import express from 'express';
import { CostTrackingService } from '../services/nlp/costTrackingService';
import { authenticateToken } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = express.Router();
const costTracker = new CostTrackingService();

// Get agent's cost statistics
router.get('/agent/:agentId/stats', authenticateToken, async (req, res) => {
  try {
    const { agentId } = req.params;
    const { days = '30' } = req.query;

    const stats = await costTracker.getCostStatistics(agentId, parseInt(days as string));

    res.json(stats);

  } catch (error: any) {
    logger.error('Failed to get agent cost stats', { error, agentId: req.params.agentId });
    res.status(500).json({ 
      error: 'Failed to get cost statistics',
      message: error.message 
    });
  }
});

// Get agent's daily cost summary
router.get('/agent/:agentId/daily', authenticateToken, async (req, res) => {
  try {
    const { agentId } = req.params;
    const { date } = req.query;

    const summary = await costTracker.getDailyCostSummary(agentId, date as string);

    if (!summary) {
      return res.status(404).json({ error: 'No cost data found for the specified date' });
    }

    res.json(summary);

  } catch (error: any) {
    logger.error('Failed to get daily cost summary', { error, agentId: req.params.agentId });
    res.status(500).json({ 
      error: 'Failed to get daily cost summary',
      message: error.message 
    });
  }
});

// Get agent's cost budget
router.get('/agent/:agentId/budget', authenticateToken, async (req, res) => {
  try {
    const { agentId } = req.params;

    const budget = await costTracker.getAgentCostBudget(agentId);

    res.json(budget);

  } catch (error: any) {
    logger.error('Failed to get agent cost budget', { error, agentId: req.params.agentId });
    res.status(500).json({ 
      error: 'Failed to get cost budget',
      message: error.message 
    });
  }
});

// Update agent's cost budget
router.put('/agent/:agentId/budget', authenticateToken, async (req, res) => {
  try {
    const { agentId } = req.params;
    const updates = req.body;

    // Validate updates
    const allowedFields = ['dailyBudget', 'monthlyBudget', 'costThresholdWarning', 'costThresholdApproval', 'budgetAlertsEnabled'];
    const validUpdates: any = {};

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        validUpdates[field] = updates[field];
      }
    }

    if (Object.keys(validUpdates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    await costTracker.updateAgentCostBudget(agentId, validUpdates);

    res.json({ success: true, message: 'Budget updated successfully' });

  } catch (error: any) {
    logger.error('Failed to update agent cost budget', { error, agentId: req.params.agentId });
    res.status(500).json({ 
      error: 'Failed to update cost budget',
      message: error.message 
    });
  }
});

// Check cost thresholds for a request
router.post('/agent/:agentId/check-thresholds', authenticateToken, async (req, res) => {
  try {
    const { agentId } = req.params;
    const { estimatedCost } = req.body;

    if (typeof estimatedCost !== 'number' || estimatedCost < 0) {
      return res.status(400).json({ error: 'Valid estimatedCost is required' });
    }

    const thresholdCheck = await costTracker.checkCostThresholds(agentId, estimatedCost);

    res.json(thresholdCheck);

  } catch (error: any) {
    logger.error('Failed to check cost thresholds', { error, agentId: req.params.agentId });
    res.status(500).json({ 
      error: 'Failed to check cost thresholds',
      message: error.message 
    });
  }
});

// Create cost approval request
router.post('/agent/:agentId/approval-request', authenticateToken, async (req, res) => {
  try {
    const { agentId } = req.params;
    const { estimatedCost, requestType, requestDescription } = req.body;

    if (typeof estimatedCost !== 'number' || estimatedCost < 0) {
      return res.status(400).json({ error: 'Valid estimatedCost is required' });
    }

    if (!requestType) {
      return res.status(400).json({ error: 'requestType is required' });
    }

    // Set expiration to 1 hour from now
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    const approvalId = await costTracker.createApprovalRequest({
      agentId,
      estimatedCost,
      requestType,
      requestDescription,
      expiresAt
    });

    res.json({ 
      success: true, 
      approvalId,
      message: 'Approval request created successfully',
      expiresAt
    });

  } catch (error: any) {
    logger.error('Failed to create approval request', { error, agentId: req.params.agentId });
    res.status(500).json({ 
      error: 'Failed to create approval request',
      message: error.message 
    });
  }
});

// Check approval status
router.get('/agent/:agentId/approval-status', authenticateToken, async (req, res) => {
  try {
    const { agentId } = req.params;
    const { estimatedCost } = req.query;

    if (!estimatedCost || isNaN(parseFloat(estimatedCost as string))) {
      return res.status(400).json({ error: 'Valid estimatedCost query parameter is required' });
    }

    const approval = await costTracker.checkApprovalStatus(agentId, parseFloat(estimatedCost as string));

    res.json({ approval });

  } catch (error: any) {
    logger.error('Failed to check approval status', { error, agentId: req.params.agentId });
    res.status(500).json({ 
      error: 'Failed to check approval status',
      message: error.message 
    });
  }
});

// Admin routes for cost management
router.get('/admin/stats', authenticateToken, async (req, res) => {
  try {
    // TODO: Add admin role check
    const { days = '30' } = req.query;

    // Get overall statistics across all agents
    // This would need to be implemented in the cost tracking service
    res.json({ 
      message: 'Admin cost statistics endpoint - implementation needed',
      days: parseInt(days as string)
    });

  } catch (error: any) {
    logger.error('Failed to get admin cost stats', error);
    res.status(500).json({ 
      error: 'Failed to get admin cost statistics',
      message: error.message 
    });
  }
});

// Clean up expired approval requests
router.post('/admin/cleanup-expired', authenticateToken, async (req, res) => {
  try {
    // TODO: Add admin role check
    const expiredCount = await costTracker.cleanupExpiredApprovals();

    res.json({ 
      success: true, 
      message: `Cleaned up ${expiredCount} expired approval requests`,
      expiredCount
    });

  } catch (error: any) {
    logger.error('Failed to cleanup expired approvals', error);
    res.status(500).json({ 
      error: 'Failed to cleanup expired approvals',
      message: error.message 
    });
  }
});

// Record AI request (internal use)
router.post('/record-request', authenticateToken, async (req, res) => {
  try {
    const requestData = req.body;

    // Validate required fields
    const requiredFields = ['agentId', 'requestType', 'modelUsed', 'cost', 'processingTime', 'success'];
    for (const field of requiredFields) {
      if (requestData[field] === undefined) {
        return res.status(400).json({ error: `${field} is required` });
      }
    }

    const requestId = await costTracker.recordAIRequest(requestData);

    res.json({ 
      success: true, 
      requestId,
      message: 'AI request recorded successfully'
    });

  } catch (error: any) {
    logger.error('Failed to record AI request', { error, requestData: req.body });
    res.status(500).json({ 
      error: 'Failed to record AI request',
      message: error.message 
    });
  }
});

export default router;