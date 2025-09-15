/**
 * Relationship Insights Service
 * Implements AI-powered relationship insights including sentiment analysis,
 * relationship health scoring, conversation summaries, and sentiment trends
 */

import { Pool } from 'pg';
import { RedisClientType } from 'redis';
import { Communication, Client, SentimentTrend } from '../../types';
import { NLPProcessingService } from '../nlp/nlpProcessingService';
import { logger } from '../../utils/logger';

export interface SentimentAnalysisResult {
  score: number; // -1 to 1 scale
  magnitude: number; // 0 to 1 scale
  label: 'very_negative' | 'negative' | 'neutral' | 'positive' | 'very_positive';
  confidence: number; // 0 to 1 scale
  isPositive: boolean; // VADER >0.5 positive threshold
}

export interface RelationshipHealthScore {
  score: number; // 0-100 scale
  factors: {
    sentimentTrend: number; // 0-30 points
    interactionFrequency: number; // 0-25 points
    responseTime: number; // 0-20 points
    recentActivity: number; // 0-15 points
    communicationQuality: number; // 0-10 points
  };
  trend: 'improving' | 'stable' | 'declining';
  lastCalculated: Date;
}

export interface ConversationSummary {
  id: string;
  clientId: string;
  communicationId?: string;
  summary: string;
  keyTopics: string[];
  actionItems: string[];
  sentimentScore: number;
  createdAt: Date;
}

export interface SentimentTrendPoint {
  date: Date;
  sentimentScore: number;
  communicationCount: number;
  averageResponseTime: number;
}

export interface SentimentTrendData {
  clientId: string;
  timeframe: '7d' | '30d' | '90d' | '1y';
  dataPoints: SentimentTrendPoint[];
  overallTrend: 'improving' | 'stable' | 'declining';
  trendStrength: number; // 0-1 scale
}

export class RelationshipInsightsService {
  constructor(
    private db: Pool,
    private redis: RedisClientType,
    private nlpService: NLPProcessingService
  ) {}

  /**
   * Analyze sentiment of communication using VADER-like approach
   */
  async analyzeSentiment(text: string): Promise<SentimentAnalysisResult> {
    try {
      // Use existing NLP service for basic sentiment
      const nlpResult = await this.nlpService.processText({
        text,
        language: 'en'
      });

      const sentiment = nlpResult.sentiment;
      
      // Enhanced VADER-like sentiment analysis
      const enhancedResult = await this.enhancedSentimentAnalysis(text);
      
      // Combine results with VADER threshold
      const finalScore = (sentiment.score + enhancedResult.score) / 2;
      const isPositive = finalScore > 0.5; // VADER >0.5 positive threshold
      
      return {
        score: finalScore,
        magnitude: Math.max(sentiment.magnitude, enhancedResult.magnitude),
        label: this.getSentimentLabel(finalScore),
        confidence: Math.max(sentiment.confidence, enhancedResult.confidence),
        isPositive
      };

    } catch (error) {
      logger.error('Sentiment analysis failed:', error);
      return {
        score: 0,
        magnitude: 0,
        label: 'neutral',
        confidence: 0,
        isPositive: false
      };
    }
  }

  /**
   * Enhanced VADER-like sentiment analysis with insurance domain specifics
   */
  private async enhancedSentimentAnalysis(text: string): Promise<Omit<SentimentAnalysisResult, 'isPositive'>> {
    const lowerText = text.toLowerCase();
    
    // Insurance-specific sentiment lexicon
    const sentimentLexicon: Record<string, number> = {
      // Very positive (2.0)
      'excellent': 2.0, 'outstanding': 2.0, 'amazing': 2.0, 'fantastic': 2.0,
      'thrilled': 2.0, 'delighted': 2.0, 'impressed': 2.0,
      
      // Positive (1.0)
      'good': 1.0, 'great': 1.0, 'satisfied': 1.0, 'happy': 1.0, 'pleased': 1.0,
      'helpful': 1.0, 'professional': 1.0, 'responsive': 1.0, 'reliable': 1.0,
      'trustworthy': 1.0, 'recommend': 1.0, 'appreciate': 1.0, 'thank': 1.0,
      
      // Slightly positive (0.5)
      'okay': 0.5, 'fine': 0.5, 'decent': 0.5, 'reasonable': 0.5,
      
      // Slightly negative (-0.5)
      'slow': -0.5, 'delayed': -0.5, 'confused': -0.5, 'unclear': -0.5,
      
      // Negative (-1.0)
      'bad': -1.0, 'poor': -1.0, 'disappointed': -1.0, 'frustrated': -1.0,
      'unhappy': -1.0, 'dissatisfied': -1.0, 'problem': -1.0, 'issue': -1.0,
      'complaint': -1.0, 'difficult': -1.0, 'unresponsive': -1.0,
      
      // Very negative (-2.0)
      'terrible': -2.0, 'awful': -2.0, 'horrible': -2.0, 'disgusted': -2.0,
      'furious': -2.0, 'outraged': -2.0, 'unacceptable': -2.0, 'scam': -2.0
    };

    // Intensifiers
    const intensifiers: Record<string, number> = {
      'very': 1.3, 'really': 1.3, 'extremely': 1.5, 'incredibly': 1.5,
      'absolutely': 1.4, 'completely': 1.4, 'totally': 1.4,
      'quite': 1.1, 'rather': 1.1, 'somewhat': 0.8, 'slightly': 0.7
    };

    // Negation words
    const negations = ['not', 'no', 'never', 'none', 'nobody', 'nothing', 'neither', 'nowhere', 'hardly', 'scarcely', 'barely'];

    const words = lowerText.split(/\s+/);
    let sentimentScore = 0;
    let sentimentCount = 0;
    
    for (let i = 0; i < words.length; i++) {
      const word = words[i].replace(/[^\w]/g, ''); // Remove punctuation
      
      if (sentimentLexicon[word]) {
        let wordScore = sentimentLexicon[word];
        
        // Check for intensifiers in the previous 2 words
        for (let j = Math.max(0, i - 2); j < i; j++) {
          const prevWord = words[j].replace(/[^\w]/g, '');
          if (intensifiers[prevWord]) {
            wordScore *= intensifiers[prevWord];
          }
        }
        
        // Check for negations in the previous 3 words
        let isNegated = false;
        for (let j = Math.max(0, i - 3); j < i; j++) {
          const prevWord = words[j].replace(/[^\w]/g, '');
          if (negations.includes(prevWord)) {
            isNegated = true;
            break;
          }
        }
        
        if (isNegated) {
          wordScore *= -0.8; // Flip and reduce intensity
        }
        
        sentimentScore += wordScore;
        sentimentCount++;
      }
    }

    // Normalize score
    const normalizedScore = sentimentCount > 0 ? sentimentScore / sentimentCount : 0;
    
    // Calculate magnitude (intensity)
    const magnitude = Math.min(1, Math.abs(normalizedScore) / 2);
    
    // Calculate confidence based on sentiment word density
    const confidence = Math.min(0.95, sentimentCount / words.length * 5);
    
    // Normalize to -1 to 1 scale
    const finalScore = Math.max(-1, Math.min(1, normalizedScore / 2));

    return {
      score: finalScore,
      magnitude,
      label: this.getSentimentLabel(finalScore),
      confidence
    };
  }

  /**
   * Get sentiment label from score
   */
  private getSentimentLabel(score: number): SentimentAnalysisResult['label'] {
    if (score > 0.6) return 'very_positive';
    if (score > 0.2) return 'positive';
    if (score < -0.6) return 'very_negative';
    if (score < -0.2) return 'negative';
    return 'neutral';
  }

  /**
   * Calculate relationship health score (0-100 scale)
   */
  async calculateRelationshipHealth(clientId: string): Promise<RelationshipHealthScore> {
    try {
      const cacheKey = `relationship_health:${clientId}`;
      
      // Check cache (valid for 1 hour)
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Get client data
      const client = await this.getClientData(clientId);
      if (!client) {
        throw new Error(`Client not found: ${clientId}`);
      }

      // Get recent communications (last 90 days)
      const communications = await this.getRecentCommunications(clientId, 90);
      
      // Calculate individual factors
      const factors = {
        sentimentTrend: await this.calculateSentimentTrendScore(communications),
        interactionFrequency: this.calculateInteractionFrequencyScore(communications),
        responseTime: this.calculateResponseTimeScore(communications),
        recentActivity: this.calculateRecentActivityScore(communications),
        communicationQuality: await this.calculateCommunicationQualityScore(communications)
      };

      // Calculate total score
      const totalScore = Math.round(
        factors.sentimentTrend + 
        factors.interactionFrequency + 
        factors.responseTime + 
        factors.recentActivity + 
        factors.communicationQuality
      );

      // Determine trend
      const trend = await this.determineHealthTrend(clientId, totalScore);

      const healthScore: RelationshipHealthScore = {
        score: Math.max(0, Math.min(100, totalScore)),
        factors,
        trend,
        lastCalculated: new Date()
      };

      // Cache for 1 hour
      await this.redis.setEx(cacheKey, 3600, JSON.stringify(healthScore));

      // Update client record
      await this.updateClientHealthScore(clientId, healthScore.score);

      logger.info(`Calculated relationship health score for client ${clientId}: ${healthScore.score}`);
      return healthScore;

    } catch (error) {
      logger.error('Error calculating relationship health:', error);
      throw error;
    }
  }

  /**
   * Calculate sentiment trend score (0-30 points)
   */
  private async calculateSentimentTrendScore(communications: Communication[]): Promise<number> {
    if (communications.length === 0) return 15; // Neutral baseline

    let totalSentiment = 0;
    let sentimentCount = 0;

    for (const comm of communications) {
      if (comm.sentiment !== undefined) {
        totalSentiment += comm.sentiment;
        sentimentCount++;
      }
    }

    if (sentimentCount === 0) return 15;

    const averageSentiment = totalSentiment / sentimentCount;
    
    // Convert -1 to 1 scale to 0-30 points
    return Math.round(15 + (averageSentiment * 15));
  }

  /**
   * Calculate interaction frequency score (0-25 points)
   */
  private calculateInteractionFrequencyScore(communications: Communication[]): number {
    const daysInPeriod = 90;
    const interactionsPerDay = communications.length / daysInPeriod;
    
    // Optimal frequency: 1-2 interactions per week (0.14-0.28 per day)
    if (interactionsPerDay >= 0.14 && interactionsPerDay <= 0.28) {
      return 25; // Perfect frequency
    } else if (interactionsPerDay > 0.28) {
      // Too frequent - diminishing returns
      return Math.max(15, 25 - Math.round((interactionsPerDay - 0.28) * 50));
    } else {
      // Too infrequent
      return Math.round(interactionsPerDay * 178); // Scale to 25 max
    }
  }

  /**
   * Calculate response time score (0-20 points)
   */
  private calculateResponseTimeScore(communications: Communication[]): number {
    const responseTimes: number[] = [];
    
    // Calculate response times between inbound and outbound messages
    for (let i = 0; i < communications.length - 1; i++) {
      const current = communications[i];
      const next = communications[i + 1];
      
      if (current.direction === 'inbound' && next.direction === 'outbound') {
        const responseTime = (next.timestamp.getTime() - current.timestamp.getTime()) / (1000 * 60 * 60); // hours
        responseTimes.push(responseTime);
      }
    }

    if (responseTimes.length === 0) return 10; // Neutral baseline

    const averageResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
    
    // Scoring: < 2 hours = 20 points, < 24 hours = 15 points, < 48 hours = 10 points, > 48 hours = 5 points
    if (averageResponseTime < 2) return 20;
    if (averageResponseTime < 24) return 15;
    if (averageResponseTime < 48) return 10;
    return 5;
  }

  /**
   * Calculate recent activity score (0-15 points)
   */
  private calculateRecentActivityScore(communications: Communication[]): number {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const recentComms = communications.filter(c => c.timestamp >= sevenDaysAgo);
    const monthlyComms = communications.filter(c => c.timestamp >= thirtyDaysAgo);

    if (recentComms.length > 0) return 15; // Recent activity
    if (monthlyComms.length > 0) return 10; // Some recent activity
    return 5; // No recent activity
  }

  /**
   * Calculate communication quality score (0-10 points)
   */
  private async calculateCommunicationQualityScore(communications: Communication[]): Promise<number> {
    if (communications.length === 0) return 5;

    let qualityScore = 0;
    let scoredComms = 0;

    for (const comm of communications) {
      // Length indicates engagement
      const wordCount = comm.content.split(/\s+/).length;
      let commScore = 0;

      if (wordCount > 50) commScore += 3; // Detailed communication
      else if (wordCount > 20) commScore += 2; // Moderate detail
      else commScore += 1; // Brief

      // Check for questions (indicates engagement)
      if (comm.content.includes('?')) commScore += 1;

      // Check for personal touches
      const personalWords = ['thank', 'appreciate', 'family', 'birthday', 'vacation', 'holiday'];
      if (personalWords.some(word => comm.content.toLowerCase().includes(word))) {
        commScore += 1;
      }

      qualityScore += Math.min(5, commScore);
      scoredComms++;
    }

    return Math.round((qualityScore / scoredComms) * 2); // Scale to 0-10
  }

  /**
   * Determine health trend by comparing with historical scores
   */
  private async determineHealthTrend(clientId: string, currentScore: number): Promise<'improving' | 'stable' | 'declining'> {
    try {
      // Get historical scores from the last 3 months
      const query = `
        SELECT relationship_score, updated_at
        FROM clients 
        WHERE id = $1 AND updated_at >= NOW() - INTERVAL '90 days'
        ORDER BY updated_at DESC
        LIMIT 10
      `;

      const result = await this.db.query(query, [clientId]);
      
      if (result.rows.length < 2) return 'stable';

      const scores = result.rows.map(row => row.relationship_score);
      const recentAverage = scores.slice(0, 3).reduce((sum, score) => sum + score, 0) / Math.min(3, scores.length);
      const olderAverage = scores.slice(3).reduce((sum, score) => sum + score, 0) / Math.max(1, scores.length - 3);

      const difference = recentAverage - olderAverage;

      if (difference > 5) return 'improving';
      if (difference < -5) return 'declining';
      return 'stable';

    } catch (error) {
      logger.error('Error determining health trend:', error);
      return 'stable';
    }
  }

  /**
   * Generate conversation summary using AI
   */
  async generateConversationSummary(
    clientId: string, 
    communications: Communication[]
  ): Promise<ConversationSummary> {
    try {
      if (communications.length === 0) {
        throw new Error('No communications provided for summary');
      }

      // Combine communication content
      const conversationText = communications
        .map(c => `[${c.direction.toUpperCase()}] ${c.content}`)
        .join('\n\n');

      // Generate summary using NLP service
      const summaryPrompt = `
        Summarize the following conversation between an insurance agent and client. 
        Focus on key points, decisions made, and any action items mentioned.
        Keep the summary concise but comprehensive.
        
        Conversation:
        ${conversationText}
      `;

      const nlpResult = await this.nlpService.processText({
        text: summaryPrompt,
        language: 'en'
      });

      // Extract key topics from entities
      const keyTopics = nlpResult.entities
        .filter(e => ['person', 'policy_number', 'money', 'date'].includes(e.type))
        .map(e => e.value)
        .slice(0, 10); // Limit to top 10

      // Extract action items from tasks
      const actionItems = nlpResult.tasks
        .map(t => t.description)
        .slice(0, 5); // Limit to top 5

      // Generate a simple summary (in a real implementation, this would use a more sophisticated AI model)
      const summary = this.generateSimpleSummary(communications);

      // Calculate overall sentiment
      const sentiments = await Promise.all(
        communications.map(c => this.analyzeSentiment(c.content))
      );
      const averageSentiment = sentiments.reduce((sum, s) => sum + s.score, 0) / sentiments.length;

      // Save to database
      const summaryRecord = await this.saveConversationSummary({
        clientId,
        communicationId: communications[0]?.id,
        summary,
        keyTopics,
        actionItems,
        sentimentScore: averageSentiment
      });

      logger.info(`Generated conversation summary for client ${clientId}`);
      return summaryRecord;

    } catch (error) {
      logger.error('Error generating conversation summary:', error);
      throw error;
    }
  }

  /**
   * Generate simple summary from communications
   */
  private generateSimpleSummary(communications: Communication[]): string {
    const totalComms = communications.length;
    const inboundCount = communications.filter(c => c.direction === 'inbound').length;
    const outboundCount = communications.filter(c => c.direction === 'outbound').length;
    
    const timespan = this.getTimespan(communications);
    const topics = this.extractTopics(communications);

    return `Conversation summary: ${totalComms} messages exchanged over ${timespan}. ` +
           `Client sent ${inboundCount} messages, agent responded ${outboundCount} times. ` +
           `Main topics discussed: ${topics.join(', ')}.`;
  }

  /**
   * Get timespan of communications
   */
  private getTimespan(communications: Communication[]): string {
    if (communications.length < 2) return 'single interaction';

    const sorted = communications.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const start = sorted[0].timestamp;
    const end = sorted[sorted.length - 1].timestamp;
    
    const diffHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    
    if (diffHours < 24) return `${Math.round(diffHours)} hours`;
    const diffDays = Math.round(diffHours / 24);
    return `${diffDays} day${diffDays > 1 ? 's' : ''}`;
  }

  /**
   * Extract topics from communications
   */
  private extractTopics(communications: Communication[]): string[] {
    const allText = communications.map(c => c.content).join(' ').toLowerCase();
    
    const insuranceTopics = {
      'policy': ['policy', 'coverage', 'premium'],
      'claim': ['claim', 'accident', 'damage'],
      'renewal': ['renewal', 'renew', 'expire'],
      'payment': ['payment', 'bill', 'invoice'],
      'quote': ['quote', 'estimate', 'rate']
    };

    const foundTopics: string[] = [];
    
    for (const [topic, keywords] of Object.entries(insuranceTopics)) {
      if (keywords.some(keyword => allText.includes(keyword))) {
        foundTopics.push(topic);
      }
    }

    return foundTopics.length > 0 ? foundTopics : ['general inquiry'];
  }

  /**
   * Get sentiment trend data for visualization
   */
  async getSentimentTrend(
    clientId: string, 
    timeframe: '7d' | '30d' | '90d' | '1y' = '30d'
  ): Promise<SentimentTrendData> {
    try {
      const days = this.getTimeframeDays(timeframe);
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      // Get communications with sentiment data
      const query = `
        SELECT 
          DATE_TRUNC('day', timestamp) as date,
          AVG(sentiment) as avg_sentiment,
          COUNT(*) as communication_count,
          AVG(EXTRACT(EPOCH FROM (
            LEAD(timestamp) OVER (ORDER BY timestamp) - timestamp
          )) / 3600) as avg_response_time_hours
        FROM communications 
        WHERE client_id = $1 
          AND timestamp >= $2 
          AND sentiment IS NOT NULL
        GROUP BY DATE_TRUNC('day', timestamp)
        ORDER BY date
      `;

      const result = await this.db.query(query, [clientId, startDate]);

      const dataPoints: SentimentTrendPoint[] = result.rows.map(row => ({
        date: row.date,
        sentimentScore: parseFloat(row.avg_sentiment) || 0,
        communicationCount: parseInt(row.communication_count) || 0,
        averageResponseTime: parseFloat(row.avg_response_time_hours) || 0
      }));

      // Calculate overall trend
      const { trend, strength } = this.calculateTrendDirection(dataPoints);

      return {
        clientId,
        timeframe,
        dataPoints,
        overallTrend: trend,
        trendStrength: strength
      };

    } catch (error) {
      logger.error('Error getting sentiment trend:', error);
      throw error;
    }
  }

  /**
   * Calculate trend direction and strength
   */
  private calculateTrendDirection(dataPoints: SentimentTrendPoint[]): { trend: 'improving' | 'stable' | 'declining', strength: number } {
    if (dataPoints.length < 3) {
      return { trend: 'stable', strength: 0 };
    }

    // Simple linear regression to determine trend
    const n = dataPoints.length;
    const sumX = dataPoints.reduce((sum, _, i) => sum + i, 0);
    const sumY = dataPoints.reduce((sum, point) => sum + point.sentimentScore, 0);
    const sumXY = dataPoints.reduce((sum, point, i) => sum + i * point.sentimentScore, 0);
    const sumXX = dataPoints.reduce((sum, _, i) => sum + i * i, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const strength = Math.abs(slope);

    let trend: 'improving' | 'stable' | 'declining' = 'stable';
    if (slope > 0.1) trend = 'improving';
    else if (slope < -0.1) trend = 'declining';

    return { trend, strength: Math.min(1, strength * 10) };
  }

  /**
   * Helper methods
   */
  private getTimeframeDays(timeframe: string): number {
    switch (timeframe) {
      case '7d': return 7;
      case '30d': return 30;
      case '90d': return 90;
      case '1y': return 365;
      default: return 30;
    }
  }

  private async getClientData(clientId: string): Promise<Client | null> {
    const query = `
      SELECT id, crm_id, crm_system, name, email, phone
      FROM clients 
      WHERE id = $1
    `;

    const result = await this.db.query(query, [clientId]);
    return result.rows[0] || null;
  }

  private async getRecentCommunications(clientId: string, days: number): Promise<Communication[]> {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const query = `
      SELECT id, client_id, type, direction, subject, content, timestamp, sentiment
      FROM communications 
      WHERE client_id = $1 AND timestamp >= $2
      ORDER BY timestamp DESC
    `;

    const result = await this.db.query(query, [clientId, startDate]);
    
    return result.rows.map(row => ({
      id: row.id,
      clientId: row.client_id,
      type: row.type,
      direction: row.direction,
      subject: row.subject,
      content: row.content,
      timestamp: row.timestamp,
      tags: [],
      sentiment: row.sentiment,
      isUrgent: false,
      source: '',
      metadata: {}
    }));
  }

  private async updateClientHealthScore(clientId: string, score: number): Promise<void> {
    const query = `
      UPDATE clients 
      SET relationship_score = $1, updated_at = NOW()
      WHERE id = $2
    `;

    await this.db.query(query, [score, clientId]);
  }

  private async saveConversationSummary(data: {
    clientId: string;
    communicationId?: string;
    summary: string;
    keyTopics: string[];
    actionItems: string[];
    sentimentScore: number;
  }): Promise<ConversationSummary> {
    const query = `
      INSERT INTO conversation_summaries 
      (client_id, communication_id, summary, sentiment_score, key_topics, action_items)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, client_id, communication_id, summary, sentiment_score, key_topics, action_items, created_at
    `;

    const result = await this.db.query(query, [
      data.clientId,
      data.communicationId,
      data.summary,
      data.sentimentScore,
      data.keyTopics,
      data.actionItems
    ]);

    const row = result.rows[0];
    return {
      id: row.id,
      clientId: row.client_id,
      communicationId: row.communication_id,
      summary: row.summary,
      keyTopics: row.key_topics,
      actionItems: row.action_items,
      sentimentScore: row.sentiment_score,
      createdAt: row.created_at
    };
  }
}