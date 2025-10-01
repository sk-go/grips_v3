import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { 
  getDashboardData, 
  getMetricsHistory, 
  getAlerts, 
  resolveAlert 
} from '../services/monitoring/performanceDashboard';
import {
  getErrorStats,
  getErrorDetails,
  resolveError,
  searchErrors,
  getUnresolvedErrors
} from '../services/monitoring/errorTrackingService';
import {
  getUsageAnalytics,
  getSystemHealth,
  getActiveSessions
} from '../services/monitoring/analyticsService';
import { loggingService } from '../services/monitoring/loggingService';

const router = Router();

// Apply authentication middleware to all monitoring routes
router.use(authMiddleware);

// Performance Dashboard Routes
router.get('/dashboard', getDashboardData);
router.get('/metrics', getMetricsHistory);
router.get('/alerts', getAlerts);
router.post('/alerts/:alertId/resolve', resolveAlert);

// Error Tracking Routes
router.get('/errors/stats', getErrorStats);
router.get('/errors/search', searchErrors);
router.get('/errors/unresolved', getUnresolvedErrors);
router.get('/errors/:fingerprint', getErrorDetails);
router.post('/errors/:fingerprint/resolve', resolveError);

// Analytics Routes
router.get('/analytics/usage', getUsageAnalytics);
router.get('/analytics/health', getSystemHealth);
router.get('/analytics/sessions', getActiveSessions);

// Health Check Route (public)
router.get('/health', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development'
    };

    loggingService.info('Health check requested', {
      component: 'monitoring',
      action: 'health_check',
      metadata: health
    });

    res.json(health);
  } catch (error) {
    loggingService.error('Health check failed', error as Error, {
      component: 'monitoring',
      action: 'health_check_error'
    });

    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date(),
      error: 'Health check failed'
    });
  }
});

// Logs Route (admin only)
router.get('/logs', async (req, res) => {
  try {
    // This would require admin permissions in a real implementation
    const level = req.query.level as string || 'info';
    const hours = parseInt(req.query.hours as string) || 1;
    const component = req.query.component as string;
    
    // In a real implementation, you would query your log storage
    // For now, return a mock response
    const logs = {
      level,
      hours,
      component,
      entries: [
        {
          timestamp: new Date(),
          level: 'info',
          message: 'Sample log entry',
          component: 'api',
          correlationId: 'sample-correlation-id'
        }
      ]
    };

    loggingService.info('Logs requested', {
      component: 'monitoring',
      action: 'logs_request',
      metadata: { level, hours, component }
    });

    res.json(logs);
  } catch (error) {
    loggingService.error('Failed to retrieve logs', error as Error, {
      component: 'monitoring',
      action: 'logs_error'
    });

    res.status(500).json({ error: 'Failed to retrieve logs' });
  }
});

// System Information Route
router.get('/system', async (req, res) => {
  try {
    const systemInfo = {
      timestamp: new Date(),
      node: {
        version: process.version,
        platform: process.platform,
        arch: process.arch,
        uptime: process.uptime()
      },
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      environment: {
        nodeEnv: process.env.NODE_ENV,
        port: process.env.PORT,
        logLevel: process.env.LOG_LEVEL
      },
      application: {
        name: 'relationship-care-platform',
        version: process.env.npm_package_version || '1.0.0'
      }
    };

    loggingService.info('System information requested', {
      component: 'monitoring',
      action: 'system_info',
      metadata: systemInfo
    });

    res.json(systemInfo);
  } catch (error) {
    loggingService.error('Failed to get system information', error as Error, {
      component: 'monitoring',
      action: 'system_info_error'
    });

    res.status(500).json({ error: 'Failed to retrieve system information' });
  }
});

// Configuration Route
router.get('/config', async (req, res) => {
  try {
    // Return non-sensitive configuration information
    const config = {
      timestamp: new Date(),
      environment: process.env.NODE_ENV || 'development',
      features: {
        monitoring: true,
        errorTracking: true,
        analytics: true,
        logging: true
      },
      limits: {
        sessionTimeout: 30 * 60 * 1000, // 30 minutes
        maxHistorySize: 10000,
        metricsRetentionHours: 24
      },
      integrations: {
        cloudwatch: !!process.env.AWS_REGION,
        redis: !!process.env.REDIS_URL,
        database: !!process.env.SUPABASE_URL
      }
    };

    loggingService.info('Configuration requested', {
      component: 'monitoring',
      action: 'config_request',
      metadata: config
    });

    res.json(config);
  } catch (error) {
    loggingService.error('Failed to get configuration', error as Error, {
      component: 'monitoring',
      action: 'config_error'
    });

    res.status(500).json({ error: 'Failed to retrieve configuration' });
  }
});

// Test Route for generating sample data
router.post('/test/generate-data', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Test endpoints not available in production' });
    }

    const { type, count = 10 } = req.body;

    switch (type) {
      case 'errors':
        // Generate sample errors
        for (let i = 0; i < count; i++) {
          const error = new Error(`Sample error ${i + 1}`);
          error.name = i % 2 === 0 ? 'ValidationError' : 'DatabaseError';
          
          // This would use the error tracking service
          loggingService.error(`Generated sample error ${i + 1}`, error, {
            component: 'test',
            action: 'generate_error'
          });
        }
        break;

      case 'metrics':
        // Generate sample metrics
        loggingService.info('Generated sample metrics', {
          component: 'test',
          action: 'generate_metrics',
          metadata: { count }
        });
        break;

      default:
        return res.status(400).json({ error: 'Invalid test data type' });
    }

    res.json({ success: true, message: `Generated ${count} sample ${type}` });
  } catch (error) {
    loggingService.error('Failed to generate test data', error as Error, {
      component: 'monitoring',
      action: 'test_data_error'
    });

    res.status(500).json({ error: 'Failed to generate test data' });
  }
});

export default router;