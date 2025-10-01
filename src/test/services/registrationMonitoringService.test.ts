import { RegistrationMonitoringService } from '../../services/registrationMonitoringService';
import { RegistrationRateLimitingService } from '../../services/registrationRateLimitingService';
import { RedisService } from '../../services/redis';
import { logger } from '../../utils/logger';

// Mock dependencies
jest.mock('../../services/registrationRateLimitingService');
jest.mock('../../services/redis');
jest.mock('../../utils/logger');

const mockRegistrationRateLimitingService = RegistrationRateLimitingService as jest.Mocked<typeof RegistrationRateLimitingService>;
const mockRedisService = RedisService as jest.Mocked<typeof RedisService>;
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('RegistrationMonitoringService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisService.get.mockResolvedValue(null);
    mockRedisService.set.mockResolvedValue(undefined);
  });

  describe('getCurrentMetrics', () => {
    it('should return current registration metrics', async () => {
      const mockStats = {
        totalAttempts: 10,
        successfulRegistrations: 8,
        failedAttempts: 2,
        uniqueIPs: 5,
        uniqueEmails: 8,
        alertsTriggered: 1
      };

      mockRegistrationRateLimitingService.getRegistrationStatistics.mockResolvedValue(mockStats);

      const metrics = await RegistrationMonitoringService.getCurrentMetrics();

      expect(metrics).toEqual(expect.objectContaining({
        totalAttempts: 10,
        successfulRegistrations: 8,
        failedAttempts: 2,
        uniqueIPs: 5,
        uniqueEmails: 8,
        alertsTriggered: 1,
        timestamp: expect.any(Number),
        averageProgressiveDelay: expect.any(Number),
        suspiciousActivityCount: expect.any(Number)
      }));
    });

    it('should handle errors gracefully', async () => {
      mockRegistrationRateLimitingService.getRegistrationStatistics.mockRejectedValue(
        new Error('Redis connection failed')
      );

      const metrics = await RegistrationMonitoringService.getCurrentMetrics();

      expect(metrics.totalAttempts).toBe(0);
      expect(metrics.successfulRegistrations).toBe(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error getting current metrics',
        expect.any(Object)
      );
    });
  });

  describe('checkThresholds', () => {
    it('should detect threshold violations', async () => {
      const mockStats = {
        totalAttempts: 150, // Exceeds default threshold of 100
        successfulRegistrations: 50,
        failedAttempts: 100, // 66.7% failure rate, exceeds 50%
        uniqueIPs: 5,
        uniqueEmails: 8,
        alertsTriggered: 15 // Exceeds default threshold of 10
      };

      mockRegistrationRateLimitingService.getRegistrationStatistics.mockResolvedValue(mockStats);

      const result = await RegistrationMonitoringService.checkThresholds();

      expect(result.violations).toHaveLength(3);
      expect(result.overallStatus).toBe('critical');
      
      const violationTypes = result.violations.map(v => v.threshold);
      expect(violationTypes).toContain('maxRegistrationsPerHour');
      expect(violationTypes).toContain('maxFailureRatePercent');
      expect(violationTypes).toContain('maxAlertsPerHour');
    });

    it('should return healthy status when no violations', async () => {
      const mockStats = {
        totalAttempts: 50,
        successfulRegistrations: 45,
        failedAttempts: 5,
        uniqueIPs: 5,
        uniqueEmails: 8,
        alertsTriggered: 2
      };

      mockRegistrationRateLimitingService.getRegistrationStatistics.mockResolvedValue(mockStats);

      const result = await RegistrationMonitoringService.checkThresholds();

      expect(result.violations).toHaveLength(0);
      expect(result.overallStatus).toBe('healthy');
    });

    it('should use custom thresholds when provided', async () => {
      const mockStats = {
        totalAttempts: 80,
        successfulRegistrations: 70,
        failedAttempts: 10,
        uniqueIPs: 5,
        uniqueEmails: 8,
        alertsTriggered: 2
      };

      mockRegistrationRateLimitingService.getRegistrationStatistics.mockResolvedValue(mockStats);

      const customThresholds = {
        maxRegistrationsPerHour: 50 // Lower than the 80 attempts
      };

      const result = await RegistrationMonitoringService.checkThresholds(customThresholds);

      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].threshold).toBe('maxRegistrationsPerHour');
      expect(result.violations[0].current).toBe(80);
      expect(result.violations[0].limit).toBe(50);
    });
  });

  describe('createAlert', () => {
    it('should create and store an alert', async () => {
      const alertId = await RegistrationMonitoringService.createAlert(
        'ip_limit_exceeded',
        { ipAddress: '192.168.1.1', attempts: 10 },
        'high'
      );

      expect(alertId).toBeTruthy();
      expect(alertId).toMatch(/^ip_limit_exceeded_\d+_[a-z0-9]+$/);
      
      expect(mockRedisService.set).toHaveBeenCalledWith(
        expect.stringMatching(/^registration:alert:ip_limit_exceeded_/),
        expect.objectContaining({
          id: alertId,
          type: 'ip_limit_exceeded',
          severity: 'high',
          resolved: false,
          data: { ipAddress: '192.168.1.1', attempts: 10 }
        }),
        7 * 24 * 60 * 60
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Registration alert created',
        expect.objectContaining({
          alertId,
          type: 'ip_limit_exceeded',
          severity: 'high'
        })
      );
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedisService.set.mockRejectedValue(new Error('Redis error'));

      const alertId = await RegistrationMonitoringService.createAlert(
        'suspicious_activity',
        { test: 'data' }
      );

      expect(alertId).toBe('');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error creating alert',
        expect.any(Object)
      );
    });
  });

  describe('storeMetrics', () => {
    it('should store metrics with correct key and TTL', async () => {
      const metrics = {
        timestamp: 1640995200000, // 2022-01-01 00:00:00
        totalAttempts: 10,
        successfulRegistrations: 8,
        failedAttempts: 2,
        uniqueIPs: 5,
        uniqueEmails: 8,
        alertsTriggered: 1,
        averageProgressiveDelay: 5,
        suspiciousActivityCount: 0
      };

      await RegistrationMonitoringService.storeMetrics(metrics);

      const expectedKey = `registration:metrics:${Math.floor(metrics.timestamp / (60 * 1000))}`;
      
      expect(mockRedisService.set).toHaveBeenCalledWith(
        expectedKey,
        metrics,
        7 * 24 * 60 * 60 // 7 days TTL
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Registration metrics stored',
        { timestamp: metrics.timestamp }
      );
    });
  });

  describe('generateMonitoringReport', () => {
    it('should generate a comprehensive monitoring report', async () => {
      const mockStats = {
        totalAttempts: 50,
        successfulRegistrations: 45,
        failedAttempts: 5,
        uniqueIPs: 5,
        uniqueEmails: 8,
        alertsTriggered: 2
      };

      mockRegistrationRateLimitingService.getRegistrationStatistics.mockResolvedValue(mockStats);

      const report = await RegistrationMonitoringService.generateMonitoringReport();

      expect(report).toEqual({
        summary: expect.objectContaining({
          totalAttempts: 50,
          successfulRegistrations: 45,
          failedAttempts: 5
        }),
        thresholdCheck: expect.objectContaining({
          violations: expect.any(Array),
          overallStatus: expect.any(String)
        }),
        activeAlerts: expect.any(Array),
        trends: expect.objectContaining({
          registrationTrend: expect.any(String),
          failureRateTrend: expect.any(String),
          alertTrend: expect.any(String)
        })
      });
    });

    it('should handle errors and return safe defaults', async () => {
      mockRegistrationRateLimitingService.getRegistrationStatistics.mockRejectedValue(
        new Error('Service error')
      );

      const report = await RegistrationMonitoringService.generateMonitoringReport();

      expect(report.summary.totalAttempts).toBe(0);
      expect(report.thresholdCheck.overallStatus).toBe('healthy');
      expect(report.activeAlerts).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error getting current metrics',
        expect.any(Object)
      );
    });
  });

  describe('runMonitoringCycle', () => {
    it('should collect metrics and check thresholds', async () => {
      const mockStats = {
        totalAttempts: 150, // Will trigger violation
        successfulRegistrations: 50,
        failedAttempts: 100,
        uniqueIPs: 5,
        uniqueEmails: 8,
        alertsTriggered: 2
      };

      mockRegistrationRateLimitingService.getRegistrationStatistics.mockResolvedValue(mockStats);

      await RegistrationMonitoringService.runMonitoringCycle();

      // Should store metrics
      expect(mockRedisService.set).toHaveBeenCalledWith(
        expect.stringMatching(/^registration:metrics:/),
        expect.objectContaining({
          totalAttempts: 150,
          successfulRegistrations: 50
        }),
        7 * 24 * 60 * 60
      );

      // Should create alerts for violations
      expect(mockRedisService.set).toHaveBeenCalledWith(
        expect.stringMatching(/^registration:alert:/),
        expect.objectContaining({
          type: 'ip_limit_exceeded'
        }),
        7 * 24 * 60 * 60
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Monitoring cycle completed',
        expect.objectContaining({
          metricsTimestamp: expect.any(Number),
          violationsCount: expect.any(Number),
          overallStatus: expect.any(String)
        })
      );
    });

    it('should handle errors gracefully', async () => {
      mockRegistrationRateLimitingService.getRegistrationStatistics.mockRejectedValue(
        new Error('Service error')
      );

      await expect(RegistrationMonitoringService.runMonitoringCycle()).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error getting current metrics',
        expect.any(Object)
      );
    });
  });
});