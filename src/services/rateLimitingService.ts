import { RedisService } from './redis';
import { logger } from '../utils/logger';

export interface RateLimitConfig {
  windowMs: number;
  maxAttempts: number;
  blockDuration?: number;
  keyPrefix: string;
}

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
  private static readonly configs = {
    // Authentication endpoints - strict limits
    login: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxAttempts: 5,
      blockDuration: 30 * 60, // 30 minutes lockout
      keyPrefix: 'auth_login'
    },
    
    // Password reset - moderate limits
    passwordReset: {
      windowMs: 60 * 60 * 1000, // 1 hour
      maxAttempts: 3,
      blockDuration: 60 * 60, // 1 hour lockout
      keyPrefix: 'auth_password_reset'
    },
    
    // Registration - moderate limits
    register: {
      windowMs: 60 * 60 * 1000, // 1 hour
      maxAttempts: 3,
      blockDuration: 60 * 60, // 1 hour lockout
      keyPrefix: 'auth_register'
    },
    
    // Token refresh - generous limits
    tokenRefresh: {
      windowMs: 5 * 60 * 1000, // 5 minutes
      maxAttempts: 10,
      keyPrefix: 'auth_token_refresh'
    },
    
    // General API - generous limits
    api: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxAttempts: 100,
      keyPrefix: 'api_general'
    }
  };

  /**
   * Check rate limit for a specific action
   */
  static async checkRateLimit(
    identifier: string,
    action: keyof typeof RateLimitingService.configs,
    ipAddress?: string
  ): Promise<RateLimitResult> {
    try {
      const config = this.configs[action];
      const key = this.generateKey(config.keyPrefix, identifier, ipAddress);
      
      const current = await this.getCurrentCount(key);
      const windowStart = Date.now() - config.windowMs;
      
      // Clean old entries and get current count
      const validEntries = current.filter(timestamp => timestamp > windowStart);
      const currentCount = validEntries.length;
      
      // Calculate reset time
      const oldestEntry = validEntries[0] || Date.now();
      const resetTime = oldestEntry + config.windowMs;
      
      const result: RateLimitResult = {
        allowed: currentCount < config.maxAttempts,
        remaining: Math.max(0, config.maxAttempts - currentCount - 1),
        resetTime,
        totalHits: currentCount
      };

      // If blocked and has block duration, set retry after
      if (!result.allowed && 'blockDuration' in config && config.blockDuration) {
        result.retryAfter = config.blockDuration;
      }

      return result;
    } catch (error) {
      logger.error('Error checking rate limit', { error, identifier, action, ipAddress });
      // Return permissive result on error to avoid blocking legitimate users
      return {
        allowed: true,
        remaining: 999,
        resetTime: Date.now() + 900000,
        totalHits: 0
      };
    }
  }

  /**
   * Record an attempt for rate limiting
   */
  static async recordAttempt(
    identifier: string,
    action: keyof typeof RateLimitingService.configs,
    ipAddress?: string,
    success: boolean = false
  ): Promise<void> {
    try {
      const config = this.configs[action];
      const key = this.generateKey(config.keyPrefix, identifier, ipAddress);
      
      // Add current timestamp
      await this.addAttempt(key, Date.now());
      
      // If this is a login attempt, handle special lockout logic
      if (action === 'login') {
        await this.handleLoginAttempt(identifier, ipAddress, success);
      }

      logger.debug('Rate limit attempt recorded', {
        identifier,
        action,
        ipAddress,
        success,
        key
      });
    } catch (error) {
      logger.error('Error recording rate limit attempt', { error, identifier, action, ipAddress });
      // Don't throw error to avoid breaking the main flow
    }
  }

  /**
   * Check login-specific rate limiting with lockout functionality
   */
  static async checkLoginRateLimit(
    email: string,
    ipAddress?: string
  ): Promise<LoginRateLimitResult> {
    const identifier = email.toLowerCase();
    
    // Check if user is currently locked out
    const lockoutResult = await this.checkLockout(identifier, ipAddress);
    if (lockoutResult.isLockedOut) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: lockoutResult.lockoutTime || Date.now(),
        totalHits: 0,
        isLockedOut: true,
        lockoutTime: lockoutResult.lockoutTime,
        lockoutDuration: lockoutResult.lockoutDuration,
        retryAfter: lockoutResult.lockoutDuration
      };
    }

    // Check regular rate limit
    const rateLimitResult = await this.checkRateLimit(identifier, 'login', ipAddress);
    
    return {
      ...rateLimitResult,
      isLockedOut: false
    };
  }

  /**
   * Handle login attempt with lockout logic
   */
  private static async handleLoginAttempt(
    email: string,
    ipAddress?: string,
    success: boolean = false
  ): Promise<void> {
    const identifier = email.toLowerCase();
    const config = this.configs.login;
    
    if (success) {
      // Clear all failed attempts on successful login
      await this.clearAttempts(identifier, 'login', ipAddress);
      await this.clearLockout(identifier, ipAddress);
      
      logger.info('Login successful - cleared rate limit counters', {
        email: identifier,
        ipAddress
      });
    } else {
      // Check if we should trigger lockout
      const rateLimitResult = await this.checkRateLimit(identifier, 'login', ipAddress);
      
      if (!rateLimitResult.allowed && config.blockDuration) {
        await this.setLockout(identifier, config.blockDuration, ipAddress);
        
        logger.warn('User locked out due to failed login attempts', {
          email: identifier,
          ipAddress,
          attempts: rateLimitResult.totalHits,
          lockoutDuration: config.blockDuration
        });
      }
    }
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
      
      if (now < lockoutTime + (duration * 1000)) {
        return {
          isLockedOut: true,
          lockoutTime: lockoutTime + (duration * 1000),
          lockoutDuration: Math.ceil((lockoutTime + (duration * 1000) - now) / 1000)
        };
      }

      // Lockout expired, clean up
      await RedisService.del(lockoutKey);
      return { isLockedOut: false };
    } catch (error) {
      logger.error('Error checking lockout status', { error, identifier, ipAddress });
      return { isLockedOut: false }; // Default to not locked out on error
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
   * Clear all attempts for a specific action
   */
  static async clearAttempts(
    identifier: string,
    action: keyof typeof RateLimitingService.configs,
    ipAddress?: string
  ): Promise<void> {
    const config = this.configs[action];
    const key = this.generateKey(config.keyPrefix, identifier, ipAddress);
    await RedisService.del(key);
  }

  /**
   * Get current attempt count from Redis
   */
  private static async getCurrentCount(key: string): Promise<number[]> {
    const data = await RedisService.get(key);
    if (!data) return [];
    
    // RedisService.get already handles JSON parsing
    if (Array.isArray(data)) {
      return data;
    }
    
    return [];
  }

  /**
   * Add an attempt timestamp to Redis
   */
  private static async addAttempt(key: string, timestamp: number): Promise<void> {
    const current = await this.getCurrentCount(key);
    current.push(timestamp);
    
    // Keep only recent attempts (last 100 to prevent memory issues)
    const recent = current.slice(-100);
    
    // Set with TTL based on the longest window (1 hour for password reset)
    await RedisService.set(key, recent, 3600);
  }

  /**
   * Generate Redis key for rate limiting
   */
  private static generateKey(
    prefix: string,
    identifier: string,
    ipAddress?: string
  ): string {
    const parts = [prefix, identifier];
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
    return this.generateKey('lockout', identifier, ipAddress);
  }

  /**
   * Get rate limit status for monitoring/debugging
   */
  static async getRateLimitStatus(
    identifier: string,
    action: keyof typeof RateLimitingService.configs,
    ipAddress?: string
  ): Promise<{
    config: RateLimitConfig;
    current: RateLimitResult;
    lockout?: { isLockedOut: boolean; lockoutTime?: number; lockoutDuration?: number };
  }> {
    const config = this.configs[action];
    const current = await this.checkRateLimit(identifier, action, ipAddress);
    
    let lockout;
    if (action === 'login') {
      lockout = await this.checkLockout(identifier, ipAddress);
    }

    return {
      config,
      current,
      lockout
    };
  }
}