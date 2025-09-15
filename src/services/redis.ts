import { createClient, RedisClientType } from 'redis';
import { logger } from '../utils/logger';

class RedisService {
  private static client: RedisClientType;

  static async initialize(): Promise<void> {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    this.client = createClient({
      url: redisUrl,
      password: process.env.REDIS_PASSWORD || undefined,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 500)
      }
    });

    this.client.on('error', (error) => {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Redis client error', { error: errorMessage });
    });

    this.client.on('connect', () => {
      logger.info('Redis client connected');
    });

    this.client.on('reconnecting', () => {
      logger.info('Redis client reconnecting');
    });

    await this.client.connect();
    
    // Test the connection
    try {
      await this.client.ping();
      logger.info('Redis connection test successful');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Redis connection failed', { error: errorMessage });
      throw error;
    }
  }

  static getClient(): RedisClientType {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }
    return this.client;
  }

  // Session management methods
  static async setSession(sessionId: string, data: any, ttlSeconds: number = 86400): Promise<void> {
    const key = `session:${sessionId}`;
    await this.client.setEx(key, ttlSeconds, JSON.stringify(data));
    logger.debug('Session stored', { sessionId, ttl: ttlSeconds });
  }

  static async getSession(sessionId: string): Promise<any | null> {
    const key = `session:${sessionId}`;
    const data = await this.client.get(key);
    if (data) {
      return JSON.parse(data);
    }
    return null;
  }

  static async deleteSession(sessionId: string): Promise<void> {
    const key = `session:${sessionId}`;
    await this.client.del(key);
    logger.debug('Session deleted', { sessionId });
  }

  // CRM data caching methods
  static async setCrmData(crmSystem: string, crmId: string, data: any, ttlSeconds: number = 21600): Promise<void> {
    const key = `crm_client:${crmSystem}:${crmId}`;
    await this.client.setEx(key, ttlSeconds, JSON.stringify(data));
    logger.debug('CRM data cached', { crmSystem, crmId, ttl: ttlSeconds });
  }

  static async getCrmData(crmSystem: string, crmId: string): Promise<any | null> {
    const key = `crm_client:${crmSystem}:${crmId}`;
    const data = await this.client.get(key);
    if (data) {
      return JSON.parse(data);
    }
    return null;
  }

  // AI conversation context caching
  static async setAiContext(sessionId: string, context: any, ttlSeconds: number = 3600): Promise<void> {
    const key = `ai_context:${sessionId}`;
    await this.client.setEx(key, ttlSeconds, JSON.stringify(context));
    logger.debug('AI context cached', { sessionId, ttl: ttlSeconds });
  }

  static async getAiContext(sessionId: string): Promise<any | null> {
    const key = `ai_context:${sessionId}`;
    const data = await this.client.get(key);
    if (data) {
      return JSON.parse(data);
    }
    return null;
  }

  // Email sync state management
  static async setEmailSyncState(accountId: string, state: any, ttlSeconds: number = 86400): Promise<void> {
    const key = `email_sync:${accountId}`;
    await this.client.setEx(key, ttlSeconds, JSON.stringify(state));
    logger.debug('Email sync state stored', { accountId, ttl: ttlSeconds });
  }

  static async getEmailSyncState(accountId: string): Promise<any | null> {
    const key = `email_sync:${accountId}`;
    const data = await this.client.get(key);
    if (data) {
      return JSON.parse(data);
    }
    return null;
  }

  // Rate limiting support
  static async incrementRateLimit(key: string, windowMs: number): Promise<number> {
    const multi = this.client.multi();
    multi.incr(key);
    multi.expire(key, Math.ceil(windowMs / 1000));
    const results = await multi.exec();
    return results[0] as number;
  }

  // Generic cache methods
  static async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    const serializedValue = JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.setEx(key, ttlSeconds, serializedValue);
    } else {
      await this.client.set(key, serializedValue);
    }
  }

  static async get(key: string): Promise<any | null> {
    const data = await this.client.get(key);
    if (data) {
      try {
        return JSON.parse(data);
      } catch {
        return data; // Return as string if not JSON
      }
    }
    return null;
  }

  static async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  static async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  static async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      logger.info('Redis connection closed');
    }
  }
}

export { RedisService };