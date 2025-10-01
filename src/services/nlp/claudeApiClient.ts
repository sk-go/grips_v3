import Anthropic from '@anthropic-ai/sdk';
import { ClaudeAPIRequest, ClaudeAPIResponse, ClaudeUsageStats } from '../../types/nlp';
import { CostTrackingService, AIRequestRecord } from './costTrackingService';
import { logger } from '../../utils/logger';

export class ClaudeApiClient {
  private client: Anthropic;
  private apiKey: string;
  private model: string;
  private usageStats: ClaudeUsageStats;
  private costTracker: CostTrackingService;

  constructor(apiKey: string, model: string = 'claude-3-sonnet-20240229', costTracker?: CostTrackingService) {
    this.apiKey = apiKey;
    this.model = model;
    this.usageStats = {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalCost: 0
    };
    this.costTracker = costTracker || new CostTrackingService();
    
    this.client = new Anthropic({
      apiKey: this.apiKey,
      timeout: 30000 // 30 second timeout
    });
  }

  async createMessage(request: ClaudeAPIRequest & { agentId?: string; sessionId?: string }): Promise<ClaudeAPIResponse> {
    const startTime = Date.now();
    let success = false;
    let errorMessage: string | undefined;
    let inputTokens = 0;
    let outputTokens = 0;
    let cost = 0;
    
    try {
      logger.debug('Claude API request', {
        model: request.model || this.model,
        messageCount: request.messages.length,
        maxTokens: request.max_tokens,
        agentId: request.agentId
      });

      // Separate system message if present
      const systemMessage = request.messages.find(msg => msg.role === 'system');
      
      // Convert non-system messages to Claude format
      const userMessages = request.messages
        .filter(msg => msg.role !== 'system')
        .map(msg => ({
          role: msg.role === 'assistant' ? 'assistant' as const : 'user' as const,
          content: msg.content
        }));

      const response = await this.client.messages.create({
        model: request.model || this.model,
        max_tokens: request.max_tokens || 1000,
        temperature: request.temperature || 0.7,
        system: systemMessage?.content,
        messages: userMessages
      });

      // Calculate cost based on Claude pricing
      inputTokens = response.usage.input_tokens;
      outputTokens = response.usage.output_tokens;
      cost = this.calculateCost(inputTokens, outputTokens, request.model || this.model);
      success = true;

      // Update usage stats
      this.usageStats.requests++;
      this.usageStats.inputTokens += inputTokens;
      this.usageStats.outputTokens += outputTokens;
      this.usageStats.totalCost += cost;

      const processingTime = Date.now() - startTime;

      logger.debug('Claude API response', {
        inputTokens,
        outputTokens,
        cost: cost.toFixed(4),
        processingTime,
        agentId: request.agentId
      });

      // Record cost tracking if agentId is provided
      if (request.agentId) {
        try {
          await this.costTracker.recordAIRequest({
            agentId: request.agentId,
            sessionId: request.sessionId,
            requestType: 'text_generation',
            modelUsed: request.model || this.model,
            promptTokens: inputTokens,
            completionTokens: outputTokens,
            totalTokens: inputTokens + outputTokens,
            cost,
            processingTime,
            success: true,
            requestData: {
              messageCount: request.messages.length,
              maxTokens: request.max_tokens,
              temperature: request.temperature
            },
            responseData: {
              finishReason: response.stop_reason
            }
          });
        } catch (trackingError) {
          logger.error('Failed to record cost tracking', { trackingError, agentId: request.agentId });
          // Don't fail the main request if cost tracking fails
        }
      }

      // Convert to our standard response format
      const claudeResponse: ClaudeAPIResponse = {
        id: response.id,
        object: 'message',
        created: Math.floor(Date.now() / 1000),
        model: response.model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: response.content[0].type === 'text' ? response.content[0].text : ''
          },
          finish_reason: response.stop_reason || 'stop'
        }],
        usage: {
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens
        },
        cost,
        processing_time: processingTime
      };

      return claudeResponse;

    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      success = false;
      
      if (error.status === 401) {
        errorMessage = 'Invalid Claude API key';
      } else if (error.status === 429) {
        errorMessage = 'Claude API rate limit exceeded. Please wait before making more requests.';
      } else if (error.status === 503) {
        errorMessage = 'Claude API service unavailable. Please try again later.';
      } else if (error.name === 'TimeoutError' || processingTime >= 30000) {
        errorMessage = 'Claude API request timed out after 30 seconds';
      } else {
        errorMessage = `Claude API error: ${error.message}`;
      }
      
      logger.error('Claude API error', {
        error: error.message,
        status: error.status,
        processingTime,
        agentId: request.agentId
      });

      // Record failed request for cost tracking if agentId is provided
      if (request.agentId) {
        try {
          await this.costTracker.recordAIRequest({
            agentId: request.agentId,
            sessionId: request.sessionId,
            requestType: 'text_generation',
            modelUsed: request.model || this.model,
            promptTokens: inputTokens,
            completionTokens: outputTokens,
            totalTokens: inputTokens + outputTokens,
            cost,
            processingTime,
            success: false,
            errorMessage,
            requestData: {
              messageCount: request.messages.length,
              maxTokens: request.max_tokens,
              temperature: request.temperature
            }
          });
        } catch (trackingError) {
          logger.error('Failed to record failed request cost tracking', { trackingError, agentId: request.agentId });
        }
      }

      throw new Error(errorMessage);
    }
  }

  private calculateCost(inputTokens: number, outputTokens: number, model: string): number {
    // Claude pricing as of 2024 (per 1M tokens)
    const pricing: Record<string, { input: number; output: number }> = {
      'claude-3-sonnet-20240229': { input: 3.00, output: 15.00 },
      'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
      'claude-3-opus-20240229': { input: 15.00, output: 75.00 }
    };

    const modelPricing = pricing[model] || pricing['claude-3-sonnet-20240229'];
    
    const inputCost = (inputTokens / 1000000) * modelPricing.input;
    const outputCost = (outputTokens / 1000000) * modelPricing.output;
    
    return inputCost + outputCost;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      // Claude doesn't have embeddings endpoint, so we'll use a simple fallback
      // In production, you might want to use a dedicated embedding service
      logger.warn('Claude API does not support embeddings, using fallback');
      return this.generateSimpleEmbedding(text);
    } catch (error: any) {
      logger.warn('Claude embeddings not available, using fallback', error.message);
      return this.generateSimpleEmbedding(text);
    }
  }

  private generateSimpleEmbedding(text: string): number[] {
    // Simple hash-based embedding for fallback
    const embedding = new Array(384).fill(0); // 384-dimensional vector
    const words = text.toLowerCase().split(/\s+/);
    
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      let hash = 0;
      
      for (let j = 0; j < word.length; j++) {
        const char = word.charCodeAt(j);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      
      const index = Math.abs(hash) % embedding.length;
      embedding[index] += 1 / words.length;
    }
    
    // Normalize the vector
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= magnitude;
      }
    }
    
    return embedding;
  }

  /**
   * Generate text using Claude API
   */
  async generateText(prompt: string, options: {
    maxTokens?: number;
    temperature?: number;
    model?: string;
    systemPrompt?: string;
  } = {}): Promise<{ success: boolean; text?: string; error?: string; cost?: number }> {
    try {
      const messages: ClaudeAPIRequest['messages'] = [];
      
      if (options.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
      }
      
      messages.push({ role: 'user', content: prompt });

      const response = await this.createMessage({
        messages,
        model: options.model || this.model,
        max_tokens: options.maxTokens || 150,
        temperature: options.temperature || 0.7
      });

      if (response.choices && response.choices.length > 0) {
        const text = response.choices[0].message?.content || '';
        return { 
          success: true, 
          text,
          cost: response.cost
        };
      }

      return { success: false, error: 'No response generated' };

    } catch (error) {
      logger.error('Error generating text with Claude API:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await this.createMessage({
        messages: [
          { role: 'user', content: 'Hello, this is a test message. Please respond with "Test successful".' }
        ],
        model: this.model,
        max_tokens: 10
      });
      
      return response.choices && response.choices.length > 0;
    } catch (error) {
      logger.error('Claude API connection test failed', error);
      return false;
    }
  }

  getUsageStats(): ClaudeUsageStats {
    return { ...this.usageStats };
  }

  resetUsageStats(): void {
    this.usageStats = {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalCost: 0
    };
  }

  /**
   * Estimate cost for a request before making it
   */
  estimateCost(prompt: string, maxTokens: number = 150, model?: string): number {
    // Rough estimation: 1 token ≈ 4 characters for English text
    const estimatedInputTokens = Math.ceil(prompt.length / 4);
    const estimatedOutputTokens = maxTokens;
    
    return this.calculateCost(estimatedInputTokens, estimatedOutputTokens, model || this.model);
  }

  /**
   * Check if a request would exceed cost threshold
   */
  wouldExceedCostThreshold(prompt: string, maxTokens: number = 150, threshold: number = 0.10, model?: string): boolean {
    const estimatedCost = this.estimateCost(prompt, maxTokens, model);
    return estimatedCost > threshold;
  }

  /**
   * Check cost thresholds for an agent before making a request
   */
  async checkAgentCostThresholds(agentId: string, prompt: string, maxTokens: number = 150, model?: string): Promise<{
    canProceed: boolean;
    needsApproval: boolean;
    estimatedCost: number;
    thresholdCheck: any;
  }> {
    try {
      const estimatedCost = this.estimateCost(prompt, maxTokens, model);
      const thresholdCheck = await this.costTracker.checkCostThresholds(agentId, estimatedCost);

      return {
        canProceed: !thresholdCheck.exceedsApproval,
        needsApproval: thresholdCheck.exceedsApproval,
        estimatedCost,
        thresholdCheck
      };
    } catch (error) {
      logger.error('Failed to check agent cost thresholds', { error, agentId });
      // Default to allowing the request if cost checking fails
      return {
        canProceed: true,
        needsApproval: false,
        estimatedCost: this.estimateCost(prompt, maxTokens, model),
        thresholdCheck: null
      };
    }
  }

  /**
   * Get agent's cost statistics
   */
  async getAgentCostStats(agentId: string, days: number = 30): Promise<any> {
    try {
      return await this.costTracker.getCostStatistics(agentId, days);
    } catch (error) {
      logger.error('Failed to get agent cost stats', { error, agentId });
      throw error;
    }
  }

  /**
   * Get agent's daily cost summary
   */
  async getAgentDailyCosts(agentId: string, date?: string): Promise<any> {
    try {
      return await this.costTracker.getDailyCostSummary(agentId, date);
    } catch (error) {
      logger.error('Failed to get agent daily costs', { error, agentId });
      throw error;
    }
  }
}