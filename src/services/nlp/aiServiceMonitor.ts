import { ClaudeApiClient } from './claudeApiClient';
import { logger } from '../../utils/logger';
import { EventEmitter } from 'events';

export interface AIServiceStatus {
  service: string;
  status: 'healthy' | 'degraded' | 'unavailable';
  lastCheck: Date;
  lastError?: string;
  responseTime?: number;
  consecutiveFailures: number;
  uptime: number; // percentage
}

export interface AIServiceAlert {
  service: string;
  level: 'warning' | 'critical';
  message: string;
  timestamp: Date;
  details?: any;
}

export class AIServiceMonitor extends EventEmitter {
  private claudeClient: ClaudeApiClient;
  private status: AIServiceStatus;
  private checkInterval: NodeJS.Timeout | null = null;
  private alertThresholds = {
    consecutiveFailures: 3,
    responseTimeWarning: 10000, // 10 seconds
    responseTimeCritical: 30000  // 30 seconds
  };
  private uptimeHistory: boolean[] = [];
  private maxHistorySize = 100;

  constructor(claudeClient: ClaudeApiClient) {
    super();
    this.claudeClient = claudeClient;
    this.status = {
      service: 'claude',
      status: 'healthy',
      lastCheck: new Date(),
      consecutiveFailures: 0,
      uptime: 100
    };
  }

  /**
   * Start monitoring the AI service
   */
  startMonitoring(intervalMs: number = 60000): void {
    if (this.checkInterval) {
      this.stopMonitoring();
    }

    logger.info('Starting AI service monitoring', { 
      service: this.status.service, 
      intervalMs 
    });

    // Initial check
    this.performHealthCheck();

    // Set up periodic checks
    this.checkInterval = setInterval(() => {
      this.performHealthCheck();
    }, intervalMs);
  }

  /**
   * Stop monitoring the AI service
   */
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('Stopped AI service monitoring', { service: this.status.service });
    }
  }

  /**
   * Get current service status
   */
  getStatus(): AIServiceStatus {
    return { ...this.status };
  }

  /**
   * Check if the service is available for requests
   */
  isServiceAvailable(): boolean {
    return this.status.status !== 'unavailable';
  }

  /**
   * Check if the service is healthy (no degradation)
   */
  isServiceHealthy(): boolean {
    return this.status.status === 'healthy';
  }

  /**
   * Perform a health check on the AI service
   */
  private async performHealthCheck(): Promise<void> {
    const startTime = Date.now();
    let success = false;
    let error: string = '';

    try {
      logger.debug('Performing AI service health check', { service: this.status.service });

      // Test connection with a simple request
      const isConnected = await this.claudeClient.testConnection();
      const responseTime = Date.now() - startTime;

      if (isConnected) {
        success = true;
        this.handleSuccessfulCheck(responseTime);
      } else {
        error = 'Connection test failed';
        this.handleFailedCheck(error);
      }

    } catch (err: any) {
      error = err.message || 'Unknown error';
      this.handleFailedCheck(error);
    }

    // Update uptime history
    this.updateUptimeHistory(success);

    // Emit status change events
    this.emitStatusEvents();

    logger.debug('AI service health check completed', {
      service: this.status.service,
      success,
      responseTime: this.status.responseTime,
      status: this.status.status,
      consecutiveFailures: this.status.consecutiveFailures
    });
  }

  /**
   * Handle a successful health check
   */
  private handleSuccessfulCheck(responseTime: number): void {
    const previousStatus = this.status.status;
    
    this.status.lastCheck = new Date();
    this.status.responseTime = responseTime;
    this.status.lastError = undefined;
    this.status.consecutiveFailures = 0;

    // Determine status based on response time
    if (responseTime > this.alertThresholds.responseTimeCritical) {
      this.status.status = 'degraded';
    } else if (responseTime > this.alertThresholds.responseTimeWarning) {
      this.status.status = 'degraded';
    } else {
      this.status.status = 'healthy';
    }

    // Emit recovery event if service was previously unavailable
    if (previousStatus === 'unavailable') {
      this.emitAlert({
        service: this.status.service,
        level: 'warning',
        message: 'AI service has recovered and is now available',
        timestamp: new Date(),
        details: { responseTime, previousStatus }
      });
    }
  }

  /**
   * Handle a failed health check
   */
  private handleFailedCheck(error: string): void {
    const previousStatus = this.status.status;
    
    this.status.lastCheck = new Date();
    this.status.lastError = error;
    this.status.consecutiveFailures++;
    this.status.responseTime = undefined;

    // Determine status based on consecutive failures
    if (this.status.consecutiveFailures >= this.alertThresholds.consecutiveFailures) {
      this.status.status = 'unavailable';
    } else {
      this.status.status = 'degraded';
    }

    // Emit alert for service degradation or failure
    if (previousStatus === 'healthy' && this.status.status === 'degraded') {
      this.emitAlert({
        service: this.status.service,
        level: 'warning',
        message: 'AI service is experiencing issues',
        timestamp: new Date(),
        details: { error, consecutiveFailures: this.status.consecutiveFailures }
      });
    } else if (previousStatus !== 'unavailable' && this.status.status === 'unavailable') {
      this.emitAlert({
        service: this.status.service,
        level: 'critical',
        message: 'AI service is unavailable',
        timestamp: new Date(),
        details: { error, consecutiveFailures: this.status.consecutiveFailures }
      });
    }
  }

  /**
   * Update uptime history and calculate uptime percentage
   */
  private updateUptimeHistory(success: boolean): void {
    this.uptimeHistory.push(success);
    
    // Keep history size manageable
    if (this.uptimeHistory.length > this.maxHistorySize) {
      this.uptimeHistory.shift();
    }

    // Calculate uptime percentage
    const successCount = this.uptimeHistory.filter(Boolean).length;
    this.status.uptime = (successCount / this.uptimeHistory.length) * 100;
  }

  /**
   * Emit status change events
   */
  private emitStatusEvents(): void {
    this.emit('statusUpdate', this.status);
    
    if (this.status.status === 'unavailable') {
      this.emit('serviceUnavailable', this.status);
    } else if (this.status.status === 'degraded') {
      this.emit('serviceDegraded', this.status);
    } else {
      this.emit('serviceHealthy', this.status);
    }
  }

  /**
   * Emit an alert
   */
  private emitAlert(alert: AIServiceAlert): void {
    logger.warn('AI service alert', alert);
    this.emit('alert', alert);
  }

  /**
   * Force a manual health check
   */
  async forceHealthCheck(): Promise<AIServiceStatus> {
    await this.performHealthCheck();
    return this.getStatus();
  }

  /**
   * Reset consecutive failures (useful for manual recovery)
   */
  resetFailureCount(): void {
    this.status.consecutiveFailures = 0;
    logger.info('Reset AI service failure count', { service: this.status.service });
  }

  /**
   * Get uptime statistics
   */
  getUptimeStats(): {
    current: number;
    history: boolean[];
    totalChecks: number;
    successfulChecks: number;
  } {
    const successfulChecks = this.uptimeHistory.filter(Boolean).length;
    
    return {
      current: this.status.uptime,
      history: [...this.uptimeHistory],
      totalChecks: this.uptimeHistory.length,
      successfulChecks
    };
  }
}