/**
 * Integration tests for CRM synchronization with cache layer
 * Tests the interaction between cache service and CRM data operations
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { RedisService } from '../services/redis';
import { CacheService, CrmCacheService } from '../services/cacheService';
import { Client, CrmCacheData, REDIS_KEYS } from '../types';

// Mock CRM API responses
const mockCrmApiResponses = {
  salesforce: {
    'crm-123': {
      Id: 'crm-123',
      Name: 'John Doe',
      Email: 'john@example.com',
      Phone: '+1234567890',
      Custom_Hobbies__c: 'golf,reading',
      Custom_Family__c: JSON.stringify([
        { name: 'Jane Doe', relationship: 'spouse' }
      ])
    }
  },
  hubspot: {
    'crm-456': {
      id: 'crm-456',
      properties: {
        firstname: 'Jane',
        lastname: 'Smith',
        email: 'jane@example.com',
        phone: '+0987654321'
      }
    }
  }
};

// Mock Redis for integration testing
const mockRedisOperations = new Map<string, any>();

jest.mock('../services/redis', () => ({
  RedisService: {
    initialize: jest.fn(),
    getClient: jest.fn(() => ({
      set: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      expire: jest.fn(),
      lPush: jest.fn(),
      lRange: jest.fn(),
      keys: jest.fn(),
      info: jest.fn(),
      ttl: jest.fn()
    })),
    set: jest.fn((key: string, value: any, ttl?: number) => {
      mockRedisOperations.set(key, { value, ttl, timestamp: Date.now() });
      return Promise.resolve();
    }),
    get: jest.fn((key: string) => {
      const entry = mockRedisOperations.get(key);
      if (!entry) return Promise.resolve(null);
      
      // Check TTL
      if (entry.ttl && (Date.now() - entry.timestamp) / 1000 > entry.ttl) {
        mockRedisOperations.delete(key);
        return Promise.resolve(null);
      }
      
      return Promise.resolve(entry.value);
    }),
    del: jest.fn((key: string) => {
      mockRedisOperations.delete(key);
      return Promise.resolve();
    }),
    exists: jest.fn((key: string) => {
      return Promise.resolve(mockRedisOperations.has(key));
    }),
    close: jest.fn()
  }
}));

// Mock logger
jest.mock('../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('CRM Sync Integration Tests', () => {
  const mockUserId = 'test-agent-123';

  beforeAll(async () => {
    await CacheService.initialize();
  });

  beforeEach(() => {
    mockRedisOperations.clear();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await RedisService.close();
  });

  describe('CRM Data Synchronization Flow', () => {
    it('should perform complete CRM sync workflow', async () => {
      // Simulate CRM data fetch and transformation
      const crmData = mockCrmApiResponses.salesforce['crm-123'];
      
      // Transform CRM data to internal Client format
      const client: Client = {
        id: 'client-internal-123',
        crmId: 'crm-123',
        crmSystem: 'salesforce',
        name: crmData.Name,
        email: crmData.Email,
        phone: crmData.Phone,
        personalDetails: {
          hobbies: crmData.Custom_Hobbies__c.split(','),
          family: JSON.parse(crmData.Custom_Family__c),
          preferences: {},
          importantDates: []
        },
        relationshipHealth: {
          score: 75,
          lastInteraction: new Date(),
          sentimentTrend: 'positive',
          interactionFrequency: 3,
          responseTime: 4
        },
        lastCrmSync: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Step 1: Cache the CRM client data
      await CacheService.setCrmClient('salesforce', 'crm-123', client, mockUserId);

      // Verify data was cached
      const cacheKey = REDIS_KEYS.CRM_CLIENT('salesforce', 'crm-123');
      expect(RedisService.set).toHaveBeenCalledWith(
        cacheKey,
        expect.objectContaining({
          data: expect.objectContaining({
            clientData: client,
            syncStatus: 'success'
          })
        }),
        expect.any(Number)
      );

      // Step 2: Retrieve cached data
      const retrievedClient = await CacheService.getCrmClient('salesforce', 'crm-123', mockUserId);
      
      expect(retrievedClient).toEqual(client);
    });

    it('should handle CRM sync failures with error tracking', async () => {
      const partialClient: Client = {
        id: 'client-partial-456',
        crmId: 'crm-456',
        crmSystem: 'hubspot',
        name: 'Jane Smith',
        email: 'jane@example.com',
        phone: '+0987654321',
        personalDetails: {
          hobbies: [], // Failed to sync
          family: [], // Failed to sync
          preferences: {},
          importantDates: []
        },
        relationshipHealth: {
          score: 50, // Default due to sync failure
          lastInteraction: new Date(),
          sentimentTrend: 'neutral',
          interactionFrequency: 0,
          responseTime: 0
        },
        lastCrmSync: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const syncErrors = [
        'Failed to fetch custom fields',
        'API rate limit exceeded for relationship data'
      ];

      // Cache with partial sync status
      await CrmCacheService.setCrmClient(
        'hubspot',
        'crm-456',
        partialClient,
        'partial',
        syncErrors
      );

      // Verify error tracking
      const cacheKey = REDIS_KEYS.CRM_CLIENT('hubspot', 'crm-456');
      expect(RedisService.set).toHaveBeenCalledWith(
        cacheKey,
        expect.objectContaining({
          data: expect.objectContaining({
            clientData: partialClient,
            syncStatus: 'partial',
            errors: syncErrors
          })
        }),
        expect.any(Number)
      );

      // Retrieve and verify error information is preserved
      const cachedData = await CrmCacheService.getCrmClient('hubspot', 'crm-456');
      expect(cachedData?.syncStatus).toBe('partial');
      expect(cachedData?.errors).toEqual(syncErrors);
    });

    it('should manage CRM sync status across multiple systems', async () => {
      const syncStatuses = [
        {
          system: 'salesforce',
          status: {
            lastSync: new Date('2024-01-15T10:00:00Z'),
            status: 'success',
            recordCount: 150,
            syncDuration: 45000, // 45 seconds
            errors: []
          }
        },
        {
          system: 'hubspot',
          status: {
            lastSync: new Date('2024-01-15T10:05:00Z'),
            status: 'partial',
            recordCount: 89,
            syncDuration: 60000, // 60 seconds
            errors: ['Rate limit exceeded', 'Some custom fields unavailable']
          }
        },
        {
          system: 'zoho',
          status: {
            lastSync: new Date('2024-01-15T09:45:00Z'),
            status: 'failed',
            recordCount: 0,
            syncDuration: 5000, // 5 seconds before failure
            errors: ['Authentication failed', 'Invalid API credentials']
          }
        }
      ];

      // Set sync status for each system
      for (const { system, status } of syncStatuses) {
        await CrmCacheService.setCrmSyncStatus(system, status);
      }

      // Verify all sync statuses were stored
      for (const { system, status } of syncStatuses) {
        const retrievedStatus = await CrmCacheService.getCrmSyncStatus(system);
        expect(retrievedStatus).toEqual(status);
      }

      // Verify Redis operations
      expect(RedisService.set).toHaveBeenCalledTimes(syncStatuses.length);
    });

    it('should handle cache expiration and refresh cycles', async () => {
      const client: Client = {
        id: 'client-expiry-test',
        crmId: 'crm-expiry-123',
        crmSystem: 'salesforce',
        name: 'Test Client',
        email: 'test@example.com',
        phone: '+1111111111',
        personalDetails: {
          hobbies: ['testing'],
          family: [],
          preferences: {},
          importantDates: []
        },
        relationshipHealth: {
          score: 80,
          lastInteraction: new Date(),
          sentimentTrend: 'positive',
          interactionFrequency: 2,
          responseTime: 3
        },
        lastCrmSync: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Cache with short TTL for testing
      await CacheService.setCrmClient('salesforce', 'crm-expiry-123', client, mockUserId);

      // Simulate cache expiration by manipulating mock
      const cacheKey = REDIS_KEYS.CRM_CLIENT('salesforce', 'crm-expiry-123');
      const entry = mockRedisOperations.get(cacheKey);
      if (entry) {
        entry.timestamp = Date.now() - (entry.ttl + 1) * 1000; // Expire the entry
      }

      // Attempt to retrieve expired data
      const expiredResult = await CacheService.getCrmClient('salesforce', 'crm-expiry-123', mockUserId);
      expect(expiredResult).toBeNull();

      // Refresh cache with new data
      const updatedClient = { ...client, name: 'Updated Test Client' };
      await CacheService.setCrmClient('salesforce', 'crm-expiry-123', updatedClient, mockUserId);

      // Verify fresh data is retrieved
      const refreshedResult = await CacheService.getCrmClient('salesforce', 'crm-expiry-123', mockUserId);
      expect(refreshedResult?.name).toBe('Updated Test Client');
    });

    it('should maintain data consistency during concurrent operations', async () => {
      const baseClient: Client = {
        id: 'client-concurrent-test',
        crmId: 'crm-concurrent-123',
        crmSystem: 'hubspot',
        name: 'Concurrent Test Client',
        email: 'concurrent@example.com',
        phone: '+2222222222',
        personalDetails: {
          hobbies: [],
          family: [],
          preferences: {},
          importantDates: []
        },
        relationshipHealth: {
          score: 70,
          lastInteraction: new Date(),
          sentimentTrend: 'neutral',
          interactionFrequency: 1,
          responseTime: 5
        },
        lastCrmSync: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Simulate concurrent cache operations
      const operations = [
        CacheService.setCrmClient('hubspot', 'crm-concurrent-123', 
          { ...baseClient, name: 'Update 1' }, mockUserId),
        CacheService.setCrmClient('hubspot', 'crm-concurrent-123', 
          { ...baseClient, name: 'Update 2' }, mockUserId),
        CacheService.setCrmClient('hubspot', 'crm-concurrent-123', 
          { ...baseClient, name: 'Update 3' }, mockUserId)
      ];

      // Execute concurrent operations
      await Promise.all(operations);

      // Verify final state is consistent
      const finalResult = await CacheService.getCrmClient('hubspot', 'crm-concurrent-123', mockUserId);
      expect(finalResult).toBeTruthy();
      expect(['Update 1', 'Update 2', 'Update 3']).toContain(finalResult?.name);
    });
  });

  describe('CRM Integration Error Scenarios', () => {
    it('should handle CRM API timeout scenarios', async () => {
      // Simulate timeout by having Redis operations fail
      (RedisService.set as any).mockRejectedValueOnce(new Error('Operation timeout'));

      const client: Client = {
        id: 'client-timeout-test',
        crmId: 'crm-timeout-123',
        crmSystem: 'zoho',
        name: 'Timeout Test Client',
        email: 'timeout@example.com',
        phone: '+3333333333',
        personalDetails: {
          hobbies: [],
          family: [],
          preferences: {},
          importantDates: []
        },
        relationshipHealth: {
          score: 60,
          lastInteraction: new Date(),
          sentimentTrend: 'neutral',
          interactionFrequency: 1,
          responseTime: 10
        },
        lastCrmSync: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Should throw error on cache failure
      await expect(
        CacheService.setCrmClient('zoho', 'crm-timeout-123', client, mockUserId)
      ).rejects.toThrow('Operation timeout');
    });

    it('should handle malformed CRM data gracefully', async () => {
      // Test with incomplete client data
      const incompleteClient = {
        id: 'client-incomplete',
        crmId: 'crm-incomplete-123',
        crmSystem: 'salesforce',
        name: 'Incomplete Client'
        // Missing required fields
      } as Client;

      // Should handle gracefully without throwing
      await expect(
        CacheService.setCrmClient('salesforce', 'crm-incomplete-123', incompleteClient, mockUserId)
      ).resolves.not.toThrow();
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large client datasets efficiently', async () => {
      const startTime = Date.now();
      const clientCount = 100;
      const operations: Promise<void>[] = [];

      // Create multiple clients
      for (let i = 0; i < clientCount; i++) {
        const client: Client = {
          id: `client-perf-${i}`,
          crmId: `crm-perf-${i}`,
          crmSystem: 'salesforce',
          name: `Performance Test Client ${i}`,
          email: `perf${i}@example.com`,
          phone: `+${1000000000 + i}`,
          personalDetails: {
            hobbies: [`hobby-${i}`],
            family: [],
            preferences: { testId: i },
            importantDates: []
          },
          relationshipHealth: {
            score: 50 + (i % 50),
            lastInteraction: new Date(),
            sentimentTrend: 'positive',
            interactionFrequency: i % 10,
            responseTime: i % 24
          },
          lastCrmSync: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        };

        operations.push(
          CacheService.setCrmClient('salesforce', `crm-perf-${i}`, client, mockUserId)
        );
      }

      // Execute all operations
      await Promise.all(operations);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Performance assertion - should complete within reasonable time
      expect(duration).toBeLessThan(5000); // 5 seconds for 100 operations
      expect(RedisService.set).toHaveBeenCalledTimes(clientCount * 2); // Client + audit log
    });
  });
});