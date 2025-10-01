/**
 * Health Monitor Implementation
 * Monitors service health and provides detailed status reporting
 */

import axios, { AxiosResponse } from 'axios';
import { logger } from '../../utils/logger';
import {
  HealthMonitor as IHealthMonitor,
  HealthCheckResult,
  ServiceHealthCheck,
  ServiceStatus
} from '../../types/serviceDiscovery';

export class HealthMonitor implements IHealthMonitor {
  private healthChecks: Map<string, ServiceHealthCheck> = new Map();
  private healthStatuses: Map<string, HealthCheckResult> = new Map();
  private monitoringTimers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Start monitoring a service
   */
  async startMonitoring(serviceId: string, healthCheck: ServiceHealthCheck): Promise<void> {
    // Stop existing monitoring if any
    await this.stopMonitoring(serviceId);

    this.healthChecks.set(serviceId, healthCheck);

    // Perform initial health check
    await this.performHealthCheck(serviceId);

    // Set up periodic health checks
    const timer = setInterval(async () => {
      try {
        await this.performHealthCheck(serviceId);
      } catch (error) {
        logger.error('Error during periodic health check', {
          serviceId,
          error: error.message
        });
      }
    }, healthCheck.interval);

    this.monitoringTimers.set(serviceId, timer);

    logger.info('Started health monitoring for service', {
      serviceId,
      endpoint: healthCheck.endpoint,
      interval: healthCheck.interval
    });
  }

  /**
   * Stop monitoring a service
   */
  async stopMonitoring(serviceId: string): Promise<void> {
    const timer = this.monitoringTimers.get(serviceId);
    if (timer) {
      clearInterval(timer);
      this.monitoringTimers.delete(serviceId);
    }

    this.healthChecks.delete(serviceId);
    this.healthStatuses.delete(serviceId);

    logger.info('Stopped health monitoring for service', { serviceId });
  }

  /**
   * Get health status for a specific service
   */
  async getHealthStatus(serviceId: string): Promise<HealthCheckResult | null> {
    return this.healthStatuses.get(serviceId) || null;
  }

  /**
   * Get all health statuses
   */
  async getAllHealthStatuses(): Promise<Map<string, HealthCheckResult>> {
    return new Map(this.healthStatuses);
  }

  /**
   * Perform health check for a service
   */
  private async performHealthCheck(serviceId: string): Promise<void> {
    const healthCheck = this.healthChecks.get(serviceId);
    if (!healthCheck) {
      logger.warn('No health check configuration found for service', { serviceId });
      return;
    }

    const startTime = Date.now();
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < healthCheck.retries) {
      try {
        const response = await this.makeHealthCheckRequest(healthCheck);
        const responseTime = Date.now() - startTime;

        const result: HealthCheckResult = {
          status: this.determineStatus(response, healthCheck),
          timestamp: new Date(),
          responseTime,
          details: {
            statusCode: response.status,
            responseData: response.data,
            attempt: attempt + 1,
            endpoint: healthCheck.endpoint
          }
        };

        this.healthStatuses.set(serviceId, result);

        logger.debug('Health check completed successfully', {
          serviceId,
          status: result.status,
          responseTime,
          attempt: attempt + 1
        });

        return; // Success, exit retry loop
      } catch (error) {
        lastError = error as Error;
        attempt++;

        logger.warn('Health check attempt failed', {
          serviceId,
          attempt,
          maxRetries: healthCheck.retries,
          error: error.message
        });

        if (attempt < healthCheck.retries) {
          // Wait before retry
          await this.sleep(1000 * attempt); // Exponential backoff
        }
      }
    }

    // All attempts failed
    const responseTime = Date.now() - startTime;
    const result: HealthCheckResult = {
      status: ServiceStatus.UNHEALTHY,
      timestamp: new Date(),
      responseTime,
      details: {
        endpoint: healthCheck.endpoint,
        attempts: healthCheck.retries,
        lastError: lastError?.message
      },
      errors: [lastError?.message || 'Unknown error']
    };

    this.healthStatuses.set(serviceId, result);

    logger.error('Health check failed after all retries', {
      serviceId,
      attempts: healthCheck.retries,
      error: lastError?.message
    });
  }

  /**
   * Make HTTP request for health check
   */
  private async makeHealthCheckRequest(healthCheck: ServiceHealthCheck): Promise<AxiosResponse> {
    return axios.get(healthCheck.endpoint, {
      timeout: healthCheck.timeout,
      validateStatus: (status) => {
        // Accept any status code if no expected status is specified
        if (healthCheck.expectedStatus === undefined) {
          return status >= 200 && status < 300;
        }
        return status === healthCheck.expectedStatus;
      }
    });
  }

  /**
   * Determine service status based on response
   */
  private determineStatus(response: AxiosResponse, healthCheck: ServiceHealthCheck): ServiceStatus {
    // Check status code
    if (healthCheck.expectedStatus !== undefined && response.status !== healthCheck.expectedStatus) {
      return ServiceStatus.UNHEALTHY;
    }

    // Check response content if expected response is specified
    if (healthCheck.expectedResponse !== undefined) {
      try {
        const responseData = typeof response.data === 'string' 
          ? JSON.parse(response.data) 
          : response.data;

        if (!this.deepEqual(responseData, healthCheck.expectedResponse)) {
          return ServiceStatus.UNHEALTHY;
        }
      } catch (error) {
        logger.warn('Failed to parse health check response', {
          error: error.message,
          response: response.data
        });
        return ServiceStatus.UNHEALTHY;
      }
    }

    return ServiceStatus.HEALTHY;
  }

  /**
   * Deep equality check for objects
   */
  private deepEqual(obj1: any, obj2: any): boolean {
    if (obj1 === obj2) return true;

    if (obj1 == null || obj2 == null) return false;

    if (typeof obj1 !== typeof obj2) return false;

    if (typeof obj1 !== 'object') return obj1 === obj2;

    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) return false;

    for (const key of keys1) {
      if (!keys2.includes(key)) return false;
      if (!this.deepEqual(obj1[key], obj2[key])) return false;
    }

    return true;
  }

  /**
   * Sleep utility function
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get monitoring statistics
   */
  getMonitoringStats(): {
    activeMonitors: number;
    totalHealthChecks: number;
    healthyServices: number;
    unhealthyServices: number;
  } {
    const totalHealthChecks = this.healthStatuses.size;
    let healthyServices = 0;
    let unhealthyServices = 0;

    for (const status of this.healthStatuses.values()) {
      if (status.status === ServiceStatus.HEALTHY) {
        healthyServices++;
      } else if (status.status === ServiceStatus.UNHEALTHY) {
        unhealthyServices++;
      }
    }

    return {
      activeMonitors: this.monitoringTimers.size,
      totalHealthChecks,
      healthyServices,
      unhealthyServices
    };
  }

  /**
   * Shutdown the health monitor
   */
  async shutdown(): Promise<void> {
    // Stop all monitoring timers
    for (const [serviceId] of this.monitoringTimers) {
      await this.stopMonitoring(serviceId);
    }

    logger.info('Health monitor shutdown completed');
  }
}