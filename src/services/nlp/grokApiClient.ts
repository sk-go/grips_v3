import axios, { AxiosInstance } from 'axios';
import { GrokAPIRequest, GrokAPIResponse } from '../../types/nlp';
import { logger } from '../../utils/logger';

export class GrokApiClient {
  private client: AxiosInstance;
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string = 'https://api.x.ai/v1') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 second timeout
    });

    // Add request/response interceptors for logging
    this.client.interceptors.request.use(
      (config) => {
        logger.debug('Grok API request', {
          url: config.url,
          method: config.method,
          headers: { ...config.headers, Authorization: '[REDACTED]' }
        });
        return config;
      },
      (error) => {
        logger.error('Grok API request error', error);
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.debug('Grok API response', {
          status: response.status,
          usage: response.data?.usage
        });
        return response;
      },
      (error) => {
        logger.error('Grok API response error', {
          status: error.response?.status,
          message: error.response?.data?.error?.message || error.message
        });
        return Promise.reject(error);
      }
    );
  }

  async createChatCompletion(request: GrokAPIRequest): Promise<GrokAPIResponse> {
    try {
      const response = await this.client.post('/chat/completions', request);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new Error('Invalid Grok API key');
      } else if (error.response?.status === 429) {
        throw new Error('Grok API rate limit exceeded');
      } else if (error.response?.status === 503) {
        throw new Error('Grok API service unavailable');
      } else {
        throw new Error(`Grok API error: ${error.message}`);
      }
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      // Note: Grok API may not have embeddings endpoint yet, this is a placeholder
      // In production, you might use OpenAI embeddings or another service
      const response = await this.client.post('/embeddings', {
        input: text,
        model: 'text-embedding-ada-002' // Placeholder model
      });
      
      return response.data.data[0].embedding;
    } catch (error: any) {
      logger.warn('Grok embeddings not available, using fallback', error.message);
      // Fallback: generate simple hash-based embedding
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
   * Generate text using Grok API
   */
  async generateText(prompt: string, options: {
    maxTokens?: number;
    temperature?: number;
    model?: string;
  } = {}): Promise<{ success: boolean; text?: string; error?: string }> {
    try {
      const response = await this.createChatCompletion({
        messages: [
          { role: 'user', content: prompt }
        ],
        model: options.model || 'grok-beta',
        max_tokens: options.maxTokens || 150,
        temperature: options.temperature || 0.7
      });

      if (response.choices && response.choices.length > 0) {
        const text = response.choices[0].message?.content || '';
        return { success: true, text };
      }

      return { success: false, error: 'No response generated' };

    } catch (error) {
      logger.error('Error generating text with Grok API:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await this.createChatCompletion({
        messages: [
          { role: 'user', content: 'Hello, this is a test message.' }
        ],
        model: 'grok-beta',
        max_tokens: 10
      });
      
      return response.choices && response.choices.length > 0;
    } catch (error) {
      logger.error('Grok API connection test failed', error);
      return false;
    }
  }

  getUsageStats(): { requests: number; tokens: number } {
    // In a production environment, you'd track these metrics
    return { requests: 0, tokens: 0 };
  }
}