import { AutoScalingService } from '../../services/performance/autoScalingService';
import { performanceMonitor } from '../../services/performance/performanceMonitor';

// Mock performance monitor
jest.mock('../../services/performance/performanceMonitor');
const mockPerformanceMonitor = performanceMonitor as jest.Mocked<typeof performanceMonitor>;

describe('AutoScalingService', () => {
  let autoScalingService: AutoScalingService;

  beforeEach(() => {
    autoScalingService = new AutoScalingService({
      minInstances: 1,
      maxInstances: 5,
      targetCpuUtilization: 70,
      targetMemoryUtilization: 80,
      targetResponseTime: 500,
      scaleUpThreshold: 2,
      scaleDownThreshold: 3,
      cooldownPeriod: 60 // 1 minute for testing
    });

    jest.clearAllMocks();
  });

  describe('collectMetrics', () => {
    it('should collect scaling metrics successfully', async () => {
      mockPerformanceMonitor.getPerformanceSummary.mockReturnValue({
        current: {
          timestamp: new Date(),
          responseTime: 300,
          memoryUsage: process.memoryUsage(),
          activeConnections: 10,
          cacheHitRate: 85,
          dbQueryTime: 100,
          concurrentUsers: 10
        },
        averages: {
          responseTime: 300,
          memoryUsage: 400,
          cacheHitRate: 85,
          dbQueryTime: 100
        },
        thresholds: {
          maxResponseTime: 500,
          maxMemoryUsage: 1024,
          maxConcurrentUsers: 100,
          minCacheHitRate: 80,
          maxDbQueryTime: 200
        },
        alerts: []
      });

      const metrics = await autoScalingService.collectMetrics();

      expect(metrics).toHaveProperty('cpuUsage');
      expect(metrics).toHaveProperty('memoryUsage');
      expect(metrics).toHaveProperty('activeConnections');
      expect(metrics).toHaveProperty('responseTime');
      expect(metrics).toHaveProperty('errorRate');
      expect(metrics).toHaveProperty('timestamp');

      expect(typeof metrics.cpuUsage).toBe('number');
      expect(typeof metrics.memoryUsage).toBe('number');
      expect(metrics.activeConnections).toBe(10);
      expect(metrics.responseTime).toBe(300);
    });
  });

  describe('evaluateScaling', () => {
    it('should return no action when insufficient metrics', () => {
      const action = autoScalingService.evaluateScaling();

      expect(action.type).toBe('no_action');
      expect(action.reason).toContain('Insufficient metrics history');
      expect(action.currentInstances).toBe(1);
      expect(action.targetInstances).toBe(1);
    });

    it('should recommend scale up when metrics exceed thresholds', async () => {
      // Add metrics that exceed thresholds
      for (let i = 0; i < 3; i++) {
        mockPerformanceMonitor.getPerformanceSummary.mockReturnValue({
          current: {
            timestamp: new Date(),
            responseTime: 600, // Exceeds 500ms threshold
            memoryUsage: process.memoryUsage(),
            activeConnections: 50,
            cacheHitRate: 85,
            dbQueryTime: 100,
            concurrentUsers: 50
          },
          averages: { responseTime: 600, memoryUsage: 400, cacheHitRate: 85, dbQueryTime: 100 },
          thresholds: { maxResponseTime: 500, maxMemoryUsage: 1024, maxConcurrentUsers: 100, minCacheHitRate: 80, maxDbQueryTime: 200 },
          alerts: []
        });

        await autoScalingService.collectMetrics();
      }

      const action = autoScalingService.evaluateScaling();

      expect(action.type).toBe('scale_up');
      expect(action.reason).toContain('High resource utilization');
      expect(action.currentInstances).toBe(1);
      expect(action.targetInstances).toBe(2);
    });

    it('should recommend scale down when metrics are consistently low', async () => {
      // Start with 3 instances
      const service = new AutoScalingService({
        minInstances: 1,
        maxInstances: 5,
        targetCpuUtilization: 70,
        targetMemoryUtilization: 80,
        targetResponseTime: 500,
        scaleUpThreshold: 2,
        scaleDownThreshold: 3,
        cooldownPeriod: 0 // No cooldown for testing
      });

      // Simulate having 3 instances
      (service as any).currentInstances = 3;

      // Add metrics that are consistently low
      for (let i = 0; i < 4; i++) {
        mockPerformanceMonitor.getPerformanceSummary.mockReturnValue({
          current: {
            timestamp: new Date(),
            responseTime: 100, // Well below 500ms threshold
            memoryUsage: process.memoryUsage(),
            activeConnections: 5,
            cacheHitRate: 95,
            dbQueryTime: 50,
            concurrentUsers: 5
          },
          averages: { responseTime: 100, memoryUsage: 200, cacheHitRate: 95, dbQueryTime: 50 },
          thresholds: { maxResponseTime: 500, maxMemoryUsage: 1024, maxConcurrentUsers: 100, minCacheHitRate: 80, maxDbQueryTime: 200 },
          alerts: []
        });

        await service.collectMetrics();
      }

      const action = service.evaluateScaling();

      expect(action.type).toBe('scale_down');
      expect(action.reason).toContain('Low resource utilization');
      expect(action.currentInstances).toBe(3);
      expect(action.targetInstances).toBe(2);
    });

    it('should respect minimum instance limit', async () => {
      // Add low metrics
      for (let i = 0; i < 4; i++) {
        mockPerformanceMonitor.getPerformanceSummary.mockReturnValue({
          current: {
            timestamp: new Date(),
            responseTime: 100,
            memoryUsage: process.memoryUsage(),
            activeConnections: 1,
            cacheHitRate: 95,
            dbQueryTime: 50,
            concurrentUsers: 1
          },
          averages: { responseTime: 100, memoryUsage: 200, cacheHitRate: 95, dbQueryTime: 50 },
          thresholds: { maxResponseTime: 500, maxMemoryUsage: 1024, maxConcurrentUsers: 100, minCacheHitRate: 80, maxDbQueryTime: 200 },
          alerts: []
        });

        await autoScalingService.collectMetrics();
      }

      const action = autoScalingService.evaluateScaling();

      // Should not scale down below minimum
      expect(action.type).toBe('no_action');
      expect(action.currentInstances).toBe(1);
    });

    it('should respect maximum instance limit', async () => {
      // Start with max instances
      const service = new AutoScalingService({
        minInstances: 1,
        maxInstances: 2,
        targetCpuUtilization: 70,
        targetMemoryUtilization: 80,
        targetResponseTime: 500,
        scaleUpThreshold: 2,
        scaleDownThreshold: 3,
        cooldownPeriod: 0
      });

      (service as any).currentInstances = 2;

      // Add high metrics
      for (let i = 0; i < 3; i++) {
        mockPerformanceMonitor.getPerformanceSummary.mockReturnValue({
          current: {
            timestamp: new Date(),
            responseTime: 800,
            memoryUsage: process.memoryUsage(),
            activeConnections: 90,
            cacheHitRate: 70,
            dbQueryTime: 300,
            concurrentUsers: 90
          },
          averages: { responseTime: 800, memoryUsage: 900, cacheHitRate: 70, dbQueryTime: 300 },
          thresholds: { maxResponseTime: 500, maxMemoryUsage: 1024, maxConcurrentUsers: 100, minCacheHitRate: 80, maxDbQueryTime: 200 },
          alerts: []
        });

        await service.collectMetrics();
      }

      const action = service.evaluateScaling();

      // Should not scale up beyond maximum
      expect(action.type).toBe('no_action');
      expect(action.currentInstances).toBe(2);
    });

    it('should respect cooldown period', async () => {
      const service = new AutoScalingService({
        minInstances: 1,
        maxInstances: 5,
        targetCpuUtilization: 70,
        targetMemoryUtilization: 80,
        targetResponseTime: 500,
        scaleUpThreshold: 2,
        scaleDownThreshold: 3,
        cooldownPeriod: 300 // 5 minutes
      });

      // Simulate recent scaling action
      (service as any).lastScalingAction = new Date();

      // Add high metrics
      for (let i = 0; i < 3; i++) {
        mockPerformanceMonitor.getPerformanceSummary.mockReturnValue({
          current: {
            timestamp: new Date(),
            responseTime: 800,
            memoryUsage: process.memoryUsage(),
            activeConnections: 90,
            cacheHitRate: 70,
            dbQueryTime: 300,
            concurrentUsers: 90
          },
          averages: { responseTime: 800, memoryUsage: 900, cacheHitRate: 70, dbQueryTime: 300 },
          thresholds: { maxResponseTime: 500, maxMemoryUsage: 1024, maxConcurrentUsers: 100, minCacheHitRate: 80, maxDbQueryTime: 200 },
          alerts: []
        });

        await service.collectMetrics();
      }

      const action = service.evaluateScaling();

      expect(action.type).toBe('no_action');
      expect(action.reason).toContain('Cooldown period active');
    });
  });

  describe('executeScaling', () => {
    it('should execute scale up action', async () => {
      const action = {
        type: 'scale_up' as const,
        reason: 'High utilization',
        currentInstances: 1,
        targetInstances: 2,
        timestamp: new Date()
      };

      const result = await autoScalingService.executeScaling(action);

      expect(result).toBe(true);
      expect(autoScalingService.getScalingStatus().currentInstances).toBe(2);
    });

    it('should execute scale down action', async () => {
      // Start with 2 instances
      (autoScalingService as any).currentInstances = 2;

      const action = {
        type: 'scale_down' as const,
        reason: 'Low utilization',
        currentInstances: 2,
        targetInstances: 1,
        timestamp: new Date()
      };

      const result = await autoScalingService.executeScaling(action);

      expect(result).toBe(true);
      expect(autoScalingService.getScalingStatus().currentInstances).toBe(1);
    });

    it('should handle no action', async () => {
      const action = {
        type: 'no_action' as const,
        reason: 'Metrics within range',
        currentInstances: 1,
        targetInstances: 1,
        timestamp: new Date()
      };

      const result = await autoScalingService.executeScaling(action);

      expect(result).toBe(true);
      expect(autoScalingService.getScalingStatus().currentInstances).toBe(1);
    });
  });

  describe('getScalingStatus', () => {
    it('should return current scaling status', () => {
      const status = autoScalingService.getScalingStatus();

      expect(status).toHaveProperty('currentInstances');
      expect(status).toHaveProperty('config');
      expect(status).toHaveProperty('recentMetrics');
      expect(status).toHaveProperty('nextEvaluationIn');

      expect(status.currentInstances).toBe(1);
      expect(Array.isArray(status.recentMetrics)).toBe(true);
      expect(typeof status.nextEvaluationIn).toBe('number');
    });
  });

  describe('generateCloudConfig', () => {
    it('should generate AWS configuration', () => {
      const config = autoScalingService.generateCloudConfig();

      expect(config).toHaveProperty('aws');
      expect(config.aws).toHaveProperty('autoScalingGroup');
      expect(config.aws).toHaveProperty('scalingPolicies');
      expect(config.aws).toHaveProperty('cloudWatchAlarms');

      expect(config.aws.autoScalingGroup.minSize).toBe(1);
      expect(config.aws.autoScalingGroup.maxSize).toBe(5);
    });

    it('should generate GCP configuration', () => {
      const config = autoScalingService.generateCloudConfig();

      expect(config).toHaveProperty('gcp');
      expect(config.gcp).toHaveProperty('instanceGroupManager');
      expect(config.gcp).toHaveProperty('autoscaler');

      expect(config.gcp.autoscaler.minNumReplicas).toBe(1);
      expect(config.gcp.autoscaler.maxNumReplicas).toBe(5);
    });

    it('should generate Azure configuration', () => {
      const config = autoScalingService.generateCloudConfig();

      expect(config).toHaveProperty('azure');
      expect(config.azure).toHaveProperty('vmScaleSet');
      expect(config.azure).toHaveProperty('autoscaleSettings');

      expect(config.azure.autoscaleSettings.profiles[0].capacity.minimum).toBe('1');
      expect(config.azure.autoscaleSettings.profiles[0].capacity.maximum).toBe('5');
    });
  });
});