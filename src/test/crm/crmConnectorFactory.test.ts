/**
 * CRM Connector Factory Tests
 * Tests the factory pattern for creating CRM connectors
 */

import { CrmConnectorFactory } from '../../services/crm/crmConnectorFactory';
import { 
  CrmConfig, 
  ZohoCrmConfig, 
  SalesforceCrmConfig, 
  HubSpotCrmConfig, 
  AgencyBlocCrmConfig 
} from '../../services/crm/types';
import { ZohoCrmConnector } from '../../services/crm/connectors/zohoCrmConnector';
import { SalesforceCrmConnector } from '../../services/crm/connectors/salesforceCrmConnector';
import { HubSpotCrmConnector } from '../../services/crm/connectors/hubspotCrmConnector';
import { AgencyBlocCrmConnector } from '../../services/crm/connectors/agencyBlocCrmConnector';

// Mock the logger
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('CrmConnectorFactory', () => {
  beforeEach(() => {
    // Clear all connectors before each test
    CrmConnectorFactory.clearAll();
  });

  afterEach(() => {
    CrmConnectorFactory.clearAll();
  });

  describe('createConnector', () => {
    it('should create Zoho CRM connector', () => {
      const config: ZohoCrmConfig = {
        system: 'zoho',
        clientId: 'zoho-client-id',
        clientSecret: 'zoho-client-secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['ZohoCRM.modules.ALL'],
        baseUrl: 'https://accounts.zoho.com',
        datacenter: 'us'
      };

      const connector = CrmConnectorFactory.createConnector(config);

      expect(connector).toBeInstanceOf(ZohoCrmConnector);
      expect(connector.system).toBe('zoho');
      expect(connector.config).toEqual(config);
    });

    it('should create Salesforce CRM connector', () => {
      const config: SalesforceCrmConfig = {
        system: 'salesforce',
        clientId: 'sf-client-id',
        clientSecret: 'sf-client-secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['api', 'refresh_token'],
        baseUrl: 'https://login.salesforce.com',
        instanceUrl: 'https://myorg.salesforce.com',
        isSandbox: false
      };

      const connector = CrmConnectorFactory.createConnector(config);

      expect(connector).toBeInstanceOf(SalesforceCrmConnector);
      expect(connector.system).toBe('salesforce');
      expect(connector.config).toEqual(config);
    });

    it('should create HubSpot CRM connector', () => {
      const config: HubSpotCrmConfig = {
        system: 'hubspot',
        clientId: 'hs-client-id',
        clientSecret: 'hs-client-secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['contacts'],
        baseUrl: 'https://api.hubapi.com',
        portalId: '12345'
      };

      const connector = CrmConnectorFactory.createConnector(config);

      expect(connector).toBeInstanceOf(HubSpotCrmConnector);
      expect(connector.system).toBe('hubspot');
      expect(connector.config).toEqual(config);
    });

    it('should create AgencyBloc CRM connector', () => {
      const config: AgencyBlocCrmConfig = {
        system: 'agencybloc',
        clientId: 'ab-client-id',
        clientSecret: 'ab-client-secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['contacts:read'],
        baseUrl: 'https://api.agencybloc.com',
        environment: 'production'
      };

      const connector = CrmConnectorFactory.createConnector(config);

      expect(connector).toBeInstanceOf(AgencyBlocCrmConnector);
      expect(connector.system).toBe('agencybloc');
      expect(connector.config).toEqual(config);
    });

    it('should throw error for unsupported CRM system', () => {
      const config = {
        system: 'unsupported' as any,
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: [],
        baseUrl: 'https://api.unsupported.com'
      } as CrmConfig;

      expect(() => {
        CrmConnectorFactory.createConnector(config);
      }).toThrow('Unsupported CRM system: unsupported');
    });

    it('should return cached connector for same configuration', () => {
      const config: ZohoCrmConfig = {
        system: 'zoho',
        clientId: 'zoho-client-id',
        clientSecret: 'zoho-client-secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['ZohoCRM.modules.ALL'],
        baseUrl: 'https://accounts.zoho.com',
        datacenter: 'us'
      };

      const connector1 = CrmConnectorFactory.createConnector(config);
      const connector2 = CrmConnectorFactory.createConnector(config);

      expect(connector1).toBe(connector2); // Same instance
    });
  });

  describe('getConnector', () => {
    it('should return existing connector', () => {
      const config: ZohoCrmConfig = {
        system: 'zoho',
        clientId: 'zoho-client-id',
        clientSecret: 'zoho-client-secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['ZohoCRM.modules.ALL'],
        baseUrl: 'https://accounts.zoho.com',
        datacenter: 'us'
      };

      const createdConnector = CrmConnectorFactory.createConnector(config);
      const retrievedConnector = CrmConnectorFactory.getConnector('zoho', 'zoho-client-id');

      expect(retrievedConnector).toBe(createdConnector);
    });

    it('should return undefined for non-existent connector', () => {
      const connector = CrmConnectorFactory.getConnector('zoho', 'non-existent');
      expect(connector).toBeUndefined();
    });
  });

  describe('removeConnector', () => {
    it('should remove connector from cache', () => {
      const config: ZohoCrmConfig = {
        system: 'zoho',
        clientId: 'zoho-client-id',
        clientSecret: 'zoho-client-secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['ZohoCRM.modules.ALL'],
        baseUrl: 'https://accounts.zoho.com',
        datacenter: 'us'
      };

      CrmConnectorFactory.createConnector(config);
      
      // Verify connector exists
      expect(CrmConnectorFactory.getConnector('zoho', 'zoho-client-id')).toBeDefined();
      
      // Remove connector
      CrmConnectorFactory.removeConnector('zoho', 'zoho-client-id');
      
      // Verify connector is removed
      expect(CrmConnectorFactory.getConnector('zoho', 'zoho-client-id')).toBeUndefined();
    });
  });

  describe('getAllConnectors', () => {
    it('should return all active connectors', () => {
      const zohoConfig: ZohoCrmConfig = {
        system: 'zoho',
        clientId: 'zoho-client-id',
        clientSecret: 'zoho-client-secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['ZohoCRM.modules.ALL'],
        baseUrl: 'https://accounts.zoho.com',
        datacenter: 'us'
      };

      const salesforceConfig: SalesforceCrmConfig = {
        system: 'salesforce',
        clientId: 'sf-client-id',
        clientSecret: 'sf-client-secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['api'],
        baseUrl: 'https://login.salesforce.com',
        instanceUrl: 'https://myorg.salesforce.com',
        isSandbox: false
      };

      CrmConnectorFactory.createConnector(zohoConfig);
      CrmConnectorFactory.createConnector(salesforceConfig);

      const connectors = CrmConnectorFactory.getAllConnectors();

      expect(connectors).toHaveLength(2);
      expect(connectors.some(c => c.system === 'zoho')).toBe(true);
      expect(connectors.some(c => c.system === 'salesforce')).toBe(true);
    });

    it('should return empty array when no connectors', () => {
      const connectors = CrmConnectorFactory.getAllConnectors();
      expect(connectors).toHaveLength(0);
    });
  });

  describe('createDefaultConfigs', () => {
    it('should return default configurations for all supported systems', () => {
      const configs = CrmConnectorFactory.createDefaultConfigs();

      expect(configs.zoho.system).toBe('zoho');
      expect(configs.zoho.baseUrl).toBe('https://accounts.zoho.com');
      expect(configs.zoho.scopes).toContain('ZohoCRM.modules.ALL');

      expect(configs.salesforce.system).toBe('salesforce');
      expect(configs.salesforce.baseUrl).toBe('https://login.salesforce.com');
      expect(configs.salesforce.scopes).toContain('api');

      expect(configs.hubspot.system).toBe('hubspot');
      expect(configs.hubspot.baseUrl).toBe('https://api.hubapi.com');
      expect(configs.hubspot.scopes).toContain('contacts');

      expect(configs.agencybloc.system).toBe('agencybloc');
      expect(configs.agencybloc.baseUrl).toBe('https://api.agencybloc.com');
      expect(configs.agencybloc.scopes).toContain('contacts:read');
    });
  });

  describe('validateConfig', () => {
    it('should return true for valid Zoho config', () => {
      const config: ZohoCrmConfig = {
        system: 'zoho',
        clientId: 'zoho-client-id',
        clientSecret: 'zoho-client-secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['ZohoCRM.modules.ALL'],
        baseUrl: 'https://accounts.zoho.com',
        datacenter: 'us'
      };

      expect(CrmConnectorFactory.validateConfig(config)).toBe(true);
    });

    it('should return false for missing required fields', () => {
      const config = {
        system: 'zoho',
        clientId: 'zoho-client-id',
        // Missing clientSecret
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['ZohoCRM.modules.ALL'],
        baseUrl: 'https://accounts.zoho.com'
      } as CrmConfig;

      expect(CrmConnectorFactory.validateConfig(config)).toBe(false);
    });

    it('should return false for Zoho config missing datacenter', () => {
      const config = {
        system: 'zoho',
        clientId: 'zoho-client-id',
        clientSecret: 'zoho-client-secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['ZohoCRM.modules.ALL'],
        baseUrl: 'https://accounts.zoho.com'
        // Missing datacenter
      } as ZohoCrmConfig;

      expect(CrmConnectorFactory.validateConfig(config)).toBe(false);
    });

    it('should return false for HubSpot config missing portalId', () => {
      const config = {
        system: 'hubspot',
        clientId: 'hs-client-id',
        clientSecret: 'hs-client-secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['contacts'],
        baseUrl: 'https://api.hubapi.com'
        // Missing portalId
      } as HubSpotCrmConfig;

      expect(CrmConnectorFactory.validateConfig(config)).toBe(false);
    });

    it('should return false for AgencyBloc config missing environment', () => {
      const config = {
        system: 'agencybloc',
        clientId: 'ab-client-id',
        clientSecret: 'ab-client-secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['contacts:read'],
        baseUrl: 'https://api.agencybloc.com'
        // Missing environment
      } as AgencyBlocCrmConfig;

      expect(CrmConnectorFactory.validateConfig(config)).toBe(false);
    });

    it('should warn but return true for Salesforce config missing instanceUrl', () => {
      const config = {
        system: 'salesforce',
        clientId: 'sf-client-id',
        clientSecret: 'sf-client-secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['api'],
        baseUrl: 'https://login.salesforce.com',
        isSandbox: false
        // Missing instanceUrl (will be set during auth)
      } as SalesforceCrmConfig;

      expect(CrmConnectorFactory.validateConfig(config)).toBe(true);
    });
  });

  describe('testAllConnections', () => {
    it('should test all active connectors', async () => {
      const config: ZohoCrmConfig = {
        system: 'zoho',
        clientId: 'zoho-client-id',
        clientSecret: 'zoho-client-secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['ZohoCRM.modules.ALL'],
        baseUrl: 'https://accounts.zoho.com',
        datacenter: 'us'
      };

      const connector = CrmConnectorFactory.createConnector(config);
      
      // Mock the health check
      jest.spyOn(connector, 'healthCheck').mockResolvedValue(true);

      const results = await CrmConnectorFactory.testAllConnections();

      expect(results).toHaveProperty('zoho-zoho-client-id');
      expect(results['zoho-zoho-client-id']).toBe(true);
      expect(connector.healthCheck).toHaveBeenCalled();
    });

    it('should handle health check failures', async () => {
      const config: ZohoCrmConfig = {
        system: 'zoho',
        clientId: 'zoho-client-id',
        clientSecret: 'zoho-client-secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['ZohoCRM.modules.ALL'],
        baseUrl: 'https://accounts.zoho.com',
        datacenter: 'us'
      };

      const connector = CrmConnectorFactory.createConnector(config);
      
      // Mock the health check to fail
      jest.spyOn(connector, 'healthCheck').mockRejectedValue(new Error('Health check failed'));

      const results = await CrmConnectorFactory.testAllConnections();

      expect(results).toHaveProperty('zoho-zoho-client-id');
      expect(results['zoho-zoho-client-id']).toBe(false);
    });

    it('should return empty object when no connectors', async () => {
      const results = await CrmConnectorFactory.testAllConnections();
      expect(results).toEqual({});
    });
  });
});