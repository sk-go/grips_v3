/**
 * CRM Connector Factory
 * Creates and manages CRM connector instances
 */

import { 
  ICrmConnector, 
  CrmConfig, 
  ZohoCrmConfig, 
  SalesforceCrmConfig, 
  HubSpotCrmConfig, 
  AgencyBlocCrmConfig,
  ProfessionalWorksCrmConfig,
  CrmError 
} from './types';
import { CrmSystem } from '../../types';
import { ZohoCrmConnector } from './connectors/zohoCrmConnector';
import { SalesforceCrmConnector } from './connectors/salesforceCrmConnector';
import { HubSpotCrmConnector } from './connectors/hubspotCrmConnector';
import { AgencyBlocCrmConnector } from './connectors/agencyBlocCrmConnector';
import { ProfessionalWorksCrmConnector } from './connectors/professionalWorksCrmConnector';
import { logger } from '../../utils/logger';

export class CrmConnectorFactory {
  private static connectors: Map<string, ICrmConnector> = new Map();

  /**
   * Create a CRM connector instance
   */
  static createConnector(config: CrmConfig): ICrmConnector {
    const key = `${config.system}-${config.clientId}`;
    
    // Return existing connector if available
    if (this.connectors.has(key)) {
      return this.connectors.get(key)!;
    }

    let connector: ICrmConnector;

    switch (config.system) {
      case 'zoho':
        connector = new ZohoCrmConnector(config as ZohoCrmConfig);
        break;
      
      case 'salesforce':
        connector = new SalesforceCrmConnector(config as SalesforceCrmConfig);
        break;
      
      case 'hubspot':
        connector = new HubSpotCrmConnector(config as HubSpotCrmConfig);
        break;
      
      case 'agencybloc':
        connector = new AgencyBlocCrmConnector(config as AgencyBlocCrmConfig);
        break;
      
      case 'professional-works':
        connector = new ProfessionalWorksCrmConnector(config as ProfessionalWorksCrmConfig);
        break;
      
      default:
        throw new CrmError(
          `Unsupported CRM system: ${config.system}`,
          'UNSUPPORTED_SYSTEM',
          config.system as CrmSystem
        );
    }

    // Cache the connector
    this.connectors.set(key, connector);
    
    logger.info(`Created CRM connector for ${config.system}`, { 
      clientId: config.clientId,
      baseUrl: config.baseUrl 
    });

    return connector;
  }

  /**
   * Get an existing connector
   */
  static getConnector(system: CrmSystem, clientId: string): ICrmConnector | undefined {
    const key = `${system}-${clientId}`;
    return this.connectors.get(key);
  }

  /**
   * Remove a connector from cache
   */
  static removeConnector(system: CrmSystem, clientId: string): void {
    const key = `${system}-${clientId}`;
    this.connectors.delete(key);
    logger.info(`Removed CRM connector for ${system}`, { clientId });
  }

  /**
   * Get all active connectors
   */
  static getAllConnectors(): ICrmConnector[] {
    return Array.from(this.connectors.values());
  }

  /**
   * Clear all connectors
   */
  static clearAll(): void {
    this.connectors.clear();
    logger.info('Cleared all CRM connectors');
  }

  /**
   * Create default configurations for supported CRM systems
   */
  static createDefaultConfigs(): Record<CrmSystem, Partial<CrmConfig>> {
    return {
      zoho: {
        system: 'zoho',
        baseUrl: 'https://accounts.zoho.com',
        scopes: ['ZohoCRM.modules.ALL', 'ZohoCRM.settings.ALL'],
        apiVersion: 'v2'
      } as Partial<ZohoCrmConfig>,

      salesforce: {
        system: 'salesforce',
        baseUrl: 'https://login.salesforce.com',
        scopes: ['api', 'refresh_token', 'offline_access'],
        apiVersion: 'v58.0'
      } as Partial<SalesforceCrmConfig>,

      hubspot: {
        system: 'hubspot',
        baseUrl: 'https://api.hubapi.com',
        scopes: ['contacts', 'crm.objects.contacts.read', 'crm.objects.contacts.write'],
        apiVersion: 'v3'
      } as Partial<HubSpotCrmConfig>,

      agencybloc: {
        system: 'agencybloc',
        baseUrl: 'https://api.agencybloc.com',
        scopes: ['contacts:read', 'contacts:write'],
        apiVersion: 'v1'
      } as Partial<AgencyBlocCrmConfig>,

      'professional-works': {
        system: 'professional-works',
        baseUrl: 'https://api.professional.works/api/v1',
        scopes: ['contacts:read', 'contacts:write', 'accounts:read'],
        apiVersion: 'v1'
      } as Partial<ProfessionalWorksCrmConfig>
    };
  }

  /**
   * Validate CRM configuration
   */
  static validateConfig(config: CrmConfig): boolean {
    const required = ['system', 'clientId', 'clientSecret', 'redirectUri', 'baseUrl'];
    
    for (const field of required) {
      if (!config[field as keyof CrmConfig]) {
        logger.error(`Missing required CRM config field: ${field}`, { system: config.system });
        return false;
      }
    }

    // System-specific validation
    switch (config.system) {
      case 'zoho':
        const zohoConfig = config as ZohoCrmConfig;
        if (!zohoConfig.datacenter) {
          logger.error('Zoho CRM config missing datacenter', { system: config.system });
          return false;
        }
        break;

      case 'salesforce':
        const sfConfig = config as SalesforceCrmConfig;
        if (!sfConfig.instanceUrl) {
          logger.warn('Salesforce CRM config missing instanceUrl (will be set during auth)', { system: config.system });
        }
        break;

      case 'hubspot':
        const hsConfig = config as HubSpotCrmConfig;
        if (!hsConfig.portalId) {
          logger.error('HubSpot CRM config missing portalId', { system: config.system });
          return false;
        }
        break;

      case 'agencybloc':
        const abConfig = config as AgencyBlocCrmConfig;
        if (!abConfig.environment) {
          logger.error('AgencyBloc CRM config missing environment', { system: config.system });
          return false;
        }
        break;

      case 'professional-works':
        const pwConfig = config as ProfessionalWorksCrmConfig;
        if (!pwConfig.planTier) {
          logger.error('Professional Works CRM config missing planTier', { system: config.system });
          return false;
        }
        if (!pwConfig.environment) {
          logger.error('Professional Works CRM config missing environment', { system: config.system });
          return false;
        }
        break;
    }

    return true;
  }

  /**
   * Test connectivity for all active connectors
   */
  static async testAllConnections(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    
    for (const [key, connector] of this.connectors.entries()) {
      try {
        const isHealthy = await connector.healthCheck();
        results[key] = isHealthy;
        logger.info(`Health check for ${key}: ${isHealthy ? 'PASS' : 'FAIL'}`);
      } catch (error) {
        results[key] = false;
        logger.error(`Health check failed for ${key}:`, error);
      }
    }

    return results;
  }
}