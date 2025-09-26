import { RateLimitingService } from '../../services/rateLimitingService.simple';
import { RedisService } from '../../services/redis';

// Mock RedisService
jest.mock('../../services/redis');
const mockRedisService = RedisService as jest.Mocked<typeof RedisService>;

describe('RateLimitingService (Simple)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisService.get.mockResolvedValue(null);
    mockRedisService.set.mockResolvedValue(undefined);
    mockRedisService.del.mockResolvedValue(undefined);
  });

  describe('checkLoginRateLimit', () => {
    it('should allow login attempts within rate limit', async () => {
      // Mock no previous attempts
      mockRedisService.get.mockResolvedValue([]);

      const result = await RateLimitingService.checkLoginRateLimit('test@example.com', '127.0.0.1');

      expect(result.allowed).toBe(true);
      expect(result.isLockedOut).toBe(false);
      expect(result.remaining).toBe(4); // 5 max - 1 = 4
    });

    it('should block login attempts when rate limit exceeded', async () => {
      // Mock 5 recent attempts (at rate limit)
      const recentAttempts = Array(5).fill(Date.now() - 60000); // 1 minute ago
      mockRedisService.get
        .mockResolvedValueOnce(null) // no lockout
        .mockResolvedValueOnce(recentAttempts); // rate limit attempts

      const result = await RateLimitingService.checkLoginRateLimit('test@example.com', '127.0.0.1');

      expect(result.allowed).toBe(false);
      expect(result.isLockedOut).toBe(false);
      expect(result.totalHits).toBe(5);
    });

    it('should handle lockout status', async () => {
      // Mock active lockout
      const lockoutData = {
        lockoutTime: Date.now() - 60000, // 1 minute ago
        duration: 1800 // 30 minutes
      };
      mockRedisService.get.mockResolvedValueOnce(lockoutData);

      const result = await RateLimitingService.checkLoginRateLimit('test@example.com', '127.0.0.1');

      expect(result.allowed).toBe(false);
      expect(result.isLockedOut).toBe(true);
      expect(result.lockoutTime).toBeDefined();
      expect(result.lockoutDuration).toBeDefined();
    });

    it('should clear expired lockout', async () => {
      // Mock expired lockout
      const expiredLockoutData = {
        lockoutTime: Date.now() - 2000000, // Long ago
        duration: 1800 // 30 minutes
      };
      mockRedisService.get
        .mockResolvedValueOnce(expiredLockoutData) // lockout check
        .mockResolvedValueOnce([]); // no rate limit attempts

      const result = await RateLimitingService.checkLoginRateLimit('test@example.com', '127.0.0.1');

      expect(result.allowed).toBe(true);
      expect(result.isLockedOut).toBe(false);
      expect(mockRedisService.del).toHaveBeenCalledWith(
        expect.stringContaining('lockout:test@example.com:127.0.0.1')
      );
    });
  });

  describe('recordLoginAttempt', () => {
    it('should clear attempts on successful login', async () => {
      await RateLimitingService.recordLoginAttempt('test@example.com', true, '127.0.0.1');

      expect(mockRedisService.del).toHaveBeenCalledWith(
        expect.stringContaining('rate_limit:login:test@example.com:127.0.0.1')
      );
      expect(mockRedisService.del).toHaveBeenCalledWith(
        expect.stringContaining('lockout:test@example.com:127.0.0.1')
      );
    });

    it('should record failed login attempt', async () => {
      // Mock no previous attempts
      mockRedisService.get.mockResolvedValue([]);

      await RateLimitingService.recordLoginAttempt('test@example.com', false, '127.0.0.1');

      expect(mockRedisService.set).toHaveBeenCalledWith(
        expect.stringContaining('rate_limit:login:test@example.com:127.0.0.1'),
        expect.arrayContaining([expect.any(Number)]),
        expect.any(Number)
      );
    });
  });

  describe('checkPasswordResetRateLimit', () => {
    it('should allow password reset attempts within rate limit', async () => {
      mockRedisService.get.mockResolvedValue([]);

      const result = await RateLimitingService.checkPasswordResetRateLimit('test@example.com', '127.0.0.1');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2); // 3 max - 1 = 2
    });

    it('should block password reset attempts when rate limit exceeded', async () => {
      // Mock 3 recent attempts (at rate limit)
      const recentAttempts = Array(3).fill(Date.now() - 60000);
      mockRedisService.get.mockResolvedValue(recentAttempts);

      const result = await RateLimitingService.checkPasswordResetRateLimit('test@example.com', '127.0.0.1');

      expect(result.allowed).toBe(false);
      expect(result.totalHits).toBe(3);
    });
  });

  describe('checkTokenRefreshRateLimit', () => {
    it('should allow token refresh attempts within rate limit', async () => {
      mockRedisService.get.mockResolvedValue([]);

      const result = await RateLimitingService.checkTokenRefreshRateLimit('127.0.0.1', '127.0.0.1');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9); // 10 max - 1 = 9
    });

    it('should block token refresh attempts when rate limit exceeded', async () => {
      // Mock 10 recent attempts (at rate limit)
      const recentAttempts = Array(10).fill(Date.now() - 60000);
      mockRedisService.get.mockResolvedValue(recentAttempts);

      const result = await RateLimitingService.checkTokenRefreshRateLimit('127.0.0.1', '127.0.0.1');

      expect(result.allowed).toBe(false);
      expect(result.totalHits).toBe(10);
    });
  });

  describe('error handling', () => {
    it('should handle Redis errors gracefully', async () => {
      mockRedisService.get.mockRejectedValue(new Error('Redis connection failed'));

      const result = await RateLimitingService.checkLoginRateLimit('test@example.com', '127.0.0.1');

      expect(result.allowed).toBe(true); // Default to allowing on error
      expect(result.isLockedOut).toBe(false);
    });

    it('should handle malformed Redis data', async () => {
      mockRedisService.get.mockResolvedValue('invalid-data');

      const result = await RateLimitingService.checkLoginRateLimit('test@example.com', '127.0.0.1');

      expect(result.allowed).toBe(true);
      expect(result.isLockedOut).toBe(false);
    });
  });
});