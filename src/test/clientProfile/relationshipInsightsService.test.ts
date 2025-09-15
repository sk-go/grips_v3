/**
 * Tests for Relationship Insights Service
 */

import { Pool } from 'pg';
import { RedisClientType } from 'redis';
import { RelationshipInsightsService, SentimentAnalysisResult, RelationshipHealthScore } from '../../services/clientProfile/relationshipInsightsService';
import { NLPProcessingService } from '../../services/nlp/nlpProcessingService';
import { Communication } from '../../types';

// Mock dependencies
jest.mock('pg');
jest.mock('ioredis');
jest.mock('../../services/nlp/nlpProcessingService');
jest.mock('../../utils/logger');

describe('RelationshipInsightsService', () => {
  let service: RelationshipInsightsService;
  let mockDb: jest.Mocked<Pool>;
  let mockRedis: jest.Mocked<RedisClientType>;
  let mockNlpService: jest.Mocked<NLPProcessingService>;

  beforeEach(() => {
    mockDb = {
      query: jest.fn(),
    } as any;

    mockRedis = {
      get: jest.fn(),
      setEx: jest.fn(),
      del: jest.fn(),
    } as any;

    mockNlpService = {
      processText: jest.fn(),
    } as any;

    service = new RelationshipInsightsService(mockDb, mockRedis, mockNlpService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('analyzeSentiment', () => {
    it('should analyze sentiment with VADER threshold', async () => {
      // Mock NLP service response
      mockNlpService.processText.mockResolvedValue({
        sentiment: {
          score: 0.6,
          magnitude: 0.8,
          label: 'positive',
          confidence: 0.9
        },
        intent: { name: 'test', confidence: 0.8, category: 'other' },
        entities: [],
        tasks: [],
        language: 'en',
        processingTime: 100
      });

      const result = await service.analyzeSentiment('I am very happy with the service!');

      expect(result.isPositive).toBe(true); // Should be > 0.5 threshold
      expect(result.score).toBeGreaterThan(0.5);
      expect(result.label).toBe('very_positive');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should handle negative sentiment correctly', async () => {
      mockNlpService.processText.mockResolvedValue({
        sentiment: {
          score: -0.7,
          magnitude: 0.8,
          label: 'negative',
          confidence: 0.9
        },
        intent: { name: 'test', confidence: 0.8, category: 'other' },
        entities: [],
        tasks: [],
        language: 'en',
        processingTime: 100
      });

      const result = await service.analyzeSentiment('This is terrible service!');

      expect(result.isPositive).toBe(false);
      expect(result.score).toBeLessThan(0);
      expect(result.label).toBe('very_negative');
    });

    it('should handle insurance-specific sentiment words', async () => {
      mockNlpService.processText.mockResolvedValue({
        sentiment: {
          score: 0.3,
          magnitude: 0.5,
          label: 'positive',
          confidence: 0.7
        },
        intent: { name: 'test', confidence: 0.8, category: 'other' },
        entities: [],
        tasks: [],
        language: 'en',
        processingTime: 100
      });

      const result = await service.analyzeSentiment('The agent was very professional and trustworthy');

      expect(result.confidence).toBeGreaterThan(0);
      expect(result.magnitude).toBeGreaterThan(0);
    });

    it('should handle negation correctly', async () => {
      mockNlpService.processText.mockResolvedValue({
        sentiment: {
          score: 0.1,
          magnitude: 0.3,
          label: 'neutral',
          confidence: 0.6
        },
        intent: { name: 'test', confidence: 0.8, category: 'other' },
        entities: [],
        tasks: [],
        language: 'en',
        processingTime: 100
      });

      const result = await service.analyzeSentiment('The service was not bad');

      expect(result.score).toBeDefined();
      expect(result.label).toBeDefined();
    });

    it('should handle errors gracefully', async () => {
      mockNlpService.processText.mockRejectedValue(new Error('NLP service error'));

      const result = await service.analyzeSentiment('Test text');

      expect(result.score).toBe(0);
      expect(result.magnitude).toBe(0);
      expect(result.label).toBe('neutral');
      expect(result.confidence).toBe(0);
      expect(result.isPositive).toBe(false);
    });
  });

  describe('calculateRelationshipHealth', () => {
    const mockClientId = 'client-123';
    const mockCommunications: Communication[] = [
      {
        id: 'comm-1',
        clientId: mockClientId,
        type: 'email',
        direction: 'inbound',
        content: 'Hello, I have a question about my policy',
        timestamp: new Date('2024-01-15T10:00:00Z'),
        sentiment: 0.2,
        tags: [],
        isUrgent: false,
        source: 'email',
        metadata: {}
      },
      {
        id: 'comm-2',
        clientId: mockClientId,
        type: 'email',
        direction: 'outbound',
        content: 'Thank you for reaching out. I would be happy to help.',
        timestamp: new Date('2024-01-15T11:00:00Z'),
        sentiment: 0.8,
        tags: [],
        isUrgent: false,
        source: 'email',
        metadata: {}
      }
    ];

    beforeEach(() => {
      // Mock client data query
      mockDb.query.mockImplementation((query: string) => {
        if (query.includes('SELECT') && query.includes('clients') && query.includes('WHERE id = $1')) {
          return Promise.resolve({
            rows: [{
              id: mockClientId,
              name: 'John Doe',
              email: 'john@example.com'
            }]
          });
        }
        
        // Mock communications query
        if (query.includes('communications')) {
          return Promise.resolve({
            rows: mockCommunications.map(c => ({
              id: c.id,
              client_id: c.clientId,
              type: c.type,
              direction: c.direction,
              content: c.content,
              timestamp: c.timestamp,
              sentiment: c.sentiment
            }))
          });
        }

        // Mock historical scores query
        if (query.includes('relationship_score')) {
          return Promise.resolve({
            rows: [
              { relationship_score: 75, updated_at: new Date() },
              { relationship_score: 70, updated_at: new Date() }
            ]
          });
        }

        // Mock update query
        if (query.includes('UPDATE clients')) {
          return Promise.resolve({ rows: [] });
        }

        return Promise.resolve({ rows: [] });
      });

      // Mock Redis cache miss
      mockRedis.get.mockResolvedValue(null);
      mockRedis.setEx.mockResolvedValue('OK');
    });

    it('should calculate relationship health score correctly', async () => {
      const result = await service.calculateRelationshipHealth(mockClientId);

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.factors).toBeDefined();
      expect(result.factors.sentimentTrend).toBeGreaterThanOrEqual(0);
      expect(result.factors.sentimentTrend).toBeLessThanOrEqual(30);
      expect(result.factors.interactionFrequency).toBeGreaterThanOrEqual(0);
      expect(result.factors.interactionFrequency).toBeLessThanOrEqual(25);
      expect(result.factors.responseTime).toBeGreaterThanOrEqual(0);
      expect(result.factors.responseTime).toBeLessThanOrEqual(20);
      expect(result.factors.recentActivity).toBeGreaterThanOrEqual(0);
      expect(result.factors.recentActivity).toBeLessThanOrEqual(15);
      expect(result.factors.communicationQuality).toBeGreaterThanOrEqual(0);
      expect(result.factors.communicationQuality).toBeLessThanOrEqual(10);
      expect(['improving', 'stable', 'declining']).toContain(result.trend);
      expect(result.lastCalculated).toBeInstanceOf(Date);
    });

    it('should use cached result when available', async () => {
      const cachedResult: RelationshipHealthScore = {
        score: 85,
        factors: {
          sentimentTrend: 25,
          interactionFrequency: 20,
          responseTime: 15,
          recentActivity: 15,
          communicationQuality: 10
        },
        trend: 'improving',
        lastCalculated: new Date()
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(cachedResult));

      const result = await service.calculateRelationshipHealth(mockClientId);

      expect(result).toEqual(cachedResult);
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should handle client not found', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      await expect(service.calculateRelationshipHealth('nonexistent-client'))
        .rejects.toThrow('Client not found: nonexistent-client');
    });

    it('should handle empty communications gracefully', async () => {
      mockDb.query.mockImplementation((query: string) => {
        if (query.includes('clients')) {
          return Promise.resolve({
            rows: [{
              id: mockClientId,
              name: 'John Doe',
              email: 'john@example.com'
            }]
          });
        }
        
        if (query.includes('communications')) {
          return Promise.resolve({ rows: [] });
        }

        if (query.includes('relationship_score')) {
          return Promise.resolve({ rows: [] });
        }

        if (query.includes('UPDATE clients')) {
          return Promise.resolve({ rows: [] });
        }

        return Promise.resolve({ rows: [] });
      });

      const result = await service.calculateRelationshipHealth(mockClientId);

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.trend).toBe('stable');
    });
  });

  describe('generateConversationSummary', () => {
    const mockClientId = 'client-123';
    const mockCommunications: Communication[] = [
      {
        id: 'comm-1',
        clientId: mockClientId,
        type: 'email',
        direction: 'inbound',
        content: 'I need help with my policy renewal',
        timestamp: new Date('2024-01-15T10:00:00Z'),
        sentiment: 0.1,
        tags: [],
        isUrgent: false,
        source: 'email',
        metadata: {}
      },
      {
        id: 'comm-2',
        clientId: mockClientId,
        type: 'email',
        direction: 'outbound',
        content: 'I can help you with the renewal process. Let me get your policy details.',
        timestamp: new Date('2024-01-15T11:00:00Z'),
        sentiment: 0.7,
        tags: [],
        isUrgent: false,
        source: 'email',
        metadata: {}
      }
    ];

    beforeEach(() => {
      mockNlpService.processText.mockResolvedValue({
        sentiment: {
          score: 0.4,
          magnitude: 0.6,
          label: 'positive',
          confidence: 0.8
        },
        intent: { name: 'help_request', confidence: 0.9, category: 'support' },
        entities: [
          { type: 'policy_number', value: 'POL123456', confidence: 0.9, startIndex: 0, endIndex: 9 }
        ],
        tasks: [
          { description: 'Process policy renewal', confidence: 0.8 }
        ],
        language: 'en',
        processingTime: 150
      });

      // Mock database insert for conversation summary
      mockDb.query.mockResolvedValue({
        rows: [{
          id: 'summary-123',
          client_id: mockClientId,
          communication_id: 'comm-1',
          summary: 'Test summary',
          sentiment_score: 0.4,
          key_topics: ['policy_number'],
          action_items: ['Process policy renewal'],
          created_at: new Date()
        }]
      });
    });

    it('should generate conversation summary successfully', async () => {
      const result = await service.generateConversationSummary(mockClientId, mockCommunications);

      expect(result.id).toBe('summary-123');
      expect(result.clientId).toBe(mockClientId);
      expect(result.summary).toBeDefined();
      expect(result.keyTopics).toContain('policy_number');
      expect(result.actionItems).toContain('Process policy renewal');
      expect(result.sentimentScore).toBeDefined();
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('should handle empty communications array', async () => {
      await expect(service.generateConversationSummary(mockClientId, []))
        .rejects.toThrow('No communications provided for summary');
    });

    it('should extract insurance-specific topics', async () => {
      const insuranceCommunications: Communication[] = [
        {
          id: 'comm-1',
          clientId: mockClientId,
          type: 'email',
          direction: 'inbound',
          content: 'I need to file a claim for my car accident',
          timestamp: new Date(),
          sentiment: -0.2,
          tags: [],
          isUrgent: true,
          source: 'email',
          metadata: {}
        }
      ];

      const result = await service.generateConversationSummary(mockClientId, insuranceCommunications);

      expect(result.summary).toContain('1 messages');
      expect(result.summary).toContain('single interaction');
    });
  });

  describe('getSentimentTrend', () => {
    const mockClientId = 'client-123';

    beforeEach(() => {
      // Mock sentiment trend query
      mockDb.query.mockResolvedValue({
        rows: [
          {
            date: new Date('2024-01-01'),
            avg_sentiment: 0.2,
            communication_count: 3,
            avg_response_time_hours: 2.5
          },
          {
            date: new Date('2024-01-02'),
            avg_sentiment: 0.5,
            communication_count: 2,
            avg_response_time_hours: 1.8
          },
          {
            date: new Date('2024-01-03'),
            avg_sentiment: 0.7,
            communication_count: 4,
            avg_response_time_hours: 1.2
          }
        ]
      });
    });

    it('should return sentiment trend data', async () => {
      const result = await service.getSentimentTrend(mockClientId, '7d');

      expect(result.clientId).toBe(mockClientId);
      expect(result.timeframe).toBe('7d');
      expect(result.dataPoints).toHaveLength(3);
      expect(result.dataPoints[0].sentimentScore).toBe(0.2);
      expect(result.dataPoints[1].sentimentScore).toBe(0.5);
      expect(result.dataPoints[2].sentimentScore).toBe(0.7);
      expect(result.overallTrend).toBe('improving'); // Upward trend
      expect(result.trendStrength).toBeGreaterThan(0);
    });

    it('should handle different timeframes', async () => {
      const result30d = await service.getSentimentTrend(mockClientId, '30d');
      expect(result30d.timeframe).toBe('30d');

      const result90d = await service.getSentimentTrend(mockClientId, '90d');
      expect(result90d.timeframe).toBe('90d');

      const result1y = await service.getSentimentTrend(mockClientId, '1y');
      expect(result1y.timeframe).toBe('1y');
    });

    it('should handle declining trend', async () => {
      // Mock declining sentiment data
      mockDb.query.mockResolvedValue({
        rows: [
          {
            date: new Date('2024-01-01'),
            avg_sentiment: 0.8,
            communication_count: 3,
            avg_response_time_hours: 1.0
          },
          {
            date: new Date('2024-01-02'),
            avg_sentiment: 0.4,
            communication_count: 2,
            avg_response_time_hours: 2.5
          },
          {
            date: new Date('2024-01-03'),
            avg_sentiment: 0.1,
            communication_count: 4,
            avg_response_time_hours: 4.0
          }
        ]
      });

      const result = await service.getSentimentTrend(mockClientId, '7d');

      expect(result.overallTrend).toBe('declining');
      expect(result.trendStrength).toBeGreaterThan(0);
    });

    it('should handle stable trend', async () => {
      // Mock stable sentiment data
      mockDb.query.mockResolvedValue({
        rows: [
          {
            date: new Date('2024-01-01'),
            avg_sentiment: 0.5,
            communication_count: 3,
            avg_response_time_hours: 2.0
          },
          {
            date: new Date('2024-01-02'),
            avg_sentiment: 0.52,
            communication_count: 2,
            avg_response_time_hours: 2.1
          },
          {
            date: new Date('2024-01-03'),
            avg_sentiment: 0.48,
            communication_count: 4,
            avg_response_time_hours: 1.9
          }
        ]
      });

      const result = await service.getSentimentTrend(mockClientId, '7d');

      expect(result.overallTrend).toBe('stable');
    });

    it('should handle insufficient data', async () => {
      mockDb.query.mockResolvedValue({
        rows: [
          {
            date: new Date('2024-01-01'),
            avg_sentiment: 0.5,
            communication_count: 1,
            avg_response_time_hours: 2.0
          }
        ]
      });

      const result = await service.getSentimentTrend(mockClientId, '7d');

      expect(result.overallTrend).toBe('stable');
      expect(result.trendStrength).toBe(0);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle database connection errors', async () => {
      mockDb.query.mockRejectedValue(new Error('Database connection failed'));

      await expect(service.calculateRelationshipHealth('client-123'))
        .rejects.toThrow('Database connection failed');
    });

    it('should handle Redis connection errors gracefully', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis connection failed'));
      
      // Mock successful database queries
      mockDb.query.mockImplementation((query: string) => {
        if (query.includes('clients')) {
          return Promise.resolve({
            rows: [{
              id: 'client-123',
              name: 'John Doe',
              email: 'john@example.com'
            }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      // Should still work without cache
      const result = await service.calculateRelationshipHealth('client-123');
      expect(result.score).toBeDefined();
    });

    it('should handle NLP service failures in sentiment analysis', async () => {
      mockNlpService.processText.mockRejectedValue(new Error('NLP service unavailable'));

      const result = await service.analyzeSentiment('Test text');

      expect(result.score).toBe(0);
      expect(result.label).toBe('neutral');
      expect(result.isPositive).toBe(false);
    });
  });
});