import { RedisService } from './redis';
import { logger } from '../utils/logger';
import { RateLimitingService, RateLimitResult } from './rateLimitingService';

export interface RegistrationRateLimitConfig {
  registrationPerIP: { limit: number; windowMs: number; blockDuration?: number };
  registrationPerEmail: { limit: number; windowMs: number; blockDuration?: number };
  verificationAttempts: { limit: number; windowMs: number };
  resendVerification: { limit: number; windowMs: number };
}

export interface RegistrationRateLimitResult extends RateLimitResult {
  progressiveDelay?: number;
  alertTriggered?: boolean;
  suspiciousActivity?: boolean;
}

export interface RegistrationAttemptData {
  timestamp: number;
  ipAddress: string;
  email: string;
  userAgent?: string;
  success: boolean;
}

export class RegistrationRateLimitingService {
  // Registration-specific rate limit configurations
  private static readonly registrationConfigs: RegistrationRateLimitConfig = {
    registrationPerIP: {
      limit: 5,
      windowMs: 60 * 60 * 1000, // 1 hour
      blockDuration: 2 * 60 * 60 // 2 hours lockout
    },
    registrationPerEmail: {
      limit: 3,
      windowMs: 24 * 60 * 60 * 1000, // 24 hours
      blockDuration: 24 * 60 * 60 // 24 hours lockout
    },
    verificationAttempts: {
      limit: 10,
      windowMs: 60 * 60 * 1000 // 1 hour
    },
    resendVerification: {
      limit: 3,
      windowMs: 15 * 60 * 1000 // 15 minutes
    }
  };

  // Progressive delay configuration (in seconds)
  private static readonly progressiveDelays = [0, 5, 15, 30, 60, 120, 300]; // 0s, 5s, 15s, 30s, 1m, 2m, 5m

  // Suspicious activity thresholds
  private static readonly suspiciousActivityThresholds = {
    maxRegistrationsPerIPPerHour: 10,
    maxUniqueEmailsPerIPPerHour: 8,
    maxFailedAttemptsPerIPPerHour: 20
  };

  /**
   * Check registration rate limit for IP address
   */
  static async checkRegistrationRateLimitByIP(
    ipAddress: string,
    userAgent?: string
  ): Promise<RegistrationRateLimitResult> {
    try {
      const config = this.registrationConfigs.registrationPerIP;
      const key = this.generateRegistrationKey('ip', ipAddress);
      
      const attempts = await this.getRegistrationAttempts(key);
      const windowStart = Date.now() - config.windowMs;
      const validAttempts = attempts.filter(attempt => attempt.timestamp > windowStart);
      
      const currentCount = validAttempts.length;
      const allowed = currentCount < config.limit;
      
      // Calculate progressive delay
      const progressiveDelay = this.calculateProgressiveDelay(currentCount);
      
      // Check for suspicious activity
      const suspiciousActivity = await this.detectSuspiciousActivity(ipAddress, validAttempts);
      
      const result: RegistrationRateLimitResult = {
        allowed: allowed && !suspiciousActivity,
        remaining: Math.max(0, config.limit - currentCount - 1),
        resetTime: this.calculateResetTime(validAttempts, config.windowMs),
        totalHits: currentCount,
        progressiveDelay,
        suspiciousActivity
      };

      // Set retry after if blocked
      if (!allowed && config.blockDuration) {
        result.retryAfter = config.blockDuration;
      }

      // Trigger alert if threshold exceeded
      if (currentCount >= config.limit || suspiciousActivity) {
        result.alertTriggered = await this.triggerSecurityAlert('ip_registration_limit', {
          ipAddress,
          userAgent,
          attempts: currentCount,
          suspiciousActivity
        });
      }

      return result;
    } catch (error) {
      logger.error('Error checking IP registration rate limit', { error, ipAddress });
      return this.getPermissiveResult();
    }
  }

  /**
   * Check registration rate limit for email address
   */
  static async checkRegistrationRateLimitByEmail(
    email: string,
    ipAddress: string
  ): Promise<RegistrationRateLimitResult> {
    try {
      const normalizedEmail = email.toLowerCase();
      const config = this.registrationConfigs.registrationPerEmail;
      const key = this.generateRegistrationKey('email', normalizedEmail);
      
      const attempts = await this.getRegistrationAttempts(key);
      const windowStart = Date.now() - config.windowMs;
      const validAttempts = attempts.filter(attempt => attempt.timestamp > windowStart);
      
      const currentCount = validAttempts.length;
      const allowed = currentCount < config.limit;
      
      // Calculate progressive delay
      const progressiveDelay = this.calculateProgressiveDelay(currentCount);
      
      const result: RegistrationRateLimitResult = {
        allowed,
        remaining: Math.max(0, config.limit - currentCount - 1),
        resetTime: this.calculateResetTime(validAttempts, config.windowMs),
        totalHits: currentCount,
        progressiveDelay
      };

      // Set retry after if blocked
      if (!allowed && config.blockDuration) {
        result.retryAfter = config.blockDuration;
      }

      // Trigger alert if threshold exceeded
      if (currentCount >= config.limit) {
        result.alertTriggered = await this.triggerSecurityAlert('email_registration_limit', {
          email: normalizedEmail,
          ipAddress,
          attempts: currentCount
        });
      }

      return result;
    } catch (error) {
      logger.error('Error checking email registration rate limit', { error, email });
      return this.getPermissiveResult();
    }
  }

  /**
   * Check email verification rate limit
   */
  static async checkVerificationRateLimit(
    email: string,
    ipAddress: string
  ): Promise<RateLimitResult> {
    const normalizedEmail = email.toLowerCase();
    const config = this.registrationConfigs.verificationAttempts;
    
    return RateLimitingService.checkRateLimit(
      normalizedEmail,
      'register', // Use existing register config as base
      ipAddress
    );
  }

  /**
   * Check resend verification rate limit
   */
  static async checkResendVerificationRateLimit(
    email: string,
    ipAddress: string
  ): Promise<RateLimitResult> {
    try {
      const normalizedEmail = email.toLowerCase();
      const config = this.registrationConfigs.resendVerification;
      const key = this.generateRegistrationKey('resend', normalizedEmail, ipAddress);
      
      const attempts = await this.getSimpleAttempts(key);
      const windowStart = Date.now() - config.windowMs;
      const validAttempts = attempts.filter(timestamp => timestamp > windowStart);
      
      const currentCount = validAttempts.length;
      const allowed = currentCount < config.limit;
      
      return {
        allowed,
        remaining: Math.max(0, config.limit - currentCount - 1),
        resetTime: this.calculateResetTime(validAttempts.map(t => ({ timestamp: t })), config.windowMs),
        totalHits: currentCount
      };
    } catch (error) {
      logger.error('Error checking resend verification rate limit', { error, email });
      return this.getPermissiveResult();
    }
  }

  /**
   * Record a registration attempt
   */
  static async recordRegistrationAttempt(
    email: string,
    ipAddress: string,
    success: boolean,
    userAgent?: string
  ): Promise<void> {
    try {
      const normalizedEmail = email.toLowerCase();
      const timestamp = Date.now();
      
      const attemptData: RegistrationAttemptData = {
        timestamp,
        ipAddress,
        email: normalizedEmail,
        userAgent,
        success
      };

      // Record attempt by IP
      const ipKey = this.generateRegistrationKey('ip', ipAddress);
      await this.addRegistrationAttempt(ipKey, attemptData);

      // Record attempt by email
      const emailKey = this.generateRegistrationKey('email', normalizedEmail);
      await this.addRegistrationAttempt(emailKey, attemptData);

      // Record in global registration log for monitoring
      await this.recordGlobalRegistrationAttempt(attemptData);

      logger.info('Registration attempt recorded', {
        email: normalizedEmail,
        ipAddress,
        success,
        userAgent
      });
    } catch (error) {
      logger.error('Error recording registration attempt', { error, email, ipAddress });
    }
  }

  /**
   * Record a verification attempt
   */
  static async recordVerificationAttempt(
    email: string,
    ipAddress: string,
    success: boolean
  ): Promise<void> {
    const normalizedEmail = email.toLowerCase();
    await RateLimitingService.recordAttempt(normalizedEmail, 'register', ipAddress, success);
  }

  /**
   * Record a resend verification attempt
   */
  static async recordResendVerificationAttempt(
    email: string,
    ipAddress: string
  ): Promise<void> {
    try {
      const normalizedEmail = email.toLowerCase();
      const key = this.generateRegistrationKey('resend', normalizedEmail, ipAddress);
      await this.addSimpleAttempt(key, Date.now());
      
      logger.debug('Resend verification attempt recorded', {
        email: normalizedEmail,
        ipAddress
      });
    } catch (error) {
      logger.error('Error recording resend verification attempt', { error, email, ipAddress });
    }
  }

  /**
   * Clear registration attempts for successful registration
   */
  static async clearRegistrationAttempts(
    email: string,
    ipAddress: string
  ): Promise<void> {
    try {
      const normalizedEmail = email.toLowerCase();
      
      // Clear IP-based attempts
      const ipKey = this.generateRegistrationKey('ip', ipAddress);
      await RedisService.del(ipKey);
      
      // Clear email-based attempts
      const emailKey = this.generateRegistrationKey('email', normalizedEmail);
      await RedisService.del(emailKey);
      
      logger.info('Registration attempts cleared for successful registration', {
        email: normalizedEmail,
        ipAddress
      });
    } catch (error) {
      logger.error('Error clearing registration attempts', { error, email, ipAddress });
    }
  }

  /**
   * Get registration statistics for monitoring
   */
  static async getRegistrationStatistics(
    timeWindowMs: number = 60 * 60 * 1000 // Default 1 hour
  ): Promise<{
    totalAttempts: number;
    successfulRegistrations: number;
    failedAttempts: number;
    uniqueIPs: number;
    uniqueEmails: number;
    alertsTriggered: number;
  }> {
    try {
      const globalKey = 'registration:global:attempts';
      const attempts = await this.getRegistrationAttempts(globalKey);
      const windowStart = Date.now() - timeWindowMs;
      const validAttempts = attempts.filter(attempt => attempt.timestamp > windowStart);
      
      const totalAttempts = validAttempts.length;
      const successfulRegistrations = validAttempts.filter(a => a.success).length;
      const failedAttempts = totalAttempts - successfulRegistrations;
      const uniqueIPs = new Set(validAttempts.map(a => a.ipAddress)).size;
      const uniqueEmails = new Set(validAttempts.map(a => a.email)).size;
      
      // Get alerts count
      const alertsKey = 'registration:alerts:count';
      const alertsData = await RedisService.get(alertsKey) || 0;
      const alertsTriggered = typeof alertsData === 'number' ? alertsData : 0;
      
      return {
        totalAttempts,
        successfulRegistrations,
        failedAttempts,
        uniqueIPs,
        uniqueEmails,
        alertsTriggered
      };
    } catch (error) {
      logger.error('Error getting registration statistics', { error });
      return {
        totalAttempts: 0,
        successfulRegistrations: 0,
        failedAttempts: 0,
        uniqueIPs: 0,
        uniqueEmails: 0,
        alertsTriggered: 0
      };
    }
  }

  /**
   * Calculate progressive delay based on attempt count
   */
  private static calculateProgressiveDelay(attemptCount: number): number {
    const index = Math.min(attemptCount, this.progressiveDelays.length - 1);
    return this.progressiveDelays[index];
  }

  /**
   * Detect suspicious registration activity
   */
  private static async detectSuspiciousActivity(
    ipAddress: string,
    attempts: RegistrationAttemptData[]
  ): Promise<boolean> {
    try {
      const hourAgo = Date.now() - (60 * 60 * 1000);
      const recentAttempts = attempts.filter(a => a.timestamp > hourAgo);
      
      // Check various suspicious patterns
      const totalAttempts = recentAttempts.length;
      const uniqueEmails = new Set(recentAttempts.map(a => a.email)).size;
      const failedAttempts = recentAttempts.filter(a => !a.success).length;
      
      const isSuspicious = 
        totalAttempts > this.suspiciousActivityThresholds.maxRegistrationsPerIPPerHour ||
        uniqueEmails > this.suspiciousActivityThresholds.maxUniqueEmailsPerIPPerHour ||
        failedAttempts > this.suspiciousActivityThresholds.maxFailedAttemptsPerIPPerHour;
      
      if (isSuspicious) {
        logger.warn('Suspicious registration activity detected', {
          ipAddress,
          totalAttempts,
          uniqueEmails,
          failedAttempts,
          thresholds: this.suspiciousActivityThresholds
        });
      }
      
      return isSuspicious;
    } catch (error) {
      logger.error('Error detecting suspicious activity', { error, ipAddress });
      return false;
    }
  }

  /**
   * Trigger security alert
   */
  private static async triggerSecurityAlert(
    alertType: string,
    data: any
  ): Promise<boolean> {
    try {
      const alertKey = `registration:alert:${alertType}:${Date.now()}`;
      const alertData = {
        type: alertType,
        timestamp: Date.now(),
        data
      };
      
      // Store alert for 24 hours
      await RedisService.set(alertKey, alertData, 24 * 60 * 60);
      
      // Increment alert counter
      const counterKey = 'registration:alerts:count';
      const currentCount = await RedisService.get(counterKey) || 0;
      await RedisService.set(counterKey, (currentCount as number) + 1, 24 * 60 * 60);
      
      logger.warn('Security alert triggered', {
        alertType,
        data
      });
      
      // In a production environment, this would also:
      // - Send notifications to administrators
      // - Update monitoring dashboards
      // - Trigger automated responses if configured
      
      return true;
    } catch (error) {
      logger.error('Error triggering security alert', { error, alertType, data });
      return false;
    }
  }

  /**
   * Generate Redis key for registration rate limiting
   */
  private static generateRegistrationKey(
    type: string,
    identifier: string,
    ipAddress?: string
  ): string {
    const parts = ['registration', type, identifier];
    if (ipAddress) {
      parts.push(ipAddress);
    }
    return parts.join(':');
  }

  /**
   * Get registration attempts from Redis
   */
  private static async getRegistrationAttempts(key: string): Promise<RegistrationAttemptData[]> {
    const data = await RedisService.get(key);
    if (!data || !Array.isArray(data)) return [];
    return data;
  }

  /**
   * Add registration attempt to Redis
   */
  private static async addRegistrationAttempt(
    key: string,
    attempt: RegistrationAttemptData
  ): Promise<void> {
    const current = await this.getRegistrationAttempts(key);
    current.push(attempt);
    
    // Keep only recent attempts (last 100 to prevent memory issues)
    const recent = current.slice(-100);
    
    // Set with TTL of 25 hours (longer than the longest window)
    await RedisService.set(key, recent, 25 * 60 * 60);
  }

  /**
   * Get simple attempts (timestamps only) from Redis
   */
  private static async getSimpleAttempts(key: string): Promise<number[]> {
    const data = await RedisService.get(key);
    if (!data || !Array.isArray(data)) return [];
    return data;
  }

  /**
   * Add simple attempt (timestamp only) to Redis
   */
  private static async addSimpleAttempt(key: string, timestamp: number): Promise<void> {
    const current = await this.getSimpleAttempts(key);
    current.push(timestamp);
    
    // Keep only recent attempts
    const recent = current.slice(-50);
    
    // Set with TTL of 1 hour
    await RedisService.set(key, recent, 60 * 60);
  }

  /**
   * Record attempt in global registration log
   */
  private static async recordGlobalRegistrationAttempt(
    attempt: RegistrationAttemptData
  ): Promise<void> {
    const globalKey = 'registration:global:attempts';
    await this.addRegistrationAttempt(globalKey, attempt);
  }

  /**
   * Calculate reset time based on attempts
   */
  private static calculateResetTime(
    attempts: { timestamp: number }[],
    windowMs: number
  ): number {
    if (attempts.length === 0) return Date.now() + windowMs;
    const oldestAttempt = Math.min(...attempts.map(a => a.timestamp));
    return oldestAttempt + windowMs;
  }

  /**
   * Get permissive result for error cases
   */
  private static getPermissiveResult(): RegistrationRateLimitResult {
    return {
      allowed: true,
      remaining: 999,
      resetTime: Date.now() + 900000,
      totalHits: 0,
      progressiveDelay: 0
    };
  }
}