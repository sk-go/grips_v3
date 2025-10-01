import { Request, Response, NextFunction } from 'express';
import { RedisService } from '../redis';
import { SecurityMonitoringService } from './securityMonitoringService';
import { logger } from '../../utils/logger';

export interface RateLimitConfig {
  windowMs: number;
  max: number;
  message?: string;
  standardHeaders?: boolean;
  legacyHeaders?: boolean;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (req: Request) => string;
  skip?: (req: Request) => boolean;
  onLimitReached?: (req: Request, res: Response) => void;
}

export interface RateLimitInfo {
  limit: number;
  current: number;
  remaining: number;
  resetTime: Date;
}

export class EnhancedRateLimitingService {
  private static readonly DEFAULT_CONFIG: RateLimitConfig = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    skipFailedRequests: false
  };

  /**
   * Create rate limiting middleware with enhanced security monitoring
   */
  static createRateLimit(config: Partial<RateLimitConfig> = {}) {
    const finalConfig = { ...this.DEFAULT_CONFIG, ...config };

    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        // Skip if configured to do so
        if (finalConfig.skip && finalConfig.skip(req)) {
          return next();
        }

        // Generate key for this request
        const key = finalConfig.keyGenerator 
          ? finalConfig.keyGenerator(req)
          : this.defaultKeyGenerator(req);

        // Check rate limit with enhanced monitoring
        const rateLimitResult = await SecurityMonitoringService.checkRateLimit(
          key,
          finalConfig.max,
          finalConfig.windowMs,
          {
            skipSuccessfulRequests: finalConfig.skipSuccessfulRequests,
            skipFailedRequests: finalConfig.skipFailedRequests
          }
        );

        // Set rate limit headers
        if (finalConfig.standardHeaders) {
          res.set({
            'RateLimit-Limit': finalConfig.max.toString(),
            'RateLimit-Remaining': rateLimitResult.remaining.toString(),
            'RateLimit-Reset': new Date(rateLimitResult.resetTime).toISOString()
          });
        }

        if (finalConfig.legacyHeaders) {
          res.set({
            'X-RateLimit-Limit': finalConfig.max.toString(),
            'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
            'X-RateLimit-Reset': Math.ceil(rateLimitResult.resetTime / 1000).toString()
          });
        }

        // Handle rate limit exceeded
        if (!rateLimitResult.allowed) {
          // Log rate limit violation
          logger.warn('Rate limit exceeded', {
            key,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            path: req.path,
            method: req.method,
            userId: (req as any).user?.id,
            abusive: rateLimitResult.abusive
          });

          // Call custom handler if provided
          if (finalConfig.onLimitReached) {
            finalConfig.onLimitReached(req, res);
          }

          // Check for potential breach if abusive
          if (rateLimitResult.abusive) {
            await SecurityMonitoringService.detectBreach('suspicious_api_calls', {
              ipAddress: req.ip,
              userAgent: req.get('User-Agent'),
              path: req.path,
              method: req.method,
              userId: (req as any).user?.id,
              callCount: finalConfig.max - rateLimitResult.remaining,
              timeWindow: finalConfig.windowMs
            });
          }

          res.status(429).json({
            error: 'Too Many Requests',
            message: finalConfig.message,
            retryAfter: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000)
          });
          return;
        }

        next();
      } catch (error) {
        logger.error('Error in rate limiting middleware', {
          error: error instanceof Error ? error.message : 'Unknown error',
          path: req.path,
          method: req.method,
          ip: req.ip
        });
        
        // Continue processing on error to avoid blocking legitimate requests
        next();
      }
    };
  }

  /**
   * Create adaptive rate limiting that adjusts based on user behavior
   */
  static createAdaptiveRateLimit(baseConfig: Partial<RateLimitConfig> = {}) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const userId = (req as any).user?.id;
        const ipAddress = req.ip;
        
        // Get user's trust score
        const trustScore = await this.getUserTrustScore(userId, ipAddress);
        
        // Adjust rate limits based on trust score
        const adjustedConfig = this.adjustConfigForTrustScore(baseConfig, trustScore);
        
        // Apply the adjusted rate limit
        const rateLimitMiddleware = this.createRateLimit(adjustedConfig);
        await rateLimitMiddleware(req, res, next);
      } catch (error) {
        logger.error('Error in adaptive rate limiting', {
          error: error instanceof Error ? error.message : 'Unknown error',
          userId: (req as any).user?.id,
          ip: req.ip
        });
        next();
      }
    };
  }

  /**
   * Rate limiting specifically for AI endpoints with input sanitization
   */
  static createAIRateLimit(config: Partial<RateLimitConfig> = {}) {
    const aiConfig = {
      ...config,
      max: config.max || 50, // Lower limit for AI endpoints
      windowMs: config.windowMs || 60 * 1000, // 1 minute window
      keyGenerator: (req: Request) => {
        const userId = (req as any).user?.id;
        return userId ? `ai:user:${userId}` : `ai:ip:${req.ip}`;
      }
    };

    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        // First apply rate limiting
        const rateLimitMiddleware = this.createRateLimit(aiConfig);
        
        // Wrap the next function to add AI input sanitization
        const wrappedNext = () => {
          // Sanitize AI input if present
          if (req.body && (req.body.message || req.body.input || req.body.text)) {
            const inputText = req.body.message || req.body.input || req.body.text;
            const sanitizationResult = SecurityMonitoringService.sanitizeAIInput(inputText);
            
            if (sanitizationResult.flagged) {
              logger.warn('AI input sanitization triggered', {
                userId: (req as any).user?.id,
                ip: req.ip,
                path: req.path,
                reasons: sanitizationResult.reasons,
                originalLength: inputText.length,
                sanitizedLength: sanitizationResult.sanitized.length
              });
              
              // Replace the input with sanitized version
              if (req.body.message) req.body.message = sanitizationResult.sanitized;
              if (req.body.input) req.body.input = sanitizationResult.sanitized;
              if (req.body.text) req.body.text = sanitizationResult.sanitized;
              
              // Add sanitization info to request for downstream processing
              (req as any).sanitizationResult = sanitizationResult;
            }
          }
          
          next();
        };

        await rateLimitMiddleware(req, res, wrappedNext);
      } catch (error) {
        logger.error('Error in AI rate limiting', {
          error: error instanceof Error ? error.message : 'Unknown error',
          userId: (req as any).user?.id,
          ip: req.ip
        });
        next();
      }
    };
  }

  /**
   * Get current rate limit status for a key
   */
  static async getRateLimitStatus(key: string, windowMs: number, max: number): Promise<RateLimitInfo> {
    try {
      const redis = RedisService.getClient();
      const now = Date.now();
      const windowStart = now - windowMs;
      
      // Count current requests in window
      const requestCount = await redis.zCard(`rate_limit:${key}`);
      
      return {
        limit: max,
        current: requestCount,
        remaining: Math.max(0, max - requestCount),
        resetTime: new Date(now + windowMs)
      };
    } catch (error) {
      logger.error('Error getting rate limit status', { key, error });
      return {
        limit: max,
        current: 0,
        remaining: max,
        resetTime: new Date(Date.now() + windowMs)
      };
    }
  }

  /**
   * Reset rate limit for a specific key (admin function)
   */
  static async resetRateLimit(key: string): Promise<boolean> {
    try {
      const redis = RedisService.getClient();
      await redis.del(`rate_limit:${key}`);
      
      logger.info('Rate limit reset', { key });
      return true;
    } catch (error) {
      logger.error('Error resetting rate limit', { key, error });
      return false;
    }
  }

  /**
   * Default key generator for rate limiting
   */
  private static defaultKeyGenerator(req: Request): string {
    const userId = (req as any).user?.id;
    return userId ? `user:${userId}` : `ip:${req.ip}`;
  }

  /**
   * Get user trust score based on historical behavior
   */
  private static async getUserTrustScore(userId?: string, ipAddress?: string): Promise<number> {
    try {
      let score = 50; // Base trust score
      
      if (userId) {
        // Check user's historical behavior
        const redis = RedisService.getClient();
        const userViolations = await redis.get(`trust:violations:user:${userId}`);
        const violations = userViolations ? parseInt(userViolations) : 0;
        
        // Reduce trust score based on violations
        score -= violations * 10;
      }
      
      if (ipAddress) {
        // Check IP reputation
        const ipScore = await SecurityMonitoringService.checkIPReputation(ipAddress);
        score -= ipScore * 0.5; // 50% weight for IP reputation
      }
      
      return Math.max(0, Math.min(100, score));
    } catch (error) {
      logger.error('Error calculating trust score', { userId, ipAddress, error });
      return 50; // Default trust score on error
    }
  }

  /**
   * Adjust rate limit configuration based on trust score
   */
  private static adjustConfigForTrustScore(
    baseConfig: Partial<RateLimitConfig>,
    trustScore: number
  ): Partial<RateLimitConfig> {
    const multiplier = trustScore / 50; // 1.0 for score of 50, 2.0 for score of 100, 0.5 for score of 25
    
    return {
      ...baseConfig,
      max: Math.ceil((baseConfig.max || 100) * multiplier),
      windowMs: baseConfig.windowMs || 15 * 60 * 1000
    };
  }

  /**
   * Middleware to block requests from locked IPs
   */
  static createIPBlockMiddleware() {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const isBlocked = await SecurityMonitoringService.isIPBlocked(req.ip || '0.0.0.0');
        
        if (isBlocked) {
          logger.warn('Blocked IP attempted access', {
            ip: req.ip,
            path: req.path,
            method: req.method,
            userAgent: req.get('User-Agent')
          });
          
          res.status(403).json({
            error: 'Access Denied',
            message: 'Your IP address has been temporarily blocked due to security concerns.'
          });
          return;
        }
        
        next();
      } catch (error) {
        logger.error('Error in IP block middleware', {
          error: error instanceof Error ? error.message : 'Unknown error',
          ip: req.ip
        });
        next(); // Continue on error to avoid blocking legitimate requests
      }
    };
  }
}