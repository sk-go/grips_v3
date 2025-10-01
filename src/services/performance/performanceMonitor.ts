import { logger } from '../../utils/logger';
import { RedisService } from '../redis';
import { DatabaseService } from '../database/DatabaseService';

export interface PerformanceMetrics {
  timestamp: Date;
  responseTime: number;
  memoryUsage: NodeJS.MemoryUsage;
  activeConnections: number;
  cacheHitRate: number;
  dbQueryTime: number;
  concurrentUsers: number;
}

export interface PerformanceThresholds {
  maxResponseTime: number; // 500ms requirement
  maxMemoryUsage: number; // MB
  maxConcurrentUsers: number; // 100 agents requirement
  minCacheHitRate: number; // percentage
  maxDbQueryTime: number; // ms
}

export class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = [];
  private readonly maxMetricsHistory = 1000;
  private readonly thresholds: PerformanceThresholds;
  private monitoringInterval?: NodeJS.Timeout;
  private activeConnections = 0;
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(thresholds?: Partial<PerformanceThresholds>) {
    this.thresholds = {
      maxResponseTime: 500, // 500ms UI response requirement
      maxMemoryUsage: 1024, // 1GB default
      maxConcurrentUsers: 100, // 100 concurrent agents requirement
      minCacheHitRate: 80, // 80% cache hit rate
      maxDbQueryTime: 200, // 200ms max DB query time
      ...thresholds
    };
  }

  /**
   * Start performance monitoring
   */
  startMonitoring(intervalMs: number = 30000): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = setInterval(async () => {
      await this.collectMetrics();
    }, intervalMs);

    logger.info('Performance monitoring started', { 
      interval: intervalMs,
      thresholds: this.thresholds 
    });
  }

  /**
   * Stop performance monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    logger.info('Performance monitoring stopped');
  }

  /**
   * Collect current performance metrics
   */
  async collectMetrics(): Promise<PerformanceMetrics> {
    const startTime = Date.now();
    
    try {
      // Test database response time
      await DatabaseService.query('SELECT 1');
      const dbQueryTime = Date.now() - startTime;

      const metrics: PerformanceMetrics = {
        timestamp: new Date(),
        responseTime: 0, // Will be set by middleware
        memoryUsage: process.memoryUsage(),
        activeConnections: this.activeConnections,
        cacheHitRate: this.calculateCacheHitRate(),
        dbQueryTime,
        concurrentUsers: this.activeConnections // Approximation
      };

      this.addMetric(metrics);
      this.checkThresholds(metrics);

      return metrics;
    } catch (error) {
      logger.error('Failed to collect performance metrics', { error });
      throw error;
    }
  }

  /**
   * Add a performance metric
   */
  addMetric(metric: PerformanceMetrics): void {
    this.metrics.push(metric);
    
    // Keep only recent metrics
    if (this.metrics.length > this.maxMetricsHistory) {
      this.metrics = this.metrics.slice(-this.maxMetricsHistory);
    }
  }

  /**
   * Record response time for a request
   */
  recordResponseTime(responseTime: number): void {
    if (this.metrics.length > 0) {
      this.metrics[this.metrics.length - 1].responseTime = responseTime;
    }
  }

  /**
   * Increment active connections
   */
  incrementConnections(): void {
    this.activeConnections++;
  }

  /**
   * Decrement active connections
   */
  decrementConnections(): void {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
  }

  /**
   * Record cache hit
   */
  recordCacheHit(): void {
    this.cacheHits++;
  }

  /**
   * Record cache miss
   */
  recordCacheMiss(): void {
    this.cacheMisses++;
  }

  /**
   * Calculate cache hit rate
   */
  private calculateCacheHitRate(): number {
    const total = this.cacheHits + this.cacheMisses;
    return total > 0 ? (this.cacheHits / total) * 100 : 0;
  }

  /**
   * Check if metrics exceed thresholds
   */
  private checkThresholds(metrics: PerformanceMetrics): void {
    const alerts: string[] = [];

    if (metrics.responseTime > this.thresholds.maxResponseTime) {
      alerts.push(`Response time ${metrics.responseTime}ms exceeds threshold ${this.thresholds.maxResponseTime}ms`);
    }

    if (metrics.memoryUsage.heapUsed / 1024 / 1024 > this.thresholds.maxMemoryUsage) {
      alerts.push(`Memory usage ${Math.round(metrics.memoryUsage.heapUsed / 1024 / 1024)}MB exceeds threshold ${this.thresholds.maxMemoryUsage}MB`);
    }

    if (metrics.concurrentUsers > this.thresholds.maxConcurrentUsers) {
      alerts.push(`Concurrent users ${metrics.concurrentUsers} exceeds threshold ${this.thresholds.maxConcurrentUsers}`);
    }

    if (metrics.cacheHitRate < this.thresholds.minCacheHitRate) {
      alerts.push(`Cache hit rate ${metrics.cacheHitRate.toFixed(1)}% below threshold ${this.thresholds.minCacheHitRate}%`);
    }

    if (metrics.dbQueryTime > this.thresholds.maxDbQueryTime) {
      alerts.push(`DB query time ${metrics.dbQueryTime}ms exceeds threshold ${this.thresholds.maxDbQueryTime}ms`);
    }

    if (alerts.length > 0) {
      logger.warn('Performance thresholds exceeded', { alerts, metrics });
    }
  }

  /**
   * Get recent performance metrics
   */
  getRecentMetrics(count: number = 10): PerformanceMetrics[] {
    return this.metrics.slice(-count);
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary(): {
    current: PerformanceMetrics | null;
    averages: {
      responseTime: number;
      memoryUsage: number;
      cacheHitRate: number;
      dbQueryTime: number;
    };
    thresholds: PerformanceThresholds;
    alerts: string[];
  } {
    const current = this.metrics.length > 0 ? this.metrics[this.metrics.length - 1] : null;
    const recent = this.getRecentMetrics(10);
    
    const averages = {
      responseTime: recent.reduce((sum, m) => sum + m.responseTime, 0) / recent.length || 0,
      memoryUsage: recent.reduce((sum, m) => sum + m.memoryUsage.heapUsed, 0) / recent.length / 1024 / 1024 || 0,
      cacheHitRate: recent.reduce((sum, m) => sum + m.cacheHitRate, 0) / recent.length || 0,
      dbQueryTime: recent.reduce((sum, m) => sum + m.dbQueryTime, 0) / recent.length || 0
    };

    const alerts: string[] = [];
    if (current) {
      if (current.responseTime > this.thresholds.maxResponseTime) {
        alerts.push('Response time threshold exceeded');
      }
      if (current.concurrentUsers > this.thresholds.maxConcurrentUsers) {
        alerts.push('Concurrent users threshold exceeded');
      }
      if (current.cacheHitRate < this.thresholds.minCacheHitRate) {
        alerts.push('Cache hit rate below threshold');
      }
    }

    return {
      current,
      averages,
      thresholds: this.thresholds,
      alerts
    };
  }

  /**
   * Reset metrics and counters
   */
  reset(): void {
    this.metrics = [];
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.activeConnections = 0;
  }
}

// Global performance monitor instance
export const performanceMonitor = new PerformanceMonitor();