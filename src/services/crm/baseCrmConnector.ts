/**
 * Base CRM Connector Implementation
 * Provides common functionality for all CRM connectors
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { 
  ICrmConnector, 
  CrmConfig, 
  CrmAuthTokens, 
  CrmClient, 
  CrmApiResponse, 
  CrmQueryOptions,
  CrmSyncResult,
  CrmError,
  CrmAuthError,
  CrmRateLimitError,
  CrmApiError
} from './types';
import { CrmSystem } from '../../types';
import { logger } from '../../utils/logger';

export abstract class BaseCrmConnector implements ICrmConnector {
  protected httpClient: AxiosInstance;
  protected tokens?: CrmAuthTokens;
  
  constructor(
    public readonly system: CrmSystem,
    public readonly config: CrmConfig
  ) {
    this.httpClient = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'RelationshipCarePlatform/1.0'
      }
    });
    
    this.setupInterceptors();
  }

  // ============================================================================
  // Abstract Methods (must be implemented by subclasses)
  // ============================================================================

  abstract authenticate(authCode: string): Promise<CrmAuthTokens>;
  abstract refreshToken(refreshToken: string): Promise<CrmAuthTokens>;
  abstract getClients(options?: CrmQueryOptions): Promise<CrmApiResponse<CrmClient[]>>;
  abstract getClient(clientId: string): Promise<CrmClient>;
  abstract updateClient(clientId: string, data: Partial<CrmClient>): Promise<CrmClient>;
  abstract createClient(data: Omit<CrmClient, 'id' | 'createdAt' | 'updatedAt'>): Promise<CrmClient>;
  
  // Transform methods (CRM-specific data mapping)
  protected abstract transformToCrmClient(rawData: any): CrmClient;
  protected abstract transformFromCrmClient(client: Partial<CrmClient>): any;

  // ============================================================================
  // Common Implementation Methods
  // ============================================================================

  async validateToken(tokens: CrmAuthTokens): Promise<boolean> {
    try {
      if (!tokens.accessToken) {
        return false;
      }
      
      if (tokens.expiresAt && new Date() >= tokens.expiresAt) {
        return false;
      }
      
      // Test the token with a simple API call
      await this.makeAuthenticatedRequest('GET', this.getHealthCheckEndpoint());
      return true;
    } catch (error) {
      logger.warn(`Token validation failed for ${this.system}:`, error);
      return false;
    }
  }

  async syncClients(lastSyncTime?: Date): Promise<CrmSyncResult> {
    const startTime = new Date();
    const result: CrmSyncResult = {
      success: false,
      clientsProcessed: 0,
      clientsUpdated: 0,
      clientsCreated: 0,
      errors: [],
      lastSyncTime: startTime
    };

    try {
      logger.info(`Starting CRM sync for ${this.system}`, { lastSyncTime });
      
      const options: CrmQueryOptions = {
        pageSize: 100,
        modifiedSince: lastSyncTime
      };
      
      let hasMore = true;
      let page = 1;
      
      while (hasMore) {
        try {
          options.page = page;
          const response = await this.getClients(options);
          
          for (const client of response.data) {
            try {
              result.clientsProcessed++;
              // Note: Actual sync logic would be implemented in the sync service
              // This is just tracking the API calls
              logger.debug(`Processed client ${client.id} from ${this.system}`);
            } catch (clientError) {
              result.errors.push({
                clientId: client.id,
                error: clientError instanceof Error ? clientError.message : 'Unknown error',
                retryable: !(clientError instanceof CrmAuthError)
              });
            }
          }
          
          hasMore = response.pagination?.hasNext ?? false;
          page++;
          
          // Rate limiting protection
          if (response.rateLimit && response.rateLimit.remaining < 10) {
            const waitTime = Math.max(1000, response.rateLimit.resetTime.getTime() - Date.now());
            logger.info(`Rate limit approaching, waiting ${waitTime}ms`);
            await this.sleep(waitTime);
          }
          
        } catch (pageError) {
          logger.error(`Error processing page ${page} for ${this.system}:`, pageError);
          result.errors.push({
            error: `Page ${page}: ${pageError instanceof Error ? pageError.message : 'Unknown error'}`,
            retryable: !(pageError instanceof CrmAuthError)
          });
          break;
        }
      }
      
      result.success = result.errors.length === 0;
      result.lastSyncTime = new Date();
      
      logger.info(`CRM sync completed for ${this.system}`, {
        success: result.success,
        processed: result.clientsProcessed,
        errors: result.errors.length
      });
      
      return result;
      
    } catch (error) {
      logger.error(`CRM sync failed for ${this.system}:`, error);
      result.errors.push({
        error: error instanceof Error ? error.message : 'Sync failed',
        retryable: !(error instanceof CrmAuthError)
      });
      return result;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.tokens) {
        return false;
      }
      
      await this.makeAuthenticatedRequest('GET', this.getHealthCheckEndpoint());
      return true;
    } catch (error) {
      logger.warn(`Health check failed for ${this.system}:`, error);
      return false;
    }
  }

  // ============================================================================
  // Protected Helper Methods
  // ============================================================================

  protected async makeAuthenticatedRequest<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    if (!this.tokens) {
      throw new CrmAuthError('No authentication tokens available', this.system);
    }

    const requestConfig: AxiosRequestConfig = {
      method,
      url,
      data,
      headers: {
        'Authorization': `${this.tokens.tokenType} ${this.tokens.accessToken}`,
        ...config?.headers
      },
      ...config
    };

    try {
      const response = await this.httpClient.request<T>(requestConfig);
      return response;
    } catch (error) {
      throw this.handleApiError(error);
    }
  }

  protected handleApiError(error: any): CrmError {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message = error.response?.data?.message || error.message;
      
      switch (status) {
        case 401:
          return new CrmAuthError(`Authentication failed: ${message}`, this.system, status);
        case 429:
          const resetTime = this.parseRateLimitReset(error.response?.headers);
          return new CrmRateLimitError(`Rate limit exceeded: ${message}`, this.system, resetTime, status);
        case 400:
          return new CrmApiError(`Bad request: ${message}`, this.system, 'BAD_REQUEST', false, status);
        case 404:
          return new CrmApiError(`Resource not found: ${message}`, this.system, 'NOT_FOUND', false, status);
        case 500:
        case 502:
        case 503:
        case 504:
          return new CrmApiError(`Server error: ${message}`, this.system, 'SERVER_ERROR', true, status);
        default:
          return new CrmApiError(`API error: ${message}`, this.system, 'UNKNOWN_ERROR', true, status);
      }
    }
    
    return new CrmError(
      error instanceof Error ? error.message : 'Unknown error',
      'UNKNOWN_ERROR',
      this.system,
      true
    );
  }

  protected parseRateLimitReset(headers: any): Date {
    // Try common rate limit headers
    const resetHeader = headers?.['x-ratelimit-reset'] || 
                       headers?.['x-rate-limit-reset'] || 
                       headers?.['retry-after'];
    
    if (resetHeader) {
      const resetTime = parseInt(resetHeader);
      if (!isNaN(resetTime)) {
        // If it's a Unix timestamp
        if (resetTime > 1000000000) {
          return new Date(resetTime * 1000);
        }
        // If it's seconds from now
        return new Date(Date.now() + resetTime * 1000);
      }
    }
    
    // Default to 1 minute from now
    return new Date(Date.now() + 60000);
  }

  protected async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  protected setTokens(tokens: CrmAuthTokens): void {
    this.tokens = tokens;
  }

  protected getTokens(): CrmAuthTokens | undefined {
    return this.tokens;
  }

  protected abstract getHealthCheckEndpoint(): string;

  // ============================================================================
  // HTTP Client Setup
  // ============================================================================

  private setupInterceptors(): void {
    // Request interceptor for logging
    this.httpClient.interceptors.request.use(
      (config) => {
        logger.debug(`${this.system} API Request:`, {
          method: config.method?.toUpperCase(),
          url: config.url,
          headers: this.sanitizeHeaders(config.headers)
        });
        return config;
      },
      (error) => {
        logger.error(`${this.system} API Request Error:`, error);
        return Promise.reject(error);
      }
    );

    // Response interceptor for logging and error handling
    this.httpClient.interceptors.response.use(
      (response) => {
        logger.debug(`${this.system} API Response:`, {
          status: response.status,
          url: response.config.url,
          dataSize: JSON.stringify(response.data).length
        });
        return response;
      },
      (error) => {
        logger.error(`${this.system} API Response Error:`, {
          status: error.response?.status,
          url: error.config?.url,
          message: error.response?.data?.message || error.message
        });
        return Promise.reject(error);
      }
    );
  }

  private sanitizeHeaders(headers: any): any {
    if (!headers) return {};
    
    const sanitized = { ...headers };
    
    // Remove sensitive headers from logs
    const sensitiveHeaders = ['authorization', 'x-api-key', 'cookie'];
    sensitiveHeaders.forEach(header => {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }
}