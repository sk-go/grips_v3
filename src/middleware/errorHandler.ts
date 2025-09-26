import { Request, Response, NextFunction } from 'express';
import { ErrorHandlingService } from '../services/errorHandlingService';
import { logger } from '../utils/logger';

interface CustomError extends Error {
  statusCode?: number;
  code?: string;
}

export const errorHandler = (
  error: CustomError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  let statusCode = error.statusCode || 500;
  let message = error.message || 'Internal Server Error';
  let errorCode = error.code;

  // Log the error with context
  logger.error('Request error', {
    error: error.message,
    stack: error.stack,
    statusCode,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id
  });

  // Log security-relevant errors
  if (ErrorHandlingService.isSecurityRelevantError(error, req.path)) {
    ErrorHandlingService.logSecurityEvent('login_failure', {
      userId: req.user?.id,
      email: req.user?.email,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      error: error.message,
      path: req.path
    });
  }

  // Handle specific error types
  if (error.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
    errorCode = 'VALIDATION_ERROR';
  } else if (error.name === 'UnauthorizedError' || error.message.includes('token')) {
    statusCode = 401;
    message = 'Unauthorized';
    errorCode = 'UNAUTHORIZED';
  } else if (error.name === 'ForbiddenError') {
    statusCode = 403;
    message = 'Forbidden';
    errorCode = 'FORBIDDEN';
  } else if (error.name === 'NotFoundError') {
    statusCode = 404;
    message = 'Resource not found';
    errorCode = 'NOT_FOUND';
  } else if (error.code && error.code.startsWith('23')) {
    // Handle database errors using the error handling service
    const dbErrorResponse = ErrorHandlingService.handleDatabaseError(error, req.path);
    statusCode = error.code === '23505' ? 409 : 400;
    message = dbErrorResponse.error;
    errorCode = dbErrorResponse.code;
  }

  // Don't expose internal errors in production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'Internal Server Error';
    errorCode = 'INTERNAL_ERROR';
  }

  // Create standardized error response
  const errorResponse = ErrorHandlingService.createErrorResponse(
    message,
    errorCode,
    process.env.NODE_ENV === 'development' ? { stack: error.stack, originalError: error } : undefined
  );

  res.status(statusCode).json(errorResponse);
};

// Async error wrapper to catch async errors in route handlers
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// 404 handler for unmatched routes
export const notFoundHandler = (req: Request, res: Response): void => {
  logger.warn('Route not found', {
    method: req.method,
    path: req.path,
    ip: req.ip
  });

  res.status(404).json({
    error: 'Route not found',
    path: req.path,
    method: req.method
  });
};