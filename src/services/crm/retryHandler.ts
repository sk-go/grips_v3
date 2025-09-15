/**
 * Retry Handler for CRM API Calls
 * Implements exponential backoff and retry logic for failed API calls
 */

import { CrmError, CrmAuthError, CrmRateLimitError } from './types';
import { logger } from '../../utils/logger';

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  backoffMultiplier: number;
  jitterFactor: number; // 0-1, adds randomness to prevent thundering herd
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalTime: number;
}

export class RetryHandler {
  private static defaultConfig: RetryConfig = {
    maxRetries: 3,
    baseDelay: 1000, // 1 second
    maxDelay: 30000, // 30 seconds
    backoffMultiplier: 2,
    jitterFactor: 0.1
  };

  /**
   * Execute a function with retry logic
   */
  static async executeWithRetry<T>(
    operation: () => Promise<T>,
    config: Partial<RetryConfig> = {},
    operationName: string = 'CRM Operation'
  ): Promise<RetryResult<T>> {
    const finalConfig = { ...this.defaultConfig, ...config };
    const startTime = Date.now();
    let lastError: Error | undefined;
    let attempts = 0;

    for (let attempt = 0; attempt <= finalConfig.maxRetries; attempt++) {
      attempts = attempt + 1;
      
      try {
        logger.debug(`${operationName}: Attempt ${attempts}/${finalConfig.maxRetries + 1}`);
        
        const result = await operation();
        
        const totalTime = Date.now() - startTime;
        logger.info(`${operationName}: Success after ${attempts} attempts in ${totalTime}ms`);
        
        return {
          success: true,
          result,
          attempts,
          totalTime
        };

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        logger.warn(`${operationName}: Attempt ${attempts} failed:`, {
          error: lastError.message,
          attempt: attempts,
          maxRetries: finalConfig.maxRetries
        });

        // Don't retry for certain types of errors
        if (!this.shouldRetry(lastError, attempt, finalConfig.maxRetries)) {
          break;
        }

        // Don't wait after the last attempt
        if (attempt < finalConfig.maxRetries) {
          const delay = this.calculateDelay(attempt, finalConfig);
          logger.debug(`${operationName}: Waiting ${delay}ms before retry`);
          await this.sleep(delay);
        }
      }
    }

    const totalTime = Date.now() - startTime;
    logger.error(`${operationName}: Failed after ${attempts} attempts in ${totalTime}ms`, {
      error: lastError?.message
    });

    return {
      success: false,
      error: lastError,
      attempts,
      totalTime
    };
  }

  /**
   * Determine if an error should trigger a retry
   */
  private static shouldRetry(error: Error, attempt: number, maxRetries: number): boolean {
    // Don't retry if we've reached max attempts
    if (attempt >= maxRetries) {
      return false;
    }

    // Never retry authentication errors
    if (error instanceof CrmAuthError) {
      logger.debug('Not retrying authentication error');
      return false;
    }

    // Handle rate limit errors specially
    if (error instanceof CrmRateLimitError) {
      logger.debug('Rate limit error - will retry after reset time');
      return true;
    }

    // Retry for CRM errors that are marked as retryable
    if (error instanceof CrmError) {
      logger.debug(`CRM error retryable: ${error.retryable}`);
      return error.retryable;
    }

    // Retry for network errors, timeouts, and 5xx server errors
    const retryablePatterns = [
      /network/i,
      /timeout/i,
      /econnreset/i,
      /enotfound/i,
      /econnrefused/i,
      /socket hang up/i,
      /5\d{2}/i // 5xx status codes
    ];

    const shouldRetry = retryablePatterns.some(pattern => 
      pattern.test(error.message) || pattern.test(error.name)
    );

    logger.debug(`Network/timeout error retryable: ${shouldRetry}`);
    return shouldRetry;
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  private static calculateDelay(attempt: number, config: RetryConfig): number {
    // Exponential backoff: baseDelay * (backoffMultiplier ^ attempt)
    const exponentialDelay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt);
    
    // Cap at maxDelay
    const cappedDelay = Math.min(exponentialDelay, config.maxDelay);
    
    // Add jitter to prevent thundering herd
    const jitter = cappedDelay * config.jitterFactor * Math.random();
    const finalDelay = cappedDelay + jitter;
    
    return Math.round(finalDelay);
  }

  /**
   * Handle rate limit errors with specific delay
   */
  static async handleRateLimit(error: CrmRateLimitError): Promise<void> {
    const now = new Date();
    const resetTime = error.resetTime;
    
    if (resetTime > now) {
      const waitTime = resetTime.getTime() - now.getTime();
      const maxWaitTime = 5 * 60 * 1000; // 5 minutes max
      
      const actualWaitTime = Math.min(waitTime, maxWaitTime);
      
      logger.info(`Rate limit hit for ${error.system}, waiting ${actualWaitTime}ms until reset`);
      await this.sleep(actualWaitTime);
    }
  }

  /**
   * Create retry configuration for different scenarios
   */
  static createConfig(scenario: 'fast' | 'standard' | 'patient' | 'critical'): RetryConfig {
    switch (scenario) {
      case 'fast':
        return {
          maxRetries: 2,
          baseDelay: 500,
          maxDelay: 5000,
          backoffMultiplier: 1.5,
          jitterFactor: 0.1
        };
      
      case 'standard':
        return this.defaultConfig;
      
      case 'patient':
        return {
          maxRetries: 5,
          baseDelay: 2000,
          maxDelay: 60000,
          backoffMultiplier: 2,
          jitterFactor: 0.2
        };
      
      case 'critical':
        return {
          maxRetries: 10,
          baseDelay: 1000,
          maxDelay: 120000,
          backoffMultiplier: 1.8,
          jitterFactor: 0.15
        };
      
      default:
        return this.defaultConfig;
    }
  }

  /**
   * Wrap a CRM connector method with retry logic
   */
  static wrapWithRetry<T extends any[], R>(
    method: (...args: T) => Promise<R>,
    config: Partial<RetryConfig> = {},
    methodName: string = 'CRM Method'
  ): (...args: T) => Promise<R> {
    return async (...args: T): Promise<R> => {
      const result = await this.executeWithRetry(
        () => method(...args),
        config,
        methodName
      );

      if (result.success && result.result !== undefined) {
        return result.result;
      }

      throw result.error || new Error(`${methodName} failed after ${result.attempts} attempts`);
    };
  }

  /**
   * Create a circuit breaker for CRM operations
   */
  static createCircuitBreaker(
    failureThreshold: number = 5,
    resetTimeout: number = 60000 // 1 minute
  ) {
    let failures = 0;
    let lastFailureTime = 0;
    let state: 'closed' | 'open' | 'half-open' = 'closed';

    return {
      async execute<T>(operation: () => Promise<T>, operationName: string = 'Operation'): Promise<T> {
        const now = Date.now();

        // Check if we should reset from open to half-open
        if (state === 'open' && now - lastFailureTime >= resetTimeout) {
          state = 'half-open';
          logger.info(`Circuit breaker for ${operationName}: Moving to half-open state`);
        }

        // Reject immediately if circuit is open
        if (state === 'open') {
          throw new CrmError(
            `Circuit breaker is open for ${operationName}`,
            'CIRCUIT_BREAKER_OPEN',
            'unknown' as any,
            false
          );
        }

        try {
          const result = await operation();
          
          // Success - reset failure count and close circuit
          if (state === 'half-open') {
            state = 'closed';
            failures = 0;
            logger.info(`Circuit breaker for ${operationName}: Reset to closed state`);
          }
          
          return result;

        } catch (error) {
          failures++;
          lastFailureTime = now;

          // Open circuit if threshold reached
          if (failures >= failureThreshold) {
            state = 'open';
            logger.warn(`Circuit breaker for ${operationName}: Opened due to ${failures} failures`);
          }

          throw error;
        }
      },

      getState: () => ({ state, failures, lastFailureTime }),
      reset: () => {
        state = 'closed';
        failures = 0;
        lastFailureTime = 0;
        logger.info('Circuit breaker manually reset');
      }
    };
  }

  /**
   * Sleep utility
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}