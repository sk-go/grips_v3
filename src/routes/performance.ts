import { Router } from 'express';
import { performanceMonitor } from '../services/performance/performanceMonitor';
import { DatabaseOptimizer } from '../services/performance/databaseOptimizer';
import { autoScalingService } from '../services/performance/autoScalingService';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();
const dbOptimizer = new DatabaseOptimizer();

// Apply authentication to all performance routes
router.use(authMiddleware);

/**
 * Get current performance metrics
 */
router.get('/metrics', async (req, res) => {
  try {
    const summary = performanceMonitor.getPerformanceSummary();
    const recentMetrics = performanceMonitor.getRecentMetrics(20);
    
    res.json({
      success: true,
      data: {
        summary,
        recentMetrics,
        timestamp: new Date()
      }
    });
  } catch (error) {
    logger.error('Failed to get performance metrics', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve performance metrics'
    });
  }
});

/**
 * Get database performance analysis
 */
router.get('/database/analysis', async (req, res) => {
  try {
    const analysis = await dbOptimizer.analyzePerformance();
    const connectionPool = await dbOptimizer.monitorConnectionPool();
    const optimizations = dbOptimizer.getQueryOptimizations();
    
    res.json({
      success: true,
      data: {
        analysis,
        connectionPool,
        optimizations,
        timestamp: new Date()
      }
    });
  } catch (error) {
    logger.error('Failed to analyze database performance', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to analyze database performance'
    });
  }
});

/**
 * Apply database optimizations
 */
router.post('/database/optimize', async (req, res) => {
  try {
    const { applyIndexes = false, updateStats = true } = req.body;
    
    const results: any = {
      indexesApplied: [],
      statsUpdated: false,
      errors: []
    };

    if (updateStats) {
      try {
        await dbOptimizer.updateTableStatistics();
        results.statsUpdated = true;
        logger.info('Database statistics updated via API');
      } catch (error) {
        results.errors.push('Failed to update table statistics');
        logger.error('Failed to update table statistics via API', { error });
      }
    }

    if (applyIndexes) {
      try {
        const analysis = await dbOptimizer.analyzePerformance();
        const recommendations = analysis.indexRecommendations.filter(r => 
          r.estimatedImpact === 'high' || r.estimatedImpact === 'medium'
        );
        
        if (recommendations.length > 0) {
          await dbOptimizer.applyIndexRecommendations(recommendations);
          results.indexesApplied = recommendations.map(r => ({
            table: r.table,
            columns: r.columns,
            type: r.type,
            reason: r.reason
          }));
          logger.info('Database indexes applied via API', { count: recommendations.length });
        }
      } catch (error) {
        results.errors.push('Failed to apply index recommendations');
        logger.error('Failed to apply indexes via API', { error });
      }
    }

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    logger.error('Failed to optimize database', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to optimize database'
    });
  }
});

/**
 * Get auto-scaling status
 */
router.get('/scaling/status', async (req, res) => {
  try {
    const status = autoScalingService.getScalingStatus();
    const cloudConfig = autoScalingService.generateCloudConfig();
    
    res.json({
      success: true,
      data: {
        status,
        cloudConfig,
        timestamp: new Date()
      }
    });
  } catch (error) {
    logger.error('Failed to get scaling status', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve scaling status'
    });
  }
});

/**
 * Trigger scaling evaluation
 */
router.post('/scaling/evaluate', async (req, res) => {
  try {
    await autoScalingService.collectMetrics();
    const action = autoScalingService.evaluateScaling();
    
    let executed = false;
    if (action.type !== 'no_action') {
      executed = await autoScalingService.executeScaling(action);
    }
    
    res.json({
      success: true,
      data: {
        action,
        executed,
        timestamp: new Date()
      }
    });
  } catch (error) {
    logger.error('Failed to evaluate scaling', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to evaluate scaling'
    });
  }
});

/**
 * Get performance health check
 */
router.get('/health', async (req, res) => {
  try {
    const summary = performanceMonitor.getPerformanceSummary();
    const connectionPool = await dbOptimizer.monitorConnectionPool();
    const scalingStatus = autoScalingService.getScalingStatus();
    
    const health = {
      overall: 'healthy' as 'healthy' | 'warning' | 'critical',
      performance: {
        status: summary.alerts.length === 0 ? 'healthy' : 'warning',
        responseTime: summary.current?.responseTime || 0,
        memoryUsage: summary.current?.memoryUsage.heapUsed || 0,
        activeConnections: summary.current?.activeConnections || 0
      },
      database: {
        status: connectionPool.poolHealth,
        totalConnections: connectionPool.totalConnections,
        activeConnections: connectionPool.activeConnections,
        waitingConnections: connectionPool.waitingConnections
      },
      scaling: {
        currentInstances: scalingStatus.currentInstances,
        nextEvaluationIn: scalingStatus.nextEvaluationIn
      }
    };

    // Determine overall health
    if (health.performance.status === 'critical' || health.database.status === 'critical') {
      health.overall = 'critical';
    } else if (health.performance.status === 'warning' || health.database.status === 'warning') {
      health.overall = 'warning';
    }

    const statusCode = health.overall === 'healthy' ? 200 : 
                      health.overall === 'warning' ? 200 : 503;

    res.status(statusCode).json({
      success: true,
      data: health
    });
  } catch (error) {
    logger.error('Failed to get performance health', { error });
    res.status(503).json({
      success: false,
      error: 'Failed to retrieve performance health'
    });
  }
});

/**
 * Reset performance metrics
 */
router.post('/metrics/reset', async (req, res) => {
  try {
    performanceMonitor.reset();
    
    res.json({
      success: true,
      message: 'Performance metrics reset successfully'
    });
  } catch (error) {
    logger.error('Failed to reset performance metrics', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to reset performance metrics'
    });
  }
});

export default router;