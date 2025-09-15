/**
 * Proactive Relationship Management Routes
 * API endpoints for meeting briefs, opportunities, and stale relationship detection
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { ProactiveRelationshipService } from '../services/clientProfile/proactiveRelationshipService';
import { ClientProfileService } from '../services/clientProfile/clientProfileService';
import { CrmSyncService } from '../services/crm/crmSyncService';
import { authenticateToken } from '../middleware/auth';
import { logger } from '../utils/logger';

export function createProactiveRelationshipRoutes(db: Pool, redis: Redis): Router {
  const router = Router();
  
  // Initialize services
  const crmSyncService = CrmSyncService.getInstance();
  const clientProfileService = new ClientProfileService(db, redis, crmSyncService);
  
  // Create a simple NLP service mock for now
  const mockNlpService = {
    extractKeyTopics: async (text: string) => ['policy', 'insurance', 'coverage'],
    generateSummary: async (prompt: string) => 'AI-generated summary of client interaction'
  } as any;
  
  const proactiveService = new ProactiveRelationshipService(
    db, 
    redis, 
    clientProfileService, 
    mockNlpService
  );

  // Apply authentication to all routes
  router.use(authenticateToken);

  /**
   * Generate meeting brief for a client
   * POST /api/proactive/meeting-brief/:clientId
   */
  router.post('/meeting-brief/:clientId', async (req: Request, res: Response) => {
    try {
      const { clientId } = req.params;
      
      if (!clientId) {
        return res.status(400).json({ 
          error: 'Client ID is required' 
        });
      }

      const meetingBrief = await proactiveService.generateMeetingBrief(clientId);
      
      return res.json({
        success: true,
        data: meetingBrief
      });

    } catch (error) {
      logger.error('Error generating meeting brief:', error);
      return res.status(500).json({ 
        error: 'Failed to generate meeting brief',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Get upcoming opportunities
   * GET /api/proactive/opportunities
   * Query params: clientId (optional), daysAhead (optional, default 30)
   */
  router.get('/opportunities', async (req: Request, res: Response) => {
    try {
      const { clientId, daysAhead } = req.query;
      const days = daysAhead ? parseInt(daysAhead as string) : 30;

      const opportunities = await proactiveService.getUpcomingOpportunities(
        clientId as string, 
        days
      );
      
      res.json({
        success: true,
        data: opportunities,
        count: opportunities.length
      });

    } catch (error) {
      logger.error('Error getting opportunities:', error);
      res.status(500).json({ 
        error: 'Failed to get opportunities',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Detect stale relationships
   * GET /api/proactive/stale-relationships
   * Query params: thresholdDays (optional, default 180)
   */
  router.get('/stale-relationships', async (req: Request, res: Response) => {
    try {
      const { thresholdDays } = req.query;
      const threshold = thresholdDays ? parseInt(thresholdDays as string) : 180;

      const staleRelationships = await proactiveService.detectStaleRelationships(threshold);
      
      res.json({
        success: true,
        data: staleRelationships,
        count: staleRelationships.length
      });

    } catch (error) {
      logger.error('Error detecting stale relationships:', error);
      res.status(500).json({ 
        error: 'Failed to detect stale relationships',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Generate re-engagement suggestions for a client
   * POST /api/proactive/re-engagement/:clientId
   */
  router.post('/re-engagement/:clientId', async (req: Request, res: Response) => {
    try {
      const { clientId } = req.params;
      
      if (!clientId) {
        return res.status(400).json({ 
          error: 'Client ID is required' 
        });
      }

      const suggestions = await proactiveService.generateReEngagementSuggestions(clientId);
      
      return res.json({
        success: true,
        data: suggestions,
        count: suggestions.length
      });

    } catch (error) {
      logger.error('Error generating re-engagement suggestions:', error);
      return res.status(500).json({ 
        error: 'Failed to generate re-engagement suggestions',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Get proactive opportunities dashboard
   * GET /api/proactive/dashboard
   */
  router.get('/dashboard', async (req: Request, res: Response) => {
    try {
      const dashboard = await proactiveService.getProactiveOpportunitiesDashboard();
      
      res.json({
        success: true,
        data: dashboard
      });

    } catch (error) {
      logger.error('Error getting proactive dashboard:', error);
      res.status(500).json({ 
        error: 'Failed to get proactive dashboard',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Get meeting brief from cache
   * GET /api/proactive/meeting-brief/:clientId
   */
  router.get('/meeting-brief/:clientId', async (req: Request, res: Response) => {
    try {
      const { clientId } = req.params;
      
      if (!clientId) {
        return res.status(400).json({ 
          error: 'Client ID is required' 
        });
      }

      // Check cache first
      const cacheKey = `meeting_brief:${clientId}`;
      const cached = await redis.get(cacheKey);
      
      if (cached) {
        const meetingBrief = JSON.parse(cached);
        return res.json({
          success: true,
          data: meetingBrief,
          cached: true
        });
      }

      // If not cached, generate new brief
      const meetingBrief = await proactiveService.generateMeetingBrief(clientId);
      
      return res.json({
        success: true,
        data: meetingBrief,
        cached: false
      });

    } catch (error) {
      logger.error('Error getting meeting brief:', error);
      return res.status(500).json({ 
        error: 'Failed to get meeting brief',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Mark opportunity as completed
   * PUT /api/proactive/opportunities/:opportunityId/complete
   */
  router.put('/opportunities/:opportunityId/complete', async (req: Request, res: Response) => {
    try {
      const { opportunityId } = req.params;
      const { notes } = req.body;

      // Extract type and ID from opportunity ID (format: type_id)
      const [type, id] = opportunityId.split('_');

      if (type === 'followup') {
        // Update task status
        await db.query(
          'UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2',
          ['completed', id]
        );
      }

      // Log the completion
      logger.info(`Opportunity completed: ${opportunityId}`, { notes });

      res.json({
        success: true,
        message: 'Opportunity marked as completed'
      });

    } catch (error) {
      logger.error('Error completing opportunity:', error);
      res.status(500).json({ 
        error: 'Failed to complete opportunity',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Snooze opportunity for later
   * PUT /api/proactive/opportunities/:opportunityId/snooze
   */
  router.put('/opportunities/:opportunityId/snooze', async (req: Request, res: Response) => {
    try {
      const { opportunityId } = req.params;
      const { days = 7 } = req.body;

      // Extract type and ID from opportunity ID
      const [type, id] = opportunityId.split('_');

      if (type === 'followup') {
        // Update task due date
        const newDueDate = new Date();
        newDueDate.setDate(newDueDate.getDate() + days);
        
        await db.query(
          'UPDATE tasks SET due_date = $1, updated_at = NOW() WHERE id = $2',
          [newDueDate, id]
        );
      }

      logger.info(`Opportunity snoozed: ${opportunityId} for ${days} days`);

      res.json({
        success: true,
        message: `Opportunity snoozed for ${days} days`
      });

    } catch (error) {
      logger.error('Error snoozing opportunity:', error);
      res.status(500).json({ 
        error: 'Failed to snooze opportunity',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  return router;
}