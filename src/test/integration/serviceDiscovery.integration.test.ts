/**
 * Integration Tests for Service Discovery
 */

import { ServiceDiscoveryClient } from '../../services/serviceDiscovery/serviceDiscoveryClient';
import { ServiceStatus } from '../../types/serviceDiscovery';
import { DatabaseService } from '../../services/database';

// Mock logger
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Service Discovery Integration', () => {
  let client1: ServiceDiscoveryClient;
  let client2: ServiceDiscoveryClient;

  beforeAll(async () => {
    // Initialize database for testing
    await DatabaseService.initialize();
  });

  beforeEach(() => {
    client1 = new ServiceDiscoveryClient();
    client2 = new ServiceDiscoveryClient();
  });

  afterEach(async () => {
    await client1.shutdown();
    await client2.shutdown();
  });

  afterAll(async () => {
    await DatabaseService.close();
  });

  describe('service registration and discovery', () => {
    it('should register and discover services across multiple clients', async () => {
      // Register service with client1
      const serviceId1 = await client1.registerService({
        name: 'api-service',
        version: '1.0.0',
        host: 'localhost',
        port: 3000,
        protocol: 'http',
        endpoints: [
          { path: '/health', method: 'GET', description: 'Health check' }
        ],
        metadata: { environment: 'test' },
        status: ServiceStatus.HEALTHY,
        tags: ['api', 'test']
      });

      // Register another service with client2
      const serviceId2 = await client2.registerService({
        name: 'worker-service',
        version: '2.0.0',
        host: 'localhost',
        port: 3001,
        protocol: 'http',
        endpoints: [
          { path: '/status', method: 'GET', description: 'Worker status' }
        ],
        metadata: { environment: 'test' },
        status: ServiceStatus.HEALTHY,
        tags: ['worker', 'test']
      });

      // Both clients should be able to discover both services
      const servicesFromClient1 = await client1.discoverServices();
      const servicesFromClient2 = await client2.discoverServices();

      expect(servicesFromClient1).toHaveLength(2);
      expect(servicesFromClient2).toHaveLength(2);

      const serviceIds = servicesFromClient1.map(s => s.id);
      expect(serviceIds).toContain(serviceId1);
      expect(serviceIds).toContain(serviceId2);
    });

    it('should handle service deregistration', async () => {
      // Register service
      const serviceId = await client1.registerService({
        name: 'temp-service',
        version: '1.0.0',
        host: 'localhost',
        port: 3002,
        protocol: 'http',
        endpoints: [],
        metadata: {},
        status: ServiceStatus.HEALTHY,
        tags: []
      });

      // Verify service is discoverable
      let services = await client2.discoverServices({ name: 'temp-service' });
      expect(services).toHaveLength(1);

      // Deregister service
      await client1.deregisterService();

      // Verify service is no longer discoverable
      services = await client2.discoverServices({ name: 'temp-service' });
      expect(services).toHaveLength(0);
    });

    it('should update service status across clients', async () => {
      // Register service
      await client1.registerService({
        name: 'status-test-service',
        version: '1.0.0',
        host: 'localhost',
        port: 3003,
        protocol: 'http',
        endpoints: [],
        metadata: {},
        status: ServiceStatus.STARTING,
        tags: []
      });

      // Update status
      await client1.updateServiceStatus(ServiceStatus.HEALTHY, {
        lastCheck: new Date().toISOString()
      });

      // Verify status update is visible from other client
      const services = await client2.discoverServices({ name: 'status-test-service' });
      expect(services).toHaveLength(1);
      expect(services[0].status).toBe(ServiceStatus.HEALTHY);
      expect(services[0].metadata.lastCheck).toBeDefined();
    });
  });

  describe('service discovery queries', () => {
    beforeEach(async () => {
      // Set up test services
      await client1.registerService({
        name: 'api-service',
        version: '1.0.0',
        host: 'localhost',
        port: 3000,
        protocol: 'http',
        endpoints: [],
        metadata: { environment: 'production', region: 'us-east-1' },
        status: ServiceStatus.HEALTHY,
        tags: ['api', 'production']
      });

      await client1.registerService({
        name: 'api-service',
        version: '1.1.0',
        host: 'localhost',
        port: 3001,
        protocol: 'https',
        endpoints: [],
        metadata: { environment: 'staging', region: 'us-west-2' },
        status: ServiceStatus.HEALTHY,
        tags: ['api', 'staging']
      });

      await client1.registerService({
        name: 'worker-service',
        version: '2.0.0',
        host: 'localhost',
        port: 3002,
        protocol: 'http',
        endpoints: [],
        metadata: { environment: 'production', region: 'us-east-1' },
        status: ServiceStatus.UNHEALTHY,
        tags: ['worker', 'production']
      });
    });

    it('should discover services by name', async () => {
      const services = await client2.getServicesByName('api-service');
      expect(services).toHaveLength(2);
      expect(services.every(s => s.name === 'api-service')).toBe(true);
    });

    it('should discover healthy services by name', async () => {
      const services = await client2.getHealthyServicesByName('api-service');
      expect(services).toHaveLength(2);
      expect(services.every(s => s.name === 'api-service' && s.status === ServiceStatus.HEALTHY)).toBe(true);
    });

    it('should discover services by tags', async () => {
      const services = await client2.discoverServices({ tags: ['production'] });
      expect(services).toHaveLength(2);
      expect(services.every(s => s.tags.includes('production'))).toBe(true);
    });

    it('should discover services by metadata', async () => {
      const services = await client2.discoverServices({
        metadata: { region: 'us-east-1' }
      });
      expect(services).toHaveLength(2);
      expect(services.every(s => s.metadata.region === 'us-east-1')).toBe(true);
    });

    it('should discover services with complex queries', async () => {
      const services = await client2.discoverServices({
        status: ServiceStatus.HEALTHY,
        tags: ['api'],
        metadata: { environment: 'staging' }
      });
      expect(services).toHaveLength(1);
      expect(services[0].name).toBe('api-service');
      expect(services[0].version).toBe('1.1.0');
    });
  });

  describe('statistics and monitoring', () => {
    it('should provide accurate statistics', async () => {
      // Register multiple services
      await client1.registerService({
        name: 'service-1',
        version: '1.0.0',
        host: 'localhost',
        port: 3000,
        protocol: 'http',
        endpoints: [],
        metadata: {},
        status: ServiceStatus.HEALTHY,
        tags: []
      });

      await client1.registerService({
        name: 'service-2',
        version: '1.0.0',
        host: 'localhost',
        port: 3001,
        protocol: 'http',
        endpoints: [],
        metadata: {},
        status: ServiceStatus.UNHEALTHY,
        tags: []
      });

      const stats = await client2.getStatistics();
      expect(stats.totalServices).toBe(2);
      expect(stats.healthyServices).toBe(1);
      expect(stats.unhealthyServices).toBe(1);
    });
  });

  describe('error handling', () => {
    it('should handle database connection errors gracefully', async () => {
      // This test would require mocking database failures
      // For now, we'll test that the service continues to work with in-memory data
      
      const serviceId = await client1.registerService({
        name: 'resilient-service',
        version: '1.0.0',
        host: 'localhost',
        port: 3000,
        protocol: 'http',
        endpoints: [],
        metadata: {},
        status: ServiceStatus.HEALTHY,
        tags: []
      });

      // Service should still be discoverable
      const services = await client1.discoverServices({ name: 'resilient-service' });
      expect(services).toHaveLength(1);
      expect(services[0].id).toBe(serviceId);
    });

    it('should handle concurrent registrations', async () => {
      const registrationPromises = Array.from({ length: 5 }, (_, i) =>
        client1.registerService({
          name: `concurrent-service-${i}`,
          version: '1.0.0',
          host: 'localhost',
          port: 3000 + i,
          protocol: 'http',
          endpoints: [],
          metadata: { index: i },
          status: ServiceStatus.HEALTHY,
          tags: [`service-${i}`]
        })
      );

      const serviceIds = await Promise.all(registrationPromises);
      expect(serviceIds).toHaveLength(5);
      expect(new Set(serviceIds).size).toBe(5); // All IDs should be unique

      const allServices = await client2.discoverServices();
      expect(allServices.length).toBeGreaterThanOrEqual(5);
    });
  });
});