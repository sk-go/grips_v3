import { RedisService } from './redis';
import { logger } from '../utils/logger';
import { RegistrationRateLimitingService } from './registrationRateLimitingService';

export interface RegistrationAlert {
  id: string;
  type: 'ip_limit_exceeded' | 'email_limit_exceeded' | 'suspicious_activity' | 'verification_abuse';
  timestamp: number;
  data: any;
  severity: 'low' | 'medium' | 'high' | 'critical';
  resolved: boolean;
  resolvedAt?: number;
  resolvedBy?: string;
}

export interface RegistrationMetrics {
  timestamp: number;
  totalAttempts: number;
  successfulRegistrations: number;
  failedAttempts: number;
  uniqueIPs: number;
  uniqueEmails: number;
  alertsTriggered: number;
  averageProgressiveDelay: number;
  suspiciousActivityCount: number;
}

export interface MonitoringThresholds {
  maxRegistrationsPerHour: number;
  maxFailureRatePercent: number;
  maxAlertsPerHour: number;
  maxSuspiciousActivityPerHour: number;
}

export class RegistrationMonitoringService {
  private static readonly defaultThresholds: MonitoringThresholds = {
    maxRegistrationsPerHour: 100,
    maxFailureRatePercent: 50,
    maxAlertsPerHour: 10,
    maxSuspiciousActivityPerHour: 5
  };

  /**
   * Get current registration metrics
   */
  static async getCurrentMetrics(
    timeWindowMs: number = 60 * 60 * 1000 // Default 1 hour
  ): Promise<RegistrationMetrics> {
    try {
      const stats = await RegistrationRateLimitingService.getRegistrationStatistics(timeWindowMs);
      
      // Get additional metrics
      const suspiciousActivityCount = await this.getSuspiciousActivityCount(timeWindowMs);
      const averageProgressiveDelay = await this.getAverageProgressiveDelay(timeWindowMs);
      
      return {
        timestamp: Date.now(),
        totalAttempts: stats.totalAttempts,
        successfulRegistrations: stats.successfulRegistrations,
        failedAttempts: stats.failedAttempts,
        uniqueIPs: stats.uniqueIPs,
        uniqueEmails: stats.uniqueEmails,
        alertsTriggered: stats.alertsTriggered,
        averageProgressiveDelay,
        suspiciousActivityCount
      };
    } catch (error) {
      logger.error('Error getting current metrics', { error });
      return this.getEmptyMetrics();
    }
  }

  /**
   * Store metrics for historical tracking
   */
  static async storeMetrics(metrics: RegistrationMetrics): Promise<void> {
    try {
      const metricsKey = `registration:metrics:${Math.floor(metrics.timestamp / (60 * 1000))}`; // Per minute
      await RedisService.set(metricsKey, metrics, 7 * 24 * 60 * 60); // Keep for 7 days
      
      logger.debug('Registration metrics stored', { timestamp: metrics.timestamp });
    } catch (error) {
      logger.error('Error storing metrics', { error, metrics });
    }
  }

  /**
   * Get historical metrics
   */
  static async getHistoricalMetrics(
    startTime: number,
    endTime: number,
    intervalMinutes: number = 5
  ): Promise<RegistrationMetrics[]> {
    try {
      const metrics: RegistrationMetrics[] = [];
      const intervalMs = intervalMinutes * 60 * 1000;
      
      for (let time = startTime; time <= endTime; time += intervalMs) {
        const metricsKey = `registration:metrics:${Math.floor(time / (60 * 1000))}`;
        const data = await RedisService.get(metricsKey);
        
        if (data && typeof data === 'object') {
          metrics.push(data as RegistrationMetrics);
        }
      }
      
      return metrics;
    } catch (error) {
      logger.error('Error getting historical metrics', { error, startTime, endTime });
      return [];
    }
  }

  /**
   * Check if current metrics exceed thresholds
   */
  static async checkThresholds(
    thresholds: Partial<MonitoringThresholds> = {}
  ): Promise<{
    violations: Array<{
      threshold: keyof MonitoringThresholds;
      current: number;
      limit: number;
      severity: 'medium' | 'high' | 'critical';
    }>;
    overallStatus: 'healthy' | 'warning' | 'critical';
  }> {
    try {
      const effectiveThresholds = { ...this.defaultThresholds, ...thresholds };
      const metrics = await this.getCurrentMetrics();
      const violations = [];
      
      // Check registration rate
      if (metrics.totalAttempts > effectiveThresholds.maxRegistrationsPerHour) {
        violations.push({
          threshold: 'maxRegistrationsPerHour' as keyof MonitoringThresholds,
          current: metrics.totalAttempts,
          limit: effectiveThresholds.maxRegistrationsPerHour,
          severity: 'high' as const
        });
      }
      
      // Check failure rate
      const failureRate = metrics.totalAttempts > 0 
        ? (metrics.failedAttempts / metrics.totalAttempts) * 100 
        : 0;
      
      if (failureRate > effectiveThresholds.maxFailureRatePercent) {
        violations.push({
          threshold: 'maxFailureRatePercent' as keyof MonitoringThresholds,
          current: failureRate,
          limit: effectiveThresholds.maxFailureRatePercent,
          severity: 'medium' as const
        });
      }
      
      // Check alert rate
      if (metrics.alertsTriggered > effectiveThresholds.maxAlertsPerHour) {
        violations.push({
          threshold: 'maxAlertsPerHour' as keyof MonitoringThresholds,
          current: metrics.alertsTriggered,
          limit: effectiveThresholds.maxAlertsPerHour,
          severity: 'critical' as const
        });
      }
      
      // Check suspicious activity
      if (metrics.suspiciousActivityCount > effectiveThresholds.maxSuspiciousActivityPerHour) {
        violations.push({
          threshold: 'maxSuspiciousActivityPerHour' as keyof MonitoringThresholds,
          current: metrics.suspiciousActivityCount,
          limit: effectiveThresholds.maxSuspiciousActivityPerHour,
          severity: 'high' as const
        });
      }
      
      // Determine overall status
      let overallStatus: 'healthy' | 'warning' | 'critical' = 'healthy';
      if (violations.some(v => v.severity === 'critical')) {
        overallStatus = 'critical';
      } else if (violations.some(v => v.severity === 'high' || v.severity === 'medium')) {
        overallStatus = 'warning';
      }
      
      return { violations, overallStatus };
    } catch (error) {
      logger.error('Error checking thresholds', { error });
      return { violations: [], overallStatus: 'healthy' };
    }
  }

  /**
   * Get active alerts
   */
  static async getActiveAlerts(): Promise<RegistrationAlert[]> {
    try {
      const alertKeys = await this.getAlertKeys();
      const alerts: RegistrationAlert[] = [];
      
      for (const key of alertKeys) {
        const alertData = await RedisService.get(key);
        if (alertData && typeof alertData === 'object') {
          const alert = alertData as RegistrationAlert;
          if (!alert.resolved) {
            alerts.push(alert);
          }
        }
      }
      
      // Sort by timestamp (newest first)
      return alerts.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      logger.error('Error getting active alerts', { error });
      return [];
    }
  }

  /**
   * Resolve an alert
   */
  static async resolveAlert(alertId: string, resolvedBy: string): Promise<boolean> {
    try {
      const alertKey = `registration:alert:${alertId}`;
      const alertData = await RedisService.get(alertKey);
      
      if (!alertData || typeof alertData !== 'object') {
        return false;
      }
      
      const alert = alertData as RegistrationAlert;
      alert.resolved = true;
      alert.resolvedAt = Date.now();
      alert.resolvedBy = resolvedBy;
      
      await RedisService.set(alertKey, alert, 7 * 24 * 60 * 60); // Keep for 7 days
      
      logger.info('Alert resolved', { alertId, resolvedBy });
      return true;
    } catch (error) {
      logger.error('Error resolving alert', { error, alertId, resolvedBy });
      return false;
    }
  }

  /**
   * Create a new alert
   */
  static async createAlert(
    type: RegistrationAlert['type'],
    data: any,
    severity: RegistrationAlert['severity'] = 'medium'
  ): Promise<string> {
    try {
      const alertId = `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const alert: RegistrationAlert = {
        id: alertId,
        type,
        timestamp: Date.now(),
        data,
        severity,
        resolved: false
      };
      
      const alertKey = `registration:alert:${alertId}`;
      await RedisService.set(alertKey, alert, 7 * 24 * 60 * 60); // Keep for 7 days
      
      logger.warn('Registration alert created', { alertId, type, severity, data });
      
      // In a production environment, this would also:
      // - Send notifications (email, Slack, PagerDuty, etc.)
      // - Update monitoring dashboards
      // - Trigger automated responses if configured
      
      return alertId;
    } catch (error) {
      logger.error('Error creating alert', { error, type, data, severity });
      return '';
    }
  }

  /**
   * Generate monitoring report
   */
  static async generateMonitoringReport(
    timeWindowMs: number = 24 * 60 * 60 * 1000 // Default 24 hours
  ): Promise<{
    summary: RegistrationMetrics;
    thresholdCheck: Awaited<ReturnType<typeof RegistrationMonitoringService.checkThresholds>>;
    activeAlerts: RegistrationAlert[];
    trends: {
      registrationTrend: 'increasing' | 'decreasing' | 'stable';
      failureRateTrend: 'increasing' | 'decreasing' | 'stable';
      alertTrend: 'increasing' | 'decreasing' | 'stable';
    };
  }> {
    try {
      const summary = await this.getCurrentMetrics(timeWindowMs);
      const thresholdCheck = await this.checkThresholds();
      const activeAlerts = await this.getActiveAlerts();
      
      // Calculate trends (simplified - in production, you'd use more sophisticated analysis)
      const trends = await this.calculateTrends(timeWindowMs);
      
      return {
        summary,
        thresholdCheck,
        activeAlerts,
        trends
      };
    } catch (error) {
      logger.error('Error generating monitoring report', { error });
      return {
        summary: this.getEmptyMetrics(),
        thresholdCheck: { violations: [], overallStatus: 'healthy' },
        activeAlerts: [],
        trends: {
          registrationTrend: 'stable',
          failureRateTrend: 'stable',
          alertTrend: 'stable'
        }
      };
    }
  }

  /**
   * Start automated monitoring (call this periodically)
   */
  static async runMonitoringCycle(): Promise<void> {
    try {
      // Collect and store current metrics
      const metrics = await this.getCurrentMetrics();
      await this.storeMetrics(metrics);
      
      // Check thresholds and create alerts if needed
      const thresholdCheck = await this.checkThresholds();
      
      for (const violation of thresholdCheck.violations) {
        await this.createAlert(
          'ip_limit_exceeded', // This would be more specific based on the violation
          {
            threshold: violation.threshold,
            current: violation.current,
            limit: violation.limit
          },
          violation.severity
        );
      }
      
      logger.debug('Monitoring cycle completed', {
        metricsTimestamp: metrics.timestamp,
        violationsCount: thresholdCheck.violations.length,
        overallStatus: thresholdCheck.overallStatus
      });
    } catch (error) {
      logger.error('Error in monitoring cycle', { error });
    }
  }

  /**
   * Get suspicious activity count
   */
  private static async getSuspiciousActivityCount(timeWindowMs: number): Promise<number> {
    try {
      // This would query for suspicious activity alerts in the time window
      const alertKeys = await this.getAlertKeys();
      let count = 0;
      const windowStart = Date.now() - timeWindowMs;
      
      for (const key of alertKeys) {
        const alertData = await RedisService.get(key);
        if (alertData && typeof alertData === 'object') {
          const alert = alertData as RegistrationAlert;
          if (alert.type === 'suspicious_activity' && alert.timestamp > windowStart) {
            count++;
          }
        }
      }
      
      return count;
    } catch (error) {
      logger.error('Error getting suspicious activity count', { error });
      return 0;
    }
  }

  /**
   * Get average progressive delay
   */
  private static async getAverageProgressiveDelay(timeWindowMs: number): Promise<number> {
    try {
      // This is a simplified implementation
      // In practice, you'd track progressive delays in the metrics
      return 0; // Placeholder
    } catch (error) {
      logger.error('Error getting average progressive delay', { error });
      return 0;
    }
  }

  /**
   * Get alert keys from Redis
   */
  private static async getAlertKeys(): Promise<string[]> {
    try {
      // In a real Redis implementation, you'd use SCAN or KEYS
      // For this implementation, we'll return an empty array as a placeholder
      // The actual implementation would depend on your Redis client capabilities
      return [];
    } catch (error) {
      logger.error('Error getting alert keys', { error });
      return [];
    }
  }

  /**
   * Calculate trends
   */
  private static async calculateTrends(timeWindowMs: number): Promise<{
    registrationTrend: 'increasing' | 'decreasing' | 'stable';
    failureRateTrend: 'increasing' | 'decreasing' | 'stable';
    alertTrend: 'increasing' | 'decreasing' | 'stable';
  }> {
    try {
      // Simplified trend calculation
      // In production, you'd analyze historical data to determine trends
      return {
        registrationTrend: 'stable',
        failureRateTrend: 'stable',
        alertTrend: 'stable'
      };
    } catch (error) {
      logger.error('Error calculating trends', { error });
      return {
        registrationTrend: 'stable',
        failureRateTrend: 'stable',
        alertTrend: 'stable'
      };
    }
  }

  /**
   * Get empty metrics for error cases
   */
  private static getEmptyMetrics(): RegistrationMetrics {
    return {
      timestamp: Date.now(),
      totalAttempts: 0,
      successfulRegistrations: 0,
      failedAttempts: 0,
      uniqueIPs: 0,
      uniqueEmails: 0,
      alertsTriggered: 0,
      averageProgressiveDelay: 0,
      suspiciousActivityCount: 0
    };
  }
}