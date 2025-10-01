/**
 * Unit Tests for Circuit Breaker
 */

import { CircuitBreaker, CircuitBreakerError } from '../../services/interServiceCommunication/circuitBreaker';
import { CircuitBreakerState } from '../../types/interServiceCommunication';

// Mock logger
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    jest.clearAllMocks();
    circuitBreaker = new CircuitBreaker('test-service', {
      failureThreshold: 3,
      recoveryTimeout: 1000, // 1 second for testing
      halfOpenMaxCalls: 2
    });
  });

  describe('closed state', () => {
    it('should execute operations successfully in closed state', async () => {
      const operation = jest.fn().mockResolvedValue('success');

      const result = await circuitBreaker.execute(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should remain closed after successful operations', async () => {
      const operation = jest.fn().mockResolvedValue('success');

      await circuitBreaker.execute(operation);
      await circuitBreaker.execute(operation);
      await circuitBreaker.execute(operation);

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should open after failure threshold is reached', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Service error'));

      // Execute operations that will fail
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(operation);
        } catch (error) {
          // Expected to fail
        }
      }

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should reset failure count on success', async () => {
      const failingOperation = jest.fn().mockRejectedValue(new Error('Service error'));
      const successOperation = jest.fn().mockResolvedValue('success');

      // Fail twice (below threshold)
      try {
        await circuitBreaker.execute(failingOperation);
      } catch (error) {
        // Expected
      }
      try {
        await circuitBreaker.execute(failingOperation);
      } catch (error) {
        // Expected
      }

      // Succeed once (should reset failure count)
      await circuitBreaker.execute(successOperation);

      // Fail twice more (should not open circuit)
      try {
        await circuitBreaker.execute(failingOperation);
      } catch (error) {
        // Expected
      }
      try {
        await circuitBreaker.execute(failingOperation);
      } catch (error) {
        // Expected
      }

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });
  });

  describe('open state', () => {
    beforeEach(async () => {
      // Force circuit to open state
      const operation = jest.fn().mockRejectedValue(new Error('Service error'));
      
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(operation);
        } catch (error) {
          // Expected to fail
        }
      }
    });

    it('should reject operations immediately in open state', async () => {
      const operation = jest.fn().mockResolvedValue('success');

      await expect(circuitBreaker.execute(operation))
        .rejects.toThrow(CircuitBreakerError);

      expect(operation).not.toHaveBeenCalled();
    });

    it('should transition to half-open after recovery timeout', async () => {
      const operation = jest.fn().mockResolvedValue('success');

      // Wait for recovery timeout
      await new Promise(resolve => setTimeout(resolve, 1100));

      await circuitBreaker.execute(operation);

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe('half-open state', () => {
    beforeEach(async () => {
      // Force circuit to half-open state
      circuitBreaker.forceState(CircuitBreakerState.HALF_OPEN);
    });

    it('should allow limited operations in half-open state', async () => {
      const operation = jest.fn().mockResolvedValue('success');

      // Should allow up to halfOpenMaxCalls (2)
      await circuitBreaker.execute(operation);
      await circuitBreaker.execute(operation);

      expect(operation).toHaveBeenCalledTimes(2);
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should close circuit after successful operations', async () => {
      const operation = jest.fn().mockResolvedValue('success');

      await circuitBreaker.execute(operation);
      await circuitBreaker.execute(operation);

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should open circuit on any failure', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Service error'));

      try {
        await circuitBreaker.execute(operation);
      } catch (error) {
        // Expected to fail
      }

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });

    it('should reject operations after max calls reached', async () => {
      const operation = jest.fn().mockResolvedValue('success');

      // Execute max calls
      await circuitBreaker.execute(operation);
      await circuitBreaker.execute(operation);

      // Reset to half-open for testing
      circuitBreaker.forceState(CircuitBreakerState.HALF_OPEN);
      
      // This should be rejected as we've exceeded max calls
      await expect(circuitBreaker.execute(operation))
        .rejects.toThrow(CircuitBreakerError);
    });
  });

  describe('metrics', () => {
    it('should track success and failure counts', async () => {
      const successOperation = jest.fn().mockResolvedValue('success');
      const failOperation = jest.fn().mockRejectedValue(new Error('Service error'));

      await circuitBreaker.execute(successOperation);
      await circuitBreaker.execute(successOperation);

      try {
        await circuitBreaker.execute(failOperation);
      } catch (error) {
        // Expected
      }

      const metrics = circuitBreaker.getMetrics();
      expect(metrics.successCount).toBe(2);
      expect(metrics.failureCount).toBe(1);
      expect(metrics.lastSuccessTime).toBeDefined();
      expect(metrics.lastFailureTime).toBeDefined();
    });

    it('should track state transitions', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Service error'));

      // Start in closed state
      expect(circuitBreaker.getMetrics().state).toBe(CircuitBreakerState.CLOSED);

      // Fail enough times to open circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(operation);
        } catch (error) {
          // Expected
        }
      }

      expect(circuitBreaker.getMetrics().state).toBe(CircuitBreakerState.OPEN);
    });
  });

  describe('reset', () => {
    it('should reset circuit breaker to initial state', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Service error'));

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(operation);
        } catch (error) {
          // Expected
        }
      }

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);

      // Reset
      circuitBreaker.reset();

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
      expect(circuitBreaker.getMetrics().failureCount).toBe(0);
      expect(circuitBreaker.getMetrics().successCount).toBe(0);
    });
  });
});