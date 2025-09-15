/**
 * AgencyBloc CRM Connector Implementation
 * Handles integration with AgencyBloc API
 */

import { BaseCrmConnector } from '../baseCrmConnector';
import {
  CrmAuthTokens,
  CrmClient,
  CrmApiResponse,
  CrmQueryOptions,
  AgencyBlocCrmConfig,
  AgencyBlocContact,
  CrmAuthError,
  CrmApiError
} from '../types';
import { logger } from '../../../utils/logger';

export class AgencyBlocCrmConnector extends BaseCrmConnector {
  constructor(config: AgencyBlocCrmConfig) {
    super('agencybloc', config);
  }

  // ============================================================================
  // Authentication Methods
  // ============================================================================

  async authenticate(authCode: string): Promise<CrmAuthTokens> {
    try {
      const response = await this.httpClient.post('/oauth/token', {
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
      logger.info('AgencyBloc CRM authentication successful');
      return tokens;

    } catch (error) {
      logger.error('AgencyBloc CRM authentication failed:', error);
      throw new CrmAuthError('Authentication failed', 'agencybloc');
    }
  }

  async refreshToken(refreshToken: string): Promise<CrmAuthTokens> {
    try {
      const response = await this.httpClient.post('/oauth/token', {
        grant_type: 'refresh_token',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: refreshToken
      });

      const data = response.data;
      const tokens: CrmAuthTokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        tokenType: data.token_type || 'Bearer',
        scope: data.scope
      };

      this.setTokens(tokens);
      logger.info('AgencyBloc CRM token refresh successful');
      return tokens;

    } catch (error) {
      logger.error('AgencyBloc CRM token refresh failed:', error);
      throw new CrmAuthError('Token refresh failed', 'agencybloc');
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
        '/api/v1/contacts',
        undefined,
        { params }
      );

      const data = response.data;
      const clients = data.contacts?.map((contact: AgencyBlocContact) => 
        this.transformToCrmClient(contact)
      ) || [];

      return {
        data: clients,
        pagination: this.buildPagination(data, options),
        rateLimit: this.parseRateLimit(response.headers)
      };

    } catch (error) {
      logger.error('Failed to get AgencyBloc CRM clients:', error);
      throw this.handleApiError(error);
    }
  }

  async getClient(clientId: string): Promise<CrmClient> {
    try {
      const response = await this.makeAuthenticatedRequest(
        'GET',
        `/api/v1/contacts/${clientId}`
      );

      const contact = response.data.contact;
      if (!contact) {
        throw new CrmApiError('Client not found', 'agencybloc', 'NOT_FOUND');
      }

      return this.transformToCrmClient(contact);

    } catch (error) {
      logger.error(`Failed to get AgencyBloc CRM client ${clientId}:`, error);
      throw this.handleApiError(error);
    }
  }

  async updateClient(clientId: string, data: Partial<CrmClient>): Promise<CrmClient> {
    try {
      const agencyBlocData = this.transformFromCrmClient(data);
      await this.makeAuthenticatedRequest(
        'PUT',
        `/api/v1/contacts/${clientId}`,
        { contact: agencyBlocData }
      );

      // Fetch the updated record
      return await this.getClient(clientId);

    } catch (error) {
      logger.error(`Failed to update AgencyBloc CRM client ${clientId}:`, error);
      throw this.handleApiError(error);
    }
  }

  async createClient(data: Omit<CrmClient, 'id' | 'createdAt' | 'updatedAt'>): Promise<CrmClient> {
    try {
      const agencyBlocData = this.transformFromCrmClient(data);
      const response = await this.makeAuthenticatedRequest(
        'POST',
        '/api/v1/contacts',
        { contact: agencyBlocData }
      );

      const clientId = response.data.contact?.ContactId;
      if (!clientId) {
        throw new CrmApiError('Failed to create client', 'agencybloc', 'CREATE_FAILED');
      }

      return await this.getClient(clientId.toString());

    } catch (error) {
      logger.error('Failed to create AgencyBloc CRM client:', error);
      throw this.handleApiError(error);
    }
  }

  // ============================================================================
  // Data Transformation Methods
  // ============================================================================

  protected transformToCrmClient(agencyBlocContact: AgencyBlocContact): CrmClient {
    const name = `${agencyBlocContact.FirstName || ''} ${agencyBlocContact.LastName || ''}`.trim();

    return {
      id: agencyBlocContact.ContactId.toString(),
      name,
      email: agencyBlocContact.Email || '',
      phone: agencyBlocContact.Phone || '',
      company: agencyBlocContact.Company,
      address: {
        street: agencyBlocContact.Address1,
        city: agencyBlocContact.City,
        state: agencyBlocContact.State,
        zipCode: agencyBlocContact.Zip,
        country: agencyBlocContact.Country
      },
      customFields: this.extractCustomFields(agencyBlocContact),
      createdAt: new Date(agencyBlocContact.DateCreated),
      updatedAt: new Date(agencyBlocContact.DateModified),
      lastActivity: agencyBlocContact.LastContactDate ? new Date(agencyBlocContact.LastContactDate) : undefined
    };
  }

  protected transformFromCrmClient(client: Partial<CrmClient>): Partial<AgencyBlocContact> {
    const agencyBlocData: Partial<AgencyBlocContact> = {};

    if (client.name) {
      const nameParts = client.name.split(' ');
      agencyBlocData.FirstName = nameParts[0];
      agencyBlocData.LastName = nameParts.slice(1).join(' ') || nameParts[0];
    }

    if (client.email) agencyBlocData.Email = client.email;
    if (client.phone) agencyBlocData.Phone = client.phone;
    if (client.company) agencyBlocData.Company = client.company;

    if (client.address) {
      agencyBlocData.Address1 = client.address.street;
      agencyBlocData.City = client.address.city;
      agencyBlocData.State = client.address.state;
      agencyBlocData.Zip = client.address.zipCode;
      agencyBlocData.Country = client.address.country;
    }

    // Add custom fields
    if (client.customFields) {
      Object.assign(agencyBlocData, client.customFields);
    }

    return agencyBlocData;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  protected getHealthCheckEndpoint(): string {
    return '/api/v1/contacts?limit=1';
  }

  private buildQueryParams(options: CrmQueryOptions): Record<string, any> {
    const params: Record<string, any> = {};

    if (options.pageSize) {
      params.limit = Math.min(options.pageSize, 500); // AgencyBloc max is typically 500
    }

    if (options.page && options.page > 1) {
      params.offset = (options.page - 1) * (options.pageSize || 100);
    }

    if (options.modifiedSince) {
      params.modified_since = options.modifiedSince.toISOString();
    }

    if (options.searchQuery) {
      // AgencyBloc supports various search parameters
      params.search = options.searchQuery;
    }

    if (options.sortBy) {
      params.sort_by = options.sortBy;
      params.sort_order = options.sortOrder || 'asc';
    }

    return params;
  }

  private buildPagination(data: any, options: CrmQueryOptions): any {
    if (!data) return undefined;

    const pageSize = options.pageSize || 100;
    const currentPage = options.page || 1;
    const totalRecords = data.total_count || data.contacts?.length || 0;

    return {
      page: currentPage,
      pageSize,
      totalPages: Math.ceil(totalRecords / pageSize),
      totalRecords,
      hasNext: data.has_more || false
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

  private extractCustomFields(agencyBlocContact: AgencyBlocContact): Record<string, any> {
    const customFields: Record<string, any> = {};
    const standardFields = new Set([
      'ContactId', 'FirstName', 'LastName', 'Email', 'Phone', 'Company',
      'Address1', 'City', 'State', 'Zip', 'Country', 'DateCreated', 
      'DateModified', 'LastContactDate'
    ]);

    Object.entries(agencyBlocContact).forEach(([key, value]) => {
      if (!standardFields.has(key) && value !== null && value !== undefined) {
        customFields[key] = value;
      }
    });

    return customFields;
  }
}