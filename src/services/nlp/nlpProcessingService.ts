import { 
  NLPRequest, 
  NLPResponse, 
  Intent, 
  Entity, 
  SentimentAnalysis, 
  NLPConfig,
  LanguageModel,
  ConversationContext,
  ContextMessage
} from '../../types/nlp';
import { GrokApiClient } from './grokApiClient';
import { TaskExtractionService } from './taskExtractionService';
import { ContextAggregationService } from './contextAggregationService';
import { VectorSearchService } from './vectorSearchService';
import { logger } from '../../utils/logger';

export class NLPProcessingService {
  private grokClient: GrokApiClient;
  private taskExtractor: TaskExtractionService;
  private contextAggregator: ContextAggregationService;
  private vectorSearch: VectorSearchService;
  private config: NLPConfig;

  constructor(
    grokClient: GrokApiClient,
    taskExtractor: TaskExtractionService,
    contextAggregator: ContextAggregationService,
    vectorSearch: VectorSearchService,
    config: NLPConfig
  ) {
    this.grokClient = grokClient;
    this.taskExtractor = taskExtractor;
    this.contextAggregator = contextAggregator;
    this.vectorSearch = vectorSearch;
    this.config = config;
  }

  async processText(request: NLPRequest): Promise<NLPResponse> {
    const startTime = Date.now();
    
    try {
      logger.debug('Processing NLP request', { 
        textLength: request.text.length, 
        language: request.language,
        sessionId: request.sessionId 
      });

      // Get or create conversation context
      let context = request.context;
      if (!context && request.sessionId) {
        context = await this.contextAggregator.getContext(
          request.sessionId,
          'unknown', // Will be updated when we have agent info
          undefined
        );
      }

      // Detect language if not provided
      const language = request.language || await this.detectLanguage(request.text);

      // Extract entities
      const entities = await this.extractEntities(request.text, language);

      // Analyze sentiment
      const sentiment = await this.analyzeSentiment(request.text, language);

      // Determine intent
      const intent = await this.determineIntent(request.text, entities, context, language);

      // Extract tasks
      const tasks = this.taskExtractor.extractTasks(request.text, entities, context);

      // Update context if session ID is provided
      if (request.sessionId && context) {
        const userMessage: ContextMessage = {
          role: 'user',
          content: request.text,
          timestamp: new Date(),
          metadata: { language, sentiment: sentiment.score }
        };
        
        await this.contextAggregator.updateContext(request.sessionId, userMessage);
      }

      // Index the text for future semantic search
      if (this.config.vectorSearch.enabled) {
        await this.indexTextForSearch(request.text, entities, context);
      }

      const processingTime = Date.now() - startTime;

      const response: NLPResponse = {
        intent,
        entities,
        tasks,
        sentiment,
        confidence: this.calculateOverallConfidence(intent, entities, tasks, sentiment),
        language,
        processingTime
      };

      logger.debug('NLP processing completed', { 
        processingTime, 
        tasksFound: tasks.length,
        entitiesFound: entities.length,
        intent: intent.name
      });

      return response;

    } catch (error) {
      logger.error('NLP processing failed', { error, request });
      
      // Return minimal response on error
      return {
        intent: { name: 'unknown', confidence: 0, category: 'other' },
        entities: [],
        tasks: [],
        sentiment: { score: 0, magnitude: 0, label: 'neutral', confidence: 0 },
        confidence: 0,
        language: request.language || 'en',
        processingTime: Date.now() - startTime
      };
    }
  }

  private async detectLanguage(text: string): Promise<string> {
    try {
      // Simple language detection based on common words
      const englishWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
      const spanishWords = ['el', 'la', 'y', 'o', 'pero', 'en', 'de', 'con', 'por', 'para', 'que', 'es'];
      
      const lowerText = text.toLowerCase();
      const words = lowerText.split(/\s+/);
      
      let englishScore = 0;
      let spanishScore = 0;
      
      for (const word of words) {
        if (englishWords.includes(word)) englishScore++;
        if (spanishWords.includes(word)) spanishScore++;
      }
      
      if (spanishScore > englishScore) {
        return 'es';
      }
      
      return 'en'; // Default to English
      
    } catch (error) {
      logger.error('Language detection failed', error);
      return 'en';
    }
  }

  private async extractEntities(text: string, language: string): Promise<Entity[]> {
    try {
      const entities: Entity[] = [];
      
      // Email extraction
      const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
      let match;
      while ((match = emailRegex.exec(text)) !== null) {
        entities.push({
          type: 'email',
          value: match[0],
          confidence: 0.95,
          startIndex: match.index,
          endIndex: match.index + match[0].length
        });
      }
      
      // Phone number extraction
      const phoneRegex = /\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g;
      while ((match = phoneRegex.exec(text)) !== null) {
        entities.push({
          type: 'phone',
          value: match[0],
          confidence: 0.9,
          startIndex: match.index,
          endIndex: match.index + match[0].length
        });
      }
      
      // Date extraction (simple patterns)
      const dateRegex = /\b(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})\b/gi;
      while ((match = dateRegex.exec(text)) !== null) {
        entities.push({
          type: 'date',
          value: match[0],
          confidence: 0.8,
          startIndex: match.index,
          endIndex: match.index + match[0].length
        });
      }
      
      // Money extraction
      const moneyRegex = /\$[\d,]+(?:\.\d{2})?|\b\d+(?:,\d{3})*(?:\.\d{2})?\s*(?:dollars?|USD|usd)\b/gi;
      while ((match = moneyRegex.exec(text)) !== null) {
        entities.push({
          type: 'money',
          value: match[0],
          confidence: 0.85,
          startIndex: match.index,
          endIndex: match.index + match[0].length
        });
      }
      
      // Policy number extraction (insurance-specific)
      const policyRegex = /\b(?:policy|pol)[\s#]*([A-Z0-9]{6,20})\b/gi;
      while ((match = policyRegex.exec(text)) !== null) {
        entities.push({
          type: 'policy_number',
          value: match[1],
          confidence: 0.9,
          startIndex: match.index,
          endIndex: match.index + match[0].length
        });
      }
      
      // Person names (simple capitalized words)
      const nameRegex = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
      while ((match = nameRegex.exec(text)) !== null) {
        // Skip common words that might be capitalized
        const commonWords = ['I', 'The', 'This', 'That', 'When', 'Where', 'How', 'Why', 'What'];
        if (!commonWords.includes(match[0]) && match[0].split(' ').length <= 3) {
          entities.push({
            type: 'person',
            value: match[0],
            confidence: 0.6, // Lower confidence for name detection
            startIndex: match.index,
            endIndex: match.index + match[0].length
          });
        }
      }
      
      return entities.sort((a, b) => a.startIndex - b.startIndex);
      
    } catch (error) {
      logger.error('Entity extraction failed', { error, text });
      return [];
    }
  }

  private async analyzeSentiment(text: string, language: string): Promise<SentimentAnalysis> {
    try {
      // Simple rule-based sentiment analysis
      const positiveWords = ['good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'love', 'like', 'happy', 'satisfied', 'pleased'];
      const negativeWords = ['bad', 'terrible', 'awful', 'horrible', 'hate', 'dislike', 'angry', 'frustrated', 'disappointed', 'upset'];
      
      const lowerText = text.toLowerCase();
      const words = lowerText.split(/\s+/);
      
      let positiveScore = 0;
      let negativeScore = 0;
      
      for (const word of words) {
        if (positiveWords.includes(word)) positiveScore++;
        if (negativeWords.includes(word)) negativeScore++;
      }
      
      const totalSentimentWords = positiveScore + negativeScore;
      const magnitude = totalSentimentWords / words.length;
      
      let score = 0;
      if (totalSentimentWords > 0) {
        score = (positiveScore - negativeScore) / totalSentimentWords;
      }
      
      let label: SentimentAnalysis['label'] = 'neutral';
      if (score > 0.5) label = 'very_positive';
      else if (score > 0.1) label = 'positive';
      else if (score < -0.5) label = 'very_negative';
      else if (score < -0.1) label = 'negative';
      
      return {
        score,
        magnitude,
        label,
        confidence: Math.min(0.9, magnitude * 2) // Higher confidence with more sentiment words
      };
      
    } catch (error) {
      logger.error('Sentiment analysis failed', { error, text });
      return { score: 0, magnitude: 0, label: 'neutral', confidence: 0 };
    }
  }

  private async determineIntent(
    text: string, 
    entities: Entity[], 
    context?: ConversationContext,
    language: string = 'en'
  ): Promise<Intent> {
    try {
      const lowerText = text.toLowerCase();
      
      // Greeting patterns
      if (/\b(hello|hi|hey|good morning|good afternoon|good evening)\b/.test(lowerText)) {
        return {
          name: 'greeting',
          confidence: 0.9,
          category: 'greeting'
        };
      }
      
      // Question patterns
      if (/^(what|when|where|who|why|how|can|could|would|will|is|are|do|does)\b/.test(lowerText) || text.includes('?')) {
        return {
          name: 'question',
          confidence: 0.8,
          category: 'question'
        };
      }
      
      // Task request patterns
      const taskKeywords = ['send', 'call', 'schedule', 'create', 'generate', 'update', 'remind', 'follow up'];
      if (taskKeywords.some(keyword => lowerText.includes(keyword))) {
        return {
          name: 'task_request',
          confidence: 0.85,
          category: 'task_request'
        };
      }
      
      // Complaint patterns
      const complaintKeywords = ['problem', 'issue', 'complaint', 'wrong', 'error', 'mistake', 'frustrated'];
      if (complaintKeywords.some(keyword => lowerText.includes(keyword))) {
        return {
          name: 'complaint',
          confidence: 0.8,
          category: 'complaint'
        };
      }
      
      // Compliment patterns
      const complimentKeywords = ['thank', 'thanks', 'appreciate', 'great job', 'excellent', 'wonderful'];
      if (complimentKeywords.some(keyword => lowerText.includes(keyword))) {
        return {
          name: 'compliment',
          confidence: 0.8,
          category: 'compliment'
        };
      }
      
      // Default to general request
      return {
        name: 'general_request',
        confidence: 0.5,
        category: 'other'
      };
      
    } catch (error) {
      logger.error('Intent determination failed', { error, text });
      return {
        name: 'unknown',
        confidence: 0,
        category: 'other'
      };
    }
  }

  private calculateOverallConfidence(
    intent: Intent,
    entities: Entity[],
    tasks: any[],
    sentiment: SentimentAnalysis
  ): number {
    const weights = {
      intent: 0.3,
      entities: 0.3,
      tasks: 0.2,
      sentiment: 0.2
    };
    
    const entityConfidence = entities.length > 0 
      ? entities.reduce((sum, e) => sum + e.confidence, 0) / entities.length 
      : 0.5;
    
    const taskConfidence = tasks.length > 0
      ? tasks.reduce((sum, t) => sum + t.confidence, 0) / tasks.length
      : 0.5;
    
    return (
      intent.confidence * weights.intent +
      entityConfidence * weights.entities +
      taskConfidence * weights.tasks +
      sentiment.confidence * weights.sentiment
    );
  }

  private async indexTextForSearch(
    text: string,
    entities: Entity[],
    context?: ConversationContext
  ): Promise<void> {
    try {
      if (!this.config.vectorSearch.enabled) return;
      
      const embedding = await this.grokClient.generateEmbedding(text);
      const documentId = `nlp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const metadata = {
        type: 'nlp_processed_text',
        entityCount: entities.length,
        sessionId: context?.sessionId,
        clientId: context?.clientId,
        timestamp: new Date().toISOString()
      };
      
      await this.vectorSearch.indexDocument(documentId, text, embedding, metadata);
      
    } catch (error) {
      logger.error('Failed to index text for search', { error, text: text.substring(0, 100) });
    }
  }

  async searchSimilarTexts(query: string, limit: number = 5): Promise<any[]> {
    try {
      if (!this.config.vectorSearch.enabled) {
        return [];
      }
      
      const results = await this.vectorSearch.search({
        query,
        limit,
        threshold: this.config.vectorSearch.similarityThreshold,
        filters: { type: 'nlp_processed_text' }
      });
      
      return results;
      
    } catch (error) {
      logger.error('Semantic search failed', { error, query });
      return [];
    }
  }

  updateConfig(newConfig: Partial<NLPConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  getConfig(): NLPConfig {
    return { ...this.config };
  }

  async getProcessingStats(): Promise<any> {
    const vectorStats = await this.vectorSearch.getIndexStats();
    
    return {
      vectorSearch: vectorStats,
      supportedLanguages: this.config.languages.length,
      grokConnection: await this.grokClient.testConnection()
    };
  }

  /**
   * Extract key topics from text using NLP analysis
   */
  async extractKeyTopics(text: string, maxTopics: number = 5): Promise<string[]> {
    try {
      if (!text || text.trim().length === 0) {
        return [];
      }

      // Use Grok API to extract key topics
      const prompt = `Extract the ${maxTopics} most important topics from the following text. Return only the topics as a comma-separated list, no explanations:

${text}`;

      const response = await this.grokClient.generateText(prompt, {
        maxTokens: 100,
        temperature: 0.3
      });

      if (response.success && response.text) {
        const topics = response.text
          .split(',')
          .map(topic => topic.trim().toLowerCase())
          .filter(topic => topic.length > 0 && topic.length < 50)
          .slice(0, maxTopics);
        
        return topics;
      }

      // Fallback: simple keyword extraction
      return this.extractKeywordsSimple(text, maxTopics);

    } catch (error) {
      logger.error('Error extracting key topics:', error);
      return this.extractKeywordsSimple(text, maxTopics);
    }
  }

  /**
   * Generate a summary of text using AI
   */
  async generateSummary(prompt: string, context?: any, maxLength: number = 200): Promise<string> {
    try {
      if (!prompt || prompt.trim().length === 0) {
        return '';
      }

      // Enhance prompt with context if provided
      let enhancedPrompt = prompt;
      if (context) {
        enhancedPrompt = `${prompt}\n\nContext: ${JSON.stringify(context, null, 2)}`;
      }

      const response = await this.grokClient.generateText(enhancedPrompt, {
        maxTokens: Math.min(maxLength * 2, 500), // Rough token estimation
        temperature: 0.5
      });

      if (response.success && response.text) {
        // Trim to max length if needed
        let summary = response.text.trim();
        if (summary.length > maxLength) {
          summary = summary.substring(0, maxLength - 3) + '...';
        }
        return summary;
      }

      return 'Summary generation failed';

    } catch (error) {
      logger.error('Error generating summary:', error);
      return 'Summary generation failed';
    }
  }

  /**
   * Simple keyword extraction fallback
   */
  private extractKeywordsSimple(text: string, maxKeywords: number): string[] {
    // Remove common stop words
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might', 'can', 'must', 'shall',
      'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
      'my', 'your', 'his', 'her', 'its', 'our', 'their', 'this', 'that', 'these', 'those'
    ]);

    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3 && !stopWords.has(word));

    // Count word frequency
    const wordCount = new Map<string, number>();
    words.forEach(word => {
      wordCount.set(word, (wordCount.get(word) || 0) + 1);
    });

    // Sort by frequency and return top keywords
    return Array.from(wordCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxKeywords)
      .map(([word]) => word);
  }
}