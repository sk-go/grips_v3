import { NLPProcessingService } from '../../services/nlp/nlpProcessingService';
import { GrokApiClient } from '../../services/nlp/grokApiClient';
import { TaskExtractionService } from '../../services/nlp/taskExtractionService';
import { ContextAggregationService } from '../../services/nlp/contextAggregationService';
import { VectorSearchService } from '../../services/nlp/vectorSearchService';
import { NLPConfig } from '../../types/nlp';

// Mock the dependencies
jest.mock('../../services/nlp/grokApiClient');
jest.mock('../../services/nlp/taskExtractionService');
jest.mock('../../services/nlp/contextAggregationService');
jest.mock('../../services/nlp/vectorSearchService');

describe('NLPProcessingService', () => {
  let service: NLPProcessingService;
  let mockGrokClient: jest.Mocked<GrokApiClient>;
  let mockTaskExtractor: jest.Mocked<TaskExtractionService>;
  let mockContextAggregator: jest.Mocked<ContextAggregationService>;
  let mockVectorSearch: jest.Mocked<VectorSearchService>;
  let mockConfig: NLPConfig;

  beforeEach(() => {
    mockConfig = {
      grok: {
        apiKey: 'test-key',
        baseUrl: 'https://api.x.ai/v1',
        model: 'grok-beta',
        temperature: 0.7,
        maxTokens: 1000
      },
      languages: [
        { code: 'en', name: 'English', grokModel: 'grok-beta', supported: true },
        { code: 'es', name: 'Spanish', grokModel: 'grok-beta', supported: true }
      ],
      sentiment: {
        threshold: {
          veryNegative: -0.5,
          negative: -0.1,
          neutral: 0.1,
          positive: 0.5
        }
      },
      taskExtraction: {
        confidenceThreshold: 0.7,
        approvalThreshold: 0.8
      },
      vectorSearch: {
        enabled: true,
        dimensions: 384,
        similarityThreshold: 0.7
      }
    };

    mockGrokClient = new GrokApiClient('test') as jest.Mocked<GrokApiClient>;
    mockTaskExtractor = new TaskExtractionService() as jest.Mocked<TaskExtractionService>;
    mockContextAggregator = {} as jest.Mocked<ContextAggregationService>;
    mockVectorSearch = {} as jest.Mocked<VectorSearchService>;

    // Setup mocks
    mockTaskExtractor.extractTasks = jest.fn().mockReturnValue([]);
    mockContextAggregator.getContext = jest.fn().mockResolvedValue({
      sessionId: 'test-session',
      agentId: 'test-agent',
      previousMessages: [],
      metadata: {}
    });
    mockContextAggregator.updateContext = jest.fn().mockResolvedValue(undefined);
    mockVectorSearch.indexDocument = jest.fn().mockResolvedValue(undefined);
    mockGrokClient.generateEmbedding = jest.fn().mockResolvedValue(new Array(384).fill(0.1));

    service = new NLPProcessingService(
      mockGrokClient,
      mockTaskExtractor,
      mockContextAggregator,
      mockVectorSearch,
      mockConfig
    );
  });

  describe('processText', () => {
    it('should process simple text and return NLP response', async () => {
      const request = {
        text: 'Hello, how are you today?',
        sessionId: 'test-session'
      };

      const result = await service.processText(request);

      expect(result).toHaveProperty('intent');
      expect(result).toHaveProperty('entities');
      expect(result).toHaveProperty('tasks');
      expect(result).toHaveProperty('sentiment');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('language');
      expect(result).toHaveProperty('processingTime');

      expect(result.intent.name).toBe('greeting');
      expect(result.intent.category).toBe('greeting');
      expect(result.language).toBe('en');
    });

    it('should detect questions correctly', async () => {
      const request = {
        text: 'What is my policy status?'
      };

      const result = await service.processText(request);

      expect(result.intent.name).toBe('question');
      expect(result.intent.category).toBe('question');
    });

    it('should detect task requests', async () => {
      const request = {
        text: 'Send an email to the client about their renewal'
      };

      mockTaskExtractor.extractTasks.mockReturnValue([
        {
          id: 'task-1',
          type: 'email',
          description: 'Send email to the client',
          priority: 'medium',
          parameters: { target: 'the client' },
          confidence: 0.8,
          requiresApproval: true
        }
      ]);

      const result = await service.processText(request);

      expect(result.intent.name).toBe('task_request');
      expect(result.intent.category).toBe('task_request');
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].type).toBe('email');
    });

    it('should extract email entities', async () => {
      const request = {
        text: 'Contact john.doe@example.com about the policy'
      };

      const result = await service.processText(request);

      const emailEntities = result.entities.filter(e => e.type === 'email');
      expect(emailEntities).toHaveLength(1);
      expect(emailEntities[0].value).toBe('john.doe@example.com');
    });

    it('should extract phone number entities', async () => {
      const request = {
        text: 'Call the client at (555) 123-4567'
      };

      const result = await service.processText(request);

      const phoneEntities = result.entities.filter(e => e.type === 'phone');
      expect(phoneEntities).toHaveLength(1);
      expect(phoneEntities[0].value).toBe('(555) 123-4567');
    });

    it('should extract policy number entities', async () => {
      const request = {
        text: 'Update policy POL123456 with new information'
      };

      const result = await service.processText(request);

      const policyEntities = result.entities.filter(e => e.type === 'policy_number');
      expect(policyEntities).toHaveLength(1);
      expect(policyEntities[0].value).toBe('POL123456');
    });

    it('should analyze positive sentiment', async () => {
      const request = {
        text: 'I love this service! It is excellent and wonderful.'
      };

      const result = await service.processText(request);

      expect(result.sentiment.score).toBeGreaterThan(0);
      expect(result.sentiment.label).toBe('very_positive');
    });

    it('should analyze negative sentiment', async () => {
      const request = {
        text: 'This is terrible and awful. I hate it.'
      };

      const result = await service.processText(request);

      expect(result.sentiment.score).toBeLessThan(0);
      expect(result.sentiment.label).toBe('very_negative');
    });

    it('should detect Spanish language', async () => {
      const request = {
        text: 'Hola, ¿cómo está usted? Necesito ayuda con mi póliza.'
      };

      const result = await service.processText(request);

      expect(result.language).toBe('es');
    });

    it('should handle context updates', async () => {
      const request = {
        text: 'Hello there',
        sessionId: 'test-session'
      };

      await service.processText(request);

      expect(mockContextAggregator.updateContext).toHaveBeenCalledWith(
        'test-session',
        expect.objectContaining({
          role: 'user',
          content: 'Hello there'
        })
      );
    });

    it('should index text for vector search when enabled', async () => {
      const request = {
        text: 'This is a test message for indexing'
      };

      await service.processText(request);

      expect(mockGrokClient.generateEmbedding).toHaveBeenCalledWith(request.text);
      expect(mockVectorSearch.indexDocument).toHaveBeenCalled();
    });

    it('should handle processing errors gracefully', async () => {
      mockTaskExtractor.extractTasks.mockImplementation(() => {
        throw new Error('Task extraction failed');
      });

      const request = {
        text: 'This should cause an error'
      };

      const result = await service.processText(request);

      expect(result.intent.name).toBe('unknown');
      expect(result.confidence).toBe(0);
    });
  });

  describe('searchSimilarTexts', () => {
    it('should search for similar texts', async () => {
      const mockResults = [
        {
          id: 'doc-1',
          content: 'Similar text content',
          score: 0.85,
          metadata: { type: 'nlp_processed_text' }
        }
      ];

      mockVectorSearch.search = jest.fn().mockResolvedValue(mockResults);

      const results = await service.searchSimilarTexts('test query', 5);

      expect(mockVectorSearch.search).toHaveBeenCalledWith({
        query: 'test query',
        limit: 5,
        threshold: 0.7,
        filters: { type: 'nlp_processed_text' }
      });

      expect(results).toEqual(mockResults);
    });

    it('should return empty array when vector search is disabled', async () => {
      service.updateConfig({ vectorSearch: { enabled: false } });

      const results = await service.searchSimilarTexts('test query');

      expect(results).toEqual([]);
    });
  });

  describe('configuration management', () => {
    it('should update configuration', () => {
      const newConfig = {
        sentiment: {
          threshold: {
            veryNegative: -0.8,
            negative: -0.2,
            neutral: 0.2,
            positive: 0.8
          }
        }
      };

      service.updateConfig(newConfig);
      const config = service.getConfig();

      expect(config.sentiment.threshold.veryNegative).toBe(-0.8);
    });

    it('should return current configuration', () => {
      const config = service.getConfig();

      expect(config).toHaveProperty('grok');
      expect(config).toHaveProperty('languages');
      expect(config).toHaveProperty('sentiment');
      expect(config).toHaveProperty('taskExtraction');
      expect(config).toHaveProperty('vectorSearch');
    });
  });
});