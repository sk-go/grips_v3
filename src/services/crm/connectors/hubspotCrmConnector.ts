/**
 * HubSpot CRM Connector Implementation
 * Handles integration with HubSpot API
 */

import { BaseCrmConnector } from '../baseCrmConnector';
import {
  CrmAuthTokens,
  CrmClient,
  CrmApiResponse,
  CrmQueryOptions,
  HubSpotCrmConfig,
  HubSpotContact,
  CrmAuthError,
  CrmApiError
} from '../types';
import { logger } from '../../../utils/logger';

export class HubSpotCrmConnector extends BaseCrmConnector {
  constructor(config: HubSpotCrmConfig) {
    super('hubspot', config);
  }

  // ============================================================================
  // Authentication Methods
  // ============================================================================

  async authenticate(authCode: string): Promise<CrmAuthTokens> {
    try {
      const response = await this.httpClient.post('/oauth/v1/token', {
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
      logger.info('HubSpot CRM authentication successful');
      return tokens;

    } catch (error) {
      logger.error('HubSpot CRM authentication failed:', error);
      throw new CrmAuthError('Authentication failed', 'hubspot');
    }
  }

  async refreshToken(refreshToken: string): Promise<CrmAuthTokens> {
    try {
      const response = await this.httpClient.post('/oauth/v1/token', {
        grant_type: 'refresh_token',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: refreshToken
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
      logger.info('HubSpot CRM token refresh successful');
      return tokens;

    } catch (error) {
      logger.error('HubSpot CRM token refresh failed:', error);
      throw new CrmAuthError('Token refresh failed', 'hubspot');
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
        '/crm/v3/objects/contacts',
        undefined,
        { params }
      );

      const data = response.data;
      const clients = data.results?.map((contact: HubSpotContact) => 
        this.transformToCrmClient(contact)
      ) || [];

      return {
        data: clients,
        pagination: this.buildPagination(data, options),
        rateLimit: this.parseRateLimit(response.headers)
      };

    } catch (error) {
      logger.error('Failed to get HubSpot CRM clients:', error);
      throw this.handleApiError(error);
    }
  }

  async getClient(clientId: string): Promise<CrmClient> {
    try {
      const response = await this.makeAuthenticatedRequest(
        'GET',
        `/crm/v3/objects/contacts/${clientId}`,
        undefined,
        {
          params: {
            properties: 'firstname,lastname,email,phone,company,address,city,state,zip,country,createdate,lastmodifieddate,notes_last_contacted'
          }
        }
      );

      return this.transformToCrmClient(response.data);

    } catch (error) {
      logger.error(`Failed to get HubSpot CRM client ${clientId}:`, error);
      throw this.handleApiError(error);
    }
  }

  async updateClient(clientId: string, data: Partial<CrmClient>): Promise<CrmClient> {
    try {
      const hubspotData = this.transformFromCrmClient(data);
      await this.makeAuthenticatedRequest(
        'PATCH',
        `/crm/v3/objects/contacts/${clientId}`,
        { properties: hubspotData }
      );

      // Fetch the updated record
      return await this.getClient(clientId);

    } catch (error) {
      logger.error(`Failed to update HubSpot CRM client ${clientId}:`, error);
      throw this.handleApiError(error);
    }
  }

  async createClient(data: Omit<CrmClient, 'id' | 'createdAt' | 'updatedAt'>): Promise<CrmClient> {
    try {
      const hubspotData = this.transformFromCrmClient(data);
      const response = await this.makeAuthenticatedRequest(
        'POST',
        '/crm/v3/objects/contacts',
        { properties: hubspotData }
      );

      const clientId = response.data.id;
      if (!clientId) {
        throw new CrmApiError('Failed to create client', 'hubspot', 'CREATE_FAILED');
      }

      return await this.getClient(clientId);

    } catch (error) {
      logger.error('Failed to create HubSpot CRM client:', error);
      throw this.handleApiError(error);
    }
  }

  // ============================================================================
  // Data Transformation Methods
  // ============================================================================

  protected transformToCrmClient(hubspotContact: HubSpotContact): CrmClient {
    const props = hubspotContact.properties;
    const firstName = props.firstname || '';
    const lastName = props.lastname || '';
    const name = `${firstName} ${lastName}`.trim();

    return {
      id: hubspotContact.id,
      name,
      email: props.email || '',
      phone: props.phone || '',
      company: props.company,
      address: {
        street: props.address,
        city: props.city,
        state: props.state,
        zipCode: props.zip,
        country: props.country
      },
      customFields: this.extractCustomFields(props),
      createdAt: props.createdate ? new Date(props.createdate) : new Date(),
      updatedAt: props.lastmodifieddate ? new Date(props.lastmodifieddate) : new Date(),
      lastActivity: props.notes_last_contacted ? new Date(props.notes_last_contacted) : undefined
    };
  }

  protected transformFromCrmClient(client: Partial<CrmClient>): Record<string, any> {
    const hubspotData: Record<string, any> = {};

    if (client.name) {
      const nameParts = client.name.split(' ');
      hubspotData.firstname = nameParts[0];
      hubspotData.lastname = nameParts.slice(1).join(' ') || nameParts[0];
    }

    if (client.email) hubspotData.email = client.email;
    if (client.phone) hubspotData.phone = client.phone;
    if (client.company) hubspotData.company = client.company;

    if (client.address) {
      if (client.address.street) hubspotData.address = client.address.street;
      if (client.address.city) hubspotData.city = client.address.city;
      if (client.address.state) hubspotData.state = client.address.state;
      if (client.address.zipCode) hubspotData.zip = client.address.zipCode;
      if (client.address.country) hubspotData.country = client.address.country;
    }

    // Add custom fields
    if (client.customFields) {
      Object.assign(hubspotData, client.customFields);
    }

    return hubspotData;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  protected getHealthCheckEndpoint(): string {
    return '/crm/v3/objects/contacts?limit=1';
  }

  private buildQueryParams(options: CrmQueryOptions): Record<string, any> {
    const params: Record<string, any> = {
      properties: 'firstname,lastname,email,phone,company,address,city,state,zip,country,createdate,lastmodifieddate,notes_last_contacted'
    };

    if (options.pageSize) {
      params.limit = Math.min(options.pageSize, 100); // HubSpot max is 100
    }

    if (options.page && options.page > 1) {
      // HubSpot uses offset-based pagination
      params.after = ((options.page - 1) * (options.pageSize || 100)).toString();
    }

    // HubSpot doesn't support modifiedSince in the same way, but we can use filters
    if (options.modifiedSince) {
      // This would require using the search API instead
      logger.warn('HubSpot connector: modifiedSince filtering requires search API implementation');
    }

    if (options.searchQuery) {
      // For search, we'd need to use the search API endpoint
      logger.warn('HubSpot connector: search query requires search API implementation');
    }

    return params;
  }

  private buildPagination(data: any, options: CrmQueryOptions): any {
    if (!data) return undefined;

    const pageSize = options.pageSize || 100;
    const currentPage = options.page || 1;
    const hasNext = !!data.paging?.next;

    return {
      page: currentPage,
      pageSize,
      totalPages: hasNext ? currentPage + 1 : currentPage, // HubSpot doesn't provide total count
      totalRecords: data.total || data.results?.length || 0,
      hasNext,
      nextPageToken: data.paging?.next?.after
    };
  }

  private parseRateLimit(headers: any): any {
    const remaining = headers?.['x-hubspot-ratelimit-remaining'];
    const limit = headers?.['x-hubspot-ratelimit-limit'];
    const resetInterval = headers?.['x-hubspot-ratelimit-interval-milliseconds'];

    if (remaining && limit) {
      const resetTime = resetInterval 
        ? new Date(Date.now() + parseInt(resetInterval))
        : new Date(Date.now() + 10000); // Default 10 seconds

      return {
        remaining: parseInt(remaining),
        limit: parseInt(limit),
        resetTime
      };
    }

    return undefined;
  }

  private extractCustomFields(properties: Record<string, any>): Record<string, any> {
    const customFields: Record<string, any> = {};
    const standardFields = new Set([
      'firstname', 'lastname', 'email', 'phone', 'company', 'address',
      'city', 'state', 'zip', 'country', 'createdate', 'lastmodifieddate',
      'notes_last_contacted'
    ]);

    Object.entries(properties).forEach(([key, value]) => {
      if (!standardFields.has(key) && value !== null && value !== undefined) {
        customFields[key] = value;
      }
    });

    return customFields;
  }
}