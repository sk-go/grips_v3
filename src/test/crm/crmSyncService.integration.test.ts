/**
 * CRM Sync Service Integration Tests
 * Tests the synchronization functionality with real and mock CRM APIs
 */

import { CrmSyncService } from '../../services/crm/crmSyncService';
import { MockConnectorFactory } from '../../services/crm/mocks/mockConnectorFactory';
import { CacheService } from '../../services/cacheService';
import { ICrmConnector } from '../../services/crm/types';
import { CrmSystem } from '../../types';

// Mock the cache service
jest.mock('../../services/cacheService', () => ({
  CacheService: {
    getInstance: jest.fn()
  }
}));

// Mock the logger
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('CrmSyncService Integration Tests', () => {
  let syncService: CrmSyncService;
  let mockCacheService: any;
  let mockConnectors: Record<CrmSystem, ICrmConnector>;

  beforeAll(async () => {
    // Create test environment with mock connectors
    mockConnectors = await MockConnectorFactory.createTestEnvironment('minimal_data');
  });

  beforeEach(async () => {
    // Reset sync service
    syncService = CrmSyncService.getInstance();
    syncService.clearAllSyncData();

    // Setup mock cache service
    mockCacheService = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      expire: jest.fn(),
      keys: jest.fn(),
      flushAll: jest.fn(),
      getInstance: jest.fn()
    } as any;

    (CacheService.getInstance as jest.Mock).mockReturnValue(mockCacheService);
  });

  afterEach(() => {
    syncService.stopAllSyncs();
    syncService.clearAllSyncData();
    
    // Cleanup mock connectors
    for (const connector of Object.values(mockConnectors)) {
      if ('cleanup' in connector) {
        (connector as any).cleanup();
      }
    }
    
    jest.clearAllMocks();
  });

  afterAll(() => {
    // Cleanup sync service
    syncService.cleanup();
    
    // Cleanup mock connectors
    MockConnectorFactory.clearAllMockConnectors();
  });

  describe('Basic Sync Operations', () => {
    it('should successfully sync with Zoho mock connector', async () => {
      const zohoConnector = mockConnectors.zoho;
      
      // Mock cache operations
      mockCacheService.get.mockResolvedValue(null); // No previous sync
      mockCacheService.set.mockResolvedValue(undefined);

      const result = await syncService.startSync(zohoConnector, {
        batchSize: 10,
        syncIntervalMinutes: 1,
        enableBidirectionalSync: false
      });

      expect(result.success).toBe(true);
      expect(result.crmSystem).toBe('zoho');
      expect(result.status).toBe('idle');
      expect(result.clientsProcessed).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should successfully sync with Salesforce mock connector', async () => {
      const salesforceConnector = mockConnectors.salesforce;
      
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);

      const result = await syncService.startSync(salesforceConnector, {
        batchSize: 20,
        syncIntervalMinutes: 5,
        enableBidirectionalSync: false
      });

      expect(result.success).toBe(true);
      expect(result.crmSystem).toBe('salesforce');
      expect(result.status).toBe('idle');
      expect(result.clientsProcessed).toBeGreaterThan(0);
    });

    it('should successfully sync with HubSpot mock connector', async () => {
      const hubspotConnector = mockConnectors.hubspot;
      
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);

      const result = await syncService.startSync(hubspotConnector);

      expect(result.success).toBe(true);
      expect(result.crmSystem).toBe('hubspot');
      expect(result.status).toBe('idle');
    });

    it('should successfully sync with AgencyBloc mock connector', async () => {
      const agencyBlocConnector = mockConnectors.agencybloc;
      
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);

      const result = await syncService.startSync(agencyBlocConnector);

      expect(result.success).toBe(true);
      expect(result.crmSystem).toBe('agencybloc');
      expect(result.status).toBe('idle');
    });
  });

  describe('Incremental Sync', () => {
    it('should perform incremental sync based on last sync time', async () => {
      const zohoConnector = mockConnectors.zoho;
      const lastSyncTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
      
      mockCacheService.get.mockResolvedValue(lastSyncTime);
      mockCacheService.set.mockResolvedValue(undefined);

      const result = await syncService.startSync(zohoConnector);

      expect(result.success).toBe(true);
      expect(mockCacheService.get).toHaveBeenCalledWith(
        expect.stringContaining('crm_sync:zoho:')
      );
    });

    it('should handle full sync when no previous sync time exists', async () => {
      const salesforceConnector = mockConnectors.salesforce;
      
      mockCacheService.get.mockResolvedValue(null); // No previous sync
      mockCacheService.set.mockResolvedValue(undefined);

      const result = await syncService.startSync(salesforceConnector);

      expect(result.success).toBe(true);
      expect(result.clientsProcessed).toBeGreaterThan(0);
    });
  });

  describe('Concurrent Sync Management', () => {
    it('should prevent duplicate syncs for the same connector', async () => {
      const zohoConnector = mockConnectors.zoho;
      
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);

      // Start first sync
      const firstSyncPromise = syncService.startSync(zohoConnector);
      
      // Try to start second sync immediately
      const secondSyncPromise = syncService.startSync(zohoConnector);

      const [firstResult, secondResult] = await Promise.all([
        firstSyncPromise,
        secondSyncPromise
      ]);

      // Both should return the same result (second one waits for first)
      expect(firstResult).toEqual(secondResult);
    });

    it('should enforce maximum concurrent sync limit', async () => {
      const connectors = [
        mockConnectors.zoho,
        mockConnectors.salesforce,
        mockConnectors.hubspot,
        mockConnectors.agencybloc
      ];

      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);

      // Start syncs up to the limit (default is 3)
      const syncPromises = connectors.slice(0, 3).map(connector =>
        syncService.startSync(connector)
      );

      // Try to start one more sync (should fail)
      await expect(
        syncService.startSync(connectors[3], { maxConcurrentSyncs: 3 })
      ).rejects.toThrow('Maximum concurrent syncs');

      // Wait for existing syncs to complete
      await Promise.all(syncPromises);
    });
  });

  describe('Error Handling', () => {
    it('should handle connector errors gracefully', async () => {
      const zohoConnector = mockConnectors.zoho;
      
      // Make the connector unhealthy
      (zohoConnector as any).setHealthStatus(false);
      
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);

      const result = await syncService.startSync(zohoConnector);

      expect(result.success).toBe(false);
      expect(result.status).toBe('error');
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle cache service errors', async () => {
      const salesforceConnector = mockConnectors.salesforce;
      
      mockCacheService.get.mockRejectedValue(new Error('Cache service unavailable'));
      mockCacheService.set.mockResolvedValue(undefined);

      const result = await syncService.startSync(salesforceConnector);

      // Should still attempt sync even if cache fails
      expect(result).toBeDefined();
      expect(result.crmSystem).toBe('salesforce');
    });
  });

  describe('Cache Management', () => {
    it('should cache client data with correct TTL', async () => {
      const hubspotConnector = mockConnectors.hubspot;
      const mockClient = {
        id: 'test-client-1',
        crmId: 'test-client-1',
        crmSystem: 'hubspot' as CrmSystem,
        name: 'Test Client',
        email: 'test@example.com',
        phone: '555-0123',
        personalDetails: {
          hobbies: [],
          family: [],
          preferences: {},
          importantDates: []
        },
        relationshipHealth: {
          score: 50,
          lastInteraction: new Date(),
          sentimentTrend: 'neutral' as const,
          interactionFrequency: 0,
          responseTime: 0
        },
        lastCrmSync: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockCacheService.set.mockResolvedValue(undefined);

      await syncService.setCachedClient(mockClient);

      expect(mockCacheService.set).toHaveBeenCalledWith(
        'crm_client:hubspot:test-client-1',
        mockClient,
        expect.any(Number) // TTL in seconds
      );
    });

    it('should retrieve cached client data', async () => {
      const mockClient = {
        id: 'test-client-2',
        name: 'Cached Client'
      };

      mockCacheService.get.mockResolvedValue(mockClient);

      const result = await syncService.getCachedClient('zoho', 'test-client-2');

      expect(result).toEqual(mockClient);
      expect(mockCacheService.get).toHaveBeenCalledWith('crm_client:zoho:test-client-2');
    });

    it('should invalidate cached client data', async () => {
      mockCacheService.delete.mockResolvedValue(1);

      await syncService.invalidateCachedClient('salesforce', 'test-client-3');

      expect(mockCacheService.delete).toHaveBeenCalledWith('crm_client:salesforce:test-client-3');
    });
  });

  describe('Sync Status Management', () => {
    it('should track sync status correctly', async () => {
      const agencyBlocConnector = mockConnectors.agencybloc;
      
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);

      await syncService.startSync(agencyBlocConnector);

      const status = syncService.getSyncStatus('agencybloc', agencyBlocConnector.config.clientId);
      
      expect(status).toBeDefined();
      expect(status!.crmSystem).toBe('agencybloc');
      expect(status!.status).toBe('idle');
      expect(status!.lastSyncTime).toBeInstanceOf(Date);
      expect(status!.syncDuration).toBeGreaterThan(0);
    });

    it('should return all sync statuses', async () => {
      const zohoConnector = mockConnectors.zoho;
      const salesforceConnector = mockConnectors.salesforce;
      
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);

      await Promise.all([
        syncService.startSync(zohoConnector),
        syncService.startSync(salesforceConnector)
      ]);

      const allStatuses = syncService.getAllSyncStatuses();
      
      expect(allStatuses).toHaveLength(2);
      expect(allStatuses.some(s => s.crmSystem === 'zoho')).toBe(true);
      expect(allStatuses.some(s => s.crmSystem === 'salesforce')).toBe(true);
    });
  });

  describe('Force Sync', () => {
    it('should perform immediate sync when forced', async () => {
      const hubspotConnector = mockConnectors.hubspot;
      
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);

      const result = await syncService.forcSync(hubspotConnector, {
        batchSize: 5
      });

      expect(result.success).toBe(true);
      expect(result.crmSystem).toBe('hubspot');
      expect(result.status).toBe('idle');
    });
  });

  describe('Sync Configuration', () => {
    it('should respect custom sync configuration', async () => {
      const zohoConnector = mockConnectors.zoho;
      
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);

      const customConfig = {
        batchSize: 50,
        maxConcurrentSyncs: 5,
        syncIntervalMinutes: 15,
        cacheExpirationMonths: 12,
        enableBidirectionalSync: true,
        conflictResolution: 'platform_wins' as const
      };

      const result = await syncService.startSync(zohoConnector, customConfig);

      expect(result.success).toBe(true);
      // Configuration is used internally, hard to test directly
      // but we can verify the sync completed successfully
    });
  });

  describe('Cleanup Operations', () => {
    it('should stop all syncs when requested', async () => {
      const connectors = [mockConnectors.zoho, mockConnectors.salesforce];
      
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);

      // Start multiple syncs
      await Promise.all(
        connectors.map(connector => syncService.startSync(connector))
      );

      // Verify syncs are tracked
      expect(syncService.getAllSyncStatuses()).toHaveLength(2);

      // Stop all syncs
      syncService.stopAllSyncs();

      // Verify all syncs are paused
      const statuses = syncService.getAllSyncStatuses();
      statuses.forEach(status => {
        expect(status.status).toBe('paused');
      });
    });

    it('should clear all sync data', () => {
      // Start a sync first
      const zohoConnector = mockConnectors.zoho;
      
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);

      return syncService.startSync(zohoConnector).then(() => {
        // Verify sync data exists
        expect(syncService.getAllSyncStatuses()).toHaveLength(1);

        // Clear all data
        syncService.clearAllSyncData();

        // Verify data is cleared
        expect(syncService.getAllSyncStatuses()).toHaveLength(0);
      });
    });
  });

  describe('Performance Tests', () => {
    it('should handle high-volume sync efficiently', async () => {
      // Create high-volume test environment
      const highVolumeConnector = await MockConnectorFactory.createMockConnector({
        system: 'zoho',
        clientId: 'high_volume_test',
        clientSecret: 'test_secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['read'],
        baseUrl: 'https://mock.zoho.com'
      });

      await MockConnectorFactory.applyScenario(highVolumeConnector, 'high_volume');
      
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);

      const startTime = Date.now();
      const result = await syncService.startSync(highVolumeConnector, {
        batchSize: 100
      });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.clientsProcessed).toBeGreaterThan(100);
      expect(duration).toBeLessThan(30000); // Should complete within 30 seconds
    }, 35000); // Increase timeout for this test
  });
});