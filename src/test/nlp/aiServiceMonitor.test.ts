import { AIServiceMonitor } from '../../services/nlp/aiServiceMonitor';
import { ClaudeApiClient } from '../../services/nlp/claudeApiClient';

// Mock the ClaudeApiClient
jest.mock('../../services/nlp/claudeApiClient');

describe('AIServiceMonitor', () => {
  let monitor: AIServiceMonitor;
  let mockClaudeClient: jest.Mocked<ClaudeApiClient>;

  beforeEach(() => {
    mockClaudeClient = {
      testConnection: jest.fn()
    } as any;
    
    monitor = new AIServiceMonitor(mockClaudeClient);
    jest.clearAllMocks();
  });

  afterEach(() => {
    monitor.stopMonitoring();
  });

  describe('constructor', () => {
    it('should initialize with healthy status', () => {
      const status = monitor.getStatus();
      
      expect(status.service).toBe('claude');
      expect(status.status).toBe('healthy');
      expect(status.consecutiveFailures).toBe(0);
      expect(status.uptime).toBe(100);
    });
  });

  describe('isServiceAvailable', () => {
    it('should return true when service is healthy', () => {
      expect(monitor.isServiceAvailable()).toBe(true);
    });

    it('should return true when service is degraded', () => {
      // Simulate degraded state by making the service slow but working
      mockClaudeClient.testConnection.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve(true), 15000))
      );
      
      expect(monitor.isServiceAvailable()).toBe(true);
    });
  });

  describe('isServiceHealthy', () => {
    it('should return true when service is healthy', () => {
      expect(monitor.isServiceHealthy()).toBe(true);
    });
  });

  describe('forceHealthCheck', () => {
    it('should perform health check and return status', async () => {
      mockClaudeClient.testConnection.mockResolvedValue(true);

      const status = await monitor.forceHealthCheck();

      expect(mockClaudeClient.testConnection).toHaveBeenCalled();
      expect(status.status).toBe('healthy');
      expect(status.consecutiveFailures).toBe(0);
    });

    it('should handle connection failures', async () => {
      mockClaudeClient.testConnection.mockResolvedValue(false);

      const status = await monitor.forceHealthCheck();

      expect(status.status).toBe('degraded');
      expect(status.consecutiveFailures).toBe(1);
      expect(status.lastError).toBe('Connection test failed');
    });

    it('should handle connection errors', async () => {
      const error = new Error('Network error');
      mockClaudeClient.testConnection.mockRejectedValue(error);

      const status = await monitor.forceHealthCheck();

      expect(status.status).toBe('degraded');
      expect(status.consecutiveFailures).toBe(1);
      expect(status.lastError).toBe('Network error');
    });

    it('should mark service as unavailable after consecutive failures', async () => {
      mockClaudeClient.testConnection.mockResolvedValue(false);

      // Perform multiple failed checks
      await monitor.forceHealthCheck();
      await monitor.forceHealthCheck();
      const status = await monitor.forceHealthCheck();

      expect(status.status).toBe('unavailable');
      expect(status.consecutiveFailures).toBe(3);
    });

    it('should track response time for successful checks', async () => {
      mockClaudeClient.testConnection.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve(true), 100))
      );

      const status = await monitor.forceHealthCheck();

      expect(status.responseTime).toBeGreaterThan(90);
      expect(status.responseTime).toBeLessThan(200);
    });
  });

  describe('event emission', () => {
    it('should emit statusUpdate events', async () => {
      const statusUpdateSpy = jest.fn();
      monitor.on('statusUpdate', statusUpdateSpy);

      mockClaudeClient.testConnection.mockResolvedValue(true);
      await monitor.forceHealthCheck();

      expect(statusUpdateSpy).toHaveBeenCalledWith(expect.objectContaining({
        service: 'claude',
        status: 'healthy'
      }));
    });

    it('should emit serviceHealthy events', async () => {
      const serviceHealthySpy = jest.fn();
      monitor.on('serviceHealthy', serviceHealthySpy);

      mockClaudeClient.testConnection.mockResolvedValue(true);
      await monitor.forceHealthCheck();

      expect(serviceHealthySpy).toHaveBeenCalled();
    });

    it('should emit serviceDegraded events', async () => {
      const serviceDegradedSpy = jest.fn();
      monitor.on('serviceDegraded', serviceDegradedSpy);

      mockClaudeClient.testConnection.mockResolvedValue(false);
      await monitor.forceHealthCheck();

      expect(serviceDegradedSpy).toHaveBeenCalled();
    });

    it('should emit serviceUnavailable events', async () => {
      const serviceUnavailableSpy = jest.fn();
      monitor.on('serviceUnavailable', serviceUnavailableSpy);

      mockClaudeClient.testConnection.mockResolvedValue(false);
      
      // Trigger multiple failures to reach unavailable state
      await monitor.forceHealthCheck();
      await monitor.forceHealthCheck();
      await monitor.forceHealthCheck();

      expect(serviceUnavailableSpy).toHaveBeenCalled();
    });

    it('should emit alert events for service recovery', async () => {
      const alertSpy = jest.fn();
      monitor.on('alert', alertSpy);

      // First make service unavailable
      mockClaudeClient.testConnection.mockResolvedValue(false);
      await monitor.forceHealthCheck();
      await monitor.forceHealthCheck();
      await monitor.forceHealthCheck();

      // Then recover
      mockClaudeClient.testConnection.mockResolvedValue(true);
      await monitor.forceHealthCheck();

      expect(alertSpy).toHaveBeenCalledWith(expect.objectContaining({
        level: 'warning',
        message: 'AI service has recovered and is now available'
      }));
    });
  });

  describe('uptime tracking', () => {
    it('should calculate uptime correctly', async () => {
      mockClaudeClient.testConnection
        .mockResolvedValueOnce(true)   // Success
        .mockResolvedValueOnce(false)  // Failure
        .mockResolvedValueOnce(true)   // Success
        .mockResolvedValueOnce(true);  // Success

      await monitor.forceHealthCheck();
      await monitor.forceHealthCheck();
      await monitor.forceHealthCheck();
      await monitor.forceHealthCheck();

      const stats = monitor.getUptimeStats();
      expect(stats.current).toBe(75); // 3 out of 4 successful
      expect(stats.totalChecks).toBe(4);
      expect(stats.successfulChecks).toBe(3);
    });
  });

  describe('resetFailureCount', () => {
    it('should reset consecutive failures', async () => {
      mockClaudeClient.testConnection.mockResolvedValue(false);
      
      await monitor.forceHealthCheck();
      await monitor.forceHealthCheck();
      
      expect(monitor.getStatus().consecutiveFailures).toBe(2);
      
      monitor.resetFailureCount();
      
      expect(monitor.getStatus().consecutiveFailures).toBe(0);
    });
  });

  describe('startMonitoring and stopMonitoring', () => {
    it('should start and stop monitoring', () => {
      expect(() => {
        monitor.startMonitoring(1000);
        monitor.stopMonitoring();
      }).not.toThrow();
    });

    it('should stop existing monitoring when starting new monitoring', () => {
      monitor.startMonitoring(1000);
      monitor.startMonitoring(2000); // Should stop the first one
      monitor.stopMonitoring();
    });
  });
});