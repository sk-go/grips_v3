/**
 * Integration tests for Relationship Insights functionality
 */

import { RelationshipInsightsService } from '../../services/clientProfile/relationshipInsightsService';
import { SentimentTrendChart } from '../../components/SentimentTrendChart';
import { Communication } from '../../types';

// Mock dependencies
jest.mock('pg');
jest.mock('redis');
jest.mock('../../services/nlp/nlpProcessingService');
jest.mock('../../utils/logger');

describe('Relationship Insights Integration', () => {
  let service: RelationshipInsightsService;
  let chart: SentimentTrendChart;
  let mockDb: any;
  let mockRedis: any;
  let mockNlpService: any;

  const mockCommunications: Communication[] = [
    {
      id: 'comm-1',
      clientId: 'client-123',
      type: 'email',
      direction: 'inbound',
      subject: 'Policy Question',
      content: 'I have a question about my policy coverage',
      timestamp: new Date('2024-01-15T10:00:00Z'),
      tags: ['policy'],
      sentiment: 0.2,
      isUrgent: false,
      source: 'client@example.com',
      metadata: {}
    },
    {
      id: 'comm-2',
      clientId: 'client-123',
      type: 'email',
      direction: 'outbound',
      subject: 'Re: Policy Question',
      content: 'I would be happy to help you with your policy questions',
      timestamp: new Date('2024-01-15T11:00:00Z'),
      tags: ['policy', 'response'],
      sentiment: 0.8,
      isUrgent: false,
      source: 'agent@insurance.com',
      metadata: {}
    }
  ];

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
    chart = new SentimentTrendChart();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('End-to-End Workflow', () => {
    it('should complete full relationship insights workflow', async () => {
      const clientId = 'client-123';

      // Mock NLP service
      mockNlpService.processText.mockResolvedValue({
        sentiment: {
          score: 0.6,
          magnitude: 0.8,
          label: 'positive',
          confidence: 0.9
        },
        intent: { name: 'inquiry', confidence: 0.8, category: 'question' },
        entities: [
          { type: 'policy_number', value: 'POL123456', confidence: 0.9, startIndex: 0, endIndex: 9 }
        ],
        tasks: [],
        confidence: 0.8,
        language: 'en',
        processingTime: 100
      });

      // Mock Redis cache miss
      mockRedis.get.mockResolvedValue(null);
      mockRedis.setEx.mockResolvedValue('OK');

      // Mock database queries
      mockDb.query.mockImplementation((query: string) => {
        if (query.includes('SELECT') && query.includes('clients')) {
          return Promise.resolve({
            rows: [{
              id: clientId,
              name: 'John Doe',
              email: 'john@example.com'
            }]
          });
        }
        
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

        if (query.includes('relationship_score')) {
          return Promise.resolve({
            rows: [
              { relationship_score: 75, updated_at: new Date() }
            ]
          });
        }

        if (query.includes('UPDATE clients')) {
          return Promise.resolve({ rows: [] });
        }

        if (query.includes('INSERT INTO conversation_summaries')) {
          return Promise.resolve({
            rows: [{
              id: 'summary-123',
              client_id: clientId,
              communication_id: 'comm-1',
              summary: 'Client inquired about policy coverage',
              sentiment_score: 0.5,
              key_topics: ['policy_number'],
              action_items: [],
              created_at: new Date()
            }]
          });
        }

        if (query.includes('DATE_TRUNC')) {
          return Promise.resolve({
            rows: [
              {
                date: new Date('2024-01-15'),
                avg_sentiment: 0.5,
                communication_count: 2,
                avg_response_time_hours: 1.0
              }
            ]
          });
        }

        return Promise.resolve({ rows: [] });
      });

      // Step 1: Analyze sentiment
      const sentimentResult = await service.analyzeSentiment('I am happy with the service');
      expect(sentimentResult.score).toBeGreaterThan(0);
      expect(sentimentResult.isPositive).toBe(true);

      // Step 2: Calculate relationship health
      const healthScore = await service.calculateRelationshipHealth(clientId);
      expect(healthScore.score).toBeGreaterThanOrEqual(0);
      expect(healthScore.score).toBeLessThanOrEqual(100);
      expect(healthScore.factors).toBeDefined();

      // Step 3: Generate conversation summary
      const summary = await service.generateConversationSummary(clientId, mockCommunications);
      expect(summary.id).toBe('summary-123');
      expect(summary.clientId).toBe(clientId);
      expect(summary.summary).toBeDefined();

      // Step 4: Get sentiment trend
      const trendData = await service.getSentimentTrend(clientId, '7d');
      expect(trendData.clientId).toBe(clientId);
      expect(trendData.timeframe).toBe('7d');
      expect(trendData.dataPoints).toHaveLength(1);

      // Step 5: Generate visualization
      const chartData = chart.prepareChartData(trendData.dataPoints);
      expect(chartData).toHaveLength(1);
      expect(chartData[0].y).toBe(0.5);

      const svgChart = chart.generateSVGChart(trendData.dataPoints);
      expect(svgChart).toContain('<svg');
      expect(svgChart).toContain('</svg>');

      const chartJSConfig = chart.generateChartJSConfig(trendData.dataPoints);
      expect(chartJSConfig.type).toBe('line');
      expect(chartJSConfig.data.datasets).toHaveLength(1);
    });

    it('should handle errors gracefully in workflow', async () => {
      const clientId = 'client-123';

      // Mock NLP service failure
      mockNlpService.processText.mockRejectedValue(new Error('NLP service unavailable'));

      // Sentiment analysis should handle error
      const sentimentResult = await service.analyzeSentiment('Test text');
      expect(sentimentResult.score).toBe(0);
      expect(sentimentResult.isPositive).toBe(false);

      // Mock database failure
      mockDb.query.mockRejectedValue(new Error('Database connection failed'));

      // Health calculation should propagate error
      await expect(service.calculateRelationshipHealth(clientId))
        .rejects.toThrow('Database connection failed');
    });
  });

  describe('Performance and Caching', () => {
    it('should use cache for repeated health score calculations', async () => {
      const clientId = 'client-123';
      const cachedHealthScore = {
        score: 85,
        factors: {
          sentimentTrend: 25,
          interactionFrequency: 20,
          responseTime: 15,
          recentActivity: 15,
          communicationQuality: 10
        },
        trend: 'improving' as const,
        lastCalculated: new Date()
      };

      // Mock cache hit
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedHealthScore));

      const result = await service.calculateRelationshipHealth(clientId);

      expect(result).toEqual(cachedHealthScore);
      expect(mockDb.query).not.toHaveBeenCalled(); // Should not hit database
    });

    it('should handle large datasets efficiently', async () => {
      const clientId = 'client-123';
      
      // Generate large dataset
      const largeCommunicationSet = Array.from({ length: 1000 }, (_, i) => ({
        id: `comm-${i}`,
        client_id: clientId,
        type: 'email',
        direction: i % 2 === 0 ? 'inbound' : 'outbound',
        content: `Communication ${i}`,
        timestamp: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
        sentiment: Math.random() * 2 - 1 // Random sentiment between -1 and 1
      }));

      mockDb.query.mockResolvedValue({
        rows: largeCommunicationSet
      });

      const startTime = Date.now();
      const trendData = await service.getSentimentTrend(clientId, '1y');
      const endTime = Date.now();

      expect(trendData.dataPoints).toBeDefined();
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });

  describe('Data Validation', () => {
    it('should validate sentiment scores are within range', async () => {
      mockNlpService.processText.mockResolvedValue({
        sentiment: {
          score: 0.7,
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

      const result = await service.analyzeSentiment('Great service!');

      expect(result.score).toBeGreaterThanOrEqual(-1);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(result.magnitude).toBeGreaterThanOrEqual(0);
      expect(result.magnitude).toBeLessThanOrEqual(1);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should validate health scores are within range', async () => {
      const clientId = 'client-123';

      mockRedis.get.mockResolvedValue(null);
      mockRedis.setEx.mockResolvedValue('OK');

      mockDb.query.mockImplementation((query: string) => {
        if (query.includes('clients')) {
          return Promise.resolve({
            rows: [{ id: clientId, name: 'Test Client', email: 'test@example.com' }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await service.calculateRelationshipHealth(clientId);

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
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
    });
  });
});