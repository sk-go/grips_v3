/**
 * Salesforce CRM Connector Implementation
 * Handles integration with Salesforce API
 */

import { BaseCrmConnector } from '../baseCrmConnector';
import {
  CrmAuthTokens,
  CrmClient,
  CrmApiResponse,
  CrmQueryOptions,
  SalesforceCrmConfig,
  SalesforceContact,
  CrmAuthError,
  CrmApiError
} from '../types';
import { logger } from '../../../utils/logger';

export class SalesforceCrmConnector extends BaseCrmConnector {
  private instanceUrl?: string;

  constructor(config: SalesforceCrmConfig) {
    super('salesforce', config);
    this.instanceUrl = config.instanceUrl;
  }

  // ============================================================================
  // Authentication Methods
  // ============================================================================

  async authenticate(authCode: string): Promise<CrmAuthTokens> {
    try {
      const response = await this.httpClient.post('/services/oauth2/token', {
        grant_type: 'authorization_code',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        code: authCode
      });

      const data = response.data;
      this.instanceUrl = data.instance_url;
      
      const tokens: CrmAuthTokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
        tokenType: data.token_type || 'Bearer',
        scope: data.scope
      };

      this.setTokens(tokens);
      
      // Update base URL to use instance URL
      this.httpClient.defaults.baseURL = this.instanceUrl;
      
      logger.info('Salesforce CRM authentication successful', { instanceUrl: this.instanceUrl });
      return tokens;

    } catch (error) {
      logger.error('Salesforce CRM authentication failed:', error);
      throw new CrmAuthError('Authentication failed', 'salesforce');
    }
  }

  async refreshToken(refreshToken: string): Promise<CrmAuthTokens> {
    try {
      const response = await this.httpClient.post('/services/oauth2/token', {
        grant_type: 'refresh_token',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: refreshToken
      });

      const data = response.data;
      
      const tokens: CrmAuthTokens = {
        accessToken: data.access_token,
        refreshToken: refreshToken, // Salesforce doesn't return new refresh token
        expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
        tokenType: data.token_type || 'Bearer',
        scope: data.scope
      };

      this.setTokens(tokens);
      logger.info('Salesforce CRM token refresh successful');
      return tokens;

    } catch (error) {
      logger.error('Salesforce CRM token refresh failed:', error);
      throw new CrmAuthError('Token refresh failed', 'salesforce');
    }
  }

  // ============================================================================
  // Client Data Methods
  // ============================================================================

  async getClients(options: CrmQueryOptions = {}): Promise<CrmApiResponse<CrmClient[]>> {
    try {
      const soql = this.buildSOQLQuery(options);
      const response = await this.makeAuthenticatedRequest(
        'GET',
        '/services/data/v58.0/query',
        undefined,
        { params: { q: soql } }
      );

      const data = response.data;
      const clients = data.records?.map((contact: SalesforceContact) => 
        this.transformToCrmClient(contact)
      ) || [];

      return {
        data: clients,
        pagination: this.buildPagination(data, options),
        rateLimit: this.parseRateLimit(response.headers)
      };

    } catch (error) {
      logger.error('Failed to get Salesforce CRM clients:', error);
      throw this.handleApiError(error);
    }
  }

  async getClient(clientId: string): Promise<CrmClient> {
    try {
      const response = await this.makeAuthenticatedRequest(
        'GET',
        `/services/data/v58.0/sobjects/Contact/${clientId}`
      );

      return this.transformToCrmClient(response.data);

    } catch (error) {
      logger.error(`Failed to get Salesforce CRM client ${clientId}:`, error);
      throw this.handleApiError(error);
    }
  }

  async updateClient(clientId: string, data: Partial<CrmClient>): Promise<CrmClient> {
    try {
      const salesforceData = this.transformFromCrmClient(data);
      await this.makeAuthenticatedRequest(
        'PATCH',
        `/services/data/v58.0/sobjects/Contact/${clientId}`,
        salesforceData
      );

      // Salesforce PATCH returns 204 No Content, so we need to fetch the updated record
      return await this.getClient(clientId);

    } catch (error) {
      logger.error(`Failed to update Salesforce CRM client ${clientId}:`, error);
      throw this.handleApiError(error);
    }
  }

  async createClient(data: Omit<CrmClient, 'id' | 'createdAt' | 'updatedAt'>): Promise<CrmClient> {
    try {
      const salesforceData = this.transformFromCrmClient(data);
      const response = await this.makeAuthenticatedRequest(
        'POST',
        '/services/data/v58.0/sobjects/Contact',
        salesforceData
      );

      const clientId = response.data.id;
      if (!clientId) {
        throw new CrmApiError('Failed to create client', 'salesforce', 'CREATE_FAILED');
      }

      return await this.getClient(clientId);

    } catch (error) {
      logger.error('Failed to create Salesforce CRM client:', error);
      throw this.handleApiError(error);
    }
  }

  // ============================================================================
  // Data Transformation Methods
  // ============================================================================

  protected transformToCrmClient(salesforceContact: SalesforceContact): CrmClient {
    const firstName = salesforceContact.FirstName || '';
    const lastName = salesforceContact.LastName || '';
    const name = `${firstName} ${lastName}`.trim() || salesforceContact.Name || '';

    return {
      id: salesforceContact.Id,
      name,
      email: salesforceContact.Email || '',
      phone: salesforceContact.Phone || salesforceContact.MobilePhone || '',
      company: salesforceContact.Account?.Name,
      address: {
        street: salesforceContact.MailingStreet,
        city: salesforceContact.MailingCity,
        state: salesforceContact.MailingState,
        zipCode: salesforceContact.MailingPostalCode,
        country: salesforceContact.MailingCountry
      },
      customFields: this.extractCustomFields(salesforceContact),
      createdAt: new Date(salesforceContact.CreatedDate),
      updatedAt: new Date(salesforceContact.LastModifiedDate),
      lastActivity: salesforceContact.LastActivityDate ? new Date(salesforceContact.LastActivityDate) : undefined
    };
  }

  protected transformFromCrmClient(client: Partial<CrmClient>): Partial<SalesforceContact> {
    const salesforceData: Partial<SalesforceContact> = {};

    if (client.name) {
      const nameParts = client.name.split(' ');
      salesforceData.FirstName = nameParts[0];
      salesforceData.LastName = nameParts.slice(1).join(' ') || nameParts[0];
    }

    if (client.email) salesforceData.Email = client.email;
    if (client.phone) salesforceData.Phone = client.phone;

    if (client.address) {
      salesforceData.MailingStreet = client.address.street;
      salesforceData.MailingCity = client.address.city;
      salesforceData.MailingState = client.address.state;
      salesforceData.MailingPostalCode = client.address.zipCode;
      salesforceData.MailingCountry = client.address.country;
    }

    // Add custom fields
    if (client.customFields) {
      Object.assign(salesforceData, client.customFields);
    }

    return salesforceData;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  protected getHealthCheckEndpoint(): string {
    return '/services/data/v58.0/limits';
  }

  private buildSOQLQuery(options: CrmQueryOptions): string {
    const fields = (options.fields && options.fields.length > 0)
      ? options.fields.join(', ')
      : 'Id, FirstName, LastName, Name, Email, Phone, MobilePhone, Account.Name, MailingStreet, MailingCity, MailingState, MailingPostalCode, MailingCountry, CreatedDate, LastModifiedDate, LastActivityDate';

    let soql = `SELECT ${fields} FROM Contact`;
    
    const conditions: string[] = [];

    if (options.modifiedSince) {
      conditions.push(`LastModifiedDate >= ${options.modifiedSince.toISOString()}`);
    }

    if (options.searchQuery) {
      conditions.push(`(Email LIKE '%${options.searchQuery}%' OR Phone LIKE '%${options.searchQuery}%' OR LastName LIKE '%${options.searchQuery}%')`);
    }

    if (conditions.length > 0) {
      soql += ` WHERE ${conditions.join(' AND ')}`;
    }

    if (options.sortBy) {
      soql += ` ORDER BY ${options.sortBy} ${options.sortOrder || 'ASC'}`;
    }

    if (options.pageSize) {
      soql += ` LIMIT ${Math.min(options.pageSize, 2000)}`; // Salesforce max is 2000
    }

    if (options.page && options.page > 1 && options.pageSize) {
      const offset = (options.page - 1) * options.pageSize;
      soql += ` OFFSET ${offset}`;
    }

    return soql;
  }

  private buildPagination(data: any, options: CrmQueryOptions): any {
    if (!data) return undefined;

    const pageSize = options.pageSize || 100;
    const totalRecords = data.totalSize || 0;
    const currentPage = options.page || 1;

    return {
      page: currentPage,
      pageSize,
      totalPages: Math.ceil(totalRecords / pageSize),
      totalRecords,
      hasNext: !data.done,
      nextPageToken: data.nextRecordsUrl
    };
  }

  private parseRateLimit(headers: any): any {
    // Salesforce uses different headers for API limits
    const apiUsage = headers?.['sforce-limit-info'];
    
    if (apiUsage) {
      // Parse format like "api-usage=123/15000"
      const match = apiUsage.match(/api-usage=(\d+)\/(\d+)/);
      if (match) {
        const used = parseInt(match[1]);
        const limit = parseInt(match[2]);
        return {
          remaining: limit - used,
          limit,
          resetTime: new Date(Date.now() + 24 * 60 * 60 * 1000) // Resets daily
        };
      }
    }

    return undefined;
  }

  private extractCustomFields(salesforceContact: SalesforceContact): Record<string, any> {
    const customFields: Record<string, any> = {};
    const standardFields = new Set([
      'Id', 'FirstName', 'LastName', 'Name', 'Email', 'Phone', 'MobilePhone',
      'AccountId', 'Account', 'MailingStreet', 'MailingCity', 'MailingState', 
      'MailingPostalCode', 'MailingCountry', 'CreatedDate', 'LastModifiedDate', 
      'LastActivityDate', 'attributes'
    ]);

    Object.entries(salesforceContact).forEach(([key, value]) => {
      if (!standardFields.has(key) && value !== null && value !== undefined) {
        customFields[key] = value;
      }
    });

    return customFields;
  }
}