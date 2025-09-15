/**
 * Simple tests for Relationship Insights Service
 */

import { RelationshipInsightsService } from '../../services/clientProfile/relationshipInsightsService';

// Mock dependencies
jest.mock('pg');
jest.mock('redis');
jest.mock('../../services/nlp/nlpProcessingService');
jest.mock('../../utils/logger');

describe('RelationshipInsightsService - Core Functionality', () => {
  let service: RelationshipInsightsService;
  let mockDb: any;
  let mockRedis: any;
  let mockNlpService: any;

  beforeEach(() => {
    mockDb = {
      query: jest.fn(),
    };

    mockRedis = {
      get: jest.fn(),
      setEx: jest.fn(),
      del: jest.fn(),
    };

    mockNlpService = {
      processText: jest.fn(),
    };

    service = new RelationshipInsightsService(mockDb, mockRedis, mockNlpService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('analyzeSentiment', () => {
    it('should analyze positive sentiment correctly', async () => {
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
        confidence: 0.8,
        language: 'en',
        processingTime: 100
      });

      const result = await service.analyzeSentiment('I am very happy with the service!');

      expect(result.isPositive).toBe(true);
      expect(result.score).toBeGreaterThan(0.5);
      expect(result.confidence).toBeGreaterThan(0);
      expect(['very_negative', 'negative', 'neutral', 'positive', 'very_positive']).toContain(result.label);
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
    it('should calculate health score when cache is empty', async () => {
      const mockClientId = 'client-123';

      // Mock Redis cache miss
      mockRedis.get.mockResolvedValue(null);
      mockRedis.setEx.mockResolvedValue('OK');

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
            rows: [{
              id: 'comm-1',
              client_id: mockClientId,
              type: 'email',
              direction: 'inbound',
              content: 'Hello',
              timestamp: new Date(),
              sentiment: 0.5
            }]
          });
        }

        // Mock historical scores query
        if (query.includes('relationship_score')) {
          return Promise.resolve({
            rows: [
              { relationship_score: 75, updated_at: new Date() }
            ]
          });
        }

        // Mock update query
        if (query.includes('UPDATE clients')) {
          return Promise.resolve({ rows: [] });
        }

        return Promise.resolve({ rows: [] });
      });

      const result = await service.calculateRelationshipHealth(mockClientId);

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.factors).toBeDefined();
      expect(['improving', 'stable', 'declining']).toContain(result.trend);
      expect(result.lastCalculated).toBeInstanceOf(Date);
    });

    it('should handle client not found', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockDb.query.mockResolvedValue({ rows: [] });

      await expect(service.calculateRelationshipHealth('nonexistent-client'))
        .rejects.toThrow('Client not found: nonexistent-client');
    });
  });

  describe('getSentimentTrend', () => {
    it('should return sentiment trend data', async () => {
      const mockClientId = 'client-123';

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

      const result = await service.getSentimentTrend(mockClientId, '7d');

      expect(result.clientId).toBe(mockClientId);
      expect(result.timeframe).toBe('7d');
      expect(result.dataPoints).toHaveLength(3);
      expect(result.dataPoints[0].sentimentScore).toBe(0.2);
      expect(result.dataPoints[1].sentimentScore).toBe(0.5);
      expect(result.dataPoints[2].sentimentScore).toBe(0.7);
      expect(['improving', 'stable', 'declining']).toContain(result.overallTrend);
      expect(result.trendStrength).toBeGreaterThanOrEqual(0);
      expect(result.trendStrength).toBeLessThanOrEqual(1);
    });
  });
});