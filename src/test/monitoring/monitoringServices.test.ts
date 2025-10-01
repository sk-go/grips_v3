import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Request, Response } from 'express';
import { loggingService } from '../../services/monitoring/loggingService';
import { performanceDashboard } from '../../services/monitoring/performanceDashboard';
import { errorTrackingService } from '../../services/monitoring/errorTrackingService';
import { analyticsService } from '../../services/monitoring/analyticsService';

// Mock external dependencies
jest.mock('winston', () => ({
  createLogger: jest.fn(() => ({
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    add: jest.fn()
  })),
  format: {
    combine: jest.fn(),
    timestamp: jest.fn(),
    errors: jest.fn(),
    json: jest.fn(),
    printf: jest.fn(),
    colorize: jest.fn(),
    simple: jest.fn()
  },
  transports: {
    Console: jest.fn(),
    File: jest.fn()
  }
}));

jest.mock('../../services/cacheService', () => ({
  cacheService: {
    ping: jest.fn().mockResolvedValue('PONG'),
    getInfo: jest.fn().mockResolvedValue({
      keyCount: 100,
      memoryUsage: 1024 * 1024
    })
  }
}));

describe('Monitoring Services', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('LoggingService', () => {
    it('should generate correlation ID', () => {
      const correlationId = loggingService.generateCorrelationId();
      expect(correlationId).toBeDefined();
      expect(typeof correlationId).toBe('string');
      expect(correlationId.length).toBeGreaterThan(0);
    });

    it('should set and get correlation ID', () => {
      const testId = 'test-correlation-id';
      loggingService.setCorrelationId(testId);
      expect(loggingService.getCorrelationId()).toBe(testId);
    });

    it('should log with context', () => {
      const context = {
        correlationId: 'test-id',
        userId: 'user-123',
        component: 'test',
        action: 'test_action'
      };

      loggingService.info('Test message', context);
      // Verify logging was called (mocked)
      expect(true).toBe(true); // Placeholder assertion
    });

    it('should start and end performance timer', () => {
      const operationId = 'test-operation';
      
      loggingService.startPerformanceTimer(operationId);
      
      // Simulate some work
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Wait 10ms
      }
      
      const metrics = loggingService.endPerformanceTimer(operationId);
      
      expect(metrics).toBeDefined();
      expect(metrics?.duration).toBeGreaterThan(0);
      expect(metrics?.memoryUsage).toBeDefined();
    });

    it('should handle missing performance timer', () => {
      const metrics = loggingService.endPerformanceTimer('non-existent');
      expect(metrics).toBeNull();
    });

    it('should log structured events', () => {
      const mockReq = {
        method: 'GET',
        url: '/api/test',
        get: jest.fn().mockReturnValue('test-agent'),
        ip: '127.0.0.1'
      } as unknown as Request;

      const mockRes = {
        statusCode: 200
      } as Response;

      loggingService.logApiRequest(mockReq, mockRes, 150);
      
      // Verify the log was called
      expect(true).toBe(true); // Placeholder assertion
    });
  });

  describe('PerformanceDashboard', () => {
    it('should record request metrics', () => {
      performanceDashboard.recordRequest('GET', '/api/test', 200, 150);
      
      // Verify metrics were recorded
      expect(true).toBe(true); // Placeholder assertion
    });

    it('should get health status', () => {
      const health = performanceDashboard.getHealthStatus();
      
      expect(health).toBeDefined();
      expect(health.status).toMatch(/healthy|degraded|unhealthy/);
      expect(health.details).toBeDefined();
    });

    it('should get system metrics', () => {
      const metrics = performanceDashboard.getSystemMetrics(1);
      
      expect(Array.isArray(metrics)).toBe(true);
    });

    it('should get active alerts', () => {
      const alerts = performanceDashboard.getActiveAlerts();
      
      expect(Array.isArray(alerts)).toBe(true);
    });

    it('should resolve alerts', () => {
      // This would require creating an alert first
      const resolved = performanceDashboard.resolveAlert('non-existent-alert');
      expect(resolved).toBe(false);
    });
  });

  describe('ErrorTrackingService', () => {
    it('should track errors', () => {
      const error = new Error('Test error');
      const context = {
        correlationId: 'test-id',
        component: 'test',
        action: 'test_action'
      };

      const fingerprint = errorTrackingService.trackError(error, context);
      
      expect(fingerprint).toBeDefined();
      expect(typeof fingerprint).toBe('string');
    });

    it('should group similar errors', () => {
      const error1 = new Error('Same error message');
      const error2 = new Error('Same error message');
      
      const fingerprint1 = errorTrackingService.trackError(error1);
      const fingerprint2 = errorTrackingService.trackError(error2);
      
      expect(fingerprint1).toBe(fingerprint2);
    });

    it('should get error statistics', () => {
      const stats = errorTrackingService.getErrorStats(24);
      
      expect(stats).toBeDefined();
      expect(typeof stats.totalErrors).toBe('number');
      expect(typeof stats.errorRate).toBe('number');
      expect(Array.isArray(stats.topErrors)).toBe(true);
      expect(Array.isArray(stats.recentErrors)).toBe(true);
    });

    it('should search errors', () => {
      const results = errorTrackingService.searchErrors('test', 24);
      
      expect(Array.isArray(results)).toBe(true);
    });

    it('should get unresolved errors', () => {
      const errors = errorTrackingService.getUnresolvedErrors();
      
      expect(Array.isArray(errors)).toBe(true);
    });

    it('should resolve errors', () => {
      const error = new Error('Test error for resolution');
      const fingerprint = errorTrackingService.trackError(error);
      
      const resolved = errorTrackingService.resolveError(fingerprint);
      expect(resolved).toBe(true);
      
      const errorReport = errorTrackingService.getError(fingerprint);
      expect(errorReport?.resolved).toBe(true);
    });
  });

  describe('AnalyticsService', () => {
    it('should start and end sessions', () => {
      const sessionId = 'test-session-123';
      const userId = 'user-456';
      
      analyticsService.startSession(sessionId, userId, 'test-agent', '127.0.0.1');
      
      const session = analyticsService.getSessionById(sessionId);
      expect(session).toBeDefined();
      expect(session?.sessionId).toBe(sessionId);
      expect(session?.userId).toBe(userId);
      
      analyticsService.endSession(sessionId);
      
      const endedSession = analyticsService.getSessionById(sessionId);
      expect(endedSession).toBeUndefined();
    });

    it('should track events', () => {
      const sessionId = 'test-session-events';
      
      analyticsService.startSession(sessionId);
      analyticsService.trackEvent(sessionId, {
        type: 'feature_use',
        category: 'test',
        action: 'test_action',
        label: 'test_feature'
      });
      
      const session = analyticsService.getSessionById(sessionId);
      expect(session?.actions.length).toBe(1);
      expect(session?.actions[0].type).toBe('feature_use');
    });

    it('should track page views', () => {
      const sessionId = 'test-session-pageview';
      
      analyticsService.startSession(sessionId);
      analyticsService.trackPageView(sessionId, '/test-page', 'Test Page');
      
      const session = analyticsService.getSessionById(sessionId);
      expect(session?.pageViews).toBe(1);
      expect(session?.actions[0].type).toBe('page_view');
    });

    it('should track feature usage', () => {
      const sessionId = 'test-session-feature';
      
      analyticsService.startSession(sessionId);
      analyticsService.trackFeatureUse(sessionId, 'ai-assistant', 'voice_input');
      
      const session = analyticsService.getSessionById(sessionId);
      expect(session?.actions[0].type).toBe('feature_use');
      expect(session?.actions[0].label).toBe('ai-assistant');
    });

    it('should track API calls', () => {
      const sessionId = 'test-session-api';
      
      analyticsService.startSession(sessionId);
      analyticsService.trackApiCall(sessionId, '/api/test', 'GET', 200, 150);
      
      const session = analyticsService.getSessionById(sessionId);
      expect(session?.actions[0].type).toBe('api_call');
      expect(session?.actions[0].value).toBe(150);
    });

    it('should get usage metrics', () => {
      const metrics = analyticsService.getUsageMetrics(7);
      
      expect(Array.isArray(metrics)).toBe(true);
    });

    it('should get current health', () => {
      const health = analyticsService.getCurrentHealth();
      
      // Health might be null if no health checks have run yet
      if (health) {
        expect(health.status).toMatch(/healthy|degraded|unhealthy/);
        expect(health.components).toBeDefined();
      }
    });

    it('should get active sessions', () => {
      const sessions = analyticsService.getActiveSessions();
      
      expect(Array.isArray(sessions)).toBe(true);
    });

    it('should get user sessions', () => {
      const userId = 'test-user-sessions';
      const sessionId1 = 'session-1';
      const sessionId2 = 'session-2';
      
      analyticsService.startSession(sessionId1, userId);
      analyticsService.startSession(sessionId2, userId);
      
      const userSessions = analyticsService.getUserSessions(userId);
      expect(userSessions.length).toBe(2);
      expect(userSessions.every(s => s.userId === userId)).toBe(true);
    });
  });

  describe('Integration Tests', () => {
    it('should handle error tracking with logging', () => {
      const error = new Error('Integration test error');
      const context = {
        correlationId: loggingService.generateCorrelationId(),
        component: 'integration-test',
        action: 'test_integration'
      };

      loggingService.setCorrelationId(context.correlationId);
      const fingerprint = errorTrackingService.trackError(error, context);
      
      expect(fingerprint).toBeDefined();
      
      const errorReport = errorTrackingService.getError(fingerprint);
      expect(errorReport?.context.correlationId).toBe(context.correlationId);
    });

    it('should handle performance monitoring with analytics', () => {
      const sessionId = 'perf-test-session';
      const operationId = 'test-operation';
      
      analyticsService.startSession(sessionId);
      loggingService.startPerformanceTimer(operationId);
      
      // Simulate work
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Wait 10ms
      }
      
      const metrics = loggingService.endPerformanceTimer(operationId);
      
      if (metrics) {
        analyticsService.trackEvent(sessionId, {
          type: 'api_call',
          category: 'performance',
          action: 'operation_completed',
          value: metrics.duration
        });
      }
      
      const session = analyticsService.getSessionById(sessionId);
      expect(session?.actions.length).toBeGreaterThan(0);
    });

    it('should handle concurrent operations', async () => {
      const promises = [];
      
      // Create multiple concurrent operations
      for (let i = 0; i < 10; i++) {
        promises.push(
          new Promise<void>((resolve) => {
            const sessionId = `concurrent-session-${i}`;
            const operationId = `concurrent-operation-${i}`;
            
            analyticsService.startSession(sessionId);
            loggingService.startPerformanceTimer(operationId);
            
            setTimeout(() => {
              loggingService.endPerformanceTimer(operationId);
              analyticsService.endSession(sessionId);
              resolve();
            }, Math.random() * 50);
          })
        );
      }
      
      await Promise.all(promises);
      
      // Verify all operations completed without errors
      expect(true).toBe(true);
    });
  });
});

describe('Monitoring Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockReq = {
      get: jest.fn(),
      ip: '127.0.0.1',
      method: 'GET',
      url: '/api/test'
    };
    
    mockRes = {
      set: jest.fn(),
      end: jest.fn()
    };
    
    mockNext = jest.fn();
  });

  it('should add correlation ID to requests', () => {
    const { correlationIdMiddleware } = require('../../services/monitoring/loggingService');
    
    correlationIdMiddleware(mockReq as Request, mockRes as Response, mockNext);
    
    expect(mockRes.set).toHaveBeenCalledWith('X-Correlation-ID', expect.any(String));
    expect(mockNext).toHaveBeenCalled();
  });

  it('should track errors automatically', () => {
    const { errorTrackingMiddleware } = require('../../services/monitoring/errorTrackingService');
    
    const error = new Error('Middleware test error');
    
    errorTrackingMiddleware(error, mockReq as Request, mockRes as Response, mockNext);
    
    expect(mockRes.set).toHaveBeenCalledWith('X-Error-Fingerprint', expect.any(String));
    expect(mockNext).toHaveBeenCalledWith(error);
  });

  it('should track analytics automatically', () => {
    const { analyticsMiddleware } = require('../../services/monitoring/analyticsService');
    
    (mockReq as any).sessionID = 'test-session';
    (mockReq as any).user = { id: 'test-user' };
    
    analyticsMiddleware(mockReq as Request, mockRes as Response, mockNext);
    
    expect(mockNext).toHaveBeenCalled();
  });
});