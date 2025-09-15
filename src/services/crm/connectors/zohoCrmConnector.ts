/**
 * Zoho CRM Connector Implementation
 * Handles integration with Zoho CRM API
 */

import { BaseCrmConnector } from '../baseCrmConnector';
import {
  CrmAuthTokens,
  CrmClient,
  CrmApiResponse,
  CrmQueryOptions,
  ZohoCrmConfig,
  ZohoCrmClient,
  CrmAuthError,
  CrmApiError
} from '../types';
import { logger } from '../../../utils/logger';

export class ZohoCrmConnector extends BaseCrmConnector {
  constructor(config: ZohoCrmConfig) {
    super('zoho', config);
  }

  // ============================================================================
  // Authentication Methods
  // ============================================================================

  async authenticate(authCode: string): Promise<CrmAuthTokens> {
    try {
      const response = await this.httpClient.post('/oauth/v2/token', {
        grant_type: 'authorization_code',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        code: authCode
      });

      const data = response.data;
      const tokens: CrmAuthTokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        tokenType: data.token_type || 'Bearer',
        scope: data.scope
      };

      this.setTokens(tokens);
      logger.info('Zoho CRM authentication successful');
      return tokens;

    } catch (error) {
      logger.error('Zoho CRM authentication failed:', error);
      throw new CrmAuthError('Authentication failed', 'zoho');
    }
  }

  async refreshToken(refreshToken: string): Promise<CrmAuthTokens> {
    try {
      const response = await this.httpClient.post('/oauth/v2/token', {
        grant_type: 'refresh_token',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: refreshToken
      });

      const data = response.data;
      const tokens: CrmAuthTokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken, // Zoho may not return new refresh token
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        tokenType: data.token_type || 'Bearer',
        scope: data.scope
      };

      this.setTokens(tokens);
      logger.info('Zoho CRM token refresh successful');
      return tokens;

    } catch (error) {
      logger.error('Zoho CRM token refresh failed:', error);
      throw new CrmAuthError('Token refresh failed', 'zoho');
    }
  }

  // ============================================================================
  // Client Data Methods
  // ============================================================================

  async getClients(options: CrmQueryOptions = {}): Promise<CrmApiResponse<CrmClient[]>> {
    try {
      const params = this.buildQueryParams(options);
      const response = await this.makeAuthenticatedRequest(
        'GET',
        '/crm/v2/Contacts',
        undefined,
        { params }
      );

      const data = response.data;
      const clients = data.data?.map((contact: ZohoCrmClient) => 
        this.transformToCrmClient(contact)
      ) || [];

      return {
        data: clients,
        pagination: this.buildPagination(data.info, options),
        rateLimit: this.parseRateLimit(response.headers)
      };

    } catch (error) {
      logger.error('Failed to get Zoho CRM clients:', error);
      throw this.handleApiError(error);
    }
  }

  async getClient(clientId: string): Promise<CrmClient> {
    try {
      const response = await this.makeAuthenticatedRequest(
        'GET',
        `/crm/v2/Contacts/${clientId}`
      );

      const contact = response.data.data?.[0];
      if (!contact) {
        throw new CrmApiError('Client not found', 'zoho', 'NOT_FOUND');
      }

      return this.transformToCrmClient(contact);

    } catch (error) {
      logger.error(`Failed to get Zoho CRM client ${clientId}:`, error);
      throw this.handleApiError(error);
    }
  }

  async updateClient(clientId: string, data: Partial<CrmClient>): Promise<CrmClient> {
    try {
      const zohoData = this.transformFromCrmClient(data);
      const response = await this.makeAuthenticatedRequest(
        'PUT',
        `/crm/v2/Contacts/${clientId}`,
        { data: [{ id: clientId, ...zohoData }] }
      );

      const updatedContact = response.data.data?.[0]?.details;
      if (!updatedContact) {
        throw new CrmApiError('Failed to update client', 'zoho', 'UPDATE_FAILED');
      }

      return this.transformToCrmClient(updatedContact);

    } catch (error) {
      logger.error(`Failed to update Zoho CRM client ${clientId}:`, error);
      throw this.handleApiError(error);
    }
  }

  async createClient(data: Omit<CrmClient, 'id' | 'createdAt' | 'updatedAt'>): Promise<CrmClient> {
    try {
      const zohoData = this.transformFromCrmClient(data);
      const response = await this.makeAuthenticatedRequest(
        'POST',
        '/crm/v2/Contacts',
        { data: [zohoData] }
      );

      const createdContact = response.data.data?.[0]?.details;
      if (!createdContact) {
        throw new CrmApiError('Failed to create client', 'zoho', 'CREATE_FAILED');
      }

      return this.transformToCrmClient(createdContact);

    } catch (error) {
      logger.error('Failed to create Zoho CRM client:', error);
      throw this.handleApiError(error);
    }
  }

  // ============================================================================
  // Data Transformation Methods
  // ============================================================================

  protected transformToCrmClient(zohoContact: ZohoCrmClient): CrmClient {
    return {
      id: zohoContact.id,
      name: zohoContact.Account_Name || `${zohoContact.First_Name || ''} ${zohoContact.Last_Name || ''}`.trim(),
      email: zohoContact.Email || '',
      phone: zohoContact.Phone || '',
      company: zohoContact.Account_Name,
      address: {
        street: zohoContact.Mailing_Street,
        city: zohoContact.Mailing_City,
        state: zohoContact.Mailing_State,
        zipCode: zohoContact.Mailing_Code,
        country: zohoContact.Mailing_Country
      },
      customFields: this.extractCustomFields(zohoContact),
      createdAt: new Date(zohoContact.Created_Time),
      updatedAt: new Date(zohoContact.Modified_Time),
      lastActivity: zohoContact.Last_Activity_Time ? new Date(zohoContact.Last_Activity_Time) : undefined
    };
  }

  protected transformFromCrmClient(client: Partial<CrmClient>): Partial<ZohoCrmClient> {
    const zohoData: Partial<ZohoCrmClient> = {};

    if (client.name) {
      const nameParts = client.name.split(' ');
      zohoData.First_Name = nameParts[0];
      zohoData.Last_Name = nameParts.slice(1).join(' ') || nameParts[0];
    }

    if (client.email) zohoData.Email = client.email;
    if (client.phone) zohoData.Phone = client.phone;
    if (client.company) zohoData.Account_Name = client.company;

    if (client.address) {
      zohoData.Mailing_Street = client.address.street;
      zohoData.Mailing_City = client.address.city;
      zohoData.Mailing_State = client.address.state;
      zohoData.Mailing_Code = client.address.zipCode;
      zohoData.Mailing_Country = client.address.country;
    }

    // Add custom fields
    if (client.customFields) {
      Object.assign(zohoData, client.customFields);
    }

    return zohoData;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  protected getHealthCheckEndpoint(): string {
    return '/crm/v2/org';
  }

  private buildQueryParams(options: CrmQueryOptions): Record<string, any> {
    const params: Record<string, any> = {};

    if (options.page) {
      params.page = options.page;
    }

    if (options.pageSize) {
      params.per_page = Math.min(options.pageSize, 200); // Zoho max is 200
    }

    if (options.modifiedSince) {
      params.If_Modified_Since = options.modifiedSince.toISOString();
    }

    if (options.searchQuery) {
      params.criteria = `(Email:equals:${options.searchQuery})or(Phone:equals:${options.searchQuery})or(Last_Name:starts_with:${options.searchQuery})`;
    }

    if (options.fields && options.fields.length > 0) {
      params.fields = options.fields.join(',');
    }

    if (options.sortBy) {
      params.sort_by = options.sortBy;
      params.sort_order = options.sortOrder || 'asc';
    }

    return params;
  }

  private buildPagination(info: any, options: CrmQueryOptions): any {
    if (!info) return undefined;

    return {
      page: options.page || 1,
      pageSize: options.pageSize || 100,
      totalPages: Math.ceil((info.count || 0) / (options.pageSize || 100)),
      totalRecords: info.count || 0,
      hasNext: info.more_records || false
    };
  }

  private parseRateLimit(headers: any): any {
    const remaining = headers?.['x-ratelimit-remaining'];
    const limit = headers?.['x-ratelimit-limit'];
    const reset = headers?.['x-ratelimit-reset'];

    if (remaining && limit) {
      return {
        remaining: parseInt(remaining),
        limit: parseInt(limit),
        resetTime: reset ? new Date(parseInt(reset) * 1000) : new Date(Date.now() + 60000)
      };
    }

    return undefined;
  }

  private extractCustomFields(zohoContact: ZohoCrmClient): Record<string, any> {
    const customFields: Record<string, any> = {};
    const standardFields = new Set([
      'id', 'Account_Name', 'First_Name', 'Last_Name', 'Email', 'Phone',
      'Mailing_Street', 'Mailing_City', 'Mailing_State', 'Mailing_Code', 'Mailing_Country',
      'Created_Time', 'Modified_Time', 'Last_Activity_Time'
    ]);

    Object.entries(zohoContact).forEach(([key, value]) => {
      if (!standardFields.has(key) && value !== null && value !== undefined) {
        customFields[key] = value;
      }
    });

    return customFields;
  }
}