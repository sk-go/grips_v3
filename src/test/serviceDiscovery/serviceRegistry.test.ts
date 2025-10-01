/**
 * Unit Tests for Service Registry
 */

import { ServiceRegistry } from '../../services/serviceDiscovery/serviceRegistry';
import { ServiceStatus } from '../../types/serviceDiscovery';
import { DatabaseService } from '../../services/database';

// Mock database service
jest.mock('../../services/database', () => ({
  DatabaseService: {
    query: jest.fn(),
  },
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('ServiceRegistry', () => {
  let serviceRegistry: ServiceRegistry;
  const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDatabaseService.query.mockResolvedValue({ rows: [] });
    serviceRegistry = new ServiceRegistry();
  });

  afterEach(async () => {
    await serviceRegistry.shutdown();
  });

  describe('register', () => {
    it('should successfully register a new service', async () => {
      const service = {
        name: 'test-service',
        version: '1.0.0',
        host: 'localhost',
        port: 3000,
        protocol: 'http' as const,
        endpoints: [
          { path: '/health', method: 'GET' as const, description: 'Health check', healthCheck: true }
        ],
        metadata: { environment: 'test' },
        status: ServiceStatus.HEALTHY,
        tags: ['api', 'test']
      };

      const serviceId = await serviceRegistry.register(service);

      expect(serviceId).toBeDefined();
      expect(serviceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO service_registrations'),
        expect.arrayContaining([serviceId, service.name, service.version])
      );
    });

    it('should handle database errors during registration', async () => {
      mockDatabaseService.query.mockRejectedValue(new Error('Database error'));

      const service = {
        name: 'test-service',
        version: '1.0.0',
        host: 'localhost',
        port: 3000,
        protocol: 'http' as const,
        endpoints: [],
        metadata: {},
        status: ServiceStatus.HEALTHY,
        tags: []
      };

      await expect(serviceRegistry.register(service)).rejects.toThrow('Database error');
    });
  });

  describe('discover', () => {
    beforeEach(async () => {
      // Register test services
      await serviceRegistry.register({
        name: 'api-service',
        version: '1.0.0',
        host: 'localhost',
        port: 3000,
        protocol: 'http',
        endpoints: [],
        metadata: { environment: 'production' },
        status: ServiceStatus.HEALTHY,
        tags: ['api', 'production']
      });

      await serviceRegistry.register({
        name: 'worker-service',
        version: '2.0.0',
        host: 'localhost',
        port: 3001,
        protocol: 'http',
        endpoints: [],
        metadata: { environment: 'development' },
        status: ServiceStatus.UNHEALTHY,
        tags: ['worker', 'development']
      });

      await serviceRegistry.register({
        name: 'api-service',
        version: '1.1.0',
        host: 'localhost',
        port: 3002,
        protocol: 'https',
        endpoints: [],
        metadata: { environment: 'staging' },
        status: ServiceStatus.HEALTHY,
        tags: ['api', 'staging']
      });
    });

    it('should discover services by name', async () => {
      const services = await serviceRegistry.discover({ name: 'api-service' });

      expect(services).toHaveLength(2);
      expect(services.every(s => s.name === 'api-service')).toBe(true);
    });

    it('should discover services by status', async () => {
      const services = await serviceRegistry.discover({ status: ServiceStatus.HEALTHY });

      expect(services).toHaveLength(2);
      expect(services.every(s => s.status === ServiceStatus.HEALTHY)).toBe(true);
    });

    it('should discover services by tags', async () => {
      const services = await serviceRegistry.discover({ tags: ['api'] });

      expect(services).toHaveLength(2);
      expect(services.every(s => s.tags.includes('api'))).toBe(true);
    });

    it('should discover services by metadata', async () => {
      const services = await serviceRegistry.discover({ 
        metadata: { environment: 'production' } 
      });

      expect(services).toHaveLength(1);
      expect(services[0].metadata.environment).toBe('production');
    });

    it('should discover services with multiple criteria', async () => {
      const services = await serviceRegistry.discover({
        name: 'api-service',
        status: ServiceStatus.HEALTHY,
        tags: ['staging']
      });

      expect(services).toHaveLength(1);
      expect(services[0].name).toBe('api-service');
      expect(services[0].status).toBe(ServiceStatus.HEALTHY);
      expect(services[0].tags).toContain('staging');
    });

    it('should return empty array when no services match criteria', async () => {
      const services = await serviceRegistry.discover({ name: 'non-existent-service' });

      expect(services).toHaveLength(0);
    });
  });

  describe('updateHeartbeat', () => {
    it('should successfully update service heartbeat', async () => {
      const serviceId = await serviceRegistry.register({
        name: 'test-service',
        version: '1.0.0',
        host: 'localhost',
        port: 3000,
        protocol: 'http',
        endpoints: [],
        metadata: {},
        status: ServiceStatus.HEALTHY,
        tags: []
      });

      const beforeUpdate = await serviceRegistry.getService(serviceId);
      const originalHeartbeat = beforeUpdate!.lastHeartbeat;

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      await serviceRegistry.updateHeartbeat(serviceId);

      const afterUpdate = await serviceRegistry.getService(serviceId);
      expect(afterUpdate!.lastHeartbeat.getTime()).toBeGreaterThan(originalHeartbeat.getTime());
    });

    it('should throw error for non-existent service', async () => {
      await expect(serviceRegistry.updateHeartbeat('non-existent-id'))
        .rejects.toThrow('Service not found: non-existent-id');
    });
  });

  describe('updateStatus', () => {
    it('should successfully update service status', async () => {
      const serviceId = await serviceRegistry.register({
        name: 'test-service',
        version: '1.0.0',
        host: 'localhost',
        port: 3000,
        protocol: 'http',
        endpoints: [],
        metadata: {},
        status: ServiceStatus.STARTING,
        tags: []
      });

      await serviceRegistry.updateStatus(serviceId, ServiceStatus.HEALTHY, {
        lastCheck: new Date().toISOString()
      });

      const service = await serviceRegistry.getService(serviceId);
      expect(service!.status).toBe(ServiceStatus.HEALTHY);
      expect(service!.metadata.lastCheck).toBeDefined();
    });

    it('should throw error for non-existent service', async () => {
      await expect(serviceRegistry.updateStatus('non-existent-id', ServiceStatus.HEALTHY))
        .rejects.toThrow('Service not found: non-existent-id');
    });
  });

  describe('deregister', () => {
    it('should successfully deregister a service', async () => {
      const serviceId = await serviceRegistry.register({
        name: 'test-service',
        version: '1.0.0',
        host: 'localhost',
        port: 3000,
        protocol: 'http',
        endpoints: [],
        metadata: {},
        status: ServiceStatus.HEALTHY,
        tags: []
      });

      await serviceRegistry.deregister(serviceId);

      const service = await serviceRegistry.getService(serviceId);
      expect(service).toBeNull();
    });

    it('should throw error for non-existent service', async () => {
      await expect(serviceRegistry.deregister('non-existent-id'))
        .rejects.toThrow('Service not found: non-existent-id');
    });
  });

  describe('cleanup', () => {
    it('should remove stale services', async () => {
      const serviceId = await serviceRegistry.register({
        name: 'test-service',
        version: '1.0.0',
        host: 'localhost',
        port: 3000,
        protocol: 'http',
        endpoints: [],
        metadata: {},
        status: ServiceStatus.HEALTHY,
        tags: []
      });

      // Manually set old heartbeat to simulate stale service
      const service = await serviceRegistry.getService(serviceId);
      if (service) {
        service.lastHeartbeat = new Date(Date.now() - 400000); // 6+ minutes ago
        await serviceRegistry.updateHeartbeat(serviceId);
      }

      const beforeCleanup = await serviceRegistry.getAllServices();
      expect(beforeCleanup).toHaveLength(1);

      await serviceRegistry.cleanup();

      const afterCleanup = await serviceRegistry.getAllServices();
      expect(afterCleanup).toHaveLength(0);
    });

    it('should not remove healthy services', async () => {
      await serviceRegistry.register({
        name: 'test-service',
        version: '1.0.0',
        host: 'localhost',
        port: 3000,
        protocol: 'http',
        endpoints: [],
        metadata: {},
        status: ServiceStatus.HEALTHY,
        tags: []
      });

      const beforeCleanup = await serviceRegistry.getAllServices();
      expect(beforeCleanup).toHaveLength(1);

      await serviceRegistry.cleanup();

      const afterCleanup = await serviceRegistry.getAllServices();
      expect(afterCleanup).toHaveLength(1);
    });
  });
});