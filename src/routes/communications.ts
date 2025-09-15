import { Router, Request, Response } from 'express';
import { CommunicationCenterService, CommunicationSearchQuery } from '../services/communication/communicationCenterService';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../utils/logger';
import Joi from 'joi';

const router = Router();

// Validation schemas
const searchQuerySchema = Joi.object({
  clientId: Joi.string().uuid().optional(),
  type: Joi.string().valid('email', 'call', 'sms').optional(),
  direction: Joi.string().valid('inbound', 'outbound').optional(),
  from: Joi.string().optional(),
  to: Joi.string().optional(),
  subject: Joi.string().optional(),
  content: Joi.string().optional(),
  dateFrom: Joi.date().optional(),
  dateTo: Joi.date().optional(),
  tags: Joi.array().items(Joi.string()).optional(),
  isUrgent: Joi.boolean().optional(),
  isRead: Joi.boolean().optional(),
  limit: Joi.number().integer().min(1).max(100).default(20),
  offset: Joi.number().integer().min(0).default(0),
  sortBy: Joi.string().valid('timestamp', 'type', 'urgency').default('timestamp'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
});

const autoTagRuleSchema = Joi.object({
  name: Joi.string().max(255).required(),
  description: Joi.string().optional(),
  conditions: Joi.array().items(
    Joi.object({
      field: Joi.string().valid('from', 'to', 'subject', 'content', 'type', 'time').required(),
      operator: Joi.string().valid('contains', 'equals', 'starts_with', 'ends_with', 'regex', 'time_range').required(),
      value: Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string())).required(),
      caseSensitive: Joi.boolean().default(false),
    })
  ).min(1).required(),
  actions: Joi.array().items(
    Joi.object({
      type: Joi.string().valid('add_tag', 'set_urgent', 'set_read', 'assign_client').required(),
      value: Joi.alternatives().try(Joi.string(), Joi.boolean()).required(),
    })
  ).min(1).required(),
  isActive: Joi.boolean().default(true),
  priority: Joi.number().integer().min(0).default(0),
});

// Initialize service (this would be injected in a real app)
let communicationService: CommunicationCenterService;

// Middleware to ensure service is initialized
const ensureService = (req: Request, res: Response, next: any): void => {
  if (!communicationService) {
    res.status(500).json({ error: 'Communication service not initialized' });
    return;
  }
  next();
};

// Get unified communications timeline
router.get('/timeline', authMiddleware, ensureService, async (req: Request, res: Response): Promise<void> => {
  try {
    const { error, value } = searchQuerySchema.validate(req.query);
    if (error) {
      res.status(400).json({ error: error.details[0].message });
      return;
    }

    const userId = (req as any).user.id;
    const query: CommunicationSearchQuery = {
      ...value,
      userId,
    };

    const result = await communicationService.getUnifiedCommunications(query);
    
    res.json({
      communications: result.communications,
      pagination: {
        total: result.total,
        limit: value.limit,
        offset: value.offset,
        hasMore: result.hasMore,
      },
    });
  } catch (error) {
    logger.error('Get communications timeline error:', error);
    res.status(500).json({ error: 'Failed to get communications timeline' });
  }
});

// Search communications with full-text search
router.get('/search', authMiddleware, ensureService, async (req: Request, res: Response): Promise<void> => {
  try {
    const { q: searchTerm, limit = 20, offset = 0 } = req.query;
    
    if (!searchTerm || typeof searchTerm !== 'string') {
      res.status(400).json({ error: 'Search term is required' });
      return;
    }

    const userId = (req as any).user.id;
    const communications = await communicationService.searchCommunications(searchTerm, {
      userId,
      limit: Math.min(parseInt(limit as string) || 20, 100),
      offset: parseInt(offset as string) || 0,
    });
    
    res.json({
      communications,
      searchTerm,
      count: communications.length,
    });
  } catch (error) {
    logger.error('Search communications error:', error);
    res.status(500).json({ error: 'Failed to search communications' });
  }
});

// Get auto-tag rules
router.get('/auto-tag-rules', authMiddleware, ensureService, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const rules = await communicationService.getAutoTagRules(userId);
    
    res.json(rules);
  } catch (error) {
    logger.error('Get auto-tag rules error:', error);
    res.status(500).json({ error: 'Failed to get auto-tag rules' });
  }
});

// Create auto-tag rule
router.post('/auto-tag-rules', authMiddleware, ensureService, async (req: Request, res: Response): Promise<void> => {
  try {
    const { error, value } = autoTagRuleSchema.validate(req.body);
    if (error) {
      res.status(400).json({ error: error.details[0].message });
      return;
    }

    const userId = (req as any).user.id;
    const rule = await communicationService.createAutoTagRule(userId, value);
    
    res.status(201).json(rule);
  } catch (error) {
    logger.error('Create auto-tag rule error:', error);
    res.status(500).json({ error: 'Failed to create auto-tag rule' });
  }
});

// Get communication statistics
router.get('/stats', authMiddleware, ensureService, async (req: Request, res: Response) => {
  try {
    const { days = 30 } = req.query;
    const daysCount = Math.min(parseInt(days as string) || 30, 365);
    
    // This would be implemented in the service
    // For now, return mock data
    const stats = {
      totalCommunications: 0,
      byType: {
        email: 0,
        call: 0,
        sms: 0,
      },
      byDirection: {
        inbound: 0,
        outbound: 0,
      },
      urgentCount: 0,
      unreadCount: 0,
      averageSentiment: 0,
      dailyStats: [],
    };
    
    res.json(stats);
  } catch (error) {
    logger.error('Get communication stats error:', error);
    res.status(500).json({ error: 'Failed to get communication statistics' });
  }
});

// Mark communication as read
router.patch('/communications/:id/read', authMiddleware, ensureService, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { isRead = true } = req.body;
    
    // This would be implemented in the service to update the specific communication
    // For now, just return success
    
    res.json({ success: true, id, isRead });
  } catch (error) {
    logger.error('Mark communication as read error:', error);
    res.status(500).json({ error: 'Failed to update communication' });
  }
});

// Add tags to communication
router.patch('/communications/:id/tags', authMiddleware, ensureService, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { tags, action = 'add' } = req.body;
    
    if (!Array.isArray(tags)) {
      res.status(400).json({ error: 'Tags must be an array' });
      return;
    }
    
    // This would be implemented in the service to update tags
    // For now, just return success
    
    res.json({ success: true, id, tags, action });
  } catch (error) {
    logger.error('Update communication tags error:', error);
    res.status(500).json({ error: 'Failed to update communication tags' });
  }
});

// Get communication by ID with full details
router.get('/communications/:id', authMiddleware, ensureService, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.id;
    
    // This would be implemented in the service to get full communication details
    // For now, return mock data
    
    res.json({
      id,
      message: 'Communication details would be returned here',
    });
  } catch (error) {
    logger.error('Get communication details error:', error);
    res.status(500).json({ error: 'Failed to get communication details' });
  }
});

// Initialize service function (to be called from main app)
export const initializeCommunicationService = (
  communicationCenterService: CommunicationCenterService
) => {
  communicationService = communicationCenterService;
};

export default router;