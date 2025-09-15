/**
 * Base Mock CRM Connector
 * Provides common mock functionality for all CRM systems
 */

import { ICrmConnector, CrmConfig, CrmAuthTokens, CrmClient, CrmApiResponse, CrmQueryOptions, CrmSyncResult } from '../types';
import { CrmSystem } from '../../../types';
import { logger } from '../../../utils/logger';

export abstract class BaseMockConnector implements ICrmConnector {
  protected mockClients: Map<string, CrmClient> = new Map();
  protected mockTokens?: CrmAuthTokens;
  protected isHealthy: boolean = true;
  protected simulateLatency: boolean = true;
  protected latencyRange: [number, number] = [100, 500]; // milliseconds

  constructor(
    public readonly system: CrmSystem,
    public readonly config: CrmConfig
  ) {
    this.initializeMockData();
  }

  // ============================================================================
  // Abstract Methods
  // ============================================================================

  protected abstract initializeMockData(): void;

  // ============================================================================
  // Authentication Methods
  // ============================================================================

  async authenticate(authCode: string): Promise<CrmAuthTokens> {
    await this.simulateDelay();
    
    if (authCode === 'invalid_code') {
      throw new Error('Invalid authorization code');
    }

    const tokens: CrmAuthTokens = {
      accessToken: `mock_access_token_${this.system}_${Date.now()}`,
      refreshToken: `mock_refresh_token_${this.system}_${Date.now()}`,
      expiresAt: new Date(Date.now() + 3600000), // 1 hour
      tokenType: 'Bearer',
      scope: this.config.scopes?.join(' ')
    };

    this.mockTokens = tokens;
    logger.info(`Mock ${this.system} authentication successful`);
    return tokens;
  }

  async refreshToken(refreshToken: string): Promise<CrmAuthTokens> {
    await this.simulateDelay();
    
    if (!this.mockTokens || this.mockTokens.refreshToken !== refreshToken) {
      throw new Error('Invalid refresh token');
    }

    const tokens: CrmAuthTokens = {
      accessToken: `mock_access_token_${this.system}_${Date.now()}`,
      refreshToken: refreshToken, // Keep same refresh token
      expiresAt: new Date(Date.now() + 3600000), // 1 hour
      tokenType: 'Bearer',
      scope: this.mockTokens.scope
    };

    this.mockTokens = tokens;
    logger.info(`Mock ${this.system} token refresh successful`);
    return tokens;
  }

  async validateToken(tokens: CrmAuthTokens): Promise<boolean> {
    await this.simulateDelay(50, 100);
    
    if (!tokens.accessToken) {
      return false;
    }
    
    if (tokens.expiresAt && new Date() >= tokens.expiresAt) {
      return false;
    }
    
    return this.isHealthy;
  }

  // ============================================================================
  // Client Data Methods
  // ============================================================================

  async getClients(options: CrmQueryOptions = {}): Promise<CrmApiResponse<CrmClient[]>> {
    await this.simulateDelay();
    
    if (!this.isHealthy) {
      throw new Error(`Mock ${this.system} service unavailable`);
    }

    let clients = Array.from(this.mockClients.values());

    // Apply filters
    if (options.searchQuery) {
      const query = options.searchQuery.toLowerCase();
      clients = clients.filter(client => 
        client.name.toLowerCase().includes(query) ||
        client.email.toLowerCase().includes(query) ||
        client.phone.includes(query)
      );
    }

    if (options.modifiedSince) {
      clients = clients.filter(client => 
        client.updatedAt >= options.modifiedSince!
      );
    }

    // Apply sorting
    if (options.sortBy) {
      clients.sort((a, b) => {
        const aValue = (a as any)[options.sortBy!];
        const bValue = (b as any)[options.sortBy!];
        
        if (options.sortOrder === 'desc') {
          return bValue > aValue ? 1 : -1;
        }
        return aValue > bValue ? 1 : -1;
      });
    }

    // Apply pagination
    const page = options.page || 1;
    const pageSize = options.pageSize || 100;
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedClients = clients.slice(startIndex, endIndex);

    return {
      data: paginatedClients,
      pagination: {
        page,
        pageSize,
        totalPages: Math.ceil(clients.length / pageSize),
        totalRecords: clients.length,
        hasNext: endIndex < clients.length
      },
      rateLimit: {
        remaining: 4900,
        limit: 5000,
        resetTime: new Date(Date.now() + 3600000)
      }
    };
  }

  async getClient(clientId: string): Promise<CrmClient> {
    await this.simulateDelay();
    
    if (!this.isHealthy) {
      throw new Error(`Mock ${this.system} service unavailable`);
    }

    const client = this.mockClients.get(clientId);
    if (!client) {
      throw new Error(`Client ${clientId} not found`);
    }

    return { ...client }; // Return copy
  }

  async updateClient(clientId: string, data: Partial<CrmClient>): Promise<CrmClient> {
    await this.simulateDelay();
    
    if (!this.isHealthy) {
      throw new Error(`Mock ${this.system} service unavailable`);
    }

    const existingClient = this.mockClients.get(clientId);
    if (!existingClient) {
      throw new Error(`Client ${clientId} not found`);
    }

    const updatedClient: CrmClient = {
      ...existingClient,
      ...data,
      id: clientId, // Ensure ID doesn't change
      updatedAt: new Date()
    };

    this.mockClients.set(clientId, updatedClient);
    logger.debug(`Mock ${this.system}: Updated client ${clientId}`);
    
    return { ...updatedClient };
  }

  async createClient(data: Omit<CrmClient, 'id' | 'createdAt' | 'updatedAt'>): Promise<CrmClient> {
    await this.simulateDelay();
    
    if (!this.isHealthy) {
      throw new Error(`Mock ${this.system} service unavailable`);
    }

    const newClient: CrmClient = {
      ...data,
      id: this.generateMockId(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.mockClients.set(newClient.id, newClient);
    logger.debug(`Mock ${this.system}: Created client ${newClient.id}`);
    
    return { ...newClient };
  }

  async syncClients(lastSyncTime?: Date): Promise<CrmSyncResult> {
    await this.simulateDelay(1000, 3000); // Longer delay for sync operations
    
    if (!this.isHealthy) {
      throw new Error(`Mock ${this.system} sync service unavailable`);
    }

    const clients = Array.from(this.mockClients.values());
    let clientsToSync = clients;

    if (lastSyncTime) {
      clientsToSync = clients.filter(client => 
        client.updatedAt > lastSyncTime
      );
    }

    // Simulate some processing time and potential errors
    const errors: any[] = [];
    let processed = 0;
    let updated = 0;
    let created = 0;

    for (const client of clientsToSync) {
      processed++;
      
      // Simulate occasional errors (5% chance)
      if (Math.random() < 0.05) {
        errors.push({
          clientId: client.id,
          error: `Mock sync error for client ${client.id}`,
          retryable: true
        });
        continue;
      }

      // Simulate updates vs creates
      if (Math.random() < 0.7) {
        updated++;
      } else {
        created++;
      }
    }

    const result: CrmSyncResult = {
      success: errors.length === 0,
      clientsProcessed: processed,
      clientsUpdated: updated,
      clientsCreated: created,
      errors,
      lastSyncTime: new Date()
    };

    logger.info(`Mock ${this.system} sync completed`, result);
    return result;
  }

  async healthCheck(): Promise<boolean> {
    await this.simulateDelay(50, 150);
    return this.isHealthy;
  }

  // ============================================================================
  // Mock Control Methods
  // ============================================================================

  /**
   * Set mock service health status
   */
  setHealthStatus(healthy: boolean): void {
    this.isHealthy = healthy;
    logger.info(`Mock ${this.system} health status set to: ${healthy}`);
  }

  /**
   * Add a mock client
   */
  addMockClient(client: Omit<CrmClient, 'id' | 'createdAt' | 'updatedAt'>): CrmClient {
    const mockClient: CrmClient = {
      ...client,
      id: this.generateMockId(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.mockClients.set(mockClient.id, mockClient);
    return mockClient;
  }

  /**
   * Remove a mock client
   */
  removeMockClient(clientId: string): boolean {
    return this.mockClients.delete(clientId);
  }

  /**
   * Clear all mock clients
   */
  clearMockClients(): void {
    this.mockClients.clear();
  }

  /**
   * Get all mock clients
   */
  getMockClients(): CrmClient[] {
    return Array.from(this.mockClients.values());
  }

  /**
   * Set latency simulation
   */
  setLatencySimulation(enabled: boolean, minMs: number = 100, maxMs: number = 500): void {
    this.simulateLatency = enabled;
    this.latencyRange = [minMs, maxMs];
  }

  /**
   * Cleanup method for testing
   */
  cleanup(): void {
    this.mockClients.clear();
    this.mockTokens = undefined;
    this.isHealthy = true;
    this.simulateLatency = true;
    this.latencyRange = [100, 500];
  }

  /**
   * Simulate rate limiting
   */
  async simulateRateLimit(): Promise<void> {
    await this.simulateDelay(5000, 10000);
    throw new Error(`Rate limit exceeded for mock ${this.system}`);
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  protected async simulateDelay(minMs?: number, maxMs?: number): Promise<void> {
    if (!this.simulateLatency) {
      return;
    }

    const min = minMs || this.latencyRange[0];
    const max = maxMs || this.latencyRange[1];
    const delay = Math.random() * (max - min) + min;
    
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  protected generateMockId(): string {
    return `mock_${this.system}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  protected createMockClient(overrides: Partial<CrmClient> = {}): CrmClient {
    const baseClient: CrmClient = {
      id: this.generateMockId(),
      name: 'Mock Client',
      email: 'mock@example.com',
      phone: '555-0123',
      company: 'Mock Company',
      address: {
        street: '123 Mock Street',
        city: 'Mock City',
        state: 'Mock State',
        zipCode: '12345',
        country: 'Mock Country'
      },
      customFields: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      lastActivity: new Date()
    };

    return { ...baseClient, ...overrides };
  }

  protected generateMockClients(count: number): void {
    const firstNames = ['John', 'Jane', 'Bob', 'Alice', 'Charlie', 'Diana', 'Eve', 'Frank'];
    const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis'];
    const companies = ['Acme Corp', 'Global Industries', 'Tech Solutions', 'Insurance Plus', 'Financial Services'];
    const cities = ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia'];

    for (let i = 0; i < count; i++) {
      const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
      const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
      const company = companies[Math.floor(Math.random() * companies.length)];
      const city = cities[Math.floor(Math.random() * cities.length)];

      const client = this.createMockClient({
        name: `${firstName} ${lastName}`,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
        phone: `555-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`,
        company,
        address: {
          street: `${Math.floor(Math.random() * 9999) + 1} ${lastName} Street`,
          city,
          state: 'Mock State',
          zipCode: String(Math.floor(Math.random() * 90000) + 10000),
          country: 'United States'
        },
        customFields: {
          industry: company.includes('Tech') ? 'Technology' : 'Insurance',
          priority: Math.random() > 0.5 ? 'High' : 'Normal',
          source: Math.random() > 0.5 ? 'Referral' : 'Website'
        }
      });

      this.mockClients.set(client.id, client);
    }
  }
}