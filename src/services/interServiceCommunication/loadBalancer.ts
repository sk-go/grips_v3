/**
 * Load Balancer Implementation
 * Distributes requests across multiple service instances
 */

import { logger } from '../../utils/logger';
import {
  LoadBalancingConfig,
  ServiceInstance
} from '../../types/interServiceCommunication';

export class LoadBalancer {
  private instances: ServiceInstance[] = [];
  private currentIndex = 0;

  private readonly config: LoadBalancingConfig = {
    strategy: 'round-robin',
    healthCheckRequired: true,
    weights: {},
    ...this.userConfig
  };

  constructor(
    private readonly serviceName: string,
    private readonly userConfig: Partial<LoadBalancingConfig> = {}
  ) {
    this.config = { ...this.config, ...userConfig };
  }

  /**
   * Add service instance
   */
  addInstance(instance: ServiceInstance): void {
    const existingIndex = this.instances.findIndex(i => i.id === instance.id);
    
    if (existingIndex >= 0) {
      this.instances[existingIndex] = instance;
      logger.debug('Updated service instance', {
        serviceName: this.serviceName,
        instanceId: instance.id,
        host: instance.host,
        port: instance.port
      });
    } else {
      this.instances.push(instance);
      logger.info('Added service instance', {
        serviceName: this.serviceName,
        instanceId: instance.id,
        host: instance.host,
        port: instance.port,
        totalInstances: this.instances.length
      });
    }
  }

  /**
   * Remove service instance
   */
  removeInstance(instanceId: string): void {
    const index = this.instances.findIndex(i => i.id === instanceId);
    
    if (index >= 0) {
      const removed = this.instances.splice(index, 1)[0];
      
      // Adjust current index if necessary
      if (this.currentIndex >= this.instances.length) {
        this.currentIndex = 0;
      }

      logger.info('Removed service instance', {
        serviceName: this.serviceName,
        instanceId: removed.id,
        host: removed.host,
        port: removed.port,
        totalInstances: this.instances.length
      });
    }
  }

  /**
   * Update instance health status
   */
  updateInstanceHealth(instanceId: string, healthy: boolean): void {
    const instance = this.instances.find(i => i.id === instanceId);
    
    if (instance) {
      const wasHealthy = instance.healthy;
      instance.healthy = healthy;
      instance.lastHealthCheck = new Date();

      if (wasHealthy !== healthy) {
        logger.info('Instance health status changed', {
          serviceName: this.serviceName,
          instanceId,
          healthy,
          host: instance.host,
          port: instance.port
        });
      }
    }
  }

  /**
   * Get next available instance
   */
  getNextInstance(): ServiceInstance | null {
    const availableInstances = this.getAvailableInstances();
    
    if (availableInstances.length === 0) {
      logger.warn('No available instances for service', {
        serviceName: this.serviceName,
        totalInstances: this.instances.length,
        healthyInstances: this.instances.filter(i => i.healthy).length
      });
      return null;
    }

    switch (this.config.strategy) {
      case 'round-robin':
        return this.roundRobinSelection(availableInstances);
      
      case 'least-connections':
        return this.leastConnectionsSelection(availableInstances);
      
      case 'random':
        return this.randomSelection(availableInstances);
      
      case 'weighted':
        return this.weightedSelection(availableInstances);
      
      default:
        return this.roundRobinSelection(availableInstances);
    }
  }

  /**
   * Get available instances (healthy if health check required)
   */
  private getAvailableInstances(): ServiceInstance[] {
    if (this.config.healthCheckRequired) {
      return this.instances.filter(instance => instance.healthy);
    }
    return this.instances;
  }

  /**
   * Round-robin selection
   */
  private roundRobinSelection(instances: ServiceInstance[]): ServiceInstance {
    const instance = instances[this.currentIndex % instances.length];
    this.currentIndex = (this.currentIndex + 1) % instances.length;
    return instance;
  }

  /**
   * Least connections selection
   */
  private leastConnectionsSelection(instances: ServiceInstance[]): ServiceInstance {
    return instances.reduce((least, current) => 
      current.connections < least.connections ? current : least
    );
  }

  /**
   * Random selection
   */
  private randomSelection(instances: ServiceInstance[]): ServiceInstance {
    const randomIndex = Math.floor(Math.random() * instances.length);
    return instances[randomIndex];
  }

  /**
   * Weighted selection
   */
  private weightedSelection(instances: ServiceInstance[]): ServiceInstance {
    const totalWeight = instances.reduce((sum, instance) => {
      const weight = this.config.weights?.[instance.id] || instance.weight || 1;
      return sum + weight;
    }, 0);

    let random = Math.random() * totalWeight;
    
    for (const instance of instances) {
      const weight = this.config.weights?.[instance.id] || instance.weight || 1;
      random -= weight;
      
      if (random <= 0) {
        return instance;
      }
    }

    // Fallback to first instance
    return instances[0];
  }

  /**
   * Increment connection count for instance
   */
  incrementConnections(instanceId: string): void {
    const instance = this.instances.find(i => i.id === instanceId);
    if (instance) {
      instance.connections++;
    }
  }

  /**
   * Decrement connection count for instance
   */
  decrementConnections(instanceId: string): void {
    const instance = this.instances.find(i => i.id === instanceId);
    if (instance && instance.connections > 0) {
      instance.connections--;
    }
  }

  /**
   * Get all instances
   */
  getAllInstances(): ServiceInstance[] {
    return [...this.instances];
  }

  /**
   * Get healthy instances
   */
  getHealthyInstances(): ServiceInstance[] {
    return this.instances.filter(instance => instance.healthy);
  }

  /**
   * Get load balancer statistics
   */
  getStatistics(): {
    totalInstances: number;
    healthyInstances: number;
    unhealthyInstances: number;
    totalConnections: number;
    strategy: string;
  } {
    const healthyInstances = this.instances.filter(i => i.healthy).length;
    const totalConnections = this.instances.reduce((sum, i) => sum + i.connections, 0);

    return {
      totalInstances: this.instances.length,
      healthyInstances,
      unhealthyInstances: this.instances.length - healthyInstances,
      totalConnections,
      strategy: this.config.strategy
    };
  }

  /**
   * Clear all instances
   */
  clear(): void {
    this.instances = [];
    this.currentIndex = 0;
    
    logger.info('Cleared all instances', {
      serviceName: this.serviceName
    });
  }
}