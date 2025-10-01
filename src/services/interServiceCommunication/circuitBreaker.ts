/**
 * Circuit Breaker Implementation
 * Prevents cascading failures by monitoring service health
 */

import { logger } from '../../utils/logger';
import {
  CircuitBreakerConfig,
  CircuitBreakerState,
  CircuitBreakerMetrics
} from '../../types/interServiceCommunication';

export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime?: Date;
  private lastSuccessTime?: Date;
  private halfOpenCalls = 0;
  private nextAttemptTime = 0;

  private readonly config: CircuitBreakerConfig = {
    failureThreshold: 5,
    recoveryTimeout: 60000, // 1 minute
    monitoringPeriod: 300000, // 5 minutes
    halfOpenMaxCalls: 3,
    ...this.userConfig
  };

  constructor(
    private readonly serviceName: string,
    private readonly userConfig: Partial<CircuitBreakerConfig> = {}
  ) {
    this.config = { ...this.config, ...userConfig };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new CircuitBreakerError(
        `Circuit breaker is ${this.state} for service: ${this.serviceName}`,
        this.state
      );
    }

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.halfOpenCalls++;
    }

    const startTime = Date.now();

    try {
      const result = await operation();
      this.onSuccess();
      
      logger.debug('Circuit breaker operation succeeded', {
        serviceName: this.serviceName,
        state: this.state,
        executionTime: Date.now() - startTime
      });

      return result;
    } catch (error) {
      this.onFailure(error as Error);
      
      logger.warn('Circuit breaker operation failed', {
        serviceName: this.serviceName,
        state: this.state,
        error: error.message,
        executionTime: Date.now() - startTime
      });

      throw error;
    }
  }

  /**
   * Check if operation can be executed
   */
  private canExecute(): boolean {
    const now = Date.now();

    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        return true;

      case CircuitBreakerState.OPEN:
        if (now >= this.nextAttemptTime) {
          this.state = CircuitBreakerState.HALF_OPEN;
          this.halfOpenCalls = 0;
          logger.info('Circuit breaker transitioning to half-open', {
            serviceName: this.serviceName
          });
          return true;
        }
        return false;

      case CircuitBreakerState.HALF_OPEN:
        return this.halfOpenCalls < this.config.halfOpenMaxCalls;

      default:
        return false;
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    this.successCount++;
    this.lastSuccessTime = new Date();

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      // If we've had enough successful calls in half-open state, close the circuit
      if (this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
        this.state = CircuitBreakerState.CLOSED;
        this.failureCount = 0;
        this.halfOpenCalls = 0;
        
        logger.info('Circuit breaker closed after successful recovery', {
          serviceName: this.serviceName,
          successfulCalls: this.halfOpenCalls
        });
      }
    } else if (this.state === CircuitBreakerState.CLOSED) {
      // Reset failure count on success in closed state
      this.failureCount = 0;
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure(error: Error): void {
    this.failureCount++;
    this.lastFailureTime = new Date();

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      // Any failure in half-open state opens the circuit again
      this.openCircuit();
    } else if (this.state === CircuitBreakerState.CLOSED) {
      // Check if we've exceeded the failure threshold
      if (this.failureCount >= this.config.failureThreshold) {
        this.openCircuit();
      }
    }

    logger.warn('Circuit breaker recorded failure', {
      serviceName: this.serviceName,
      state: this.state,
      failureCount: this.failureCount,
      threshold: this.config.failureThreshold,
      error: error.message
    });
  }

  /**
   * Open the circuit breaker
   */
  private openCircuit(): void {
    this.state = CircuitBreakerState.OPEN;
    this.nextAttemptTime = Date.now() + this.config.recoveryTimeout;
    this.halfOpenCalls = 0;

    logger.error('Circuit breaker opened', {
      serviceName: this.serviceName,
      failureCount: this.failureCount,
      nextAttemptTime: new Date(this.nextAttemptTime).toISOString()
    });
  }

  /**
   * Get current metrics
   */
  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      halfOpenCalls: this.halfOpenCalls
    };
  }

  /**
   * Get current state
   */
  getState(): CircuitBreakerState {
    return this.state;
  }

  /**
   * Force circuit breaker to specific state (for testing)
   */
  forceState(state: CircuitBreakerState): void {
    this.state = state;
    if (state === CircuitBreakerState.OPEN) {
      this.nextAttemptTime = Date.now() + this.config.recoveryTimeout;
    }
  }

  /**
   * Reset circuit breaker to initial state
   */
  reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = undefined;
    this.lastSuccessTime = undefined;
    this.halfOpenCalls = 0;
    this.nextAttemptTime = 0;

    logger.info('Circuit breaker reset', { serviceName: this.serviceName });
  }
}

export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public readonly state: CircuitBreakerState
  ) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}