import { Router, Request, Response } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth';
import { 
  encryptionService, 
  keyManagementService, 
  sensitiveDataService 
} from '../services/security';
import { logger } from '../utils/logger';

const router = Router();

/**
 * GET /api/security/status
 * Get overall security status (admin only)
 */
router.get('/status', authenticateToken, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const encryptionStatus = encryptionService.getStatus();
    const keyManagementStatus = keyManagementService.getStatus();
    const keyIntegrity = await keyManagementService.validateKeysIntegrity();

    res.json({
      encryption: encryptionStatus,
      keyManagement: keyManagementStatus,
      keyIntegrity,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error fetching security status:', error);
    res.status(500).json({ error: 'Failed to fetch security status' });
  }
});

/**
 * POST /api/security/keys/rotate
 * Manually trigger key rotation (admin only)
 */
router.post('/keys/rotate', authenticateToken, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { emergency, reason } = req.body;
    const userId = (req as any).user?.id;

    let rotationEvent;
    if (emergency && reason) {
      rotationEvent = await keyManagementService.emergencyRotation(reason);
      logger.warn('Emergency key rotation triggered', { userId, reason });
    } else {
      rotationEvent = await keyManagementService.rotateKeys('manual');
      logger.info('Manual key rotation triggered', { userId });
    }

    res.json({
      message: 'Key rotation completed successfully',
      event: rotationEvent
    });
  } catch (error) {
    logger.error('Key rotation failed:', error);
    res.status(500).json({ 
      error: 'Key rotation failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/security/keys/history
 * Get key rotation history (admin only)
 */
router.get('/keys/history', authenticateToken, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { limit } = req.query;
    const limitNum = limit ? parseInt(limit as string) : 50;
    
    const history = keyManagementService.getRotationHistory(limitNum);
    
    res.json({
      history,
      total: history.length
    });
  } catch (error) {
    logger.error('Error fetching key rotation history:', error);
    res.status(500).json({ error: 'Failed to fetch key rotation history' });
  }
});

/**
 * POST /api/security/keys/validate
 * Validate key integrity (admin only)
 */
router.post('/keys/validate', authenticateToken, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = await keyManagementService.validateKeysIntegrity();
    
    res.json(validation);
  } catch (error) {
    logger.error('Key validation failed:', error);
    res.status(500).json({ error: 'Key validation failed' });
  }
});

/**
 * PUT /api/security/keys/config
 * Update key management configuration (admin only)
 */
router.put('/keys/config', authenticateToken, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { enabled, schedule, notificationEmail } = req.body;
    const userId = (req as any).user?.id;

    // Validate schedule if provided
    if (schedule && typeof schedule !== 'string') {
      res.status(400).json({ error: 'Schedule must be a valid cron expression' });
      return;
    }

    const config = {
      ...(enabled !== undefined && { enabled }),
      ...(schedule && { schedule }),
      ...(notificationEmail && { notificationEmail })
    };

    keyManagementService.updateConfig(config);
    
    logger.info('Key management configuration updated', { userId, config });
    
    res.json({
      message: 'Configuration updated successfully',
      config: keyManagementService.getStatus()
    });
  } catch (error) {
    logger.error('Error updating key management configuration:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

/**
 * POST /api/security/data/classify
 * Classify text for sensitive data (authenticated users)
 */
router.post('/data/classify', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { text } = req.body;
    
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Text is required for classification' });
      return;
    }

    const classification = sensitiveDataService.classifyText(text);
    
    // Don't return the actual matches for security, just the classification
    res.json({
      hasSensitiveData: classification.hasSensitiveData,
      riskLevel: classification.riskLevel,
      matchCount: classification.matches.length,
      redactedText: classification.redactedText
    });
  } catch (error) {
    logger.error('Error classifying text:', error);
    res.status(500).json({ error: 'Failed to classify text' });
  }
});

/**
 * POST /api/security/data/sanitize
 * Sanitize text for logging (authenticated users)
 */
router.post('/data/sanitize', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { text } = req.body;
    
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Text is required for sanitization' });
      return;
    }

    const sanitized = sensitiveDataService.sanitizeForLogging(text);
    
    res.json({
      sanitizedText: sanitized
    });
  } catch (error) {
    logger.error('Error sanitizing text:', error);
    res.status(500).json({ error: 'Failed to sanitize text' });
  }
});

/**
 * GET /api/security/patterns
 * Get configured sensitive data patterns (admin only)
 */
router.get('/patterns', authenticateToken, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const patterns = sensitiveDataService.getPatterns();
    
    // Remove the actual regex patterns for security
    const safePatterns = patterns.map(pattern => ({
      name: pattern.name,
      riskLevel: pattern.riskLevel,
      description: pattern.description
    }));
    
    res.json({
      patterns: safePatterns,
      total: patterns.length
    });
  } catch (error) {
    logger.error('Error fetching sensitive data patterns:', error);
    res.status(500).json({ error: 'Failed to fetch patterns' });
  }
});

/**
 * POST /api/security/patterns
 * Add custom sensitive data pattern (admin only)
 */
router.post('/patterns', authenticateToken, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, pattern, riskLevel, description } = req.body;
    const userId = (req as any).user?.id;

    // Validate required fields
    if (!name || !pattern || !riskLevel || !description) {
      res.status(400).json({ 
        error: 'Name, pattern, riskLevel, and description are required' 
      });
      return;
    }

    // Validate risk level
    if (!['low', 'medium', 'high'].includes(riskLevel)) {
      res.status(400).json({ error: 'Risk level must be low, medium, or high' });
      return;
    }

    try {
      // Validate regex pattern
      new RegExp(pattern, 'g');
    } catch (regexError) {
      res.status(400).json({ error: 'Invalid regex pattern' });
      return;
    }

    const customPattern = {
      name,
      pattern: new RegExp(pattern, 'g'),
      riskLevel,
      description
    };

    sensitiveDataService.addCustomPattern(customPattern);
    
    logger.info('Custom sensitive data pattern added', { 
      userId, 
      patternName: name, 
      riskLevel 
    });
    
    res.status(201).json({
      message: 'Custom pattern added successfully',
      pattern: {
        name,
        riskLevel,
        description
      }
    });
  } catch (error) {
    logger.error('Error adding custom pattern:', error);
    res.status(500).json({ error: 'Failed to add custom pattern' });
  }
});

/**
 * GET /api/security/audit
 * Get security audit information (admin only)
 */
router.get('/audit', authenticateToken, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, limit } = req.query;
    
    // This would integrate with your audit logging system
    // For now, return basic security metrics
    const metrics = {
      keyRotations: keyManagementService.getRotationHistory(10),
      encryptionStatus: encryptionService.getStatus(),
      timestamp: new Date().toISOString(),
      period: {
        start: startDate || 'N/A',
        end: endDate || 'N/A'
      }
    };
    
    res.json(metrics);
  } catch (error) {
    logger.error('Error fetching security audit information:', error);
    res.status(500).json({ error: 'Failed to fetch audit information' });
  }
});

export default router;