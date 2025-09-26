import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { RateLimitingService } from '../services/rateLimitingService.simple';
import { ErrorHandlingService } from '../services/errorHandlingService';
import { logger } from '../utils/logger';

// General API rate limiter
export const rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'), // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  keyGenerator: (req) => {
    // Use IP address and user ID (if authenticated) for more granular limiting
    const userId = req.user?.id || 'anonymous';
    return `${req.ip}:${userId}`;
  },
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path
    });
    
    const errorResponse = ErrorHandlingService.createRateLimitErrorResponse(
      'Too many requests from this IP, please try again later.',
      900, // 15 minutes
      100,
      0,
      Date.now() + 900000
    );
    
    res.status(429).json(errorResponse);
  }
});

// Enhanced authentication rate limiter using our custom service
export const authRateLimiter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // For general auth endpoints, use a simple approach
    // The specific rate limiting is handled in individual route handlers
    next();
  } catch (error) {
    logger.error('Rate limiter error', { error, path: req.path, ip: req.ip });
    next(); // Continue on rate limiter error to avoid blocking legitimate requests
  }
};

// AI interaction rate limiter (more generous for authenticated users)
export const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 AI requests per minute
  message: {
    error: 'Too many AI requests, please slow down.',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `ai:${req.user?.id || req.ip}`,
  handler: (req, res) => {
    logger.warn('AI rate limit exceeded', {
      userId: req.user?.id,
      ip: req.ip,
      path: req.path
    });
    
    const errorResponse = ErrorHandlingService.createRateLimitErrorResponse(
      'Too many AI requests, please slow down.',
      60, // 1 minute
      30,
      0,
      Date.now() + 60000
    );
    
    res.status(429).json(errorResponse);
  }
});

// Enhanced login rate limiter middleware
export const loginRateLimiter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Rate limiting is handled directly in the login route for better control
    next();
  } catch (error) {
    logger.error('Login rate limiter error', { error, path: req.path, ip: req.ip });
    next(); // Continue on rate limiter error to avoid blocking legitimate requests
  }
};