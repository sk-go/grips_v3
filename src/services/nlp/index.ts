export { ClaudeApiClient } from './claudeApiClient';
export { GrokApiClient } from './grokApiClient';
export { TaskExtractionService } from './taskExtractionService';
export { ContextAggregationService } from './contextAggregationService';
export { VectorSearchService } from './vectorSearchService';
export { NLPProcessingService } from './nlpProcessingService';

import { ClaudeApiClient } from './claudeApiClient';
import { GrokApiClient } from './grokApiClient';
import { TaskExtractionService } from './taskExtractionService';
import { ContextAggregationService } from './contextAggregationService';
import { VectorSearchService } from './vectorSearchService';
import { NLPProcessingService } from './nlpProcessingService';
import { CacheService } from '../cacheService';
import { NLPConfig } from '../../types/nlp';

export class NLPService {
  private claudeClient: ClaudeApiClient;
  private grokClient: GrokApiClient | null;
  private taskExtractor: TaskExtractionService;
  private contextAggregator: ContextAggregationService;
  private vectorSearch: VectorSearchService;
  private nlpProcessor: NLPProcessingService;

  constructor(cacheService: CacheService, config: NLPConfig) {
    this.claudeClient = new ClaudeApiClient(config.claude.apiKey, config.claude.model);
    
    // Keep Grok client for backward compatibility during transition
    this.grokClient = config.grok?.apiKey ? 
      new GrokApiClient(config.grok.apiKey, config.grok.baseUrl) : 
      null;
    
    this.taskExtractor = new TaskExtractionService();
    this.contextAggregator = new ContextAggregationService(cacheService);
    this.vectorSearch = new VectorSearchService(cacheService, config.vectorSearch.dimensions);
    this.nlpProcessor = new NLPProcessingService(
      this.claudeClient,
      this.taskExtractor,
      this.contextAggregator,
      this.vectorSearch,
      config
    );
  }

  public getClaudeClient(): ClaudeApiClient {
    return this.claudeClient;
  }

  public getGrokClient(): GrokApiClient | null {
    return this.grokClient;
  }

  public getTaskExtractor(): TaskExtractionService {
    return this.taskExtractor;
  }

  public getContextAggregator(): ContextAggregationService {
    return this.contextAggregator;
  }

  public getVectorSearch(): VectorSearchService {
    return this.vectorSearch;
  }

  public getProcessor(): NLPProcessingService {
    return this.nlpProcessor;
  }

  public async processText(request: any) {
    return this.nlpProcessor.processText(request);
  }

  public async searchSimilarTexts(query: string, limit?: number) {
    return this.nlpProcessor.searchSimilarTexts(query, limit);
  }

  public async getStats() {
    return this.nlpProcessor.getProcessingStats();
  }
}