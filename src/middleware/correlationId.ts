/**
 * Correlation ID Middleware
 * Ensures all requests have correlation IDs for tracing across services
 */

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

export interface CorrelationRequest extends Request {
  correlationId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

/**
 * Middleware to add correlation ID to requests
 */
export function correlationIdMiddleware(
  req: CorrelationRequest,
  res: Response,
  next: NextFunction
): void {
  // Extract correlation ID from headers or generate new one
  const correlationId = req.headers['x-correlation-id'] as string || uuidv4();
  const traceId = req.headers['x-trace-id'] as string || uuidv4();
  const spanId = uuidv4();
  const parentSpanId = req.headers['x-parent-span-id'] as string;

  // Add to request object
  req.correlationId = correlationId;
  req.traceId = traceId;
  req.spanId = spanId;
  req.parentSpanId = parentSpanId;

  // Add to response headers
  res.setHeader('x-correlation-id', correlationId);
  res.setHeader('x-trace-id', traceId);
  res.setHeader('x-span-id', spanId);

  // Add to logger context
  const originalLogger = logger;
  (req as any).logger = {
    info: (message: string, meta?: any) => originalLogger.info(message, { 
      correlationId, 
      traceId, 
      spanId, 
      ...meta 
    }),
    error: (message: string, meta?: any) => originalLogger.error(message, { 
      correlationId, 
      traceId, 
      spanId, 
      ...meta 
    }),
    warn: (message: string, meta?: any) => originalLogger.warn(message, { 
      correlationId, 
      traceId, 
      spanId, 
      ...meta 
    }),
    debug: (message: string, meta?: any) => originalLogger.debug(message, { 
      correlationId, 
      traceId, 
      spanId, 
      ...meta 
    })
  };

  logger.debug('Request received', {
    correlationId,
    traceId,
    spanId,
    parentSpanId,
    method: req.method,
    path: req.path,
    userAgent: req.headers['user-agent'],
    ip: req.ip
  });

  next();
}

/**
 * Extract correlation context from request
 */
export function getCorrelationContext(req: CorrelationRequest): {
  correlationId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
} {
  return {
    correlationId: req.correlationId,
    traceId: req.traceId,
    spanId: req.spanId,
    parentSpanId: req.parentSpanId
  };
}

/**
 * Create headers for outgoing requests
 */
export function createTracingHeaders(context: {
  correlationId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    'x-correlation-id': context.correlationId,
    'x-trace-id': context.traceId,
    'x-parent-span-id': context.spanId
  };

  return headers;
}