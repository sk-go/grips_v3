/**
 * Redis Adapter for Client Profile Services
 * Adapts the RedisService to work with ioredis-like interface
 */

import { RedisService } from '../../services/redis';

export class RedisAdapter {
  async get(key: string): Promise<string | null> {
    const result = await RedisService.get(key);
    return result ? JSON.stringify(result) : null;
  }

  async setex(key: string, seconds: number, value: string): Promise<string> {
    await RedisService.set(key, JSON.parse(value), seconds);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (await RedisService.exists(key)) {
        await RedisService.del(key);
        deleted++;
      }
    }
    return deleted;
  }

  async keys(pattern: string): Promise<string[]> {
    // RedisService doesn't have a keys method, so we'll implement a simple version
    // In a real implementation, you'd want to use Redis SCAN command
    // For now, return empty array as this is mainly used for cache clearing
    return [];
  }

  async exists(key: string): Promise<number> {
    return (await RedisService.exists(key)) ? 1 : 0;
  }
}