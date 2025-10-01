/**
 * Professional Works CRM Rate Limiter
 * Implements configurable rate limiting for Professional Works API calls
 * with plan-specific settings and backoff strategies
 */

import { RedisService } from '../redis';
import { logger } from '../../utils/logger';
import { ProfessionalWorksCrmConfig } from './types';

export interface PWRateLimitConfig {
  planTier: 'professional' | 'enterprise';
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  burstLimit: number; // Maximum requests in a 10-second window
  backoffMultiplier: number;
  maxBackoffSeconds: number;
  queueMaxSize: number;
}

export interface PWRateLimitResult {
  allowed: boolean;
  remaining: {
    minute: number;
    hour: number;
    day: number;
    burst: number;
  };
  resetTimes: {
    minute: number;
    hour: number;
    day: number;
    burst: number;
  };
  retryAfter?: number;
  queuePosition?: number;
}

export interface PWQueuedRequest {
  id: string;
  timestamp: number;
  priority: 'high' | 'medium' | 'low';
  retryCount: number;
  maxRetries: number;
  backoffUntil?: number;
}

export class ProfessionalWorksRateLimiter {
  private static readonly PLAN_CONFIGS: Record<string, PWRateLimitConfig> = {
    professional: {
      planTier: 'professional',
      requestsPerMinute: 60,    // Conservative estimate
      requestsPerHour: 1000,    // Conservative estimate
      requestsPerDay: 10000,    // Conservative estimate
      burstLimit: 10,           // 10 requests per 10 seconds
      backoffMultiplier: 2,
      maxBackoffSeconds: 300,   // 5 minutes max backoff
      queueMaxSize: 100
    },
    enterprise: {
      planTier: 'enterprise',
      requestsPerMinute: 120,   // Higher limits for enterprise
      requestsPerHour: 3000,
      requestsPerDay: 50000,
      burstLimit: 20,
      backoffMultiplier: 1.5,
      maxBackoffSeconds: 180,   // 3 minutes max backoff
      queueMaxSize: 200
    }
  };

  private static readonly REDIS_KEYS = {
    minute: (instanceId: string) => `pw_rate_limit:minute:${instanceId}`,
    hour: (instanceId: string) => `pw_rate_limit:hour:${instanceId}`,
    day: (instanceId: string) => `pw_rate_limit:day:${instanceId}`,
    burst: (instanceId: string) => `pw_rate_limit:burst:${instanceId}`,
    queue: (instanceId: string) => `pw_rate_limit:queue:${instanceId}`,
    backoff: (instanceId: string) => `pw_rate_limit:backoff:${instanceId}`,
    config: (instanceId: string) => `pw_rate_limit:config:${instanceId}`
  };

  /**
   * Initialize rate limiter configuration for a PW instance
   */
  static async initializeConfig(
    instanceId: string,
    config: ProfessionalWorksCrmConfig,
    customLimits?: Partial<PWRateLimitConfig>
  ): Promise<void> {
    try {
      const baseConfig = this.PLAN_CONFIGS[config.planTier];
      const finalConfig = { ...baseConfig, ...customLimits };
      
      const configKey = this.REDIS_KEYS.config(instanceId);
      await RedisService.set(configKey, finalConfig, 86400); // 24 hours TTL
      
      logger.info('Professional Works rate limiter initialized', {
        instanceId,
        planTier: config.planTier,
        config: finalConfig
      });
    } catch (error) {
      logger.error('Failed to initialize PW rate limiter config', {
        error,
        instanceId,
        planTier: config.planTier
      });
      throw error;
    }
  }

  /**
   * Check if a request can be made immediately
   */
  static async checkRateLimit(
    instanceId: string,
    priority: 'high' | 'medium' | 'low' = 'medium'
  ): Promise<PWRateLimitResult> {
    try {
      const config = await this.getConfig(instanceId);
      if (!config) {
        throw new Error(`Rate limiter not initialized for instance: ${instanceId}`);
      }

      // Check if we're in backoff period
      const backoffUntil = await this.getBackoffTime(instanceId);
      if (backoffUntil && Date.now() < backoffUntil) {
        return {
          allowed: false,
          remaining: await this.getRemainingCounts(instanceId, config),
          resetTimes: await this.getResetTimes(instanceId),
          retryAfter: Math.ceil((backoffUntil - Date.now()) / 1000)
        };
      }

      // Check all rate limit windows
      const counts = await this.getCurrentCounts(instanceId);
      const now = Date.now();

      const result: PWRateLimitResult = {
        allowed: true,
        remaining: {
          minute: Math.max(0, config.requestsPerMinute - counts.minute),
          hour: Math.max(0, config.requestsPerHour - counts.hour),
          day: Math.max(0, config.requestsPerDay - counts.day),
          burst: Math.max(0, config.burstLimit - counts.burst)
        },
        resetTimes: {
          minute: now + (60 * 1000),
          hour: now + (60 * 60 * 1000),
          day: now + (24 * 60 * 60 * 1000),
          burst: now + (10 * 1000)
        }
      };

      // Check if any limit is exceeded
      if (counts.minute >= config.requestsPerMinute ||
          counts.hour >= config.requestsPerHour ||
          counts.day >= config.requestsPerDay ||
          counts.burst >= config.burstLimit) {
        
        result.allowed = false;
        
        // Calculate retry after based on the most restrictive limit
        const retryTimes = [];
        if (counts.minute >= config.requestsPerMinute) retryTimes.push(60);
        if (counts.hour >= config.requestsPerHour) retryTimes.push(3600);
        if (counts.day >= config.requestsPerDay) retryTimes.push(86400);
        if (counts.burst >= config.burstLimit) retryTimes.push(10);
        
        result.retryAfter = Math.min(...retryTimes);
      }

      return result;
    } catch (error) {
      logger.error('Error checking PW rate limit', { error, instanceId, priority });
      // Return permissive result on error to avoid blocking legitimate requests
      return {
        allowed: true,
        remaining: { minute: 999, hour: 999, day: 999, burst: 999 },
        resetTimes: {
          minute: Date.now() + 60000,
          hour: Date.now() + 3600000,
          day: Date.now() + 86400000,
          burst: Date.now() + 10000
        }
      };
    }
  }

  /**
   * Record a successful API request
   */
  static async recordRequest(instanceId: string): Promise<void> {
    try {
      const now = Date.now();
      const promises = [
        this.incrementCounter(this.REDIS_KEYS.minute(instanceId), 60),
        this.incrementCounter(this.REDIS_KEYS.hour(instanceId), 3600),
        this.incrementCounter(this.REDIS_KEYS.day(instanceId), 86400),
        this.incrementCounter(this.REDIS_KEYS.burst(instanceId), 10)
      ];

      await Promise.all(promises);
      
      logger.debug('PW API request recorded', { instanceId, timestamp: now });
    } catch (error) {
      logger.error('Error recording PW API request', { error, instanceId });
      // Don't throw to avoid breaking the main flow
    }
  }

  /**
   * Handle rate limit exceeded scenario with backoff
   */
  static async handleRateLimitExceeded(
    instanceId: string,
    retryCount: number = 0
  ): Promise<number> {
    try {
      const config = await this.getConfig(instanceId);
      if (!config) {
        throw new Error(`Rate limiter not initialized for instance: ${instanceId}`);
      }

      // Calculate exponential backoff
      const baseDelay = Math.min(
        Math.pow(config.backoffMultiplier, retryCount) * 1000,
        config.maxBackoffSeconds * 1000
      );
      
      // Add jitter to prevent thundering herd
      const jitter = Math.random() * 0.1 * baseDelay;
      const backoffMs = baseDelay + jitter;
      const backoffUntil = Date.now() + backoffMs;

      // Store backoff time
      await RedisService.set(
        this.REDIS_KEYS.backoff(instanceId),
        backoffUntil,
        Math.ceil(backoffMs / 1000)
      );

      logger.warn('PW rate limit exceeded, applying backoff', {
        instanceId,
        retryCount,
        backoffSeconds: Math.ceil(backoffMs / 1000),
        backoffUntil
      });

      return Math.ceil(backoffMs / 1000);
    } catch (error) {
      logger.error('Error handling PW rate limit exceeded', { error, instanceId, retryCount });
      return 60; // Default 1 minute backoff
    }
  }

  /**
   * Add request to queue when rate limited
   */
  static async queueRequest(
    instanceId: string,
    requestId: string,
    priority: 'high' | 'medium' | 'low' = 'medium',
    maxRetries: number = 3
  ): Promise<PWQueuedRequest> {
    try {
      const config = await this.getConfig(instanceId);
      if (!config) {
        throw new Error(`Rate limiter not initialized for instance: ${instanceId}`);
      }

      const queueKey = this.REDIS_KEYS.queue(instanceId);
      const currentQueue = await RedisService.get(queueKey) || [];
      
      if (currentQueue.length >= config.queueMaxSize) {
        throw new Error('Request queue is full');
      }

      const queuedRequest: PWQueuedRequest = {
        id: requestId,
        timestamp: Date.now(),
        priority,
        retryCount: 0,
        maxRetries
      };

      currentQueue.push(queuedRequest);
      
      // Sort by priority (high > medium > low) then by timestamp
      currentQueue.sort((a, b) => {
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
        return priorityDiff !== 0 ? priorityDiff : a.timestamp - b.timestamp;
      });

      await RedisService.set(queueKey, currentQueue, 3600); // 1 hour TTL

      logger.info('Request queued for PW API', {
        instanceId,
        requestId,
        priority,
        queuePosition: currentQueue.findIndex(r => r.id === requestId) + 1,
        queueSize: currentQueue.length
      });

      return queuedRequest;
    } catch (error) {
      logger.error('Error queuing PW API request', { error, instanceId, requestId });
      throw error;
    }
  }

  /**
   * Process next request from queue
   */
  static async processQueue(instanceId: string): Promise<PWQueuedRequest | null> {
    try {
      const queueKey = this.REDIS_KEYS.queue(instanceId);
      const currentQueue = await RedisService.get(queueKey) || [];
      
      if (currentQueue.length === 0) {
        return null;
      }

      // Check if we can process requests now
      const rateLimitResult = await this.checkRateLimit(instanceId, 'high');
      if (!rateLimitResult.allowed) {
        return null;
      }

      // Get next request from queue
      const nextRequest = currentQueue.shift();
      if (!nextRequest) {
        return null;
      }

      // Update queue
      await RedisService.set(queueKey, currentQueue, 3600);

      logger.info('Processing queued PW API request', {
        instanceId,
        requestId: nextRequest.id,
        queueSize: currentQueue.length
      });

      return nextRequest;
    } catch (error) {
      logger.error('Error processing PW API queue', { error, instanceId });
      return null;
    }
  }

  /**
   * Update rate limit configuration at runtime
   */
  static async updateConfig(
    instanceId: string,
    updates: Partial<PWRateLimitConfig>
  ): Promise<void> {
    try {
      const currentConfig = await this.getConfig(instanceId);
      if (!currentConfig) {
        throw new Error(`Rate limiter not initialized for instance: ${instanceId}`);
      }

      const updatedConfig = { ...currentConfig, ...updates };
      const configKey = this.REDIS_KEYS.config(instanceId);
      await RedisService.set(configKey, updatedConfig, 86400);

      logger.info('PW rate limiter config updated', {
        instanceId,
        updates,
        newConfig: updatedConfig
      });
    } catch (error) {
      logger.error('Error updating PW rate limiter config', { error, instanceId, updates });
      throw error;
    }
  }

  /**
   * Get current rate limiter status
   */
  static async getStatus(instanceId: string): Promise<{
    config: PWRateLimitConfig;
    currentCounts: { minute: number; hour: number; day: number; burst: number };
    queueSize: number;
    backoffUntil?: number;
  }> {
    try {
      const config = await this.getConfig(instanceId);
      if (!config) {
        throw new Error(`Rate limiter not initialized for instance: ${instanceId}`);
      }

      const [currentCounts, queueSize, backoffUntil] = await Promise.all([
        this.getCurrentCounts(instanceId),
        this.getQueueSize(instanceId),
        this.getBackoffTime(instanceId)
      ]);

      return {
        config,
        currentCounts,
        queueSize,
        backoffUntil: backoffUntil || undefined
      };
    } catch (error) {
      logger.error('Error getting PW rate limiter status', { error, instanceId });
      throw error;
    }
  }

  // Private helper methods

  private static async getConfig(instanceId: string): Promise<PWRateLimitConfig | null> {
    const configKey = this.REDIS_KEYS.config(instanceId);
    return await RedisService.get(configKey);
  }

  private static async getCurrentCounts(instanceId: string): Promise<{
    minute: number;
    hour: number;
    day: number;
    burst: number;
  }> {
    const [minute, hour, day, burst] = await Promise.all([
      RedisService.get(this.REDIS_KEYS.minute(instanceId)),
      RedisService.get(this.REDIS_KEYS.hour(instanceId)),
      RedisService.get(this.REDIS_KEYS.day(instanceId)),
      RedisService.get(this.REDIS_KEYS.burst(instanceId))
    ]);

    return {
      minute: minute || 0,
      hour: hour || 0,
      day: day || 0,
      burst: burst || 0
    };
  }

  private static async getRemainingCounts(
    instanceId: string,
    config: PWRateLimitConfig
  ): Promise<{ minute: number; hour: number; day: number; burst: number }> {
    const current = await this.getCurrentCounts(instanceId);
    return {
      minute: Math.max(0, config.requestsPerMinute - current.minute),
      hour: Math.max(0, config.requestsPerHour - current.hour),
      day: Math.max(0, config.requestsPerDay - current.day),
      burst: Math.max(0, config.burstLimit - current.burst)
    };
  }

  private static async getResetTimes(instanceId: string): Promise<{
    minute: number;
    hour: number;
    day: number;
    burst: number;
  }> {
    const now = Date.now();
    return {
      minute: now + (60 * 1000),
      hour: now + (60 * 60 * 1000),
      day: now + (24 * 60 * 60 * 1000),
      burst: now + (10 * 1000)
    };
  }

  private static async incrementCounter(key: string, ttlSeconds: number): Promise<void> {
    const current = await RedisService.get(key) || 0;
    await RedisService.set(key, current + 1, ttlSeconds);
  }

  private static async getBackoffTime(instanceId: string): Promise<number | null> {
    return await RedisService.get(this.REDIS_KEYS.backoff(instanceId));
  }

  private static async getQueueSize(instanceId: string): Promise<number> {
    const queue = await RedisService.get(this.REDIS_KEYS.queue(instanceId)) || [];
    return queue.length;
  }
}