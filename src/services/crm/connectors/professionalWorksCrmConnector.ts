/**
 * Professional Works CRM Connector
 * Implements the ICrmConnector interface for Professional Works CRM
 * with comprehensive rate limiting and error handling
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { BaseCrmConnector } from '../baseCrmConnector';
import { ProfessionalWorksRateLimiter } from '../professionalWorksRateLimiter';
import {
  ICrmConnector,
  CrmAuthTokens,
  CrmClient,
  CrmApiResponse,
  CrmQueryOptions,
  CrmSyncResult,
  CrmError,
  CrmAuthError,
  CrmRateLimitError,
  CrmApiError,
  ProfessionalWorksCrmConfig,
  ProfessionalWorksContact,
  ProfessionalWorksAccount
} from '../types';
import { logger } from '../../../utils/logger';

export class ProfessionalWorksCrmConnector extends BaseCrmConnector implements ICrmConnector {
  readonly system = 'professional-works' as const;
  private axiosInstance: AxiosInstance;
  private instanceId: string;

  constructor(config: ProfessionalWorksCrmConfig) {
    super(config);
    this.instanceId = `pw_${config.clientId}`;
    
    this.axiosInstance = axios.create({
      baseURL: config.baseUrl || 'https://api.professional.works/api/v1',
      timeout: 30000, // 30 second timeout
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'RelationshipCarePlatform/1.0'
      }
    });

    // Initialize rate limiter
    this.initializeRateLimiter();
    
    // Setup request/response interceptors
    this.setupInterceptors();
  }

  /**
   * Initialize rate limiter with plan-specific configuration
   */
  private async initializeRateLimiter(): Promise<void> {
    try {
      await ProfessionalWorksRateLimiter.initializeConfig(
        this.instanceId,
        this.config as ProfessionalWorksCrmConfig
      );
    } catch (error) {
      logger.error('Failed to initialize PW rate limiter', {
        error,
        instanceId: this.instanceId
      });
    }
  }

  /**
   * Setup axios interceptors for rate limiting and error handling
   */
  private setupInterceptors(): void {
    // Request interceptor for rate limiting
    this.axiosInstance.interceptors.request.use(
      async (config) => {
        // Check rate limit before making request
        const rateLimitResult = await ProfessionalWorksRateLimiter.checkRateLimit(
          this.instanceId,
          'medium'
        );

        if (!rateLimitResult.allowed) {
          if (rateLimitResult.retryAfter) {
            // Apply backoff
            await this.delay(rateLimitResult.retryAfter * 1000);
            
            // Recheck after backoff
            const recheckResult = await ProfessionalWorksRateLimiter.checkRateLimit(
              this.instanceId,
              'medium'
            );
            
            if (!recheckResult.allowed) {
              throw new CrmRateLimitError(
                'Rate limit exceeded after backoff',
                'professional-works',
                new Date(Date.now() + (rateLimitResult.retryAfter || 60) * 1000)
              );
            }
          } else {
            throw new CrmRateLimitError(
              'Rate limit exceeded',
              'professional-works',
              new Date(Date.now() + 60000) // Default 1 minute
            );
          }
        }

        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for success tracking and error handling
    this.axiosInstance.interceptors.response.use(
      async (response) => {
        // Record successful request
        await ProfessionalWorksRateLimiter.recordRequest(this.instanceId);
        return response;
      },
      async (error: AxiosError) => {
        // Handle rate limit responses from API
        if (error.response?.status === 429) {
          const retryAfter = this.parseRetryAfter(error.response.headers['retry-after']);
          await ProfessionalWorksRateLimiter.handleRateLimitExceeded(
            this.instanceId,
            0 // Will be incremented by retry logic
          );
          
          throw new CrmRateLimitError(
            'API rate limit exceeded',
            'professional-works',
            new Date(Date.now() + retryAfter * 1000),
            error.response.status
          );
        }

        // Handle authentication errors
        if (error.response?.status === 401) {
          throw new CrmAuthError(
            'Authentication failed',
            'professional-works',
            error.response.status
          );
        }

        // Handle other API errors
        if (error.response) {
          const isRetryable = this.isRetryableError(error.response.status);
          throw new CrmApiError(
            error.response.data?.message || error.message,
            'professional-works',
            error.response.data?.code || 'API_ERROR',
            isRetryable,
            error.response.status
          );
        }

        // Handle network errors
        throw new CrmApiError(
          'Network error',
          'professional-works',
          'NETWORK_ERROR',
          true
        );
      }
    );
  }

  /**
   * Authenticate with Professional Works API
   */
  async authenticate(authCode: string): Promise<CrmAuthTokens> {
    try {
      const response = await this.axiosInstance.post('/oauth/token', {
        grant_type: 'authorization_code',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code: authCode,
        redirect_uri: this.config.redirectUri
      });

      const tokens: CrmAuthTokens = {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresAt: new Date(Date.now() + response.data.expires_in * 1000),
        tokenType: response.data.token_type || 'Bearer',
        scope: response.data.scope
      };

      // Set authorization header for future requests
      this.axiosInstance.defaults.headers.common['Authorization'] = 
        `${tokens.tokenType} ${tokens.accessToken}`;

      logger.info('PW authentication successful', {
        instanceId: this.instanceId,
        expiresAt: tokens.expiresAt
      });

      return tokens;
    } catch (error) {
      logger.error('PW authentication failed', { error, instanceId: this.instanceId });
      throw this.handleError(error);
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string): Promise<CrmAuthTokens> {
    try {
      const response = await this.axiosInstance.post('/oauth/token', {
        grant_type: 'refresh_token',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: refreshToken
      });

      const tokens: CrmAuthTokens = {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token || refreshToken,
        expiresAt: new Date(Date.now() + response.data.expires_in * 1000),
        tokenType: response.data.token_type || 'Bearer',
        scope: response.data.scope
      };

      // Update authorization header
      this.axiosInstance.defaults.headers.common['Authorization'] = 
        `${tokens.tokenType} ${tokens.accessToken}`;

      logger.info('PW token refresh successful', {
        instanceId: this.instanceId,
        expiresAt: tokens.expiresAt
      });

      return tokens;
    } catch (error) {
      logger.error('PW token refresh failed', { error, instanceId: this.instanceId });
      throw this.handleError(error);
    }
  }

  /**
   * Validate current token
   */
  async validateToken(tokens: CrmAuthTokens): Promise<boolean> {
    try {
      // Set token for validation request
      const tempHeaders = {
        'Authorization': `${tokens.tokenType} ${tokens.accessToken}`
      };

      await this.axiosInstance.get('/user/profile', { headers: tempHeaders });
      return true;
    } catch (error) {
      logger.warn('PW token validation failed', { error, instanceId: this.instanceId });
      return false;
    }
  }

  /**
   * Get clients with pagination and filtering
   */
  async getClients(options: CrmQueryOptions = {}): Promise<CrmApiResponse<CrmClient[]>> {
    try {
      const params = this.buildQueryParams(options);
      const response = await this.axiosInstance.get('/contacts', { params });

      const contacts: ProfessionalWorksContact[] = response.data.data || [];
      const clients = contacts.map(contact => this.mapContactToClient(contact));

      return {
        data: clients,
        pagination: {
          page: response.data.page || 1,
          pageSize: response.data.per_page || 20,
          totalPages: response.data.last_page || 1,
          totalRecords: response.data.total || clients.length,
          hasNext: response.data.current_page < response.data.last_page,
          nextPageToken: response.data.next_page_url
        },
        rateLimit: {
          remaining: parseInt(response.headers['x-ratelimit-remaining'] || '999'),
          limit: parseInt(response.headers['x-ratelimit-limit'] || '1000'),
          resetTime: new Date(response.headers['x-ratelimit-reset'] || Date.now() + 3600000)
        }
      };
    } catch (error) {
      logger.error('Failed to get PW clients', { error, instanceId: this.instanceId, options });
      throw this.handleError(error);
    }
  }

  /**
   * Get single client by ID
   */
  async getClient(clientId: string): Promise<CrmClient> {
    try {
      const response = await this.axiosInstance.get(`/contacts/${clientId}`);
      const contact: ProfessionalWorksContact = response.data.data;
      
      return this.mapContactToClient(contact);
    } catch (error) {
      logger.error('Failed to get PW client', { error, instanceId: this.instanceId, clientId });
      throw this.handleError(error);
    }
  }

  /**
   * Update client data
   */
  async updateClient(clientId: string, data: Partial<CrmClient>): Promise<CrmClient> {
    try {
      const updateData = this.mapClientToContact(data);
      const response = await this.axiosInstance.put(`/contacts/${clientId}`, updateData);
      const contact: ProfessionalWorksContact = response.data.data;
      
      return this.mapContactToClient(contact);
    } catch (error) {
      logger.error('Failed to update PW client', { error, instanceId: this.instanceId, clientId });
      throw this.handleError(error);
    }
  }

  /**
   * Create new client
   */
  async createClient(data: Omit<CrmClient, 'id' | 'createdAt' | 'updatedAt'>): Promise<CrmClient> {
    try {
      const createData = this.mapClientToContact(data);
      const response = await this.axiosInstance.post('/contacts', createData);
      const contact: ProfessionalWorksContact = response.data.data;
      
      return this.mapContactToClient(contact);
    } catch (error) {
      logger.error('Failed to create PW client', { error, instanceId: this.instanceId });
      throw this.handleError(error);
    }
  }

  /**
   * Sync clients with change tracking
   */
  async syncClients(lastSyncTime?: Date): Promise<CrmSyncResult> {
    const startTime = new Date();
    let clientsProcessed = 0;
    let clientsUpdated = 0;
    let clientsCreated = 0;
    const errors: any[] = [];

    try {
      const options: CrmQueryOptions = {
        pageSize: 100,
        sortBy: 'Modified_Time',
        sortOrder: 'desc'
      };

      if (lastSyncTime) {
        options.modifiedSince = lastSyncTime;
      }

      let hasMore = true;
      let page = 1;

      while (hasMore) {
        try {
          const response = await this.getClients({ ...options, page });
          
          for (const client of response.data) {
            try {
              clientsProcessed++;
              // Sync logic would go here - for now just count
              if (lastSyncTime && new Date(client.updatedAt) > lastSyncTime) {
                clientsUpdated++;
              } else if (!lastSyncTime) {
                clientsCreated++;
              }
            } catch (error) {
              errors.push({
                clientId: client.id,
                error: error instanceof Error ? error.message : 'Unknown error',
                retryable: true
              });
            }
          }

          hasMore = response.pagination?.hasNext || false;
          page++;
        } catch (error) {
          errors.push({
            error: error instanceof Error ? error.message : 'Unknown error',
            retryable: true
          });
          break;
        }
      }

      const result: CrmSyncResult = {
        success: errors.length === 0,
        clientsProcessed,
        clientsUpdated,
        clientsCreated,
        errors,
        lastSyncTime: startTime,
        nextSyncTime: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
      };

      logger.info('PW sync completed', {
        instanceId: this.instanceId,
        result
      });

      return result;
    } catch (error) {
      logger.error('PW sync failed', { error, instanceId: this.instanceId });
      throw this.handleError(error);
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.axiosInstance.get('/user/profile');
      return true;
    } catch (error) {
      logger.warn('PW health check failed', { error, instanceId: this.instanceId });
      return false;
    }
  }

  // Private helper methods

  private buildQueryParams(options: CrmQueryOptions): Record<string, any> {
    const params: Record<string, any> = {};

    if (options.page) params.page = options.page;
    if (options.pageSize) params.per_page = Math.min(options.pageSize, 200); // PW max
    if (options.searchQuery) params.search = options.searchQuery;
    if (options.modifiedSince) {
      params.modified_since = options.modifiedSince.toISOString();
    }
    if (options.sortBy) {
      params.sort_by = options.sortBy;
      params.sort_order = options.sortOrder || 'asc';
    }
    if (options.fields) {
      params.fields = options.fields.join(',');
    }

    return params;
  }

  private mapContactToClient(contact: ProfessionalWorksContact): CrmClient {
    return {
      id: contact.id,
      name: contact.Full_Name,
      email: contact.Email,
      phone: contact.Phone,
      company: contact.Account_Name,
      address: contact.Address ? {
        street: contact.Address,
        city: contact.City,
        state: contact.State,
        zipCode: contact.Postal_Code,
        country: contact.Country
      } : undefined,
      customFields: this.extractCustomFields(contact),
      createdAt: new Date(contact.Created_Time),
      updatedAt: new Date(contact.Modified_Time),
      lastActivity: contact.Last_Activity_Time ? new Date(contact.Last_Activity_Time) : undefined
    };
  }

  private mapClientToContact(client: Partial<CrmClient>): Partial<ProfessionalWorksContact> {
    const contact: Partial<ProfessionalWorksContact> = {};

    if (client.name) contact.Full_Name = client.name;
    if (client.email) contact.Email = client.email;
    if (client.phone) contact.Phone = client.phone;
    if (client.company) contact.Account_Name = client.company;
    
    if (client.address) {
      contact.Address = client.address.street;
      contact.City = client.address.city;
      contact.State = client.address.state;
      contact.Postal_Code = client.address.zipCode;
      contact.Country = client.address.country;
    }

    // Add custom fields
    if (client.customFields) {
      Object.assign(contact, client.customFields);
    }

    return contact;
  }

  private extractCustomFields(contact: ProfessionalWorksContact): Record<string, any> {
    const standardFields = new Set([
      'id', 'Full_Name', 'Email', 'Phone', 'Account_Name',
      'Address', 'City', 'State', 'Postal_Code', 'Country',
      'Created_Time', 'Modified_Time', 'Last_Activity_Time'
    ]);

    const customFields: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(contact)) {
      if (!standardFields.has(key) && value !== null && value !== undefined) {
        customFields[key] = value;
      }
    }

    return customFields;
  }

  private parseRetryAfter(retryAfter: string | undefined): number {
    if (!retryAfter) return 60; // Default 1 minute
    
    const seconds = parseInt(retryAfter);
    return isNaN(seconds) ? 60 : Math.min(seconds, 300); // Max 5 minutes
  }

  private isRetryableError(statusCode: number): boolean {
    // 5xx errors and some 4xx errors are retryable
    return statusCode >= 500 || statusCode === 408 || statusCode === 429;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private handleError(error: any): CrmError {
    if (error instanceof CrmError) {
      return error;
    }

    if (error.response) {
      const statusCode = error.response.status;
      const message = error.response.data?.message || error.message;
      
      if (statusCode === 401) {
        return new CrmAuthError(message, 'professional-works', statusCode);
      }
      
      if (statusCode === 429) {
        const retryAfter = this.parseRetryAfter(error.response.headers['retry-after']);
        return new CrmRateLimitError(
          message,
          'professional-works',
          new Date(Date.now() + retryAfter * 1000),
          statusCode
        );
      }
      
      return new CrmApiError(
        message,
        'professional-works',
        error.response.data?.code || 'API_ERROR',
        this.isRetryableError(statusCode),
        statusCode
      );
    }

    return new CrmApiError(
      error.message || 'Unknown error',
      'professional-works',
      'UNKNOWN_ERROR',
      true
    );
  }
}