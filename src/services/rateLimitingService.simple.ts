import { RedisService } from './redis';
import { logger } from '../utils/logger';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  totalHits: number;
  retryAfter?: number;
}

export interface LoginRateLimitResult extends RateLimitResult {
  isLockedOut: boolean;
  lockoutTime?: number;
  lockoutDuration?: number;
}

export class RateLimitingService {
  // Rate limit configurations
  private static readonly LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
  private static readonly LOGIN_MAX_ATTEMPTS = 5;
  private static readonly LOGIN_LOCKOUT_DURATION = 30 * 60; // 30 minutes in seconds

  private static readonly PASSWORD_RESET_WINDOW_MS = 60 * 60 * 1000; // 1 hour
  private static readonly PASSWORD_RESET_MAX_ATTEMPTS = 3;
  private static readonly PASSWORD_RESET_LOCKOUT_DURATION = 60 * 60; // 1 hour in seconds

  private static readonly TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly TOKEN_REFRESH_MAX_ATTEMPTS = 10;

  /**
   * Check login rate limit with lockout functionality
   */
  static async checkLoginRateLimit(
    email: string,
    ipAddress?: string
  ): Promise<LoginRateLimitResult> {
    try {
      const identifier = email.toLowerCase();
      
      // Check if user is currently locked out
      const lockoutResult = await this.checkLockout(identifier, ipAddress);
      if (lockoutResult.isLockedOut) {
        return {
          allowed: false,
          remaining: 0,
          resetTime: lockoutResult.lockoutTime || Date.now(),
          totalHits: this.LOGIN_MAX_ATTEMPTS,
          isLockedOut: true,
          lockoutTime: lockoutResult.lockoutTime,
          lockoutDuration: lockoutResult.lockoutDuration,
          retryAfter: lockoutResult.lockoutDuration
        };
      }

      // Check regular rate limit
      const rateLimitResult = await this.checkRateLimit(
        identifier, 
        this.LOGIN_WINDOW_MS, 
        this.LOGIN_MAX_ATTEMPTS,
        'login',
        ipAddress
      );
      
      return {
        ...rateLimitResult,
        isLockedOut: false
      };
    } catch (error) {
      logger.error('Error checking login rate limit', { error, email, ipAddress });
      return {
        allowed: true,
        remaining: this.LOGIN_MAX_ATTEMPTS - 1,
        resetTime: Date.now() + this.LOGIN_WINDOW_MS,
        totalHits: 0,
        isLockedOut: false
      };
    }
  }

  /**
   * Record login attempt with lockout logic
   */
  static async recordLoginAttempt(
    email: string,
    success: boolean,
    ipAddress?: string
  ): Promise<void> {
    try {
      const identifier = email.toLowerCase();
      
      if (success) {
        // Clear all failed attempts on successful login
        await this.clearAttempts(identifier, 'login', ipAddress);
        await this.clearLockout(identifier, ipAddress);
        
        logger.info('Login successful - cleared rate limit counters', {
          email: identifier,
          ipAddress
        });
      } else {
        // Record failed attempt
        await this.recordAttempt(identifier, this.LOGIN_WINDOW_MS, 'login', ipAddress);
        
        // Check if we should trigger lockout
        const rateLimitResult = await this.checkRateLimit(
          identifier, 
          this.LOGIN_WINDOW_MS, 
          this.LOGIN_MAX_ATTEMPTS,
          'login',
          ipAddress
        );
        
        if (!rateLimitResult.allowed) {
          await this.setLockout(identifier, this.LOGIN_LOCKOUT_DURATION, ipAddress);
          
          logger.warn('User locked out due to failed login attempts', {
            email: identifier,
            ipAddress,
            attempts: rateLimitResult.totalHits,
            lockoutDuration: this.LOGIN_LOCKOUT_DURATION
          });
        }
      }
    } catch (error) {
      logger.error('Error recording login attempt', { error, email, ipAddress });
    }
  }

  /**
   * Check password reset rate limit
   */
  static async checkPasswordResetRateLimit(
    email: string,
    ipAddress?: string
  ): Promise<RateLimitResult> {
    try {
      return await this.checkRateLimit(
        email.toLowerCase(),
        this.PASSWORD_RESET_WINDOW_MS,
        this.PASSWORD_RESET_MAX_ATTEMPTS,
        'password_reset',
        ipAddress
      );
    } catch (error) {
      logger.error('Error checking password reset rate limit', { error, email, ipAddress });
      return {
        allowed: true,
        remaining: this.PASSWORD_RESET_MAX_ATTEMPTS - 1,
        resetTime: Date.now() + this.PASSWORD_RESET_WINDOW_MS,
        totalHits: 0
      };
    }
  }

  /**
   * Record password reset attempt
   */
  static async recordPasswordResetAttempt(
    email: string,
    ipAddress?: string
  ): Promise<void> {
    try {
      await this.recordAttempt(
        email.toLowerCase(),
        this.PASSWORD_RESET_WINDOW_MS,
        'password_reset',
        ipAddress
      );
    } catch (error) {
      logger.error('Error recording password reset attempt', { error, email, ipAddress });
    }
  }

  /**
   * Check token refresh rate limit
   */
  static async checkTokenRefreshRateLimit(
    identifier: string,
    ipAddress?: string
  ): Promise<RateLimitResult> {
    try {
      return await this.checkRateLimit(
        identifier,
        this.TOKEN_REFRESH_WINDOW_MS,
        this.TOKEN_REFRESH_MAX_ATTEMPTS,
        'token_refresh',
        ipAddress
      );
    } catch (error) {
      logger.error('Error checking token refresh rate limit', { error, identifier, ipAddress });
      return {
        allowed: true,
        remaining: this.TOKEN_REFRESH_MAX_ATTEMPTS - 1,
        resetTime: Date.now() + this.TOKEN_REFRESH_WINDOW_MS,
        totalHits: 0
      };
    }
  }

  /**
   * Record token refresh attempt
   */
  static async recordTokenRefreshAttempt(
    identifier: string,
    success: boolean,
    ipAddress?: string
  ): Promise<void> {
    try {
      if (success) {
        await this.clearAttempts(identifier, 'token_refresh', ipAddress);
      } else {
        await this.recordAttempt(identifier, this.TOKEN_REFRESH_WINDOW_MS, 'token_refresh', ipAddress);
      }
    } catch (error) {
      logger.error('Error recording token refresh attempt', { error, identifier, ipAddress });
    }
  }

  /**
   * Generic rate limit check
   */
  private static async checkRateLimit(
    identifier: string,
    windowMs: number,
    maxAttempts: number,
    action: string,
    ipAddress?: string
  ): Promise<RateLimitResult> {
    const key = this.generateKey(action, identifier, ipAddress);
    const attempts = await this.getAttempts(key);
    const windowStart = Date.now() - windowMs;
    
    // Filter to only recent attempts
    const recentAttempts = attempts.filter(timestamp => timestamp > windowStart);
    const currentCount = recentAttempts.length;
    
    // Calculate reset time (when oldest attempt expires)
    const oldestAttempt = recentAttempts[0] || Date.now();
    const resetTime = oldestAttempt + windowMs;
    
    return {
      allowed: currentCount < maxAttempts,
      remaining: Math.max(0, maxAttempts - currentCount - 1),
      resetTime,
      totalHits: currentCount
    };
  }

  /**
   * Record an attempt
   */
  private static async recordAttempt(
    identifier: string,
    windowMs: number,
    action: string,
    ipAddress?: string
  ): Promise<void> {
    const key = this.generateKey(action, identifier, ipAddress);
    const attempts = await this.getAttempts(key);
    
    // Add current timestamp
    attempts.push(Date.now());
    
    // Keep only recent attempts and limit to 100 to prevent memory issues
    const windowStart = Date.now() - windowMs;
    const recentAttempts = attempts
      .filter(timestamp => timestamp > windowStart)
      .slice(-100);
    
    // Store with TTL
    const ttlSeconds = Math.ceil(windowMs / 1000);
    await RedisService.set(key, recentAttempts, ttlSeconds);
  }

  /**
   * Get attempts from Redis
   */
  private static async getAttempts(key: string): Promise<number[]> {
    try {
      const data = await RedisService.get(key);
      if (Array.isArray(data)) {
        return data;
      }
      return [];
    } catch (error) {
      logger.error('Error getting attempts from Redis', { error, key });
      return [];
    }
  }

  /**
   * Clear attempts for successful operations
   */
  private static async clearAttempts(
    identifier: string,
    action: string,
    ipAddress?: string
  ): Promise<void> {
    const key = this.generateKey(action, identifier, ipAddress);
    await RedisService.del(key);
  }

  /**
   * Check if user/IP is currently locked out
   */
  private static async checkLockout(
    identifier: string,
    ipAddress?: string
  ): Promise<{ isLockedOut: boolean; lockoutTime?: number; lockoutDuration?: number }> {
    try {
      const lockoutKey = this.generateLockoutKey(identifier, ipAddress);
      const lockoutData = await RedisService.get(lockoutKey);
      
      if (!lockoutData || typeof lockoutData !== 'object') {
        return { isLockedOut: false };
      }

      const { lockoutTime, duration } = lockoutData;
      const now = Date.now();
      const lockoutEndTime = lockoutTime + (duration * 1000);
      
      if (now < lockoutEndTime) {
        return {
          isLockedOut: true,
          lockoutTime: lockoutEndTime,
          lockoutDuration: Math.ceil((lockoutEndTime - now) / 1000)
        };
      }

      // Lockout expired, clean up
      await RedisService.del(lockoutKey);
      return { isLockedOut: false };
    } catch (error) {
      logger.error('Error checking lockout status', { error, identifier, ipAddress });
      return { isLockedOut: false };
    }
  }

  /**
   * Set lockout for user/IP
   */
  private static async setLockout(
    identifier: string,
    duration: number,
    ipAddress?: string
  ): Promise<void> {
    const lockoutKey = this.generateLockoutKey(identifier, ipAddress);
    const lockoutData = {
      lockoutTime: Date.now(),
      duration
    };
    
    await RedisService.set(lockoutKey, lockoutData, duration);
  }

  /**
   * Clear lockout for user/IP
   */
  private static async clearLockout(
    identifier: string,
    ipAddress?: string
  ): Promise<void> {
    const lockoutKey = this.generateLockoutKey(identifier, ipAddress);
    await RedisService.del(lockoutKey);
  }

  /**
   * Generate Redis key for rate limiting
   */
  private static generateKey(
    action: string,
    identifier: string,
    ipAddress?: string
  ): string {
    const parts = ['rate_limit', action, identifier];
    if (ipAddress) {
      parts.push(ipAddress);
    }
    return parts.join(':');
  }

  /**
   * Generate Redis key for lockout
   */
  private static generateLockoutKey(
    identifier: string,
    ipAddress?: string
  ): string {
    const parts = ['lockout', identifier];
    if (ipAddress) {
      parts.push(ipAddress);
    }
    return parts.join(':');
  }
}