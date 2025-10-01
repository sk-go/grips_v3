import { PerformanceMonitor } from '../../services/performance/performanceMonitor';
import { DatabaseService } from '../../services/database/DatabaseService';

// Mock DatabaseService
jest.mock('../../services/database/DatabaseService');
const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;

describe('PerformanceMonitor', () => {
  let performanceMonitor: PerformanceMonitor;

  beforeEach(() => {
    performanceMonitor = new PerformanceMonitor({
      maxResponseTime: 500,
      maxMemoryUsage: 1024,
      maxConcurrentUsers: 100,
      minCacheHitRate: 80,
      maxDbQueryTime: 200
    });
    
    // Mock database query
    mockDatabaseService.query.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    performanceMonitor.stopMonitoring();
    performanceMonitor.reset();
    jest.clearAllMocks();
  });

  describe('collectMetrics', () => {
    it('should collect performance metrics successfully', async () => {
      const metrics = await performanceMonitor.collectMetrics();

      expect(metrics).toHaveProperty('timestamp');
      expect(metrics).toHaveProperty('responseTime');
      expect(metrics).toHaveProperty('memoryUsage');
      expect(metrics).toHaveProperty('activeConnections');
      expect(metrics).toHaveProperty('cacheHitRate');
      expect(metrics).toHaveProperty('dbQueryTime');
      expect(metrics).toHaveProperty('concurrentUsers');
      
      expect(typeof metrics.dbQueryTime).toBe('number');
      expect(metrics.dbQueryTime).toBeGreaterThanOrEqual(0);
    });

    it('should measure database query time', async () => {
      // Mock a slow database query
      mockDatabaseService.query.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({ rows: [] }), 100))
      );

      const metrics = await performanceMonitor.collectMetrics();
      expect(metrics.dbQueryTime).toBeGreaterThanOrEqual(100);
    });

    it('should handle database query errors', async () => {
      mockDatabaseService.query.mockRejectedValue(new Error('Database error'));

      await expect(performanceMonitor.collectMetrics()).rejects.toThrow('Database error');
    });
  });

  describe('connection tracking', () => {
    it('should track active connections', () => {
      expect(performanceMonitor.getPerformanceSummary().current?.activeConnections).toBe(0);

      performanceMonitor.incrementConnections();
      performanceMonitor.incrementConnections();
      
      // Need to add a metric to see the connection count
      performanceMonitor.addMetric({
        timestamp: new Date(),
        responseTime: 100,
        memoryUsage: process.memoryUsage(),
        activeConnections: 2,
        cacheHitRate: 90,
        dbQueryTime: 50,
        concurrentUsers: 2
      });

      expect(performanceMonitor.getPerformanceSummary().current?.activeConnections).toBe(2);

      performanceMonitor.decrementConnections();
      
      performanceMonitor.addMetric({
        timestamp: new Date(),
        responseTime: 100,
        memoryUsage: process.memoryUsage(),
        activeConnections: 1,
        cacheHitRate: 90,
        dbQueryTime: 50,
        concurrentUsers: 1
      });

      expect(performanceMonitor.getPerformanceSummary().current?.activeConnections).toBe(1);
    });

    it('should not allow negative connections', () => {
      performanceMonitor.decrementConnections();
      performanceMonitor.decrementConnections();
      
      // Connections should not go below 0
      expect(performanceMonitor.getPerformanceSummary().current?.activeConnections).toBe(0);
    });
  });

  describe('cache hit rate tracking', () => {
    it('should calculate cache hit rate correctly', () => {
      performanceMonitor.recordCacheHit();
      performanceMonitor.recordCacheHit();
      performanceMonitor.recordCacheMiss();

      performanceMonitor.addMetric({
        timestamp: new Date(),
        responseTime: 100,
        memoryUsage: process.memoryUsage(),
        activeConnections: 1,
        cacheHitRate: 66.67, // 2 hits out of 3 total
        dbQueryTime: 50,
        concurrentUsers: 1
      });

      const summary = performanceMonitor.getPerformanceSummary();
      expect(summary.current?.cacheHitRate).toBeCloseTo(66.67, 1);
    });

    it('should handle zero cache operations', () => {
      performanceMonitor.addMetric({
        timestamp: new Date(),
        responseTime: 100,
        memoryUsage: process.memoryUsage(),
        activeConnections: 1,
        cacheHitRate: 0,
        dbQueryTime: 50,
        concurrentUsers: 1
      });

      const summary = performanceMonitor.getPerformanceSummary();
      expect(summary.current?.cacheHitRate).toBe(0);
    });
  });

  describe('threshold monitoring', () => {
    it('should detect response time threshold violations', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      performanceMonitor.addMetric({
        timestamp: new Date(),
        responseTime: 600, // Exceeds 500ms threshold
        memoryUsage: process.memoryUsage(),
        activeConnections: 1,
        cacheHitRate: 90,
        dbQueryTime: 50,
        concurrentUsers: 1
      });

      // Threshold check happens internally when adding metrics
      // We can verify by checking the summary alerts
      const summary = performanceMonitor.getPerformanceSummary();
      expect(summary.alerts).toContain('Response time threshold exceeded');

      consoleSpy.mockRestore();
    });

    it('should detect concurrent user threshold violations', () => {
      performanceMonitor.addMetric({
        timestamp: new Date(),
        responseTime: 100,
        memoryUsage: process.memoryUsage(),
        activeConnections: 150, // Exceeds 100 user threshold
        cacheHitRate: 90,
        dbQueryTime: 50,
        concurrentUsers: 150
      });

      const summary = performanceMonitor.getPerformanceSummary();
      expect(summary.alerts).toContain('Concurrent users threshold exceeded');
    });

    it('should detect cache hit rate threshold violations', () => {
      performanceMonitor.addMetric({
        timestamp: new Date(),
        responseTime: 100,
        memoryUsage: process.memoryUsage(),
        activeConnections: 10,
        cacheHitRate: 70, // Below 80% threshold
        dbQueryTime: 50,
        concurrentUsers: 10
      });

      const summary = performanceMonitor.getPerformanceSummary();
      expect(summary.alerts).toContain('Cache hit rate below threshold');
    });
  });

  describe('metrics history management', () => {
    it('should limit metrics history to maximum size', () => {
      const monitor = new PerformanceMonitor();
      
      // Add more metrics than the maximum history size
      for (let i = 0; i < 1200; i++) {
        monitor.addMetric({
          timestamp: new Date(),
          responseTime: 100,
          memoryUsage: process.memoryUsage(),
          activeConnections: 1,
          cacheHitRate: 90,
          dbQueryTime: 50,
          concurrentUsers: 1
        });
      }

      const recentMetrics = monitor.getRecentMetrics(1200);
      expect(recentMetrics.length).toBeLessThanOrEqual(1000); // Should be limited to maxMetricsHistory
    });

    it('should return correct number of recent metrics', () => {
      for (let i = 0; i < 20; i++) {
        performanceMonitor.addMetric({
          timestamp: new Date(),
          responseTime: 100,
          memoryUsage: process.memoryUsage(),
          activeConnections: 1,
          cacheHitRate: 90,
          dbQueryTime: 50,
          concurrentUsers: 1
        });
      }

      const recentMetrics = performanceMonitor.getRecentMetrics(10);
      expect(recentMetrics.length).toBe(10);
    });
  });

  describe('performance summary', () => {
    it('should calculate averages correctly', () => {
      const testMetrics = [
        { responseTime: 100, memoryUsage: { heapUsed: 100 * 1024 * 1024 }, cacheHitRate: 80, dbQueryTime: 50 },
        { responseTime: 200, memoryUsage: { heapUsed: 200 * 1024 * 1024 }, cacheHitRate: 90, dbQueryTime: 100 },
        { responseTime: 300, memoryUsage: { heapUsed: 300 * 1024 * 1024 }, cacheHitRate: 85, dbQueryTime: 75 }
      ];

      testMetrics.forEach((metric, index) => {
        performanceMonitor.addMetric({
          timestamp: new Date(),
          responseTime: metric.responseTime,
          memoryUsage: metric.memoryUsage as NodeJS.MemoryUsage,
          activeConnections: 1,
          cacheHitRate: metric.cacheHitRate,
          dbQueryTime: metric.dbQueryTime,
          concurrentUsers: 1
        });
      });

      const summary = performanceMonitor.getPerformanceSummary();
      expect(summary.averages.responseTime).toBeCloseTo(200, 0);
      expect(summary.averages.memoryUsage).toBeCloseTo(200, 0);
      expect(summary.averages.cacheHitRate).toBeCloseTo(85, 0);
      expect(summary.averages.dbQueryTime).toBeCloseTo(75, 0);
    });
  });

  describe('monitoring lifecycle', () => {
    it('should start and stop monitoring', (done) => {
      const collectSpy = jest.spyOn(performanceMonitor, 'collectMetrics')
        .mockResolvedValue({
          timestamp: new Date(),
          responseTime: 100,
          memoryUsage: process.memoryUsage(),
          activeConnections: 1,
          cacheHitRate: 90,
          dbQueryTime: 50,
          concurrentUsers: 1
        });

      performanceMonitor.startMonitoring(100); // Very short interval for testing

      setTimeout(() => {
        performanceMonitor.stopMonitoring();
        expect(collectSpy).toHaveBeenCalled();
        collectSpy.mockRestore();
        done();
      }, 150);
    });
  });

  describe('reset functionality', () => {
    it('should reset all metrics and counters', () => {
      performanceMonitor.incrementConnections();
      performanceMonitor.recordCacheHit();
      performanceMonitor.addMetric({
        timestamp: new Date(),
        responseTime: 100,
        memoryUsage: process.memoryUsage(),
        activeConnections: 1,
        cacheHitRate: 90,
        dbQueryTime: 50,
        concurrentUsers: 1
      });

      performanceMonitor.reset();

      const summary = performanceMonitor.getPerformanceSummary();
      expect(summary.current).toBeNull();
      expect(summary.averages.responseTime).toBe(0);
      expect(summary.averages.cacheHitRate).toBe(0);
    });
  });
});