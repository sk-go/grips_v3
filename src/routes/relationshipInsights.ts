/**
 * Relationship Insights API Routes
 * Provides endpoints for sentiment analysis, relationship health scoring,
 * conversation summaries, and sentiment trend visualization
 */

import { Router, Request, Response } from 'express';
import { RedisClientType } from 'redis';
import { RelationshipInsightsService } from '../services/clientProfile/relationshipInsightsService';
import { NLPProcessingService } from '../services/nlp/nlpProcessingService';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../utils/logger';

import { Pool } from 'pg';

export function createRelationshipInsightsRoutes(
    db: Pool,
    redis: RedisClientType,
    nlpService: NLPProcessingService
): Router {
    const router = Router();
    const relationshipInsightsService = new RelationshipInsightsService(db, redis, nlpService);

    // Apply authentication middleware to all routes
    router.use(authMiddleware);

    /**
     * POST /api/relationship-insights/sentiment-analysis
     * Analyze sentiment of text using VADER-like approach
     */
    router.post('/sentiment-analysis', async (req: Request, res: Response): Promise<void> => {
        try {
            const { text } = req.body;

            if (!text || typeof text !== 'string') {
                res.status(400).json({
                    error: 'Text is required and must be a string'
                });
                return;
            }

            if (text.length > 10000) {
                res.status(400).json({
                    error: 'Text must be less than 10,000 characters'
                });
                return;
            }

            const result = await relationshipInsightsService.analyzeSentiment(text);

            res.json({
                success: true,
                data: result
            });

        } catch (error) {
            logger.error('Error in sentiment analysis:', error);
            res.status(500).json({
                error: 'Failed to analyze sentiment',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    /**
     * GET /api/relationship-insights/health-score/:clientId
     * Calculate relationship health score for a client (0-100 scale)
     */
    router.get('/health-score/:clientId', async (req: Request, res: Response): Promise<void> => {
        try {
            const { clientId } = req.params;
            const { forceRecalculate } = req.query;

            if (!clientId) {
                res.status(400).json({
                    error: 'Client ID is required'
                });
                return;
            }

            // Clear cache if force recalculate is requested
            if (forceRecalculate === 'true') {
                await redis.del(`relationship_health:${clientId}`);
            }

            const healthScore = await relationshipInsightsService.calculateRelationshipHealth(clientId);

            res.json({
                success: true,
                data: healthScore
            });

        } catch (error) {
            logger.error('Error calculating relationship health:', error);

            if (error instanceof Error && error.message.includes('Client not found')) {
                res.status(404).json({
                    error: 'Client not found',
                    message: error.message
                });
                return;
            }

            res.status(500).json({
                error: 'Failed to calculate relationship health',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    /**
     * POST /api/relationship-insights/conversation-summary
     * Generate AI-powered conversation summary
     */
    router.post('/conversation-summary', async (req: Request, res: Response): Promise<void> => {
        try {
            const { clientId, communicationIds } = req.body;

            if (!clientId || !communicationIds || !Array.isArray(communicationIds)) {
                res.status(400).json({
                    error: 'Client ID and communication IDs array are required'
                });
                return;
            }

            if (communicationIds.length === 0) {
                res.status(400).json({
                    error: 'At least one communication ID is required'
                });
                return;
            }

            if (communicationIds.length > 50) {
                res.status(400).json({
                    error: 'Maximum 50 communications can be summarized at once'
                });
                return;
            }

            // Fetch communications from database
            const communicationsQuery = `
        SELECT id, client_id, type, direction, subject, content, timestamp, sentiment, tags, is_urgent, source
        FROM communications 
        WHERE id = ANY($1) AND client_id = $2
        ORDER BY timestamp ASC
      `;

            const communicationsResult = await db.query(communicationsQuery, [communicationIds, clientId]);

            if (communicationsResult.rows.length === 0) {
                res.status(404).json({
                    error: 'No communications found for the provided IDs'
                });
                return;
            }

            const communications = communicationsResult.rows.map(row => ({
                id: row.id,
                clientId: row.client_id,
                type: row.type,
                direction: row.direction,
                subject: row.subject,
                content: row.content,
                timestamp: row.timestamp,
                tags: row.tags || [],
                sentiment: row.sentiment,
                isUrgent: row.is_urgent,
                source: row.source,
                metadata: {}
            }));

            const summary = await relationshipInsightsService.generateConversationSummary(clientId, communications);

            res.json({
                success: true,
                data: summary
            });

        } catch (error) {
            logger.error('Error generating conversation summary:', error);
            res.status(500).json({
                error: 'Failed to generate conversation summary',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    /**
     * GET /api/relationship-insights/sentiment-trend/:clientId
     * Get sentiment trend data for visualization
     */
    router.get('/sentiment-trend/:clientId', async (req: Request, res: Response): Promise<void> => {
        try {
            const { clientId } = req.params;
            const { timeframe = '30d' } = req.query;

            if (!clientId) {
                res.status(400).json({
                    error: 'Client ID is required'
                });
                return;
            }

            const validTimeframes = ['7d', '30d', '90d', '1y'];
            if (!validTimeframes.includes(timeframe as string)) {
                res.status(400).json({
                    error: 'Invalid timeframe. Must be one of: 7d, 30d, 90d, 1y'
                });
                return;
            }

            const trendData = await relationshipInsightsService.getSentimentTrend(
                clientId,
                timeframe as '7d' | '30d' | '90d' | '1y'
            );

            res.json({
                success: true,
                data: trendData
            });

        } catch (error) {
            logger.error('Error getting sentiment trend:', error);
            res.status(500).json({
                error: 'Failed to get sentiment trend',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    /**
     * GET /api/relationship-insights/conversation-summaries/:clientId
     * Get conversation summaries for a client
     */
    router.get('/conversation-summaries/:clientId', async (req: Request, res: Response): Promise<void> => {
        try {
            const { clientId } = req.params;
            const { limit = '10', offset = '0' } = req.query;

            if (!clientId) {
                res.status(400).json({
                    error: 'Client ID is required'
                });
                return;
            }

            const limitNum = parseInt(limit as string);
            const offsetNum = parseInt(offset as string);

            if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
                res.status(400).json({
                    error: 'Limit must be a number between 1 and 100'
                });
                return;
            }

            if (isNaN(offsetNum) || offsetNum < 0) {
                res.status(400).json({
                    error: 'Offset must be a non-negative number'
                });
                return;
            }

            const query = `
        SELECT 
          id, client_id, communication_id, summary, sentiment_score, 
          key_topics, action_items, created_at
        FROM conversation_summaries 
        WHERE client_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `;

            const countQuery = `
        SELECT COUNT(*) as total
        FROM conversation_summaries 
        WHERE client_id = $1
      `;

            const [summariesResult, countResult] = await Promise.all([
                db.query(query, [clientId, limitNum, offsetNum]),
                db.query(countQuery, [clientId])
            ]);

            const summaries = summariesResult.rows.map(row => ({
                id: row.id,
                clientId: row.client_id,
                communicationId: row.communication_id,
                summary: row.summary,
                keyTopics: row.key_topics,
                actionItems: row.action_items,
                sentimentScore: row.sentiment_score,
                createdAt: row.created_at
            }));

            const total = parseInt(countResult.rows[0].total);

            res.json({
                success: true,
                data: {
                    summaries,
                    pagination: {
                        total,
                        limit: limitNum,
                        offset: offsetNum,
                        hasMore: offsetNum + limitNum < total
                    }
                }
            });

        } catch (error) {
            logger.error('Error getting conversation summaries:', error);
            res.status(500).json({
                error: 'Failed to get conversation summaries',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    /**
     * POST /api/relationship-insights/batch-sentiment-analysis
     * Analyze sentiment for multiple communications at once
     */
    router.post('/batch-sentiment-analysis', async (req: Request, res: Response): Promise<void> => {
        try {
            const { communicationIds } = req.body;

            if (!communicationIds || !Array.isArray(communicationIds)) {
                res.status(400).json({
                    error: 'Communication IDs array is required'
                });
                return;
            }

            if (communicationIds.length === 0) {
                res.status(400).json({
                    error: 'At least one communication ID is required'
                });
                return;
            }

            if (communicationIds.length > 100) {
                res.status(400).json({
                    error: 'Maximum 100 communications can be analyzed at once'
                });
                return;
            }

            // Fetch communications
            const query = `
        SELECT id, content, sentiment
        FROM communications 
        WHERE id = ANY($1)
      `;

            const result = await db.query(query, [communicationIds]);

            if (result.rows.length === 0) {
                res.status(404).json({
                    error: 'No communications found for the provided IDs'
                });
                return;
            }

            // Analyze sentiment for communications that don't have it
            const analysisResults = await Promise.all(
                result.rows.map(async (row) => {
                    if (row.sentiment !== null) {
                        // Return existing sentiment
                        return {
                            communicationId: row.id,
                            sentiment: {
                                score: row.sentiment,
                                isPositive: row.sentiment > 0.5,
                                cached: true
                            }
                        };
                    }

                    // Analyze new sentiment
                    const sentimentResult = await relationshipInsightsService.analyzeSentiment(row.content);

                    // Update database with new sentiment
                    await db.query(
                        'UPDATE communications SET sentiment = $1 WHERE id = $2',
                        [sentimentResult.score, row.id]
                    );

                    return {
                        communicationId: row.id,
                        sentiment: {
                            ...sentimentResult,
                            cached: false
                        }
                    };
                })
            );

            res.json({
                success: true,
                data: {
                    results: analysisResults,
                    processed: analysisResults.length,
                    cached: analysisResults.filter(r => r.sentiment.cached).length
                }
            });

        } catch (error) {
            logger.error('Error in batch sentiment analysis:', error);
            res.status(500).json({
                error: 'Failed to analyze sentiment',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    /**
     * GET /api/relationship-insights/health-trends
     * Get relationship health trends across all clients
     */
    router.get('/health-trends', async (req: Request, res: Response): Promise<void> => {
        try {
            const { timeframe = '30d', limit = '20' } = req.query;

            const validTimeframes = ['7d', '30d', '90d', '1y'];
            if (!validTimeframes.includes(timeframe as string)) {
                res.status(400).json({
                    error: 'Invalid timeframe. Must be one of: 7d, 30d, 90d, 1y'
                });
                return;
            }

            const limitNum = parseInt(limit as string);
            if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
                res.status(400).json({
                    error: 'Limit must be a number between 1 and 100'
                });
                return;
            }

            const days = timeframe === '7d' ? 7 : timeframe === '30d' ? 30 : timeframe === '90d' ? 90 : 365;
            const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

            const query = `
        SELECT 
          c.id,
          c.name,
          c.relationship_score,
          c.sentiment_trend,
          c.last_interaction,
          COUNT(comm.id) as communication_count,
          AVG(comm.sentiment) as avg_sentiment
        FROM clients c
        LEFT JOIN communications comm ON c.id = comm.client_id 
          AND comm.timestamp >= $1
        GROUP BY c.id, c.name, c.relationship_score, c.sentiment_trend, c.last_interaction
        ORDER BY c.relationship_score DESC
        LIMIT $2
      `;

            const result = await db.query(query, [startDate, limitNum]);

            const trends = result.rows.map(row => ({
                clientId: row.id,
                clientName: row.name,
                healthScore: row.relationship_score || 50,
                sentimentTrend: row.sentiment_trend || 'neutral',
                lastInteraction: row.last_interaction,
                communicationCount: parseInt(row.communication_count) || 0,
                averageSentiment: parseFloat(row.avg_sentiment) || 0
            }));

            res.json({
                success: true,
                data: {
                    trends,
                    timeframe,
                    totalClients: trends.length
                }
            });

        } catch (error) {
            logger.error('Error getting health trends:', error);
            res.status(500).json({
                error: 'Failed to get health trends',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    return router;
}