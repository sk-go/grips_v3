/**
 * Mock CRM Connector Factory
 * Creates and manages mock CRM connector instances for development and testing
 */

import { ICrmConnector, CrmConfig } from '../types';
import { CrmSystem } from '../../../types';
import { ZohoMockConnector } from './zohoMockConnector';
import { SalesforceMockConnector } from './salesforceMockConnector';
import { HubSpotMockConnector } from './hubspotMockConnector';
import { AgencyBlocMockConnector } from './agencyBlocMockConnector';
import { logger } from '../../../utils/logger';

export interface MockScenario {
  name: string;
  description: string;
  setup: (connector: ICrmConnector) => Promise<void>;
}

export class MockConnectorFactory {
  private static mockConnectors: Map<string, ICrmConnector> = new Map();
  private static scenarios: Map<string, MockScenario> = new Map();

  /**
   * Create a mock CRM connector instance
   */
  static createMockConnector(config: CrmConfig): ICrmConnector {
    const key = `mock_${config.system}_${config.clientId}`;
    
    // Return existing mock connector if available
    if (this.mockConnectors.has(key)) {
      return this.mockConnectors.get(key)!;
    }

    let connector: ICrmConnector;

    switch (config.system) {
      case 'zoho':
        connector = new ZohoMockConnector(config as any);
        break;
      
      case 'salesforce':
        connector = new SalesforceMockConnector(config as any);
        break;
      
      case 'hubspot':
        connector = new HubSpotMockConnector(config as any);
        break;
      
      case 'agencybloc':
        connector = new AgencyBlocMockConnector(config as any);
        break;
      
      default:
        throw new Error(`Unsupported mock CRM system: ${config.system}`);
    }

    // Cache the mock connector
    this.mockConnectors.set(key, connector);
    
    logger.info(`Created mock CRM connector for ${config.system}`, { 
      clientId: config.clientId,
      baseUrl: config.baseUrl 
    });

    return connector;
  }

  /**
   * Get an existing mock connector
   */
  static getMockConnector(system: CrmSystem, clientId: string): ICrmConnector | undefined {
    const key = `mock_${system}_${clientId}`;
    return this.mockConnectors.get(key);
  }

  /**
   * Remove a mock connector from cache
   */
  static removeMockConnector(system: CrmSystem, clientId: string): void {
    const key = `mock_${system}_${clientId}`;
    this.mockConnectors.delete(key);
    logger.info(`Removed mock CRM connector for ${system}`, { clientId });
  }

  /**
   * Get all active mock connectors
   */
  static getAllMockConnectors(): ICrmConnector[] {
    return Array.from(this.mockConnectors.values());
  }

  /**
   * Clear all mock connectors
   */
  static clearAllMockConnectors(): void {
    this.mockConnectors.clear();
    logger.info('Cleared all mock CRM connectors');
  }

  /**
   * Create default mock configurations for all supported CRM systems
   */
  static createDefaultMockConfigs(): Record<CrmSystem, CrmConfig> {
    return {
      zoho: {
        system: 'zoho',
        clientId: 'mock_zoho_client',
        clientSecret: 'mock_zoho_secret',
        redirectUri: 'http://localhost:3000/auth/zoho/callback',
        scopes: ['ZohoCRM.modules.ALL', 'ZohoCRM.settings.ALL'],
        baseUrl: 'https://mock-accounts.zoho.com',
        apiVersion: 'v2'
      },

      salesforce: {
        system: 'salesforce',
        clientId: 'mock_sf_client',
        clientSecret: 'mock_sf_secret',
        redirectUri: 'http://localhost:3000/auth/salesforce/callback',
        scopes: ['api', 'refresh_token', 'offline_access'],
        baseUrl: 'https://mock-login.salesforce.com',
        apiVersion: 'v58.0'
      },

      hubspot: {
        system: 'hubspot',
        clientId: 'mock_hs_client',
        clientSecret: 'mock_hs_secret',
        redirectUri: 'http://localhost:3000/auth/hubspot/callback',
        scopes: ['contacts', 'crm.objects.contacts.read', 'crm.objects.contacts.write'],
        baseUrl: 'https://mock-api.hubapi.com',
        apiVersion: 'v3'
      },

      agencybloc: {
        system: 'agencybloc',
        clientId: 'mock_ab_client',
        clientSecret: 'mock_ab_secret',
        redirectUri: 'http://localhost:3000/auth/agencybloc/callback',
        scopes: ['contacts:read', 'contacts:write'],
        baseUrl: 'https://mock-api.agencybloc.com',
        apiVersion: 'v1'
      }
    };
  }

  /**
   * Setup predefined test scenarios
   */
  static initializeTestScenarios(): void {
    // High-volume scenario
    this.scenarios.set('high_volume', {
      name: 'High Volume',
      description: 'Large number of clients for performance testing',
      setup: async (connector: any) => {
        connector.clearMockClients();
        connector.generateMockClients(1000);
        connector.setLatencySimulation(true, 50, 200);
        logger.info('Setup high volume scenario with 1000 clients');
      }
    });

    // Error scenario
    this.scenarios.set('error_prone', {
      name: 'Error Prone',
      description: 'Simulates various API errors and failures',
      setup: async (connector: any) => {
        connector.setHealthStatus(false);
        connector.setLatencySimulation(true, 1000, 3000);
        logger.info('Setup error prone scenario');
      }
    });

    // Rate limiting scenario
    this.scenarios.set('rate_limited', {
      name: 'Rate Limited',
      description: 'Simulates rate limiting behavior',
      setup: async (connector: any) => {
        connector.setLatencySimulation(true, 2000, 5000);
        // Would need to implement rate limiting simulation in base mock
        logger.info('Setup rate limited scenario');
      }
    });

    // Minimal data scenario
    this.scenarios.set('minimal_data', {
      name: 'Minimal Data',
      description: 'Small dataset for quick testing',
      setup: async (connector: any) => {
        connector.clearMockClients();
        connector.generateMockClients(5);
        connector.setLatencySimulation(false);
        logger.info('Setup minimal data scenario with 5 clients');
      }
    });

    // Mixed data scenario
    this.scenarios.set('mixed_data', {
      name: 'Mixed Data',
      description: 'Variety of client types and data patterns',
      setup: async (connector: any) => {
        connector.clearMockClients();
        connector.generateMockClients(50);
        
        // Add specific test cases
        connector.addMockClient({
          name: 'Test Client - Special Characters',
          email: 'test+special@example.com',
          phone: '+1-555-123-4567',
          company: 'Special & Characters Corp.',
          customFields: {
            'unicode_field': 'Unicode: 你好世界 🌍',
            'special_chars': 'Special: !@#$%^&*()',
            'long_text': 'A'.repeat(1000)
          }
        });

        connector.addMockClient({
          name: 'Test Client - Empty Fields',
          email: '',
          phone: '',
          company: '',
          customFields: {}
        });

        logger.info('Setup mixed data scenario with variety of client types');
      }
    });

    logger.info('Initialized mock test scenarios', { 
      scenarios: Array.from(this.scenarios.keys()) 
    });
  }

  /**
   * Apply a test scenario to a mock connector
   */
  static async applyScenario(
    connector: ICrmConnector, 
    scenarioName: string
  ): Promise<void> {
    const scenario = this.scenarios.get(scenarioName);
    if (!scenario) {
      throw new Error(`Unknown test scenario: ${scenarioName}`);
    }

    logger.info(`Applying scenario "${scenario.name}" to ${connector.system} mock`);
    await scenario.setup(connector);
  }

  /**
   * Get available test scenarios
   */
  static getAvailableScenarios(): MockScenario[] {
    return Array.from(this.scenarios.values());
  }

  /**
   * Create a comprehensive test environment with all CRM systems
   */
  static async createTestEnvironment(scenarioName: string = 'mixed_data'): Promise<Record<CrmSystem, ICrmConnector>> {
    const configs = this.createDefaultMockConfigs();
    const connectors: Record<CrmSystem, ICrmConnector> = {} as any;

    for (const [system, config] of Object.entries(configs)) {
      const connector = this.createMockConnector(config);
      await this.applyScenario(connector, scenarioName);
      connectors[system as CrmSystem] = connector;
    }

    logger.info(`Created test environment with scenario: ${scenarioName}`);
    return connectors;
  }

  /**
   * Reset all mock connectors to default state
   */
  static async resetAllMockConnectors(): Promise<void> {
    for (const connector of this.mockConnectors.values()) {
      if ('setHealthStatus' in connector) {
        (connector as any).setHealthStatus(true);
        (connector as any).setLatencySimulation(true, 100, 500);
        (connector as any).clearMockClients();
        (connector as any).generateMockClients(25); // Default number
      }
    }
    
    logger.info('Reset all mock connectors to default state');
  }

  /**
   * Get mock connector statistics
   */
  static getMockStatistics(): Record<string, any> {
    const stats: Record<string, any> = {};
    
    for (const [key, connector] of this.mockConnectors.entries()) {
      if ('getMockClients' in connector) {
        const mockClients = (connector as any).getMockClients();
        stats[key] = {
          system: connector.system,
          clientCount: mockClients.length,
          isHealthy: 'healthCheck' in connector ? true : false // Would need to check actual health
        };
      }
    }
    
    return stats;
  }

  /**
   * Export mock data for testing
   */
  static exportMockData(system: CrmSystem, clientId: string): any {
    const connector = this.getMockConnector(system, clientId);
    if (!connector || !('getMockClients' in connector)) {
      return null;
    }

    return {
      system,
      clientId,
      clients: (connector as any).getMockClients(),
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Import mock data for testing
   */
  static importMockData(system: CrmSystem, clientId: string, data: any): void {
    const connector = this.getMockConnector(system, clientId);
    if (!connector || !('clearMockClients' in connector)) {
      throw new Error(`Mock connector not found: ${system}/${clientId}`);
    }

    (connector as any).clearMockClients();
    
    if (data.clients && Array.isArray(data.clients)) {
      for (const client of data.clients) {
        (connector as any).addMockClient(client);
      }
    }

    logger.info(`Imported mock data for ${system}/${clientId}`, { 
      clientCount: data.clients?.length || 0 
    });
  }
}

// Initialize test scenarios when the module is loaded (only in non-test environments)
if (process.env.NODE_ENV !== 'test') {
  MockConnectorFactory.initializeTestScenarios();
}