// Monitoring Services Export
export { 
  loggingService, 
  correlationIdMiddleware, 
  requestLoggingMiddleware,
  type LogContext,
  type PerformanceMetrics
} from './loggingService';

export { 
  performanceDashboard,
  getDashboardData,
  getMetricsHistory,
  getAlerts,
  resolveAlert,
  type SystemMetrics,
  type ApplicationMetrics,
  type PerformanceAlert
} from './performanceDashboard';

export { 
  errorTrackingService,
  errorTrackingMiddleware,
  getErrorStats,
  getErrorDetails,
  resolveError,
  searchErrors,
  getUnresolvedErrors,
  type ErrorReport,
  type ErrorStats
} from './errorTrackingService';

export { 
  analyticsService,
  analyticsMiddleware,
  getUsageAnalytics,
  getSystemHealth,
  getActiveSessions,
  type UserSession,
  type UserAction,
  type UsageMetrics,
  type SystemHealth,
  type ComponentHealth
} from './analyticsService';

// Monitoring configuration
export const monitoringConfig = {
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    enableCloudWatch: process.env.NODE_ENV === 'production' && !!process.env.AWS_REGION,
    enableFileLogging: true,
    maxFileSize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5
  },
  performance: {
    metricsRetentionHours: 24,
    alertThresholds: {
      cpu: 80,
      memory: 85,
      responseTime: 2000,
      errorRate: 5
    }
  },
  errorTracking: {
    maxHistorySize: 10000,
    alertThresholds: {
      errorRate: 5,
      criticalErrors: 1,
      highErrors: 5,
      mediumErrors: 10
    }
  },
  analytics: {
    sessionTimeout: 30 * 60 * 1000, // 30 minutes
    enableUserTracking: true,
    enableFeatureTracking: true,
    enablePerformanceTracking: true
  }
};

// Initialize monitoring services
export const initializeMonitoring = () => {
  console.log('Initializing monitoring services...');
  
  // Services are initialized automatically when imported
  // This function can be used for any additional setup
  
  console.log('Monitoring services initialized successfully');
  console.log('- Logging service: ✓');
  console.log('- Performance dashboard: ✓');
  console.log('- Error tracking: ✓');
  console.log('- Analytics service: ✓');
};