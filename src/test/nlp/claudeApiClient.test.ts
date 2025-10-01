import { ClaudeApiClient } from '../../services/nlp/claudeApiClient';
import { ClaudeAPIRequest } from '../../types/nlp';

// Mock the Anthropic SDK
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: mockCreate
      }
    }))
  };
});

describe('ClaudeApiClient', () => {
  let claudeClient: ClaudeApiClient;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    mockCreate.mockClear();
    
    // Create client instance
    claudeClient = new ClaudeApiClient('test-api-key', 'claude-3-sonnet-20240229');
  });

  describe('constructor', () => {
    it('should initialize with correct parameters', () => {
      expect(claudeClient).toBeInstanceOf(ClaudeApiClient);
      expect(claudeClient.getUsageStats()).toEqual({
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalCost: 0
      });
    });
  });

  describe('createMessage', () => {
    it('should successfully create a message', async () => {
      const mockResponse = {
        id: 'msg_123',
        model: 'claude-3-sonnet-20240229',
        content: [{ type: 'text', text: 'Hello! This is a test response.' }],
        usage: {
          input_tokens: 10,
          output_tokens: 8
        },
        stop_reason: 'end_turn'
      };

      mockCreate.mockResolvedValue(mockResponse);

      const request: ClaudeAPIRequest = {
        messages: [
          { role: 'user', content: 'Hello, this is a test message.' }
        ],
        model: 'claude-3-sonnet-20240229',
        max_tokens: 100,
        temperature: 0.7
      };

      const response = await claudeClient.createMessage(request);

      expect(response).toMatchObject({
        id: 'msg_123',
        model: 'claude-3-sonnet-20240229',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'Hello! This is a test response.'
          },
          finish_reason: 'end_turn'
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 8,
          total_tokens: 18
        }
      });

      expect(response.cost).toBeGreaterThan(0);
      expect(response.processing_time).toBeGreaterThan(0);
    });

    it('should handle system messages correctly', async () => {
      const mockResponse = {
        id: 'msg_456',
        model: 'claude-3-sonnet-20240229',
        content: [{ type: 'text', text: 'I understand the context.' }],
        usage: {
          input_tokens: 15,
          output_tokens: 6
        },
        stop_reason: 'end_turn'
      };

      mockCreate.mockResolvedValue(mockResponse);

      const request: ClaudeAPIRequest = {
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello!' }
        ],
        max_tokens: 50
      };

      await claudeClient.createMessage(request);

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 50,
        temperature: 0.7,
        system: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'Hello!' }]
      });
    });

    it('should handle 401 authentication errors', async () => {
      const error = new Error('Authentication failed');
      (error as any).status = 401;
      mockCreate.mockRejectedValue(error);

      const request: ClaudeAPIRequest = {
        messages: [{ role: 'user', content: 'Test' }]
      };

      await expect(claudeClient.createMessage(request))
        .rejects.toThrow('Invalid Claude API key');
    });

    it('should handle 429 rate limit errors', async () => {
      const error = new Error('Rate limit exceeded');
      (error as any).status = 429;
      mockCreate.mockRejectedValue(error);

      const request: ClaudeAPIRequest = {
        messages: [{ role: 'user', content: 'Test' }]
      };

      await expect(claudeClient.createMessage(request))
        .rejects.toThrow('Claude API rate limit exceeded. Please wait before making more requests.');
    });

    it('should handle 503 service unavailable errors', async () => {
      const error = new Error('Service unavailable');
      (error as any).status = 503;
      mockCreate.mockRejectedValue(error);

      const request: ClaudeAPIRequest = {
        messages: [{ role: 'user', content: 'Test' }]
      };

      await expect(claudeClient.createMessage(request))
        .rejects.toThrow('Claude API service unavailable. Please try again later.');
    });

    it('should handle timeout errors', async () => {
      const error = new Error('Request timeout');
      (error as any).name = 'TimeoutError';
      mockCreate.mockRejectedValue(error);

      const request: ClaudeAPIRequest = {
        messages: [{ role: 'user', content: 'Test' }]
      };

      await expect(claudeClient.createMessage(request))
        .rejects.toThrow('Claude API request timed out after 30 seconds');
    });

    it('should update usage statistics', async () => {
      const mockResponse = {
        id: 'msg_789',
        model: 'claude-3-sonnet-20240229',
        content: [{ type: 'text', text: 'Response' }],
        usage: {
          input_tokens: 20,
          output_tokens: 10
        },
        stop_reason: 'end_turn'
      };

      mockCreate.mockResolvedValue(mockResponse);

      const request: ClaudeAPIRequest = {
        messages: [{ role: 'user', content: 'Test message' }]
      };

      await claudeClient.createMessage(request);

      const stats = claudeClient.getUsageStats();
      expect(stats.requests).toBe(1);
      expect(stats.inputTokens).toBe(20);
      expect(stats.outputTokens).toBe(10);
      expect(stats.totalCost).toBeGreaterThan(0);
    });
  });

  describe('generateText', () => {
    it('should generate text successfully', async () => {
      const mockResponse = {
        id: 'msg_text',
        model: 'claude-3-sonnet-20240229',
        content: [{ type: 'text', text: 'Generated text response' }],
        usage: {
          input_tokens: 5,
          output_tokens: 4
        },
        stop_reason: 'end_turn'
      };

      mockCreate.mockResolvedValue(mockResponse);

      const result = await claudeClient.generateText('Generate some text', {
        maxTokens: 50,
        temperature: 0.5
      });

      expect(result.success).toBe(true);
      expect(result.text).toBe('Generated text response');
      expect(result.cost).toBeGreaterThan(0);
    });

    it('should handle generation errors', async () => {
      mockCreate.mockRejectedValue(new Error('Generation failed'));

      const result = await claudeClient.generateText('Test prompt');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Claude API error: Generation failed');
    });

    it('should include system prompt when provided', async () => {
      const mockResponse = {
        id: 'msg_system',
        model: 'claude-3-sonnet-20240229',
        content: [{ type: 'text', text: 'Response with system context' }],
        usage: {
          input_tokens: 12,
          output_tokens: 6
        },
        stop_reason: 'end_turn'
      };

      mockCreate.mockResolvedValue(mockResponse);

      await claudeClient.generateText('User prompt', {
        systemPrompt: 'You are an expert assistant.'
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'You are an expert assistant.',
          messages: [{ role: 'user', content: 'User prompt' }]
        })
      );
    });
  });

  describe('testConnection', () => {
    it('should return true for successful connection', async () => {
      const mockResponse = {
        id: 'msg_test',
        model: 'claude-3-sonnet-20240229',
        content: [{ type: 'text', text: 'Test successful' }],
        usage: {
          input_tokens: 8,
          output_tokens: 3
        },
        stop_reason: 'end_turn'
      };

      mockCreate.mockResolvedValue(mockResponse);

      const result = await claudeClient.testConnection();
      expect(result).toBe(true);
    });

    it('should return false for failed connection', async () => {
      mockCreate.mockRejectedValue(new Error('Connection failed'));

      const result = await claudeClient.testConnection();
      expect(result).toBe(false);
    });
  });

  describe('cost estimation', () => {
    it('should estimate cost correctly', () => {
      const prompt = 'This is a test prompt for cost estimation';
      const cost = claudeClient.estimateCost(prompt, 100);
      
      expect(cost).toBeGreaterThan(0);
      expect(typeof cost).toBe('number');
    });

    it('should check cost threshold correctly', () => {
      const shortPrompt = 'Hi';
      const longPrompt = 'This is a very long prompt that would generate a lot of tokens and cost more than the threshold. '.repeat(100);
      
      expect(claudeClient.wouldExceedCostThreshold(shortPrompt, 10, 0.10)).toBe(false);
      expect(claudeClient.wouldExceedCostThreshold(longPrompt, 1000, 0.01)).toBe(true);
    });
  });

  describe('usage statistics', () => {
    it('should track usage statistics correctly', async () => {
      const mockResponse = {
        id: 'msg_stats',
        model: 'claude-3-sonnet-20240229',
        content: [{ type: 'text', text: 'Stats test' }],
        usage: {
          input_tokens: 15,
          output_tokens: 5
        },
        stop_reason: 'end_turn'
      };

      mockCreate.mockResolvedValue(mockResponse);

      // Make multiple requests
      const request: ClaudeAPIRequest = {
        messages: [{ role: 'user', content: 'Test' }]
      };

      await claudeClient.createMessage(request);
      await claudeClient.createMessage(request);

      const stats = claudeClient.getUsageStats();
      expect(stats.requests).toBe(2);
      expect(stats.inputTokens).toBe(30);
      expect(stats.outputTokens).toBe(10);
      expect(stats.totalCost).toBeGreaterThan(0);
    });

    it('should reset usage statistics', async () => {
      const mockResponse = {
        id: 'msg_reset',
        model: 'claude-3-sonnet-20240229',
        content: [{ type: 'text', text: 'Reset test' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5
        },
        stop_reason: 'end_turn'
      };

      mockCreate.mockResolvedValue(mockResponse);

      const request: ClaudeAPIRequest = {
        messages: [{ role: 'user', content: 'Test' }]
      };

      await claudeClient.createMessage(request);
      
      let stats = claudeClient.getUsageStats();
      expect(stats.requests).toBe(1);

      claudeClient.resetUsageStats();
      
      stats = claudeClient.getUsageStats();
      expect(stats.requests).toBe(0);
      expect(stats.inputTokens).toBe(0);
      expect(stats.outputTokens).toBe(0);
      expect(stats.totalCost).toBe(0);
    });
  });

  describe('generateEmbedding', () => {
    it('should generate fallback embedding', async () => {
      const text = 'This is a test text for embedding generation';
      const embedding = await claudeClient.generateEmbedding(text);
      
      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBe(384);
      expect(embedding.every(val => typeof val === 'number')).toBe(true);
    });

    it('should generate normalized embeddings', async () => {
      const text = 'Test text';
      const embedding = await claudeClient.generateEmbedding(text);
      
      // Check if vector is normalized (magnitude should be close to 1)
      const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
      expect(magnitude).toBeCloseTo(1, 5);
    });
  });
});