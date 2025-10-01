import { Request, Response, NextFunction } from 'express';
import { performanceMonitor } from '../services/performance/performanceMonitor';
import { logger } from '../utils/logger';

export interface PerformanceRequest extends Request {
  startTime?: number;
  performanceId?: string;
}

/**
 * Middleware to track request performance metrics
 */
export function performanceTrackingMiddleware(
  req: PerformanceRequest,
  res: Response,
  next: NextFunction
): void {
  const startTime = Date.now();
  req.startTime = startTime;
  req.performanceId = `${req.method}-${req.path}-${startTime}`;

  // Increment active connections
  performanceMonitor.incrementConnections();

  // Track response completion
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    
    // Record metrics
    performanceMonitor.recordResponseTime(responseTime);
    performanceMonitor.decrementConnections();

    // Log slow requests
    if (responseTime > 500) {
      logger.warn('Slow request detected', {
        method: req.method,
        path: req.path,
        responseTime,
        statusCode: res.statusCode,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });
    }

    // Log performance metrics for monitoring
    logger.debug('Request performance', {
      method: req.method,
      path: req.path,
      responseTime,
      statusCode: res.statusCode,
      performanceId: req.performanceId
    });
  });

  next();
}

/**
 * Middleware to add performance headers to responses
 */
export function performanceHeadersMiddleware(
  req: PerformanceRequest,
  res: Response,
  next: NextFunction
): void {
  res.on('finish', () => {
    if (req.startTime) {
      const responseTime = Date.now() - req.startTime;
      res.set('X-Response-Time', `${responseTime}ms`);
      res.set('X-Performance-ID', req.performanceId || 'unknown');
    }
  });

  next();
}

/**
 * Middleware to implement circuit breaker pattern for external services
 */
export class CircuitBreakerMiddleware {
  private failures = new Map<string, number>();
  private lastFailureTime = new Map<string, number>();
  private readonly maxFailures: number;
  private readonly resetTimeoutMs: number;

  constructor(maxFailures = 5, resetTimeoutMs = 60000) {
    this.maxFailures = maxFailures;
    this.resetTimeoutMs = resetTimeoutMs;
  }

  /**
   * Check if circuit is open for a service
   */
  isCircuitOpen(serviceName: string): boolean {
    const failures = this.failures.get(serviceName) || 0;
    const lastFailure = this.lastFailureTime.get(serviceName) || 0;
    
    if (failures >= this.maxFailures) {
      const timeSinceLastFailure = Date.now() - lastFailure;
      if (timeSinceLastFailure < this.resetTimeoutMs) {
        return true; // Circuit is open
      } else {
        // Reset circuit
        this.failures.set(serviceName, 0);
        return false;
      }
    }
    
    return false;
  }

  /**
   * Record a failure for a service
   */
  recordFailure(serviceName: string): void {
    const currentFailures = this.failures.get(serviceName) || 0;
    this.failures.set(serviceName, currentFailures + 1);
    this.lastFailureTime.set(serviceName, Date.now());
    
    logger.warn('Circuit breaker recorded failure', {
      service: serviceName,
      failures: currentFailures + 1,
      maxFailures: this.maxFailures
    });
  }

  /**
   * Record a success for a service
   */
  recordSuccess(serviceName: string): void {
    this.failures.set(serviceName, 0);
  }

  /**
   * Middleware factory for circuit breaker
   */
  middleware(serviceName: string) {
    return (req: Request, res: Response, next: NextFunction) => {
      if (this.isCircuitOpen(serviceName)) {
        logger.warn('Circuit breaker is open, rejecting request', { service: serviceName });
        return res.status(503).json({
          error: 'Service temporarily unavailable',
          service: serviceName,
          retryAfter: Math.ceil(this.resetTimeoutMs / 1000)
        });
      }
      
      next();
    };
  }
}

// Global circuit breaker instance
export const circuitBreaker = new CircuitBreakerMiddleware();

/**
 * Middleware to implement request timeout
 */
export function requestTimeoutMiddleware(timeoutMs: number = 30000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn('Request timeout', {
          method: req.method,
          path: req.path,
          timeout: timeoutMs,
          ip: req.ip
        });
        
        res.status(408).json({
          error: 'Request timeout',
          timeout: timeoutMs
        });
      }
    }, timeoutMs);

    res.on('finish', () => {
      clearTimeout(timeout);
    });

    next();
  };
}

/**
 * Middleware to implement graceful degradation
 */
export function gracefulDegradationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Add degradation flags to request
  (req as any).degradation = {
    skipCache: false,
    skipNonEssential: false,
    useBasicResponse: false
  };

  // Check system load and enable degradation if needed
  const memoryUsage = process.memoryUsage();
  const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
  
  if (heapUsedMB > 800) { // 800MB threshold
    (req as any).degradation.skipNonEssential = true;
    logger.info('Graceful degradation: skipping non-essential features', { heapUsedMB });
  }
  
  if (heapUsedMB > 900) { // 900MB threshold
    (req as any).degradation.skipCache = true;
    (req as any).degradation.useBasicResponse = true;
    logger.warn('Graceful degradation: using basic responses', { heapUsedMB });
  }

  next();
}