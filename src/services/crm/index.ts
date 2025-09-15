/**
 * CRM Integration Service Exports
 * Main entry point for CRM functionality
 */

// Types and interfaces
export * from './types';

// Base connector
export { BaseCrmConnector } from './baseCrmConnector';

// Specific CRM connectors
export { ZohoCrmConnector } from './connectors/zohoCrmConnector';
export { SalesforceCrmConnector } from './connectors/salesforceCrmConnector';
export { HubSpotCrmConnector } from './connectors/hubspotCrmConnector';
export { AgencyBlocCrmConnector } from './connectors/agencyBlocCrmConnector';

// Factory and services
export { CrmConnectorFactory } from './crmConnectorFactory';
export { OAuthService } from './oauthService';
export { CrmSyncService } from './crmSyncService';
export { RetryHandler } from './retryHandler';

// Mock connectors for development and testing
export { BaseMockConnector } from './mocks/baseMockConnector';
export { ZohoMockConnector } from './mocks/zohoMockConnector';
export { SalesforceMockConnector } from './mocks/salesforceMockConnector';
export { HubSpotMockConnector } from './mocks/hubspotMockConnector';
export { AgencyBlocMockConnector } from './mocks/agencyBlocMockConnector';
export { MockConnectorFactory } from './mocks/mockConnectorFactory';

// Re-export commonly used types from main types
export type { CrmSystem } from '../../types';