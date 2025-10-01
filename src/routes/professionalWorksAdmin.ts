/**
 * Professional Works Admin Routes
 * Provides admin interface for managing PW rate limits and configuration
 */

import express from 'express';
import { ProfessionalWorksRateLimiter } from '../services/crm/professionalWorksRateLimiter';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authMiddleware);

/**
 * Get rate limiter status for a PW instance
 */
router.get('/rate-limit/status/:instanceId', async (req, res) => {
  try {
    const { instanceId } = req.params;
    
    const status = await ProfessionalWorksRateLimiter.getStatus(instanceId);
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('Failed to get PW rate limit status', { error, instanceId: req.params.instanceId });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Update rate limiter configuration
 */
router.put('/rate-limit/config/:instanceId', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const updates = req.body;
    
    // Validate updates
    const allowedFields = [
      'requestsPerMinute',
      'requestsPerHour', 
      'requestsPerDay',
      'burstLimit',
      'backoffMultiplier',
      'maxBackoffSeconds',
      'queueMaxSize'
    ];
    
    const validUpdates: any = {};
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key) && typeof value === 'number' && value > 0) {
        validUpdates[key] = value;
      }
    }
    
    if (Object.keys(validUpdates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid updates provided'
      });
    }
    
    await ProfessionalWorksRateLimiter.updateConfig(instanceId, validUpdates);
    
    // Get updated status
    const status = await ProfessionalWorksRateLimiter.getStatus(instanceId);
    
    logger.info('PW rate limit config updated', {
      instanceId,
      updates: validUpdates,
      updatedBy: req.user?.id
    });
    
    res.json({
      success: true,
      message: 'Rate limit configuration updated successfully',
      data: status
    });
  } catch (error) {
    logger.error('Failed to update PW rate limit config', { 
      error, 
      instanceId: req.params.instanceId,
      updates: req.body 
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get queue status for a PW instance
 */
router.get('/rate-limit/queue/:instanceId', async (req, res) => {
  try {
    const { instanceId } = req.params;
    
    const status = await ProfessionalWorksRateLimiter.getStatus(instanceId);
    
    res.json({
      success: true,
      data: {
        queueSize: status.queueSize,
        backoffUntil: status.backoffUntil,
        config: {
          queueMaxSize: status.config.queueMaxSize,
          maxBackoffSeconds: status.config.maxBackoffSeconds
        }
      }
    });
  } catch (error) {
    logger.error('Failed to get PW queue status', { error, instanceId: req.params.instanceId });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Process next request from queue (manual trigger)
 */
router.post('/rate-limit/queue/:instanceId/process', async (req, res) => {
  try {
    const { instanceId } = req.params;
    
    const nextRequest = await ProfessionalWorksRateLimiter.processQueue(instanceId);
    
    if (!nextRequest) {
      return res.json({
        success: true,
        message: 'No requests in queue or rate limit not available',
        data: null
      });
    }
    
    logger.info('Manually processed PW queue request', {
      instanceId,
      requestId: nextRequest.id,
      processedBy: req.user?.id
    });
    
    res.json({
      success: true,
      message: 'Request processed from queue',
      data: nextRequest
    });
  } catch (error) {
    logger.error('Failed to process PW queue', { error, instanceId: req.params.instanceId });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get rate limit metrics for monitoring
 */
router.get('/rate-limit/metrics/:instanceId', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const { timeframe = '1h' } = req.query;
    
    const status = await ProfessionalWorksRateLimiter.getStatus(instanceId);
    
    // Calculate utilization percentages
    const utilization = {
      minute: (status.currentCounts.minute / status.config.requestsPerMinute) * 100,
      hour: (status.currentCounts.hour / status.config.requestsPerHour) * 100,
      day: (status.currentCounts.day / status.config.requestsPerDay) * 100,
      burst: (status.currentCounts.burst / status.config.burstLimit) * 100
    };
    
    const metrics = {
      instanceId,
      timeframe,
      utilization,
      currentCounts: status.currentCounts,
      limits: {
        minute: status.config.requestsPerMinute,
        hour: status.config.requestsPerHour,
        day: status.config.requestsPerDay,
        burst: status.config.burstLimit
      },
      queueSize: status.queueSize,
      isBackedOff: status.backoffUntil ? Date.now() < status.backoffUntil : false,
      backoffUntil: status.backoffUntil,
      planTier: status.config.planTier
    };
    
    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    logger.error('Failed to get PW rate limit metrics', { error, instanceId: req.params.instanceId });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Reset rate limits (emergency use)
 */
router.post('/rate-limit/reset/:instanceId', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const { resetType = 'all' } = req.body;
    
    // This would require implementing a reset method in the rate limiter
    // For now, we'll just log the request
    logger.warn('PW rate limit reset requested', {
      instanceId,
      resetType,
      requestedBy: req.user?.id
    });
    
    res.json({
      success: true,
      message: 'Rate limit reset requested (implementation pending)',
      data: { instanceId, resetType }
    });
  } catch (error) {
    logger.error('Failed to reset PW rate limits', { error, instanceId: req.params.instanceId });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get all PW instances and their status
 */
router.get('/instances', async (req, res) => {
  try {
    // This would require implementing a method to list all instances
    // For now, return a placeholder response
    res.json({
      success: true,
      message: 'Instance listing not yet implemented',
      data: []
    });
  } catch (error) {
    logger.error('Failed to get PW instances', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Test rate limit check (for debugging)
 */
router.post('/rate-limit/test/:instanceId', async (req, res) => {
  try {
    const { instanceId } = req.params;
    const { priority = 'medium' } = req.body;
    
    const result = await ProfessionalWorksRateLimiter.checkRateLimit(
      instanceId,
      priority as 'high' | 'medium' | 'low'
    );
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Failed to test PW rate limit', { error, instanceId: req.params.instanceId });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;