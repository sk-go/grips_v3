/**
 * Base CRM Connector Tests
 * Tests common functionality across all CRM connectors
 */

import { BaseCrmConnector } from '../../services/crm/baseCrmConnector';
import { 
  CrmConfig, 
  CrmAuthTokens, 
  CrmClient, 
  CrmApiResponse, 
  CrmQueryOptions,
  CrmError,
  CrmAuthError,
  CrmRateLimitError 
} from '../../services/crm/types';
import { CrmSystem } from '../../types';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Test implementation of BaseCrmConnector
class TestCrmConnector extends BaseCrmConnector {
  constructor(config: CrmConfig) {
    super('zoho', config);
  }

  async authenticate(authCode: string): Promise<CrmAuthTokens> {
    return {
      accessToken: 'test-token',
      refreshToken: 'test-refresh',
      expiresAt: new Date(Date.now() + 3600000),
      tokenType: 'Bearer'
    };
  }

  async refreshToken(refreshToken: string): Promise<CrmAuthTokens> {
    return {
      accessToken: 'new-test-token',
      refreshToken: 'new-test-refresh',
      expiresAt: new Date(Date.now() + 3600000),
      tokenType: 'Bearer'
    };
  }

  async getClients(options?: CrmQueryOptions): Promise<CrmApiResponse<CrmClient[]>> {
    return {
      data: [
        {
          id: '1',
          name: 'Test Client',
          email: 'test@example.com',
          phone: '123-456-7890',
          customFields: {},
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ]
    };
  }

  async getClient(clientId: string): Promise<CrmClient> {
    return {
      id: clientId,
      name: 'Test Client',
      email: 'test@example.com',
      phone: '123-456-7890',
      customFields: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  async updateClient(clientId: string, data: Partial<CrmClient>): Promise<CrmClient> {
    return {
      id: clientId,
      name: data.name || 'Test Client',
      email: data.email || 'test@example.com',
      phone: data.phone || '123-456-7890',
      customFields: data.customFields || {},
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  async createClient(data: Omit<CrmClient, 'id' | 'createdAt' | 'updatedAt'>): Promise<CrmClient> {
    return {
      id: 'new-client-id',
      ...data,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  protected transformToCrmClient(rawData: any): CrmClient {
    return rawData;
  }

  protected transformFromCrmClient(client: Partial<CrmClient>): any {
    return client;
  }

  protected getHealthCheckEndpoint(): string {
    return '/health';
  }
}

describe('BaseCrmConnector', () => {
  let connector: TestCrmConnector;
  let mockConfig: CrmConfig;

  beforeEach(() => {
    mockConfig = {
      system: 'zoho',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'http://localhost:3000/callback',
      scopes: ['read', 'write'],
      baseUrl: 'https://api.test.com'
    };

    // Reset axios mock
    mockedAxios.create.mockReturnValue(mockedAxios);
    mockedAxios.interceptors = {
      request: { use: jest.fn() },
      response: { use: jest.fn() }
    } as any;

    connector = new TestCrmConnector(mockConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct system and config', () => {
      expect(connector.system).toBe('zoho');
      expect(connector.config).toEqual(mockConfig);
    });

    it('should create axios instance with correct configuration', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: mockConfig.baseUrl,
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'RelationshipCarePlatform/1.0'
        }
      });
    });
  });

  describe('validateToken', () => {
    it('should return false for missing access token', async () => {
      const tokens: CrmAuthTokens = {
        accessToken: '',
        refreshToken: 'refresh',
        expiresAt: new Date(Date.now() + 3600000),
        tokenType: 'Bearer'
      };

      const result = await connector.validateToken(tokens);
      expect(result).toBe(false);
    });

    it('should return false for expired token', async () => {
      const tokens: CrmAuthTokens = {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: new Date(Date.now() - 1000), // Expired
        tokenType: 'Bearer'
      };

      const result = await connector.validateToken(tokens);
      expect(result).toBe(false);
    });

    it('should return true for valid token', async () => {
      const tokens: CrmAuthTokens = {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: new Date(Date.now() + 3600000),
        tokenType: 'Bearer'
      };

      // Mock successful API call
      mockedAxios.request.mockResolvedValueOnce({ data: {} });
      connector['setTokens'](tokens);

      const result = await connector.validateToken(tokens);
      expect(result).toBe(true);
    });
  });

  describe('healthCheck', () => {
    it('should return false when no tokens are set', async () => {
      const result = await connector.healthCheck();
      expect(result).toBe(false);
    });

    it('should return true when health check succeeds', async () => {
      const tokens: CrmAuthTokens = {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: new Date(Date.now() + 3600000),
        tokenType: 'Bearer'
      };

      connector['setTokens'](tokens);
      mockedAxios.request.mockResolvedValueOnce({ data: {} });

      const result = await connector.healthCheck();
      expect(result).toBe(true);
    });

    it('should return false when health check fails', async () => {
      const tokens: CrmAuthTokens = {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: new Date(Date.now() + 3600000),
        tokenType: 'Bearer'
      };

      connector['setTokens'](tokens);
      mockedAxios.request.mockRejectedValueOnce(new Error('API Error'));

      const result = await connector.healthCheck();
      expect(result).toBe(false);
    });
  });

  describe('handleApiError', () => {
    it('should handle 401 authentication errors', () => {
      const axiosError = {
        isAxiosError: true,
        response: {
          status: 401,
          data: { message: 'Unauthorized' }
        }
      };

      mockedAxios.isAxiosError.mockReturnValue(true);
      const error = connector['handleApiError'](axiosError);

      expect(error).toBeInstanceOf(CrmAuthError);
      expect(error.code).toBe('AUTH_ERROR');
      expect(error.system).toBe('zoho');
    });

    it('should handle 429 rate limit errors', () => {
      const resetTime = new Date(Date.now() + 60000);
      const axiosError = {
        isAxiosError: true,
        response: {
          status: 429,
          data: { message: 'Rate limit exceeded' },
          headers: { 'x-ratelimit-reset': Math.floor(resetTime.getTime() / 1000).toString() }
        }
      };

      mockedAxios.isAxiosError.mockReturnValue(true);
      const error = connector['handleApiError'](axiosError);

      expect(error).toBeInstanceOf(CrmRateLimitError);
      expect(error.code).toBe('RATE_LIMIT');
      expect(error.retryable).toBe(true);
    });

    it('should handle 500 server errors as retryable', () => {
      const axiosError = {
        isAxiosError: true,
        response: {
          status: 500,
          data: { message: 'Internal server error' }
        }
      };

      mockedAxios.isAxiosError.mockReturnValue(true);
      const error = connector['handleApiError'](axiosError);

      expect(error.code).toBe('SERVER_ERROR');
      expect(error.retryable).toBe(true);
    });

    it('should handle 400 bad request errors as non-retryable', () => {
      const axiosError = {
        isAxiosError: true,
        response: {
          status: 400,
          data: { message: 'Bad request' }
        }
      };

      mockedAxios.isAxiosError.mockReturnValue(true);
      const error = connector['handleApiError'](axiosError);

      expect(error.code).toBe('BAD_REQUEST');
      expect(error.retryable).toBe(false);
    });
  });

  describe('syncClients', () => {
    beforeEach(() => {
      const tokens: CrmAuthTokens = {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: new Date(Date.now() + 3600000),
        tokenType: 'Bearer'
      };
      connector['setTokens'](tokens);
    });

    it('should successfully sync clients', async () => {
      // Mock successful API response
      mockedAxios.request.mockResolvedValueOnce({
        data: [
          { id: '1', name: 'Client 1' },
          { id: '2', name: 'Client 2' }
        ],
        pagination: { hasNext: false },
        headers: {}
      });

      const result = await connector.syncClients();

      expect(result.success).toBe(true);
      expect(result.clientsProcessed).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle pagination correctly', async () => {
      // Mock paginated responses
      mockedAxios.request
        .mockResolvedValueOnce({
          data: [{ id: '1', name: 'Client 1' }],
          pagination: { hasNext: true },
          headers: {}
        })
        .mockResolvedValueOnce({
          data: [{ id: '2', name: 'Client 2' }],
          pagination: { hasNext: false },
          headers: {}
        });

      const result = await connector.syncClients();

      expect(result.success).toBe(true);
      expect(result.clientsProcessed).toBe(2);
      expect(mockedAxios.request).toHaveBeenCalledTimes(2);
    });

    it('should handle rate limiting', async () => {
      // Mock response with low rate limit
      mockedAxios.request.mockResolvedValueOnce({
        data: [{ id: '1', name: 'Client 1' }],
        pagination: { hasNext: false },
        rateLimit: {
          remaining: 5,
          limit: 100,
          resetTime: new Date(Date.now() + 1000)
        },
        headers: {}
      });

      const result = await connector.syncClients();

      expect(result.success).toBe(true);
      expect(result.clientsProcessed).toBe(1);
    });

    it('should handle sync errors gracefully', async () => {
      mockedAxios.request.mockRejectedValueOnce(new Error('API Error'));

      const result = await connector.syncClients();

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('API Error');
    });
  });

  describe('makeAuthenticatedRequest', () => {
    it('should throw error when no tokens are available', async () => {
      await expect(
        connector['makeAuthenticatedRequest']('GET', '/test')
      ).rejects.toThrow(CrmAuthError);
    });

    it('should make authenticated request with correct headers', async () => {
      const tokens: CrmAuthTokens = {
        accessToken: 'test-token',
        refreshToken: 'refresh',
        expiresAt: new Date(Date.now() + 3600000),
        tokenType: 'Bearer'
      };

      connector['setTokens'](tokens);
      mockedAxios.request.mockResolvedValueOnce({ data: { success: true } });

      await connector['makeAuthenticatedRequest']('GET', '/test');

      expect(mockedAxios.request).toHaveBeenCalledWith({
        method: 'GET',
        url: '/test',
        data: undefined,
        headers: {
          'Authorization': 'Bearer test-token'
        }
      });
    });
  });

  describe('parseRateLimitReset', () => {
    it('should parse Unix timestamp correctly', () => {
      const timestamp = Math.floor(Date.now() / 1000) + 3600;
      const headers = { 'x-ratelimit-reset': timestamp.toString() };
      
      const resetTime = connector['parseRateLimitReset'](headers);
      
      expect(resetTime.getTime()).toBeCloseTo(timestamp * 1000, -1000);
    });

    it('should parse seconds from now correctly', () => {
      const headers = { 'retry-after': '60' };
      
      const resetTime = connector['parseRateLimitReset'](headers);
      
      expect(resetTime.getTime()).toBeCloseTo(Date.now() + 60000, -1000);
    });

    it('should return default time when no headers present', () => {
      const headers = {};
      
      const resetTime = connector['parseRateLimitReset'](headers);
      
      expect(resetTime.getTime()).toBeCloseTo(Date.now() + 60000, -1000);
    });
  });
});