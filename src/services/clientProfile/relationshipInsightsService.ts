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

export interface RelationshipInsight {
  id: string;
  clientId: string;
  type: 'sentiment_change' | 'response_delay' | 'communication_gap' | 'positive_trend';
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  actionable: boolean;
  suggestedActions: string[];
  createdAt: Date;
}

export class RelationshipInsightsService {
  private db: Pool;
  private redis: RedisClientType;
  private nlpService: NLPProcessingService;

  constructor(
    db: Pool,
    redis: RedisClientType,
    nlpService: NLPProcessingService
  ) {
    this.db = db;
    this.redis = redis;
    this.nlpService = nlpService;
  }

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

      // Convert NLP result to our sentiment format
      const score = nlpResult.sentiment?.score || 0;
      const magnitude = Math.abs(score);
      
      let label: SentimentAnalysisResult['label'];
      if (score <= -0.6) label = 'very_negative';
      else if (score <= -0.2) label = 'negative';
      else if (score >= 0.6) label = 'very_positive';
      else if (score >= 0.2) label = 'positive';
      else label = 'neutral';

      return {
        score,
        magnitude,
        label,
        confidence: nlpResult.sentiment?.confidence || 0.5,
        isPositive: score > 0.05
      };

    } catch (error) {
      logger.error('Error analyzing sentiment:', error);
      throw error;
    }
  }

  /**
   * Calculate relationship health score based on multiple factors
   */
  async calculateRelationshipHealth(clientId: string): Promise<RelationshipHealthScore> {
    try {
      const cacheKey = `relationship_health:${clientId}`;
      
      // Check cache first (valid for 1 hour)
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Get recent communications (last 90 days)
      const recentComms = await this.getRecentCommunications(clientId, 90);
      
      if (recentComms.length === 0) {
        const defaultScore: RelationshipHealthScore = {
          score: 50,
          factors: {
            sentimentTrend: 25,
            interactionFrequency: 12,
            responseTime: 10,
            recentActivity: 7,
            communicationQuality: 5
          },
          trend: 'stable',
          lastCalculated: new Date()
        };
        
        await this.redis.setex(cacheKey, 3600, JSON.stringify(defaultScore));
        return defaultScore;
      }

      // Calculate individual factors
      const sentimentTrend = await this.calculateSentimentTrendScore(recentComms);
      const interactionFrequency = this.calculateInteractionFrequencyScore(recentComms);
      const responseTime = await this.calculateResponseTimeScore(clientId, recentComms);
      const recentActivity = this.calculateRecentActivityScore(recentComms);
      const communicationQuality = await this.calculateCommunicationQualityScore(recentComms);

      const totalScore = sentimentTrend + interactionFrequency + responseTime + recentActivity + communicationQuality;
      
      // Determine trend based on recent vs older communications
      const trend = await this.determineTrend(clientId, recentComms);

      const healthScore: RelationshipHealthScore = {
        score: Math.min(100, Math.max(0, totalScore)),
        factors: {
          sentimentTrend,
          interactionFrequency,
          responseTime,
          recentActivity,
          communicationQuality
        },
        trend,
        lastCalculated: new Date()
      };

      // Cache for 1 hour
      await this.redis.setex(cacheKey, 3600, JSON.stringify(healthScore));
      
      logger.info(`Calculated relationship health for client ${clientId}: ${healthScore.score}`);
      return healthScore;

    } catch (error) {
      logger.error('Error calculating relationship health:', error);
      throw error;
    }
  }

  /**
   * Generate conversation summary using NLP
   */
  async generateConversationSummary(
    clientId: string,
    communicationIds: string[]
  ): Promise<ConversationSummary> {
    try {
      // Get communications
      const communications = await this.getCommunicationsByIds(communicationIds);
      
      if (communications.length === 0) {
        throw new Error('No communications found for summary generation');
      }

      // Combine all communication content
      const combinedText = communications
        .map(comm => `${comm.subject || ''} ${comm.content}`)
        .join('\n\n');

      // Use NLP service to generate summary
      const nlpResult = await this.nlpService.processText({
        text: combinedText,
        language: 'en'
      });

      // Extract key topics and action items
      const keyTopics = nlpResult.entities?.map(entity => entity.text) || [];
      const actionItems = nlpResult.tasks?.map(task => task.description) || [];

      // Calculate average sentiment
      const sentiments = await Promise.all(
        communications.map(comm => this.analyzeSentiment(comm.content))
      );
      const avgSentiment = sentiments.reduce((sum, s) => sum + s.score, 0) / sentiments.length;

      const summary: ConversationSummary = {
        id: `summary_${Date.now()}`,
        clientId,
        communicationId: communicationIds.length === 1 ? communicationIds[0] : undefined,
        summary: nlpResult.summary || 'Summary generation failed',
        keyTopics: keyTopics.slice(0, 10), // Limit to top 10
        actionItems: actionItems.slice(0, 5), // Limit to top 5
        sentimentScore: avgSentiment,
        createdAt: new Date()
      };

      // Store summary in database
      await this.storeSummary(summary);

      logger.info(`Generated conversation summary for client ${clientId}`);
      return summary;

    } catch (error) {
      logger.error('Error generating conversation summary:', error);
      throw error;
    }
  }

  /**
   * Get sentiment trend data for visualization
   */
  async getSentimentTrend(
    clientId: string,
    days = 30
  ): Promise<SentimentTrendPoint[]> {
    try {
      const cacheKey = `sentiment_trend:${clientId}:${days}`;
      
      // Check cache first
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const query = `
        SELECT 
          DATE(timestamp) as date,
          AVG(sentiment) as avg_sentiment,
          COUNT(*) as communication_count,
          AVG(EXTRACT(EPOCH FROM (created_at - timestamp))/3600) as avg_response_time
        FROM communications 
        WHERE client_id = $1 
          AND timestamp >= NOW() - INTERVAL '${days} days'
          AND sentiment IS NOT NULL
        GROUP BY DATE(timestamp)
        ORDER BY date ASC
      `;

      const result = await this.db.query(query, [clientId]);
      
      const trendPoints: SentimentTrendPoint[] = result.rows.map(row => ({
        date: new Date(row.date),
        sentimentScore: parseFloat(row.avg_sentiment) || 0,
        communicationCount: parseInt(row.communication_count) || 0,
        averageResponseTime: parseFloat(row.avg_response_time) || 0
      }));

      // Cache for 30 minutes
      await this.redis.setex(cacheKey, 1800, JSON.stringify(trendPoints));
      
      return trendPoints;

    } catch (error) {
      logger.error('Error getting sentiment trend:', error);
      throw error;
    }
  }

  /**
   * Generate actionable relationship insights
   */
  async generateRelationshipInsights(clientId: string): Promise<RelationshipInsight[]> {
    try {
      const insights: RelationshipInsight[] = [];
      
      // Get relationship health score
      const healthScore = await this.calculateRelationshipHealth(clientId);
      
      // Get recent communications
      const recentComms = await this.getRecentCommunications(clientId, 30);
      
      // Check for sentiment decline
      if (healthScore.factors.sentimentTrend < 15) {
        insights.push({
          id: `insight_sentiment_${Date.now()}`,
          clientId,
          type: 'sentiment_change',
          title: 'Declining Sentiment Detected',
          description: 'Recent communications show a negative sentiment trend',
          severity: 'high',
          actionable: true,
          suggestedActions: [
            'Schedule a personal check-in call',
            'Review recent service interactions',
            'Send a personalized follow-up message'
          ],
          createdAt: new Date()
        });
      }

      // Check for response delays
      if (healthScore.factors.responseTime < 10) {
        insights.push({
          id: `insight_response_${Date.now()}`,
          clientId,
          type: 'response_delay',
          title: 'Slow Response Times',
          description: 'Client response times have increased significantly',
          severity: 'medium',
          actionable: true,
          suggestedActions: [
            'Simplify communication approach',
            'Use preferred communication channel',
            'Set clear expectations for response times'
          ],
          createdAt: new Date()
        });
      }

      // Check for communication gaps
      const daysSinceLastComm = recentComms.length > 0 
        ? Math.floor((Date.now() - new Date(recentComms[0].timestamp).getTime()) / (1000 * 60 * 60 * 24))
        : 999;

      if (daysSinceLastComm > 14) {
        insights.push({
          id: `insight_gap_${Date.now()}`,
          clientId,
          type: 'communication_gap',
          title: 'Communication Gap Detected',
          description: `No communication for ${daysSinceLastComm} days`,
          severity: daysSinceLastComm > 30 ? 'high' : 'medium',
          actionable: true,
          suggestedActions: [
            'Send a friendly check-in message',
            'Share relevant industry updates',
            'Schedule a regular touchpoint'
          ],
          createdAt: new Date()
        });
      }

      // Check for positive trends
      if (healthScore.trend === 'improving' && healthScore.score > 75) {
        insights.push({
          id: `insight_positive_${Date.now()}`,
          clientId,
          type: 'positive_trend',
          title: 'Strong Relationship Momentum',
          description: 'Relationship health is improving with high engagement',
          severity: 'low',
          actionable: true,
          suggestedActions: [
            'Consider upselling opportunities',
            'Request referrals or testimonials',
            'Maintain current communication cadence'
          ],
          createdAt: new Date()
        });
      }

      return insights;

    } catch (error) {
      logger.error('Error generating relationship insights:', error);
      throw error;
    }
  }

  // Private helper methods

  private async getRecentCommunications(clientId: string, days: number): Promise<Communication[]> {
    const query = `
      SELECT * FROM communications 
      WHERE client_id = $1 
        AND timestamp >= NOW() - INTERVAL '${days} days'
      ORDER BY timestamp DESC
    `;
    
    const result = await this.db.query(query, [clientId]);
    return result.rows;
  }

  private async getCommunicationsByIds(ids: string[]): Promise<Communication[]> {
    if (ids.length === 0) return [];
    
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const query = `SELECT * FROM communications WHERE id IN (${placeholders})`;
    
    const result = await this.db.query(query, ids);
    return result.rows;
  }

  private async calculateSentimentTrendScore(communications: Communication[]): Promise<number> {
    if (communications.length === 0) return 15;

    const sentiments = communications
      .filter(comm => comm.sentiment !== null)
      .map(comm => comm.sentiment || 0);

    if (sentiments.length === 0) return 15;

    const avgSentiment = sentiments.reduce((sum, s) => sum + s, 0) / sentiments.length;
    
    // Convert -1 to 1 scale to 0-30 points
    return Math.max(0, Math.min(30, (avgSentiment + 1) * 15));
  }

  private calculateInteractionFrequencyScore(communications: Communication[]): number {
    const daysWithComms = new Set(
      communications.map(comm => new Date(comm.timestamp).toDateString())
    ).size;
    
    // Expect at least 2-3 interactions per week (score out of 25)
    const expectedDays = 12; // 2-3 days per week over 30 days
    return Math.min(25, (daysWithComms / expectedDays) * 25);
  }

  private async calculateResponseTimeScore(clientId: string, communications: Communication[]): Promise<number> {
    // This would need more complex logic to track response times
    // For now, return a default score
    return 15;
  }

  private calculateRecentActivityScore(communications: Communication[]): number {
    const last7Days = communications.filter(comm => 
      new Date(comm.timestamp) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    );
    
    // Score based on recent activity (out of 15)
    return Math.min(15, last7Days.length * 2);
  }

  private async calculateCommunicationQualityScore(communications: Communication[]): Promise<number> {
    // Score based on message length, sentiment, and engagement
    const avgLength = communications.reduce((sum, comm) => sum + comm.content.length, 0) / communications.length;
    const qualityScore = Math.min(10, avgLength / 100); // Longer messages = higher quality
    
    return qualityScore;
  }

  private async determineTrend(clientId: string, recentComms: Communication[]): Promise<'improving' | 'stable' | 'declining'> {
    if (recentComms.length < 4) return 'stable';

    const mid = Math.floor(recentComms.length / 2);
    const recent = recentComms.slice(0, mid);
    const older = recentComms.slice(mid);

    const recentAvg = recent.reduce((sum, comm) => sum + (comm.sentiment || 0), 0) / recent.length;
    const olderAvg = older.reduce((sum, comm) => sum + (comm.sentiment || 0), 0) / older.length;

    const diff = recentAvg - olderAvg;
    
    if (diff > 0.1) return 'improving';
    if (diff < -0.1) return 'declining';
    return 'stable';
  }

  private async storeSummary(summary: ConversationSummary): Promise<void> {
    const query = `
      INSERT INTO conversation_summaries 
      (id, client_id, communication_id, summary, key_topics, action_items, sentiment_score, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;
    
    await this.db.query(query, [
      summary.id,
      summary.clientId,
      summary.communicationId,
      summary.summary,
      JSON.stringify(summary.keyTopics),
      JSON.stringify(summary.actionItems),
      summary.sentimentScore,
      summary.createdAt
    ]);
  }
}