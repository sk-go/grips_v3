import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';
import { Request, Response, NextFunction } from 'express';

// Correlation ID storage
const correlationIdStore = new Map<string, string>();

export interface LogContext {
  correlationId?: string;
  userId?: string;
  sessionId?: string;
  requestId?: string;
  component?: string;
  action?: string;
  metadata?: Record<string, any>;
}

export interface PerformanceMetrics {
  duration: number;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage?: number;
  timestamp: Date;
}

class LoggingService {
  private logger: winston.Logger;
  private performanceMetrics: Map<string, { startTime: number; startMemory: NodeJS.MemoryUsage }>;

  constructor() {
    this.performanceMetrics = new Map();
    this.initializeLogger();
  }

  private initializeLogger(): void {
    const logFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
      winston.format.printf(({ timestamp, level, message, correlationId, userId, component, action, metadata, stack, ...rest }) => {
        const logEntry = {
          timestamp,
          level,
          message,
          correlationId,
          userId,
          component,
          action,
          metadata,
          ...(stack && { stack }),
          ...rest
        };
        return JSON.stringify(logEntry);
      })
    );

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: logFormat,
      defaultMeta: {
        service: 'relationship-care-platform',
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development'
      },
      transports: [
        // Console transport for development
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        }),
        
        // File transport for all logs
        new winston.transports.File({
          filename: 'logs/combined.log',
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5,
          tailable: true
        }),
        
        // Separate file for errors
        new winston.transports.File({
          filename: 'logs/error.log',
          level: 'error',
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5,
          tailable: true
        }),
        
        // Separate file for performance logs
        new winston.transports.File({
          filename: 'logs/performance.log',
          level: 'info',
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 3,
          tailable: true,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json(),
            winston.format.printf(({ timestamp, level, message, duration, memoryUsage, correlationId, component, action }) => {
              if (duration !== undefined) {
                return JSON.stringify({
                  timestamp,
                  level,
                  type: 'performance',
                  message,
                  duration,
                  memoryUsage,
                  correlationId,
                  component,
                  action
                });
              }
              return '';
            })
          )
        })
      ]
    });

    // Add CloudWatch transport in production
    if (process.env.NODE_ENV === 'production' && process.env.AWS_REGION) {
      const CloudWatchTransport = require('winston-cloudwatch');
      this.logger.add(new CloudWatchTransport({
        logGroupName: `/aws/ecs/${process.env.APP_NAME || 'relationship-care-platform'}`,
        logStreamName: `${process.env.HOSTNAME || 'unknown'}-${new Date().toISOString().split('T')[0]}`,
        awsRegion: process.env.AWS_REGION,
        messageFormatter: ({ level, message, timestamp, correlationId, userId, component, action, metadata }) => {
          return JSON.stringify({
            timestamp,
            level,
            message,
            correlationId,
            userId,
            component,
            action,
            metadata
          });
        }
      }));
    }
  }

  // Generate correlation ID
  generateCorrelationId(): string {
    return uuidv4();
  }

  // Set correlation ID for current context
  setCorrelationId(correlationId: string): void {
    correlationIdStore.set('current', correlationId);
  }

  // Get current correlation ID
  getCorrelationId(): string | undefined {
    return correlationIdStore.get('current');
  }

  // Log with context
  private logWithContext(level: string, message: string, context?: LogContext): void {
    const correlationId = context?.correlationId || this.getCorrelationId();
    
    this.logger.log(level, message, {
      correlationId,
      userId: context?.userId,
      sessionId: context?.sessionId,
      requestId: context?.requestId,
      component: context?.component,
      action: context?.action,
      metadata: context?.metadata
    });
  }

  // Public logging methods
  info(message: string, context?: LogContext): void {
    this.logWithContext('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.logWithContext('warn', message, context);
  }

  error(message: string, error?: Error, context?: LogContext): void {
    this.logWithContext('error', message, {
      ...context,
      metadata: {
        ...context?.metadata,
        error: error ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        } : undefined
      }
    });
  }

  debug(message: string, context?: LogContext): void {
    this.logWithContext('debug', message, context);
  }

  // Performance monitoring
  startPerformanceTimer(operationId: string, context?: LogContext): void {
    const startTime = Date.now();
    const startMemory = process.memoryUsage();
    
    this.performanceMetrics.set(operationId, { startTime, startMemory });
    
    this.info(`Performance timer started for operation: ${operationId}`, {
      ...context,
      component: context?.component || 'performance',
      action: 'timer_start',
      metadata: {
        operationId,
        startMemory
      }
    });
  }

  endPerformanceTimer(operationId: string, context?: LogContext): PerformanceMetrics | null {
    const timerData = this.performanceMetrics.get(operationId);
    if (!timerData) {
      this.warn(`Performance timer not found for operation: ${operationId}`, context);
      return null;
    }

    const endTime = Date.now();
    const endMemory = process.memoryUsage();
    const duration = endTime - timerData.startTime;
    
    const metrics: PerformanceMetrics = {
      duration,
      memoryUsage: {
        rss: endMemory.rss - timerData.startMemory.rss,
        heapTotal: endMemory.heapTotal - timerData.startMemory.heapTotal,
        heapUsed: endMemory.heapUsed - timerData.startMemory.heapUsed,
        external: endMemory.external - timerData.startMemory.external,
        arrayBuffers: endMemory.arrayBuffers - timerData.startMemory.arrayBuffers
      },
      timestamp: new Date()
    };

    this.performanceMetrics.delete(operationId);

    this.info(`Performance timer completed for operation: ${operationId}`, {
      ...context,
      component: context?.component || 'performance',
      action: 'timer_end',
      metadata: {
        operationId,
        duration,
        memoryDelta: metrics.memoryUsage
      }
    });

    // Log to performance file
    this.logger.info(`Operation ${operationId} completed`, {
      duration,
      memoryUsage: metrics.memoryUsage,
      correlationId: context?.correlationId || this.getCorrelationId(),
      component: context?.component,
      action: context?.action
    });

    return metrics;
  }

  // Structured logging for specific events
  logApiRequest(req: Request, res: Response, duration: number): void {
    const correlationId = this.getCorrelationId();
    
    this.info('API request completed', {
      correlationId,
      component: 'api',
      action: 'request',
      metadata: {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        userId: (req as any).user?.id
      }
    });
  }

  logDatabaseQuery(query: string, duration: number, context?: LogContext): void {
    this.info('Database query executed', {
      ...context,
      component: 'database',
      action: 'query',
      metadata: {
        query: query.substring(0, 200), // Truncate long queries
        duration
      }
    });
  }

  logCacheOperation(operation: string, key: string, hit: boolean, duration: number, context?: LogContext): void {
    this.info(`Cache ${operation}`, {
      ...context,
      component: 'cache',
      action: operation,
      metadata: {
        key,
        hit,
        duration
      }
    });
  }

  logAIOperation(operation: string, model: string, tokens: number, duration: number, context?: LogContext): void {
    this.info(`AI operation: ${operation}`, {
      ...context,
      component: 'ai',
      action: operation,
      metadata: {
        model,
        tokens,
        duration,
        tokensPerSecond: tokens / (duration / 1000)
      }
    });
  }

  logSecurityEvent(event: string, severity: 'low' | 'medium' | 'high' | 'critical', context?: LogContext): void {
    this.warn(`Security event: ${event}`, {
      ...context,
      component: 'security',
      action: 'security_event',
      metadata: {
        event,
        severity
      }
    });
  }

  logBusinessEvent(event: string, entityType: string, entityId: string, context?: LogContext): void {
    this.info(`Business event: ${event}`, {
      ...context,
      component: 'business',
      action: event,
      metadata: {
        entityType,
        entityId
      }
    });
  }

  // Health check logging
  logHealthCheck(component: string, status: 'healthy' | 'unhealthy', details?: any): void {
    const level = status === 'healthy' ? 'info' : 'error';
    
    this.logWithContext(level, `Health check: ${component} is ${status}`, {
      component: 'health',
      action: 'health_check',
      metadata: {
        component,
        status,
        details
      }
    });
  }

  // Cleanup old performance timers
  cleanupPerformanceTimers(): void {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes
    
    for (const [operationId, timerData] of this.performanceMetrics.entries()) {
      if (now - timerData.startTime > timeout) {
        this.warn(`Performance timer expired for operation: ${operationId}`, {
          component: 'performance',
          action: 'timer_cleanup',
          metadata: { operationId }
        });
        this.performanceMetrics.delete(operationId);
      }
    }
  }
}

// Middleware to add correlation ID to requests
export const correlationIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const correlationId = req.get('X-Correlation-ID') || uuidv4();
  
  // Set correlation ID in response header
  res.set('X-Correlation-ID', correlationId);
  
  // Store correlation ID for this request
  loggingService.setCorrelationId(correlationId);
  
  // Add correlation ID to request object
  (req as any).correlationId = correlationId;
  
  next();
};

// Request logging middleware
export const requestLoggingMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();
  
  // Log request start
  loggingService.info('API request started', {
    correlationId: (req as any).correlationId,
    component: 'api',
    action: 'request_start',
    metadata: {
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    }
  });

  // Override res.end to log when request completes
  const originalEnd = res.end;
  res.end = function(chunk?: any, encoding?: any) {
    const duration = Date.now() - startTime;
    loggingService.logApiRequest(req, res, duration);
    originalEnd.call(this, chunk, encoding);
  };

  next();
};

// Singleton instance
export const loggingService = new LoggingService();

// Cleanup timer
setInterval(() => {
  loggingService.cleanupPerformanceTimers();
}, 5 * 60 * 1000); // Every 5 minutes