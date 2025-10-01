/**
 * Service Registry Implementation
 * Manages service registration, discovery, and lifecycle
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';
import { DatabaseService } from '../database';
import {
  ServiceRegistration,
  ServiceStatus,
  ServiceQuery,
  ServiceRegistry as IServiceRegistry,
  ServiceDiscoveryConfig
} from '../../types/serviceDiscovery';

export class ServiceRegistry implements IServiceRegistry {
  private services: Map<string, ServiceRegistration> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;

  private readonly config: ServiceDiscoveryConfig = {
    registrationTtl: 300000, // 5 minutes
    heartbeatInterval: 30000, // 30 seconds
    healthCheckInterval: 60000, // 1 minute
    cleanupInterval: 120000, // 2 minutes
    maxRetries: 3,
    retryDelay: 5000 // 5 seconds
  };

  constructor() {
    this.startCleanupTimer();
    this.loadServicesFromDatabase();
  }

  /**
   * Register a new service
   */
  async register(
    service: Omit<ServiceRegistration, 'id' | 'registeredAt' | 'lastHeartbeat'>
  ): Promise<string> {
    const serviceId = uuidv4();
    const now = new Date();

    const registration: ServiceRegistration = {
      id: serviceId,
      registeredAt: now,
      lastHeartbeat: now,
      ...service
    };

    // Store in memory
    this.services.set(serviceId, registration);

    // Persist to database
    await this.persistServiceRegistration(registration);

    logger.info('Service registered successfully', {
      serviceId,
      name: service.name,
      host: service.host,
      port: service.port
    });

    return serviceId;
  }

  /**
   * Deregister a service
   */
  async deregister(serviceId: string): Promise<void> {
    const service = this.services.get(serviceId);
    if (!service) {
      throw new Error(`Service not found: ${serviceId}`);
    }

    // Remove from memory
    this.services.delete(serviceId);

    // Remove from database
    await this.removeServiceFromDatabase(serviceId);

    logger.info('Service deregistered successfully', {
      serviceId,
      name: service.name
    });
  }

  /**
   * Discover services based on query criteria
   */
  async discover(query: ServiceQuery): Promise<ServiceRegistration[]> {
    const services = Array.from(this.services.values());
    
    return services.filter(service => {
      // Filter by name
      if (query.name && service.name !== query.name) {
        return false;
      }

      // Filter by status
      if (query.status && service.status !== query.status) {
        return false;
      }

      // Filter by version
      if (query.version && service.version !== query.version) {
        return false;
      }

      // Filter by tags
      if (query.tags && query.tags.length > 0) {
        const hasAllTags = query.tags.every(tag => service.tags.includes(tag));
        if (!hasAllTags) {
          return false;
        }
      }

      // Filter by metadata
      if (query.metadata) {
        for (const [key, value] of Object.entries(query.metadata)) {
          if (service.metadata[key] !== value) {
            return false;
          }
        }
      }

      return true;
    });
  }

  /**
   * Get a specific service by ID
   */
  async getService(serviceId: string): Promise<ServiceRegistration | null> {
    return this.services.get(serviceId) || null;
  }

  /**
   * Update service heartbeat
   */
  async updateHeartbeat(serviceId: string): Promise<void> {
    const service = this.services.get(serviceId);
    if (!service) {
      throw new Error(`Service not found: ${serviceId}`);
    }

    service.lastHeartbeat = new Date();
    this.services.set(serviceId, service);

    // Update in database
    await this.updateServiceInDatabase(serviceId, { lastHeartbeat: service.lastHeartbeat });

    logger.debug('Service heartbeat updated', { serviceId, name: service.name });
  }

  /**
   * Update service status
   */
  async updateStatus(
    serviceId: string, 
    status: ServiceStatus, 
    details?: Record<string, any>
  ): Promise<void> {
    const service = this.services.get(serviceId);
    if (!service) {
      throw new Error(`Service not found: ${serviceId}`);
    }

    const previousStatus = service.status;
    service.status = status;
    
    if (details) {
      service.metadata = { ...service.metadata, ...details };
    }

    this.services.set(serviceId, service);

    // Update in database
    await this.updateServiceInDatabase(serviceId, { 
      status, 
      metadata: service.metadata 
    });

    logger.info('Service status updated', {
      serviceId,
      name: service.name,
      previousStatus,
      newStatus: status,
      details
    });
  }

  /**
   * Get all registered services
   */
  async getAllServices(): Promise<ServiceRegistration[]> {
    return Array.from(this.services.values());
  }

  /**
   * Clean up stale services
   */
  async cleanup(): Promise<void> {
    const now = Date.now();
    const staleServices: string[] = [];

    for (const [serviceId, service] of this.services.entries()) {
      const timeSinceHeartbeat = now - service.lastHeartbeat.getTime();
      
      if (timeSinceHeartbeat > this.config.registrationTtl) {
        staleServices.push(serviceId);
      }
    }

    for (const serviceId of staleServices) {
      const service = this.services.get(serviceId);
      logger.warn('Removing stale service', {
        serviceId,
        name: service?.name,
        lastHeartbeat: service?.lastHeartbeat
      });

      await this.deregister(serviceId);
    }

    if (staleServices.length > 0) {
      logger.info('Cleanup completed', { removedServices: staleServices.length });
    }
  }

  /**
   * Start cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(async () => {
      try {
        await this.cleanup();
      } catch (error) {
        logger.error('Error during service cleanup', { error: error.message });
      }
    }, this.config.cleanupInterval);
  }

  /**
   * Stop cleanup timer
   */
  stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Load services from database on startup
   */
  private async loadServicesFromDatabase(): Promise<void> {
    try {
      const query = `
        SELECT id, name, version, host, port, protocol, endpoints, metadata, 
               registered_at, last_heartbeat, status, tags
        FROM service_registrations 
        WHERE status != 'stopping'
      `;

      const result = await DatabaseService.query(query);
      
      for (const row of result.rows) {
        const service: ServiceRegistration = {
          id: row.id,
          name: row.name,
          version: row.version,
          host: row.host,
          port: row.port,
          protocol: row.protocol,
          endpoints: JSON.parse(row.endpoints || '[]'),
          metadata: JSON.parse(row.metadata || '{}'),
          registeredAt: new Date(row.registered_at),
          lastHeartbeat: new Date(row.last_heartbeat),
          status: row.status,
          tags: JSON.parse(row.tags || '[]')
        };

        this.services.set(service.id, service);
      }

      logger.info('Loaded services from database', { count: result.rows.length });
    } catch (error) {
      logger.error('Failed to load services from database', { error: error.message });
    }
  }

  /**
   * Persist service registration to database
   */
  private async persistServiceRegistration(service: ServiceRegistration): Promise<void> {
    try {
      const query = `
        INSERT INTO service_registrations (
          id, name, version, host, port, protocol, endpoints, metadata,
          registered_at, last_heartbeat, status, tags
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          version = EXCLUDED.version,
          host = EXCLUDED.host,
          port = EXCLUDED.port,
          protocol = EXCLUDED.protocol,
          endpoints = EXCLUDED.endpoints,
          metadata = EXCLUDED.metadata,
          last_heartbeat = EXCLUDED.last_heartbeat,
          status = EXCLUDED.status,
          tags = EXCLUDED.tags
      `;

      await DatabaseService.query(query, [
        service.id,
        service.name,
        service.version,
        service.host,
        service.port,
        service.protocol,
        JSON.stringify(service.endpoints),
        JSON.stringify(service.metadata),
        service.registeredAt,
        service.lastHeartbeat,
        service.status,
        JSON.stringify(service.tags)
      ]);
    } catch (error) {
      logger.error('Failed to persist service registration', { 
        error: error.message,
        serviceId: service.id 
      });
      throw error;
    }
  }

  /**
   * Update service in database
   */
  private async updateServiceInDatabase(
    serviceId: string, 
    updates: Partial<ServiceRegistration>
  ): Promise<void> {
    try {
      const setParts: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      for (const [key, value] of Object.entries(updates)) {
        if (key === 'endpoints' || key === 'metadata' || key === 'tags') {
          setParts.push(`${key} = $${paramIndex}`);
          values.push(JSON.stringify(value));
        } else {
          setParts.push(`${key} = $${paramIndex}`);
          values.push(value);
        }
        paramIndex++;
      }

      if (setParts.length === 0) return;

      const query = `
        UPDATE service_registrations 
        SET ${setParts.join(', ')}
        WHERE id = $${paramIndex}
      `;

      values.push(serviceId);
      await DatabaseService.query(query, values);
    } catch (error) {
      logger.error('Failed to update service in database', { 
        error: error.message,
        serviceId 
      });
    }
  }

  /**
   * Remove service from database
   */
  private async removeServiceFromDatabase(serviceId: string): Promise<void> {
    try {
      const query = 'DELETE FROM service_registrations WHERE id = $1';
      await DatabaseService.query(query, [serviceId]);
    } catch (error) {
      logger.error('Failed to remove service from database', { 
        error: error.message,
        serviceId 
      });
    }
  }

  /**
   * Shutdown the service registry
   */
  async shutdown(): Promise<void> {
    this.stopCleanupTimer();
    logger.info('Service registry shutdown completed');
  }
}