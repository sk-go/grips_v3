/**
 * Service Discovery Client
 * Provides client interface for service registration and discovery
 */

import { logger } from '../../utils/logger';
import { ServiceRegistry } from './serviceRegistry';
import { HealthMonitor } from './healthMonitor';
import {
  ServiceRegistration,
  ServiceStatus,
  ServiceQuery,
  ServiceHealthCheck,
  HealthCheckResult
} from '../../types/serviceDiscovery';

export class ServiceDiscoveryClient {
  private serviceRegistry: ServiceRegistry;
  private healthMonitor: HealthMonitor;
  private currentServiceId: string | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.serviceRegistry = new ServiceRegistry();
    this.healthMonitor = new HealthMonitor();
  }

  /**
   * Register current service
   */
  async registerService(
    service: Omit<ServiceRegistration, 'id' | 'registeredAt' | 'lastHeartbeat'>,
    healthCheck?: ServiceHealthCheck
  ): Promise<string> {
    try {
      const serviceId = await this.serviceRegistry.register(service);
      this.currentServiceId = serviceId;

      // Start heartbeat
      this.startHeartbeat(serviceId);

      // Start health monitoring if health check is provided
      if (healthCheck) {
        await this.healthMonitor.startMonitoring(serviceId, healthCheck);
      }

      logger.info('Service registered and monitoring started', {
        serviceId,
        name: service.name,
        hasHealthCheck: !!healthCheck
      });

      return serviceId;
    } catch (error) {
      logger.error('Failed to register service', { error: error.message });
      throw error;
    }
  }

  /**
   * Deregister current service
   */
  async deregisterService(): Promise<void> {
    if (!this.currentServiceId) {
      logger.warn('No service registered to deregister');
      return;
    }

    try {
      // Stop heartbeat
      this.stopHeartbeat();

      // Stop health monitoring
      await this.healthMonitor.stopMonitoring(this.currentServiceId);

      // Deregister from registry
      await this.serviceRegistry.deregister(this.currentServiceId);

      logger.info('Service deregistered successfully', {
        serviceId: this.currentServiceId
      });

      this.currentServiceId = null;
    } catch (error) {
      logger.error('Failed to deregister service', { error: error.message });
      throw error;
    }
  }

  /**
   * Discover services
   */
  async discoverServices(query: ServiceQuery = {}): Promise<ServiceRegistration[]> {
    try {
      const services = await this.serviceRegistry.discover(query);
      
      logger.debug('Services discovered', {
        query,
        count: services.length
      });

      return services;
    } catch (error) {
      logger.error('Failed to discover services', { error: error.message });
      throw error;
    }
  }

  /**
   * Get a specific service
   */
  async getService(serviceId: string): Promise<ServiceRegistration | null> {
    try {
      return await this.serviceRegistry.getService(serviceId);
    } catch (error) {
      logger.error('Failed to get service', { error: error.message, serviceId });
      throw error;
    }
  }

  /**
   * Get services by name
   */
  async getServicesByName(name: string): Promise<ServiceRegistration[]> {
    return this.discoverServices({ name });
  }

  /**
   * Get healthy services by name
   */
  async getHealthyServicesByName(name: string): Promise<ServiceRegistration[]> {
    return this.discoverServices({ name, status: ServiceStatus.HEALTHY });
  }

  /**
   * Update current service status
   */
  async updateServiceStatus(status: ServiceStatus, details?: Record<string, any>): Promise<void> {
    if (!this.currentServiceId) {
      throw new Error('No service registered');
    }

    try {
      await this.serviceRegistry.updateStatus(this.currentServiceId, status, details);
      
      logger.info('Service status updated', {
        serviceId: this.currentServiceId,
        status,
        details
      });
    } catch (error) {
      logger.error('Failed to update service status', { error: error.message });
      throw error;
    }
  }

  /**
   * Get health status for a service
   */
  async getServiceHealth(serviceId: string): Promise<HealthCheckResult | null> {
    try {
      return await this.healthMonitor.getHealthStatus(serviceId);
    } catch (error) {
      logger.error('Failed to get service health', { error: error.message, serviceId });
      throw error;
    }
  }

  /**
   * Get all service health statuses
   */
  async getAllServiceHealth(): Promise<Map<string, HealthCheckResult>> {
    try {
      return await this.healthMonitor.getAllHealthStatuses();
    } catch (error) {
      logger.error('Failed to get all service health statuses', { error: error.message });
      throw error;
    }
  }

  /**
   * Get service discovery statistics
   */
  async getStatistics(): Promise<{
    totalServices: number;
    healthyServices: number;
    unhealthyServices: number;
    monitoringStats: any;
  }> {
    try {
      const allServices = await this.serviceRegistry.getAllServices();
      const healthyServices = allServices.filter(s => s.status === ServiceStatus.HEALTHY).length;
      const unhealthyServices = allServices.filter(s => s.status === ServiceStatus.UNHEALTHY).length;
      const monitoringStats = this.healthMonitor.getMonitoringStats();

      return {
        totalServices: allServices.length,
        healthyServices,
        unhealthyServices,
        monitoringStats
      };
    } catch (error) {
      logger.error('Failed to get statistics', { error: error.message });
      throw error;
    }
  }

  /**
   * Start heartbeat for current service
   */
  private startHeartbeat(serviceId: string): void {
    // Send heartbeat every 30 seconds
    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.serviceRegistry.updateHeartbeat(serviceId);
      } catch (error) {
        logger.error('Failed to send heartbeat', {
          error: error.message,
          serviceId
        });
      }
    }, 30000);

    logger.debug('Heartbeat started for service', { serviceId });
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      logger.debug('Heartbeat stopped');
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    try {
      // Deregister current service if any
      if (this.currentServiceId) {
        await this.deregisterService();
      }

      // Shutdown components
      await this.serviceRegistry.shutdown();
      await this.healthMonitor.shutdown();

      logger.info('Service discovery client shutdown completed');
    } catch (error) {
      logger.error('Error during service discovery client shutdown', { error: error.message });
    }
  }
}