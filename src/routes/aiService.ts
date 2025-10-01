import express from 'express';
import { AIServiceMonitor } from '../services/nlp/aiServiceMonitor';
import { AIServiceDegradationHandler, DegradationConfig } from '../services/nlp/aiServiceDegradationHandler';
import { ClaudeApiClient } from '../services/nlp/claudeApiClient';
import { CostTrackingService } from '../services/nlp/costTrackingService';
import { authenticateToken } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = express.Router();

// Initialize AI service monitoring
let aiServiceMonitor: AIServiceMonitor;
let degradationHandler: AIServiceDegradationHandler;

export function initializeAIServiceMonitoring(claudeClient: ClaudeApiClient) {
  aiServiceMonitor = new AIServiceMonitor(claudeClient);
  
  const degradationConfig: DegradationConfig = {
    enableFallbacks: true,
    showManualOverrides: true,
    notifyOperationsTeam: true,
    operationsEmail: process.env.OPERATIONS_EMAIL,
    fallbackResponses: {
      'text_generation': 'AI text generation is temporarily unavailable. Please write your response manually or try again later.',
      'analysis': 'AI analysis is temporarily unavailable. Please review the content manually or try again later.',
      'summarization': 'AI summarization is temporarily unavailable. Please create a summary manually or try again later.',
      'sentiment_analysis': 'AI sentiment analysis is temporarily unavailable. Please assess sentiment manually or try again later.'
    }
  };

  degradationHandler = new AIServiceDegradationHandler(aiServiceMonitor, degradationConfig);

  // Start monitoring
  aiServiceMonitor.startMonitoring(60000); // Check every minute

  // Set up event handlers for notifications
  degradationHandler.on('operationsNotification', (notification) => {
    logger.warn('Operations team notification', notification);
    // In a real implementation, this would send emails, Slack messages, etc.
  });

  logger.info('AI service monitoring initialized');
}

// Get current AI service status
router.get('/status', authenticateToken, async (req, res) => {
  try {
    if (!degradationHandler) {
      return res.status(503).json({ 
        error: 'AI service monitoring not initialized' 
      });
    }

    const degradationState = degradationHandler.getDegradationState();
    res.json(degradationState);

  } catch (error: any) {
    logger.error('Failed to get AI service status', error);
    res.status(500).json({ 
      error: 'Failed to get service status',
      message: error.message 
    });
  }
});

// Force a health check
router.post('/health-check', authenticateToken, async (req, res) => {
  try {
    if (!aiServiceMonitor) {
      return res.status(503).json({ 
        error: 'AI service monitoring not initialized' 
      });
    }

    const status = await aiServiceMonitor.forceHealthCheck();
    res.json({ 
      success: true, 
      status,
      message: 'Health check completed'
    });

  } catch (error: any) {
    logger.error('Failed to perform health check', error);
    res.status(500).json({ 
      error: 'Failed to perform health check',
      message: error.message 
    });
  }
});

// Get uptime statistics
router.get('/uptime', authenticateToken, async (req, res) => {
  try {
    if (!aiServiceMonitor) {
      return res.status(503).json({ 
        error: 'AI service monitoring not initialized' 
      });
    }

    const uptimeStats = aiServiceMonitor.getUptimeStats();
    res.json(uptimeStats);

  } catch (error: any) {
    logger.error('Failed to get uptime statistics', error);
    res.status(500).json({ 
      error: 'Failed to get uptime statistics',
      message: error.message 
    });
  }
});

// Handle AI request with degradation fallbacks
router.post('/request', authenticateToken, async (req, res) => {
  try {
    if (!degradationHandler) {
      return res.status(503).json({ 
        error: 'AI service monitoring not initialized' 
      });
    }

    const request = req.body;
    const result = await degradationHandler.handleAIRequest(request);

    if (result.success) {
      res.json(result);
    } else if (result.manualOverrideRequired) {
      res.status(202).json({
        ...result,
        message: 'AI service unavailable. Manual override created.',
        overrideId: result.overrideId
      });
    } else {
      res.status(503).json({
        ...result,
        message: 'AI service unavailable and no fallback available.'
      });
    }

  } catch (error: any) {
    logger.error('Failed to handle AI request', error);
    res.status(500).json({ 
      error: 'Failed to handle AI request',
      message: error.message 
    });
  }
});

// Get manual overrides
router.get('/manual-overrides', authenticateToken, async (req, res) => {
  try {
    if (!degradationHandler) {
      return res.status(503).json({ 
        error: 'AI service monitoring not initialized' 
      });
    }

    const { status } = req.query;
    const overrides = degradationHandler.getManualOverrides(status as any);
    
    res.json({ overrides });

  } catch (error: any) {
    logger.error('Failed to get manual overrides', error);
    res.status(500).json({ 
      error: 'Failed to get manual overrides',
      message: error.message 
    });
  }
});

// Get specific manual override
router.get('/manual-overrides/:overrideId', authenticateToken, async (req, res) => {
  try {
    if (!degradationHandler) {
      return res.status(503).json({ 
        error: 'AI service monitoring not initialized' 
      });
    }

    const { overrideId } = req.params;
    const override = degradationHandler.getManualOverride(overrideId);

    if (!override) {
      return res.status(404).json({ error: 'Manual override not found' });
    }

    res.json({ override });

  } catch (error: any) {
    logger.error('Failed to get manual override', error);
    res.status(500).json({ 
      error: 'Failed to get manual override',
      message: error.message 
    });
  }
});

// Complete manual override
router.post('/manual-overrides/:overrideId/complete', authenticateToken, async (req, res) => {
  try {
    if (!degradationHandler) {
      return res.status(503).json({ 
        error: 'AI service monitoring not initialized' 
      });
    }

    const { overrideId } = req.params;
    const { response } = req.body;

    if (!response) {
      return res.status(400).json({ error: 'Response is required' });
    }

    const success = degradationHandler.completeManualOverride(overrideId, response);

    if (success) {
      res.json({ 
        success: true, 
        message: 'Manual override completed successfully' 
      });
    } else {
      res.status(404).json({ 
        error: 'Manual override not found or already completed' 
      });
    }

  } catch (error: any) {
    logger.error('Failed to complete manual override', error);
    res.status(500).json({ 
      error: 'Failed to complete manual override',
      message: error.message 
    });
  }
});

// Cancel manual override
router.post('/manual-overrides/:overrideId/cancel', authenticateToken, async (req, res) => {
  try {
    if (!degradationHandler) {
      return res.status(503).json({ 
        error: 'AI service monitoring not initialized' 
      });
    }

    const { overrideId } = req.params;
    const success = degradationHandler.cancelManualOverride(overrideId);

    if (success) {
      res.json({ 
        success: true, 
        message: 'Manual override cancelled successfully' 
      });
    } else {
      res.status(404).json({ 
        error: 'Manual override not found or already completed' 
      });
    }

  } catch (error: any) {
    logger.error('Failed to cancel manual override', error);
    res.status(500).json({ 
      error: 'Failed to cancel manual override',
      message: error.message 
    });
  }
});

// Update degradation configuration (admin only)
router.put('/config', authenticateToken, async (req, res) => {
  try {
    // TODO: Add admin role check
    if (!degradationHandler) {
      return res.status(503).json({ 
        error: 'AI service monitoring not initialized' 
      });
    }

    const updates = req.body;
    degradationHandler.updateConfig(updates);

    res.json({ 
      success: true, 
      message: 'Configuration updated successfully' 
    });

  } catch (error: any) {
    logger.error('Failed to update configuration', error);
    res.status(500).json({ 
      error: 'Failed to update configuration',
      message: error.message 
    });
  }
});

// Reset failure count (admin only)
router.post('/reset-failures', authenticateToken, async (req, res) => {
  try {
    // TODO: Add admin role check
    if (!aiServiceMonitor) {
      return res.status(503).json({ 
        error: 'AI service monitoring not initialized' 
      });
    }

    aiServiceMonitor.resetFailureCount();

    res.json({ 
      success: true, 
      message: 'Failure count reset successfully' 
    });

  } catch (error: any) {
    logger.error('Failed to reset failure count', error);
    res.status(500).json({ 
      error: 'Failed to reset failure count',
      message: error.message 
    });
  }
});

// Cleanup old manual overrides
router.post('/cleanup-overrides', authenticateToken, async (req, res) => {
  try {
    // TODO: Add admin role check
    if (!degradationHandler) {
      return res.status(503).json({ 
        error: 'AI service monitoring not initialized' 
      });
    }

    const { maxAgeHours = 24 } = req.body;
    const cleanedCount = degradationHandler.cleanupOldOverrides(maxAgeHours);

    res.json({ 
      success: true, 
      message: `Cleaned up ${cleanedCount} old manual overrides`,
      cleanedCount
    });

  } catch (error: any) {
    logger.error('Failed to cleanup old overrides', error);
    res.status(500).json({ 
      error: 'Failed to cleanup old overrides',
      message: error.message 
    });
  }
});

export { initializeAIServiceMonitoring };
export default router;