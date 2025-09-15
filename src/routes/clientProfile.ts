/**
 * Client Profile API Routes
 * Handles client profile enhancement, CRM data fetching, and relationship visualization
 */

import { Router, Request, Response } from 'express';
import {
    ClientProfileService,
    RelationshipVisualizationService,
    CrmDataFetchingService
} from '../services/clientProfile';
import { CrmSyncService } from '../services/crm/crmSyncService';
import { authenticateToken } from '../middleware/auth';
import { logger } from '../utils/logger';
import { RedisAdapter } from './clientProfile/redisAdapter';

import { Pool } from 'pg';

export function createClientProfileRoutes(db: Pool, redisService: typeof import('../services/redis').RedisService): Router {
    const router = Router();

    // Initialize Redis adapter
    const redisAdapter = new RedisAdapter();

    // Initialize services
    const crmSyncService = CrmSyncService.getInstance();
    const clientProfileService = new ClientProfileService(db, redisAdapter as any, crmSyncService);
    const relationshipVisualizationService = new RelationshipVisualizationService(db, redisAdapter as any);
    const crmDataFetchingService = new CrmDataFetchingService(db, redisAdapter as any, crmSyncService);

    // Apply authentication to all routes
    router.use(authenticateToken);

    /**
     * GET /api/clients/:clientId/profile
     * Get enhanced client profile with CRM overlay
     */
    router.get('/:clientId/profile', async (req: Request, res: Response): Promise<void> => {
        try {
            const { clientId } = req.params;
            const { forceSync } = req.query;

            const profileData = await clientProfileService.getClientProfile(
                clientId,
                forceSync === 'true'
            );

            if (!profileData) {
                res.status(404).json({ error: 'Client not found' });
                return;
            }

            res.json({
                success: true,
                data: profileData
            });

        } catch (error) {
            logger.error('Error getting client profile:', error);
            res.status(500).json({
                error: 'Failed to get client profile',
                details: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    /**
     * GET /api/clients/:clientId/relationship-graph
     * Get relationship graph data for D3.js visualization
     */
    router.get('/:clientId/relationship-graph', async (req: Request, res: Response): Promise<void> => {
        try {
            const { clientId } = req.params;
            const {
                maxDepth = '2',
                includeFamily = 'true',
                includeBusiness = 'true'
            } = req.query;

            const graphData = await relationshipVisualizationService.generateRelationshipGraph(
                clientId,
                parseInt(maxDepth as string),
                includeFamily === 'true',
                includeBusiness === 'true'
            );

            res.json({
                success: true,
                data: graphData
            });

        } catch (error) {
            logger.error('Error generating relationship graph:', error);
            res.status(500).json({
                error: 'Failed to generate relationship graph',
                details: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    /**
     * GET /api/clients/:clientId/graph-config
     * Get default D3.js layout configuration
     */
    router.get('/:clientId/graph-config', async (req: Request, res: Response): Promise<void> => {
        try {
            const config = relationshipVisualizationService.getDefaultLayoutConfig();

            res.json({
                success: true,
                data: config
            });

        } catch (error) {
            logger.error('Error getting graph config:', error);
            res.status(500).json({
                error: 'Failed to get graph configuration',
                details: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    /**
     * GET /api/clients/search
     * Search clients by name, email, or phone
     */
    router.get('/search', async (req: Request, res: Response): Promise<void> => {
        try {
            const { q: query, limit = '20' } = req.query;

            if (!query || typeof query !== 'string') {
                res.status(400).json({ error: 'Search query is required' });
                return;
            }

            const clients = await clientProfileService.searchClients(
                query,
                parseInt(limit as string)
            );

            res.json({
                success: true,
                data: clients
            });

        } catch (error) {
            logger.error('Error searching clients:', error);
            res.status(500).json({
                error: 'Failed to search clients',
                details: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    /**
     * GET /api/clients/crm-status
     * Get CRM connection status for all systems
     */
    router.get('/crm-status', async (req: Request, res: Response): Promise<void> => {
        try {
            const statuses = await crmDataFetchingService.getCrmConnectionStatus();

            res.json({
                success: true,
                data: statuses
            });

        } catch (error) {
            logger.error('Error getting CRM status:', error);
            res.status(500).json({
                error: 'Failed to get CRM status',
                details: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    return router;
}