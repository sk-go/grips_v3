/**
 * Unit Tests for Health Monitor
 */

import axios from 'axios';
import { HealthMonitor } from '../../services/serviceDiscovery/healthMonitor';
import { ServiceStatus } from '../../types/serviceDiscovery';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock logger
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('HealthMonitor', () => {
  let healthMonitor: HealthMonitor;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    healthMonitor = new HealthMonitor();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await healthMonitor.shutdown();
  });

  describe('startMonitoring', () => {
    it('should start monitoring a service successfully', async () => {
      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: { status: 'ok' }
      });

      const healthCheck = {
        endpoint: 'http://localhost:3000/health',
        interval: 60000,
        timeout: 5000,
        retries: 3
      };

      await healthMonitor.startMonitoring('service-1', healthCheck);

      const status = await healthMonitor.getHealthStatus('service-1');
      expect(status).toBeDefined();
      expect(status!.status).toBe(ServiceStatus.HEALTHY);
    });

    it('should perform periodic health checks', async () => {
      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: { status: 'ok' }
      });

      const healthCheck = {
        endpoint: 'http://localhost:3000/health',
        interval: 1000, // 1 second for testing
        timeout: 5000,
        retries: 3
      };

      await healthMonitor.startMonitoring('service-1', healthCheck);

      // Initial call
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);

      // Advance timer to trigger periodic check
      jest.advanceTimersByTime(1000);
      await Promise.resolve(); // Allow async operations to complete

      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });

    it('should stop existing monitoring when starting new monitoring for same service', async () => {
      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: { status: 'ok' }
      });

      const healthCheck1 = {
        endpoint: 'http://localhost:3000/health',
        interval: 60000,
        timeout: 5000,
        retries: 3
      };

      const healthCheck2 = {
        endpoint: 'http://localhost:3001/health',
        interval: 30000,
        timeout: 3000,
        retries: 2
      };

      await healthMonitor.startMonitoring('service-1', healthCheck1);
      await healthMonitor.startMonitoring('service-1', healthCheck2);

      // Should have called the new endpoint
      expect(mockedAxios.get).toHaveBeenLastCalledWith(
        'http://localhost:3001/health',
        expect.any(Object)
      );
    });
  });

  describe('stopMonitoring', () => {
    it('should stop monitoring a service', async () => {
      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: { status: 'ok' }
      });

      const healthCheck = {
        endpoint: 'http://localhost:3000/health',
        interval: 60000,
        timeout: 5000,
        retries: 3
      };

      await healthMonitor.startMonitoring('service-1', healthCheck);
      await healthMonitor.stopMonitoring('service-1');

      const status = await healthMonitor.getHealthStatus('service-1');
      expect(status).toBeNull();
    });
  });

  describe('health check logic', () => {
    it('should mark service as healthy for successful response', async () => {
      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: { status: 'ok' }
      });

      const healthCheck = {
        endpoint: 'http://localhost:3000/health',
        interval: 60000,
        timeout: 5000,
        retries: 3
      };

      await healthMonitor.startMonitoring('service-1', healthCheck);

      const status = await healthMonitor.getHealthStatus('service-1');
      expect(status!.status).toBe(ServiceStatus.HEALTHY);
      expect(status!.details.statusCode).toBe(200);
    });

    it('should mark service as unhealthy for failed response', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Connection refused'));

      const healthCheck = {
        endpoint: 'http://localhost:3000/health',
        interval: 60000,
        timeout: 5000,
        retries: 1 // Reduce retries for faster test
      };

      await healthMonitor.startMonitoring('service-1', healthCheck);

      const status = await healthMonitor.getHealthStatus('service-1');
      expect(status!.status).toBe(ServiceStatus.UNHEALTHY);
      expect(status!.errors).toContain('Connection refused');
    });

    it('should retry failed health checks', async () => {
      mockedAxios.get
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValue({
          status: 200,
          data: { status: 'ok' }
        });

      const healthCheck = {
        endpoint: 'http://localhost:3000/health',
        interval: 60000,
        timeout: 5000,
        retries: 3
      };

      await healthMonitor.startMonitoring('service-1', healthCheck);

      const status = await healthMonitor.getHealthStatus('service-1');
      expect(status!.status).toBe(ServiceStatus.HEALTHY);
      expect(mockedAxios.get).toHaveBeenCalledTimes(3);
    });

    it('should validate expected status code', async () => {
      mockedAxios.get.mockResolvedValue({
        status: 503,
        data: { status: 'maintenance' }
      });

      const healthCheck = {
        endpoint: 'http://localhost:3000/health',
        interval: 60000,
        timeout: 5000,
        retries: 1,
        expectedStatus: 200
      };

      await healthMonitor.startMonitoring('service-1', healthCheck);

      const status = await healthMonitor.getHealthStatus('service-1');
      expect(status!.status).toBe(ServiceStatus.UNHEALTHY);
    });

    it('should validate expected response content', async () => {
      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: { status: 'degraded' }
      });

      const healthCheck = {
        endpoint: 'http://localhost:3000/health',
        interval: 60000,
        timeout: 5000,
        retries: 1,
        expectedResponse: { status: 'ok' }
      };

      await healthMonitor.startMonitoring('service-1', healthCheck);

      const status = await healthMonitor.getHealthStatus('service-1');
      expect(status!.status).toBe(ServiceStatus.UNHEALTHY);
    });

    it('should handle timeout correctly', async () => {
      mockedAxios.get.mockImplementation(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('timeout')), 100)
        )
      );

      const healthCheck = {
        endpoint: 'http://localhost:3000/health',
        interval: 60000,
        timeout: 50, // Very short timeout
        retries: 1
      };

      await healthMonitor.startMonitoring('service-1', healthCheck);

      const status = await healthMonitor.getHealthStatus('service-1');
      expect(status!.status).toBe(ServiceStatus.UNHEALTHY);
    });
  });

  describe('getAllHealthStatuses', () => {
    it('should return all health statuses', async () => {
      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: { status: 'ok' }
      });

      const healthCheck = {
        endpoint: 'http://localhost:3000/health',
        interval: 60000,
        timeout: 5000,
        retries: 3
      };

      await healthMonitor.startMonitoring('service-1', healthCheck);
      await healthMonitor.startMonitoring('service-2', {
        ...healthCheck,
        endpoint: 'http://localhost:3001/health'
      });

      const allStatuses = await healthMonitor.getAllHealthStatuses();
      expect(allStatuses.size).toBe(2);
      expect(allStatuses.has('service-1')).toBe(true);
      expect(allStatuses.has('service-2')).toBe(true);
    });
  });

  describe('getMonitoringStats', () => {
    it('should return monitoring statistics', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({ status: 200, data: { status: 'ok' } })
        .mockRejectedValueOnce(new Error('Connection refused'));

      const healthCheck = {
        endpoint: 'http://localhost:3000/health',
        interval: 60000,
        timeout: 5000,
        retries: 1
      };

      await healthMonitor.startMonitoring('service-1', healthCheck);
      await healthMonitor.startMonitoring('service-2', {
        ...healthCheck,
        endpoint: 'http://localhost:3001/health'
      });

      const stats = healthMonitor.getMonitoringStats();
      expect(stats.activeMonitors).toBe(2);
      expect(stats.totalHealthChecks).toBe(2);
      expect(stats.healthyServices).toBe(1);
      expect(stats.unhealthyServices).toBe(1);
    });
  });
});