import { Request, Response } from 'express';
import { loggingService } from './loggingService';
import { DatabaseService } from '../database/DatabaseService';
import { cacheService } from '../cacheService';

export interface SystemMetrics {
  timestamp: Date;
  cpu: {
    usage: number;
    loadAverage: number[];
  };
  memory: {
    usage: NodeJS.MemoryUsage;
    percentage: number;
  };
  uptime: number;
  activeConnections: number;
  requestsPerMinute: number;
  averageResponseTime: number;
  errorRate: number;
}

export interface ApplicationMetrics {
  timestamp: Date;
  database: {
    connectionCount: number;
    queryCount: number;
    averageQueryTime: number;
    slowQueries: number;
  };
  cache: {
    hitRate: number;
    missRate: number;
    keyCount: number;
    memoryUsage: number;
  };
  ai: {
    requestCount: number;
    averageResponseTime: number;
    tokenUsage: number;
    errorRate: number;
  };
  crm: {
    syncCount: number;
    syncErrors: number;
    averageSyncTime: number;
    lastSyncTime: Date | null;
  };
}

export interface PerformanceAlert {
  id: string;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
  component: string;
  metric: string;
  value: number;
  threshold: number;
  message: string;
  resolved: boolean;
}

class PerformanceDashboard {
  private metrics: SystemMetrics[] = [];
  private appMetrics: ApplicationMetrics[] = [];
  private alerts: PerformanceAlert[] = [];
  private requestCounts: Map<string, number> = new Map();
  private responseTimes: number[] = [];
  private errorCounts: Map<string, number> = new Map();
  private metricsRetentionHours = 24;

  constructor() {
    this.startMetricsCollection();
    this.startAlertMonitoring();
  }

  private startMetricsCollection(): void {
    // Collect system metrics every minute
    setInterval(() => {
      this.collectSystemMetrics();
    }, 60 * 1000);

    // Collect application metrics every 5 minutes
    setInterval(() => {
      this.collectApplicationMetrics();
    }, 5 * 60 * 1000);

    // Cleanup old metrics every hour
    setInterval(() => {
      this.cleanupOldMetrics();
    }, 60 * 60 * 1000);
  }

  private startAlertMonitoring(): void {
    // Check for performance alerts every 2 minutes
    setInterval(() => {
      this.checkPerformanceAlerts();
    }, 2 * 60 * 1000);
  }

  private collectSystemMetrics(): void {
    const memoryUsage = process.memoryUsage();
    const totalMemory = require('os').totalmem();
    const memoryPercentage = (memoryUsage.rss / totalMemory) * 100;

    // Calculate requests per minute
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
    const requestsLastMinute = this.getRequestCountSince(oneMinuteAgo);

    // Calculate average response time
    const avgResponseTime = this.responseTimes.length > 0 
      ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length 
      : 0;

    // Calculate error rate
    const totalRequests = Array.from(this.requestCounts.values()).reduce((a, b) => a + b, 0);
    const totalErrors = Array.from(this.errorCounts.values()).reduce((a, b) => a + b, 0);
    const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

    const metrics: SystemMetrics = {
      timestamp: now,
      cpu: {
        usage: process.cpuUsage().user / 1000000, // Convert to seconds
        loadAverage: require('os').loadavg()
      },
      memory: {
        usage: memoryUsage,
        percentage: memoryPercentage
      },
      uptime: process.uptime(),
      activeConnections: 0, // Would need to track this separately
      requestsPerMinute: requestsLastMinute,
      averageResponseTime: avgResponseTime,
      errorRate
    };

    this.metrics.push(metrics);

    // Log system metrics
    loggingService.info('System metrics collected', {
      component: 'monitoring',
      action: 'metrics_collection',
      metadata: {
        memoryPercentage: Math.round(memoryPercentage * 100) / 100,
        requestsPerMinute: requestsLastMinute,
        averageResponseTime: Math.round(avgResponseTime * 100) / 100,
        errorRate: Math.round(errorRate * 100) / 100
      }
    });
  }

  private async collectApplicationMetrics(): Promise<void> {
    try {
      const now = new Date();

      // Database metrics
      const dbMetrics = await this.getDatabaseMetrics();
      
      // Cache metrics
      const cacheMetrics = await this.getCacheMetrics();
      
      // AI metrics (would need to be tracked separately)
      const aiMetrics = this.getAIMetrics();
      
      // CRM metrics (would need to be tracked separately)
      const crmMetrics = this.getCRMMetrics();

      const appMetrics: ApplicationMetrics = {
        timestamp: now,
        database: dbMetrics,
        cache: cacheMetrics,
        ai: aiMetrics,
        crm: crmMetrics
      };

      this.appMetrics.push(appMetrics);

      loggingService.info('Application metrics collected', {
        component: 'monitoring',
        action: 'app_metrics_collection',
        metadata: {
          database: dbMetrics,
          cache: cacheMetrics
        }
      });

    } catch (error) {
      loggingService.error('Failed to collect application metrics', error as Error, {
        component: 'monitoring',
        action: 'metrics_collection_error'
      });
    }
  }

  private async getDatabaseMetrics(): Promise<ApplicationMetrics['database']> {
    try {
      // This would need to be implemented based on your database monitoring
      // For now, return mock data
      return {
        connectionCount: 10,
        queryCount: 150,
        averageQueryTime: 25,
        slowQueries: 2
      };
    } catch (error) {
      return {
        connectionCount: 0,
        queryCount: 0,
        averageQueryTime: 0,
        slowQueries: 0
      };
    }
  }

  private async getCacheMetrics(): Promise<ApplicationMetrics['cache']> {
    try {
      // Get Redis info if available
      const info = await cacheService.getInfo();
      
      return {
        hitRate: 85.5, // Would need to track this
        missRate: 14.5,
        keyCount: info.keyCount || 0,
        memoryUsage: info.memoryUsage || 0
      };
    } catch (error) {
      return {
        hitRate: 0,
        missRate: 0,
        keyCount: 0,
        memoryUsage: 0
      };
    }
  }

  private getAIMetrics(): ApplicationMetrics['ai'] {
    // This would need to be tracked separately in AI services
    return {
      requestCount: 45,
      averageResponseTime: 1200,
      tokenUsage: 15000,
      errorRate: 2.1
    };
  }

  private getCRMMetrics(): ApplicationMetrics['crm'] {
    // This would need to be tracked separately in CRM services
    return {
      syncCount: 12,
      syncErrors: 1,
      averageSyncTime: 3500,
      lastSyncTime: new Date()
    };
  }

  private getRequestCountSince(since: Date): number {
    // This would need to be implemented based on actual request tracking
    return Math.floor(Math.random() * 100); // Mock data
  }

  private checkPerformanceAlerts(): void {
    const latestMetrics = this.metrics[this.metrics.length - 1];
    const latestAppMetrics = this.appMetrics[this.appMetrics.length - 1];

    if (!latestMetrics) return;

    // Check CPU usage
    if (latestMetrics.cpu.usage > 80) {
      this.createAlert('cpu', 'usage', latestMetrics.cpu.usage, 80, 'High CPU usage detected');
    }

    // Check memory usage
    if (latestMetrics.memory.percentage > 85) {
      this.createAlert('memory', 'percentage', latestMetrics.memory.percentage, 85, 'High memory usage detected');
    }

    // Check response time
    if (latestMetrics.averageResponseTime > 2000) {
      this.createAlert('api', 'response_time', latestMetrics.averageResponseTime, 2000, 'High response time detected');
    }

    // Check error rate
    if (latestMetrics.errorRate > 5) {
      this.createAlert('api', 'error_rate', latestMetrics.errorRate, 5, 'High error rate detected');
    }

    // Check application-specific metrics
    if (latestAppMetrics) {
      if (latestAppMetrics.cache.hitRate < 70) {
        this.createAlert('cache', 'hit_rate', latestAppMetrics.cache.hitRate, 70, 'Low cache hit rate detected');
      }

      if (latestAppMetrics.database.averageQueryTime > 100) {
        this.createAlert('database', 'query_time', latestAppMetrics.database.averageQueryTime, 100, 'Slow database queries detected');
      }
    }
  }

  private createAlert(component: string, metric: string, value: number, threshold: number, message: string): void {
    const severity = this.calculateAlertSeverity(component, metric, value, threshold);
    
    const alert: PerformanceAlert = {
      id: `${component}-${metric}-${Date.now()}`,
      timestamp: new Date(),
      severity,
      component,
      metric,
      value,
      threshold,
      message,
      resolved: false
    };

    this.alerts.push(alert);

    loggingService.warn(`Performance alert: ${message}`, {
      component: 'monitoring',
      action: 'performance_alert',
      metadata: {
        alertId: alert.id,
        severity,
        component,
        metric,
        value,
        threshold
      }
    });

    // Send notification for critical alerts
    if (severity === 'critical') {
      this.sendCriticalAlert(alert);
    }
  }

  private calculateAlertSeverity(component: string, metric: string, value: number, threshold: number): PerformanceAlert['severity'] {
    const ratio = value / threshold;
    
    if (ratio >= 2) return 'critical';
    if (ratio >= 1.5) return 'high';
    if (ratio >= 1.2) return 'medium';
    return 'low';
  }

  private sendCriticalAlert(alert: PerformanceAlert): void {
    // This would integrate with your notification system
    loggingService.error(`CRITICAL ALERT: ${alert.message}`, undefined, {
      component: 'monitoring',
      action: 'critical_alert',
      metadata: alert
    });
  }

  private cleanupOldMetrics(): void {
    const cutoffTime = new Date(Date.now() - this.metricsRetentionHours * 60 * 60 * 1000);
    
    this.metrics = this.metrics.filter(m => m.timestamp > cutoffTime);
    this.appMetrics = this.appMetrics.filter(m => m.timestamp > cutoffTime);
    
    // Keep alerts for 7 days
    const alertCutoffTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    this.alerts = this.alerts.filter(a => a.timestamp > alertCutoffTime);
  }

  // Public API methods
  public getSystemMetrics(hours: number = 1): SystemMetrics[] {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.metrics.filter(m => m.timestamp > cutoffTime);
  }

  public getApplicationMetrics(hours: number = 1): ApplicationMetrics[] {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.appMetrics.filter(m => m.timestamp > cutoffTime);
  }

  public getActiveAlerts(): PerformanceAlert[] {
    return this.alerts.filter(a => !a.resolved);
  }

  public getAllAlerts(hours: number = 24): PerformanceAlert[] {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.alerts.filter(a => a.timestamp > cutoffTime);
  }

  public resolveAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      loggingService.info(`Alert resolved: ${alert.message}`, {
        component: 'monitoring',
        action: 'alert_resolved',
        metadata: { alertId }
      });
      return true;
    }
    return false;
  }

  public recordRequest(method: string, path: string, statusCode: number, responseTime: number): void {
    const key = `${method}:${path}`;
    this.requestCounts.set(key, (this.requestCounts.get(key) || 0) + 1);
    this.responseTimes.push(responseTime);

    // Keep only last 1000 response times
    if (this.responseTimes.length > 1000) {
      this.responseTimes = this.responseTimes.slice(-1000);
    }

    // Track errors
    if (statusCode >= 400) {
      this.errorCounts.set(key, (this.errorCounts.get(key) || 0) + 1);
    }
  }

  public getHealthStatus(): { status: 'healthy' | 'degraded' | 'unhealthy'; details: any } {
    const latestMetrics = this.metrics[this.metrics.length - 1];
    const activeAlerts = this.getActiveAlerts();
    
    if (!latestMetrics) {
      return { status: 'unhealthy', details: { reason: 'No metrics available' } };
    }

    const criticalAlerts = activeAlerts.filter(a => a.severity === 'critical');
    const highAlerts = activeAlerts.filter(a => a.severity === 'high');

    if (criticalAlerts.length > 0) {
      return { 
        status: 'unhealthy', 
        details: { 
          criticalAlerts: criticalAlerts.length,
          alerts: criticalAlerts.map(a => a.message)
        } 
      };
    }

    if (highAlerts.length > 2 || latestMetrics.errorRate > 10) {
      return { 
        status: 'degraded', 
        details: { 
          highAlerts: highAlerts.length,
          errorRate: latestMetrics.errorRate
        } 
      };
    }

    return { 
      status: 'healthy', 
      details: { 
        uptime: latestMetrics.uptime,
        memoryUsage: latestMetrics.memory.percentage,
        errorRate: latestMetrics.errorRate
      } 
    };
  }
}

// Express route handlers
export const performanceDashboard = new PerformanceDashboard();

export const getDashboardData = async (req: Request, res: Response): Promise<void> => {
  try {
    const hours = parseInt(req.query.hours as string) || 1;
    
    const systemMetrics = performanceDashboard.getSystemMetrics(hours);
    const appMetrics = performanceDashboard.getApplicationMetrics(hours);
    const alerts = performanceDashboard.getActiveAlerts();
    const healthStatus = performanceDashboard.getHealthStatus();

    res.json({
      systemMetrics,
      applicationMetrics: appMetrics,
      alerts,
      healthStatus,
      timestamp: new Date()
    });

  } catch (error) {
    loggingService.error('Failed to get dashboard data', error as Error, {
      component: 'monitoring',
      action: 'dashboard_error'
    });
    
    res.status(500).json({ error: 'Failed to retrieve dashboard data' });
  }
};

export const getMetricsHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const hours = parseInt(req.query.hours as string) || 24;
    const type = req.query.type as string || 'system';
    
    if (type === 'system') {
      const metrics = performanceDashboard.getSystemMetrics(hours);
      res.json({ metrics, type: 'system' });
    } else if (type === 'application') {
      const metrics = performanceDashboard.getApplicationMetrics(hours);
      res.json({ metrics, type: 'application' });
    } else {
      res.status(400).json({ error: 'Invalid metrics type' });
    }

  } catch (error) {
    loggingService.error('Failed to get metrics history', error as Error, {
      component: 'monitoring',
      action: 'metrics_history_error'
    });
    
    res.status(500).json({ error: 'Failed to retrieve metrics history' });
  }
};

export const getAlerts = async (req: Request, res: Response): Promise<void> => {
  try {
    const hours = parseInt(req.query.hours as string) || 24;
    const active = req.query.active === 'true';
    
    const alerts = active 
      ? performanceDashboard.getActiveAlerts()
      : performanceDashboard.getAllAlerts(hours);
    
    res.json({ alerts });

  } catch (error) {
    loggingService.error('Failed to get alerts', error as Error, {
      component: 'monitoring',
      action: 'alerts_error'
    });
    
    res.status(500).json({ error: 'Failed to retrieve alerts' });
  }
};

export const resolveAlert = async (req: Request, res: Response): Promise<void> => {
  try {
    const { alertId } = req.params;
    
    const resolved = performanceDashboard.resolveAlert(alertId);
    
    if (resolved) {
      res.json({ success: true, message: 'Alert resolved' });
    } else {
      res.status(404).json({ error: 'Alert not found' });
    }

  } catch (error) {
    loggingService.error('Failed to resolve alert', error as Error, {
      component: 'monitoring',
      action: 'resolve_alert_error'
    });
    
    res.status(500).json({ error: 'Failed to resolve alert' });
  }
};