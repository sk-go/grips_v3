/**
 * Client Profile Service Tests
 */

import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { ClientProfileService } from '../../services/clientProfile/clientProfileService';
import { CrmSyncService } from '../../services/crm/crmSyncService';
import { Client, CrmSystem } from '../../types';

// Mock dependencies
jest.mock('pg');
jest.mock('ioredis');
jest.mock('../../services/crm/crmSyncService');
jest.mock('../../utils/logger');

describe('ClientProfileService', () => {
  let clientProfileService: ClientProfileService;
  let mockDb: jest.Mocked<Pool>;
  let mockRedis: jest.Mocked<Redis>;
  let mockCrmSyncService: jest.Mocked<CrmSyncService>;

  const mockClient: Client = {
    id: 'client-123',
    crmId: 'crm-456',
    crmSystem: 'zoho' as CrmSystem,
    name: 'John Doe',
    email: 'john@example.com',
    phone: '+1234567890',
    photo: 'https://example.com/photo.jpg',
    personalDetails: {
      hobbies: ['golf', 'reading'],
      family: [],
      preferences: { communication: 'email' },
      importantDates: []
    },
    relationshipHealth: {
      score: 85,
      lastInteraction: new Date('2024-01-15'),
      sentimentTrend: 'positive',
      interactionFrequency: 2.5,
      responseTime: 4.2
    },
    lastCrmSync: new Date('2024-01-15'),
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-15')
  };

  beforeEach(() => {
    mockDb = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    } as any;

    mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      setex: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    } as any;

    mockCrmSyncService = {
      fetchClientData: jest.fn().mockResolvedValue(null),
    } as any;

    clientProfileService = new ClientProfileService(
      mockDb,
      mockRedis,
      mockCrmSyncService
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getClientProfile', () => {
    it('should return cached client profile when available', async () => {
      const cachedProfile = {
        client: mockClient,
        familyMembers: [],
        importantDates: [],
        preferences: {},
        relationships: []
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(cachedProfile));

      const result = await clientProfileService.getClientProfile('client-123');

      expect(result).toEqual(cachedProfile);
      expect(mockRedis.get).toHaveBeenCalledWith('client_profile:client-123');
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should fetch from database when not cached', async () => {
      mockRedis.get.mockResolvedValue(null);
      
      // Mock database queries
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ // Client query
          id: 'client-123',
          crm_id: 'crm-456',
          crm_system: 'zoho',
          name: 'John Doe',
          email: 'john@example.com',
          phone: '+1234567890',
          photo_url: 'https://example.com/photo.jpg',
          relationship_score: 85,
          last_interaction: new Date('2024-01-15'),
          sentiment_trend: 'positive',
          interaction_frequency: 2.5,
          response_time_hours: 4.2,
          last_crm_sync: new Date('2024-01-15'),
          sync_status: 'success',
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-15')
        }] })
        .mockResolvedValueOnce({ rows: [] }) // Client preferences query
        .mockResolvedValueOnce({ rows: [] }) // Family members query
        .mockResolvedValueOnce({ rows: [] }) // Important dates query
        .mockResolvedValueOnce({ rows: [] }) // Client preferences query (second call)
        .mockResolvedValueOnce({ rows: [] }); // Client relationships query

      const result = await clientProfileService.getClientProfile('client-123');

      expect(result).toBeDefined();
      expect(result?.client.name).toBe('John Doe');
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'client_profile:client-123',
        3600,
        expect.any(String)
      );
    });

    it('should return null when client not found', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockDb.query.mockResolvedValue({ rows: [] });

      const result = await clientProfileService.getClientProfile('nonexistent');

      expect(result).toBeNull();
    });

    it('should force sync with CRM when requested', async () => {
      mockRedis.get.mockResolvedValue(null);
      
      // Mock client exists but needs sync
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ // Client query
          id: 'client-123',
          crm_id: 'crm-456',
          crm_system: 'zoho',
          name: 'John Doe',
          email: 'john@example.com',
          phone: '+1234567890',
          photo_url: null,
          relationship_score: 50,
          last_interaction: null,
          sentiment_trend: 'neutral',
          interaction_frequency: 0,
          response_time_hours: 0,
          last_crm_sync: new Date('2024-01-01'), // Old sync
          sync_status: 'success',
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-01')
        }] })
        .mockResolvedValueOnce({ rows: [] }) // Client preferences
        .mockResolvedValueOnce({ rows: [] }) // Family members
        .mockResolvedValueOnce({ rows: [] }) // Important dates  
        .mockResolvedValueOnce({ rows: [] }) // Client preferences (second call)
        .mockResolvedValueOnce({ rows: [] }) // Client relationships
        .mockResolvedValueOnce({ rows: [{ // Updated client after sync
          id: 'client-123',
          crm_id: 'crm-456',
          crm_system: 'zoho',
          name: 'John Doe Updated',
          email: 'john.updated@example.com',
          phone: '+1234567890',
          photo_url: 'https://example.com/new-photo.jpg',
          relationship_score: 75,
          last_interaction: new Date('2024-01-15'),
          sentiment_trend: 'positive',
          interaction_frequency: 1.5,
          response_time_hours: 2.1,
          last_crm_sync: new Date(),
          sync_status: 'success',
          created_at: new Date('2024-01-01'),
          updated_at: new Date()
        }] })
        .mockResolvedValueOnce({ rows: [] }); // Client preferences after sync

      mockCrmSyncService.fetchClientData.mockResolvedValue({
        name: 'John Doe Updated',
        email: 'john.updated@example.com',
        photo: 'https://example.com/new-photo.jpg'
      });

      const result = await clientProfileService.getClientProfile('client-123', true);

      expect(mockCrmSyncService.fetchClientData).toHaveBeenCalledWith('zoho', 'crm-456');
      expect(result?.client.name).toBe('John Doe Updated');
    });
  });

  describe('upsertClient', () => {
    it('should create or update client successfully', async () => {
      const clientData = {
        crmId: 'crm-789',
        crmSystem: 'salesforce' as CrmSystem,
        name: 'Jane Smith',
        email: 'jane@example.com',
        phone: '+0987654321',
        relationshipHealth: {
          score: 90,
          lastInteraction: new Date(),
          sentimentTrend: 'positive' as const,
          interactionFrequency: 3.0,
          responseTime: 2.5
        }
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [{ id: 'new-client-id' }] }) // Insert/update query
        .mockResolvedValueOnce({ rows: [{ // Get client by ID
          id: 'new-client-id',
          crm_id: 'crm-789',
          crm_system: 'salesforce',
          name: 'Jane Smith',
          email: 'jane@example.com',
          phone: '+0987654321',
          photo_url: null,
          relationship_score: 90,
          last_interaction: expect.any(Date),
          sentiment_trend: 'positive',
          interaction_frequency: 3.0,
          response_time_hours: 2.5,
          last_crm_sync: expect.any(Date),
          sync_status: 'success',
          created_at: expect.any(Date),
          updated_at: expect.any(Date)
        }] })
        .mockResolvedValueOnce({ rows: [] }); // Client preferences

      const result = await clientProfileService.upsertClient(clientData);

      expect(result).toBeDefined();
      expect(result.name).toBe('Jane Smith');
      expect(mockRedis.del).toHaveBeenCalledWith('client_profile:new-client-id');
    });
  });

  describe('updateFamilyMembers', () => {
    it('should update family members successfully', async () => {
      const familyMembers = [
        {
          id: 'family-1',
          name: 'Jane Doe',
          relationship: 'spouse'
        },
        {
          id: 'family-2', 
          name: 'Jimmy Doe',
          relationship: 'child',
          age: 12
        }
      ];

      mockDb.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce(undefined) // DELETE existing
        .mockResolvedValueOnce(undefined) // INSERT family member 1
        .mockResolvedValueOnce(undefined) // INSERT family member 2
        .mockResolvedValueOnce(undefined); // COMMIT

      await clientProfileService.updateFamilyMembers('client-123', familyMembers);

      expect(mockDb.query).toHaveBeenCalledWith('BEGIN');
      expect(mockDb.query).toHaveBeenCalledWith(
        'DELETE FROM family_members WHERE client_id = $1',
        ['client-123']
      );
      expect(mockDb.query).toHaveBeenCalledWith('COMMIT');
      expect(mockRedis.del).toHaveBeenCalledWith('client_profile:client-123');
    });

    it('should rollback on error', async () => {
      const familyMembers = [
        {
          id: 'family-1',
          name: 'Jane Doe',
          relationship: 'spouse'
        }
      ];

      mockDb.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce(undefined) // DELETE existing
        .mockRejectedValueOnce(new Error('Insert failed')) // INSERT fails
        .mockResolvedValueOnce(undefined); // ROLLBACK

      await expect(
        clientProfileService.updateFamilyMembers('client-123', familyMembers)
      ).rejects.toThrow('Insert failed');

      expect(mockDb.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('searchClients', () => {
    it('should search clients by name, email, or phone', async () => {
      const searchResults = [
        {
          id: 'client-1',
          crm_id: 'crm-1',
          crm_system: 'zoho',
          name: 'John Smith',
          email: 'john.smith@example.com',
          phone: '+1111111111',
          photo_url: null,
          relationship_score: 80,
          last_interaction: new Date('2024-01-10'),
          sentiment_trend: 'positive',
          interaction_frequency: 2.0,
          response_time_hours: 3.0,
          last_crm_sync: new Date('2024-01-10'),
          sync_status: 'success',
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-10')
        }
      ];

      mockDb.query.mockResolvedValue({ rows: searchResults });
      
      // Mock preferences query for each result
      mockDb.query.mockResolvedValueOnce({ rows: searchResults });
      mockDb.query.mockResolvedValueOnce({ rows: [] }); // Preferences

      const results = await clientProfileService.searchClients('john', 10);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('John Smith');
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1'),
        ['%john%', 10]
      );
    });
  });

  describe('getRelationshipGraph', () => {
    it('should generate relationship graph with nodes and edges', async () => {
      // Mock client data
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ // Client query
          id: 'client-123',
          name: 'John Doe',
          photo_url: 'https://example.com/photo.jpg',
          relationship_score: 85
        }] })
        .mockResolvedValueOnce({ rows: [ // Family members
          {
            id: 'family-1',
            name: 'Jane Doe',
            relationship: 'spouse',
            age: 35,
            notes: 'Loves gardening'
          }
        ] })
        .mockResolvedValueOnce({ rows: [ // Client relationships
          {
            related_client_id: 'client-456',
            relationship_type: 'business_partner',
            strength: 4,
            notes: 'Long-term partner'
          }
        ] })
        .mockResolvedValueOnce({ rows: [{ // Related client data
          id: 'client-456',
          name: 'Bob Smith',
          photo_url: null,
          relationship_score: 70
        }] })
        .mockResolvedValueOnce({ rows: [] }) // Related client family
        .mockResolvedValueOnce({ rows: [] }); // Related client relationships

      const graph = await clientProfileService.getRelationshipGraph('client-123', 2);

      expect(graph.nodes).toHaveLength(3); // Main client + family + related client
      expect(graph.edges).toHaveLength(2); // Family connection + business connection
      
      // Check main client node
      const mainClientNode = graph.nodes.find(n => n.id === 'client-123');
      expect(mainClientNode).toBeDefined();
      expect(mainClientNode?.name).toBe('John Doe');
      expect(mainClientNode?.type).toBe('client');

      // Check family node
      const familyNode = graph.nodes.find(n => n.id === 'family_family-1');
      expect(familyNode).toBeDefined();
      expect(familyNode?.name).toBe('Jane Doe');
      expect(familyNode?.type).toBe('family');

      // Check business relationship edge
      const businessEdge = graph.edges.find(e => 
        e.source === 'client-123' && e.target === 'client-456'
      );
      expect(businessEdge).toBeDefined();
      expect(businessEdge?.type).toBe('business_partner');
      expect(businessEdge?.strength).toBe(4);
    });
  });
});