/**
 * Relationship Visualization Service Tests
 */

import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { RelationshipVisualizationService } from '../../services/clientProfile/relationshipVisualizationService';

// Mock dependencies
jest.mock('pg');
jest.mock('ioredis');
jest.mock('../../utils/logger');

describe('RelationshipVisualizationService', () => {
  let visualizationService: RelationshipVisualizationService;
  let mockDb: jest.Mocked<Pool>;
  let mockRedis: jest.Mocked<Redis>;

  beforeEach(() => {
    mockDb = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    } as any;

    mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      setex: jest.fn().mockResolvedValue('OK'),
      keys: jest.fn().mockResolvedValue([]),
      del: jest.fn().mockResolvedValue(1),
    } as any;

    visualizationService = new RelationshipVisualizationService(mockDb, mockRedis);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateRelationshipGraph', () => {
    it('should return cached graph data when available', async () => {
      const cachedGraph = {
        nodes: [
          {
            id: 'client-123',
            name: 'John Doe',
            type: 'client',
            group: 1,
            size: 45,
            metadata: { relationshipScore: 85 }
          }
        ],
        links: [],
        centerNodeId: 'client-123',
        metadata: {
          totalNodes: 1,
          totalConnections: 0,
          maxDepth: 2,
          generatedAt: new Date('2024-01-15')
        }
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(cachedGraph));

      const result = await visualizationService.generateRelationshipGraph('client-123');

      expect(result).toEqual(cachedGraph);
      expect(mockRedis.get).toHaveBeenCalledWith('relationship_graph:client-123:2:true:true');
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should generate new graph data when not cached', async () => {
      mockRedis.get.mockResolvedValue(null);

      // Mock client data query
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ // Main client
          id: 'client-123',
          name: 'John Doe',
          photo_url: 'https://example.com/photo.jpg',
          relationship_score: 85,
          last_interaction: new Date('2024-01-15'),
          sentiment_trend: 'positive'
        }] })
        .mockResolvedValueOnce({ rows: [ // Family members
          {
            id: 'family-1',
            name: 'Jane Doe',
            relationship: 'spouse',
            age: 35,
            notes: 'Spouse'
          },
          {
            id: 'family-2',
            name: 'Jimmy Doe',
            relationship: 'child',
            age: 12,
            notes: 'Son'
          }
        ] })
        .mockResolvedValueOnce({ rows: [ // Business relationships
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
          relationship_score: 70,
          last_interaction: new Date('2024-01-10'),
          sentiment_trend: 'neutral'
        }] })
        .mockResolvedValueOnce({ rows: [] }) // Related client family
        .mockResolvedValueOnce({ rows: [] }); // Related client relationships

      const result = await visualizationService.generateRelationshipGraph('client-123');

      expect(result.nodes).toHaveLength(4); // Main client + 2 family + 1 related client
      expect(result.links).toHaveLength(3); // 2 family links + 1 business link
      expect(result.centerNodeId).toBe('client-123');

      // Check main client node
      const mainClient = result.nodes.find(n => n.id === 'client-123');
      expect(mainClient).toBeDefined();
      expect(mainClient?.type).toBe('client');
      expect(mainClient?.group).toBe(1); // Center client group

      // Check family nodes
      const familyNodes = result.nodes.filter(n => n.type === 'family');
      expect(familyNodes).toHaveLength(2);
      expect(familyNodes[0].group).toBe(3); // Family group

      // Check business relationship link
      const businessLink = result.links.find(l => 
        l.source === 'client-123' && l.target === 'client-456'
      );
      expect(businessLink).toBeDefined();
      expect(businessLink?.type).toBe('business_partner');
      expect(businessLink?.strength).toBe(4);

      // Verify caching
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'relationship_graph:client-123:2:true:true',
        1800,
        expect.any(String)
      );
    });

    it('should respect maxDepth parameter', async () => {
      mockRedis.get.mockResolvedValue(null);

      // Mock client data with depth 1 only
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ // Main client
          id: 'client-123',
          name: 'John Doe',
          photo_url: null,
          relationship_score: 85,
          last_interaction: new Date(),
          sentiment_trend: 'positive'
        }] })
        .mockResolvedValueOnce({ rows: [] }) // No family
        .mockResolvedValueOnce({ rows: [] }); // No business relationships

      const result = await visualizationService.generateRelationshipGraph('client-123', 1);

      expect(result.nodes).toHaveLength(1); // Only main client
      expect(result.links).toHaveLength(0);
      expect(result.metadata.maxDepth).toBe(1);
    });

    it('should exclude family when includeFamily is false', async () => {
      mockRedis.get.mockResolvedValue(null);

      mockDb.query
        .mockResolvedValueOnce({ rows: [{ // Main client
          id: 'client-123',
          name: 'John Doe',
          photo_url: null,
          relationship_score: 85,
          last_interaction: new Date(),
          sentiment_trend: 'positive'
        }] })
        .mockResolvedValueOnce({ rows: [] }); // No business relationships

      const result = await visualizationService.generateRelationshipGraph(
        'client-123', 
        2, 
        false, // excludeFamily
        true
      );

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes.every(n => n.type !== 'family')).toBe(true);
    });

    it('should exclude business relationships when includeBusiness is false', async () => {
      mockRedis.get.mockResolvedValue(null);

      mockDb.query
        .mockResolvedValueOnce({ rows: [{ // Main client
          id: 'client-123',
          name: 'John Doe',
          photo_url: null,
          relationship_score: 85,
          last_interaction: new Date(),
          sentiment_trend: 'positive'
        }] })
        .mockResolvedValueOnce({ rows: [ // Family members
          {
            id: 'family-1',
            name: 'Jane Doe',
            relationship: 'spouse',
            age: 35,
            notes: 'Spouse'
          }
        ] });

      const result = await visualizationService.generateRelationshipGraph(
        'client-123', 
        2, 
        true, 
        false // excludeBusiness
      );

      expect(result.nodes).toHaveLength(2); // Client + family
      expect(result.links).toHaveLength(1); // Only family link
      expect(result.links.every(l => l.type !== 'business_partner')).toBe(true);
    });
  });

  describe('getDefaultLayoutConfig', () => {
    it('should return valid D3.js layout configuration', () => {
      const config = visualizationService.getDefaultLayoutConfig();

      expect(config).toHaveProperty('width');
      expect(config).toHaveProperty('height');
      expect(config).toHaveProperty('centerForce');
      expect(config).toHaveProperty('linkDistance');
      expect(config).toHaveProperty('nodeSize');
      expect(config).toHaveProperty('colors');

      expect(config.width).toBe(800);
      expect(config.height).toBe(600);
      expect(config.nodeSize.min).toBeLessThan(config.nodeSize.max);
      
      expect(config.colors).toHaveProperty('client');
      expect(config.colors).toHaveProperty('family');
      expect(config.colors).toHaveProperty('business');
      expect(config.colors).toHaveProperty('selected');
    });
  });

  describe('getGraphStatistics', () => {
    it('should return comprehensive graph statistics', async () => {
      const mockStats = {
        business_connections: '3',
        avg_relationship_strength: '3.5',
        family_members: '2',
        relationship_score: 85,
        sentiment_trend: 'positive'
      };

      mockDb.query.mockResolvedValue({ rows: [mockStats] });

      const result = await visualizationService.getGraphStatistics('client-123');

      expect(result).toEqual({
        businessConnections: 3,
        averageRelationshipStrength: 3.5,
        familyMembers: 2,
        relationshipScore: 85,
        sentimentTrend: 'positive',
        networkSize: 5 // business + family
      });
    });

    it('should handle null statistics gracefully', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      const result = await visualizationService.getGraphStatistics('nonexistent');

      expect(result).toBeNull();
    });

    it('should handle missing values with defaults', async () => {
      const mockStats = {
        business_connections: null,
        avg_relationship_strength: null,
        family_members: null,
        relationship_score: null,
        sentiment_trend: null
      };

      mockDb.query.mockResolvedValue({ rows: [mockStats] });

      const result = await visualizationService.getGraphStatistics('client-123');

      expect(result).toEqual({
        businessConnections: 0,
        averageRelationshipStrength: 0,
        familyMembers: 0,
        relationshipScore: 50,
        sentimentTrend: 'neutral',
        networkSize: 0
      });
    });
  });

  describe('clearGraphCache', () => {
    it('should clear all graph cache entries for a client', async () => {
      const cacheKeys = [
        'relationship_graph:client-123:1:true:true',
        'relationship_graph:client-123:2:true:false',
        'relationship_graph:client-123:2:false:true'
      ];

      mockRedis.keys.mockResolvedValue(cacheKeys);
      mockRedis.del.mockResolvedValue(3);

      await visualizationService.clearGraphCache('client-123');

      expect(mockRedis.keys).toHaveBeenCalledWith('relationship_graph:client-123:*');
      expect(mockRedis.del).toHaveBeenCalledWith(...cacheKeys);
    });

    it('should handle no cache entries gracefully', async () => {
      mockRedis.keys.mockResolvedValue([]);

      await visualizationService.clearGraphCache('client-123');

      expect(mockRedis.keys).toHaveBeenCalledWith('relationship_graph:client-123:*');
      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });

  describe('node size calculation', () => {
    it('should calculate appropriate node sizes based on connections', async () => {
      mockRedis.get.mockResolvedValue(null);

      // Mock a client with multiple connections
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ // Main client
          id: 'client-123',
          name: 'John Doe',
          photo_url: null,
          relationship_score: 90, // High score
          last_interaction: new Date(),
          sentiment_trend: 'positive'
        }] })
        .mockResolvedValueOnce({ rows: [ // Multiple family members
          { id: 'family-1', name: 'Jane', relationship: 'spouse', age: 35, notes: '' },
          { id: 'family-2', name: 'Jimmy', relationship: 'child', age: 12, notes: '' },
          { id: 'family-3', name: 'Jenny', relationship: 'child', age: 8, notes: '' }
        ] })
        .mockResolvedValueOnce({ rows: [ // Multiple business relationships
          { related_client_id: 'client-456', relationship_type: 'partner', strength: 5, notes: '' },
          { related_client_id: 'client-789', relationship_type: 'referral', strength: 3, notes: '' }
        ] })
        .mockResolvedValueOnce({ rows: [{ // Related client 1
          id: 'client-456', name: 'Bob', photo_url: null, relationship_score: 70,
          last_interaction: new Date(), sentiment_trend: 'neutral'
        }] })
        .mockResolvedValueOnce({ rows: [] }) // Related client 1 family
        .mockResolvedValueOnce({ rows: [] }) // Related client 1 relationships
        .mockResolvedValueOnce({ rows: [{ // Related client 2
          id: 'client-789', name: 'Alice', photo_url: null, relationship_score: 60,
          last_interaction: new Date(), sentiment_trend: 'neutral'
        }] })
        .mockResolvedValueOnce({ rows: [] }) // Related client 2 family
        .mockResolvedValueOnce({ rows: [] }); // Related client 2 relationships

      const result = await visualizationService.generateRelationshipGraph('client-123');

      // Main client should have larger size due to high relationship score and many connections
      const mainClient = result.nodes.find(n => n.id === 'client-123');
      expect(mainClient?.size).toBeGreaterThan(30); // Should be larger due to connections

      // Family nodes should have moderate size
      const familyNodes = result.nodes.filter(n => n.type === 'family');
      familyNodes.forEach(node => {
        expect(node.size).toBeGreaterThanOrEqual(15);
        expect(node.size).toBeLessThanOrEqual(60);
      });
    });
  });

  describe('link distance optimization', () => {
    it('should set appropriate distances for different relationship types', async () => {
      mockRedis.get.mockResolvedValue(null);

      mockDb.query
        .mockResolvedValueOnce({ rows: [{ // Main client
          id: 'client-123',
          name: 'John Doe',
          photo_url: null,
          relationship_score: 85,
          last_interaction: new Date(),
          sentiment_trend: 'positive'
        }] })
        .mockResolvedValueOnce({ rows: [ // Family member
          { id: 'family-1', name: 'Jane', relationship: 'spouse', age: 35, notes: '' }
        ] })
        .mockResolvedValueOnce({ rows: [ // Business relationship
          { related_client_id: 'client-456', relationship_type: 'business_partner', strength: 4, notes: '' }
        ] })
        .mockResolvedValueOnce({ rows: [{ // Related client
          id: 'client-456', name: 'Bob', photo_url: null, relationship_score: 70,
          last_interaction: new Date(), sentiment_trend: 'neutral'
        }] })
        .mockResolvedValueOnce({ rows: [] }) // Related client family
        .mockResolvedValueOnce({ rows: [] }); // Related client relationships

      const result = await visualizationService.generateRelationshipGraph('client-123');

      // Family relationships should have shorter distances
      const familyLink = result.links.find(l => l.type === 'spouse');
      expect(familyLink?.distance).toBeLessThan(80);

      // Business relationships should have longer distances
      const businessLink = result.links.find(l => l.type === 'business_partner');
      expect(businessLink?.distance).toBeGreaterThan(familyLink?.distance || 0);
    });
  });
});