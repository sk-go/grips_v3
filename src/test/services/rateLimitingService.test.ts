import { RateLimitingService } from '../../services/rateLimitingService';
import { RedisService } from '../../services/redis';

// Mock RedisService
jest.mock('../../services/redis');
const mockRedisService = RedisService as jest.Mocked<typeof RedisService>;

describe('RateLimitingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisService.get.mockResolvedValue(null);
    mockRedisService.set.mockResolvedValue(undefined);
    mockRedisService.del.mockResolvedValue(undefined);
  });

  describe('checkRateLimit', () => {
    it('should allow requests within rate limit', async () => {
      // Mock empty attempts (no previous requests)
      mockRedisService.get.mockResolvedValue(null);

      const result = await RateLimitingService.checkRateLimit('test@example.com', 'login', '127.0.0.1');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4); // 5 max - 1 (current) = 4
      expect(result.totalHits).toBe(0);
    });

    it('should block requests exceeding rate limit', async () => {
      // Mock 5 recent attempts (at rate limit)
      const recentAttempts = Array(5).fill(Date.now() - 60000); // 1 minute ago
      mockRedisService.get.mockResolvedValue(JSON.stringify(recentAttempts));

      const result = await RateLimitingService.checkRateLimit('test@example.com', 'login', '127.0.0.1');

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.totalHits).toBe(5);
      expect(result.retryAfter).toBe(1800); // 30 minutes for login
    });

    it('should ignore old attempts outside window', async () => {
      // Mock old attempts (outside 15-minute window)
      const oldAttempts = Array(5).fill(Date.now() - 20 * 60 * 1000); // 20 minutes ago
      mockRedisService.get.mockResolvedValue(JSON.stringify(oldAttempts));

      const result = await RateLimitingService.checkRateLimit('test@example.com', 'login', '127.0.0.1');

      expect(result.allowed).toBe(true);
      expect(result.totalHits).toBe(0); // Old attempts filtered out
    });

    it('should handle different rate limit configurations', async () => {
      mockRedisService.get.mockResolvedValue(null);

      // Test password reset (3 attempts per hour)
      const passwordResetResult = await RateLimitingService.checkRateLimit(
        'test@example.com', 
        'passwordReset', 
        '127.0.0.1'
      );
      expect(passwordResetResult.allowed).toBe(true);
      expect(passwordResetResult.remaining).toBe(2); // 3 max - 1 = 2

      // Test token refresh (10 attempts per 5 minutes)
      const tokenRefreshResult = await RateLimitingService.checkRateLimit(
        '127.0.0.1', 
        'tokenRefresh', 
        '127.0.0.1'
      );
      expect(tokenRefreshResult.allowed).toBe(true);
      expect(tokenRefreshResult.remaining).toBe(9); // 10 max - 1 = 9
    });
  });

  describe('recordAttempt', () => {
    it('should record a new attempt', async () => {
      mockRedisService.get.mockResolvedValue(null);

      await RateLimitingService.recordAttempt('test@example.com', 'login', '127.0.0.1', false);

      expect(mockRedisService.set).toHaveBeenCalledWith(
        expect.stringContaining('auth_login:test@example.com:127.0.0.1'),
        expect.arrayContaining([expect.any(Number)]), // Array of timestamps
        expect.any(Number) // TTL
      );
    });

    it('should append to existing attempts', async () => {
      const existingAttempts = [Date.now() - 60000]; // 1 minute ago
      mockRedisService.get.mockResolvedValue(existingAttempts);

      await RateLimitingService.recordAttempt('test@example.com', 'login', '127.0.0.1', false);

      expect(mockRedisService.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([expect.any(Number), expect.any(Number)]), // Array with 2 elements
        expect.any(Number)
      );
    });

    it('should limit stored attempts to prevent memory issues', async () => {
      // Mock 100 existing attempts
      const manyAttempts = Array(100).fill(Date.now() - 60000);
      mockRedisService.get.mockResolvedValue(manyAttempts);

      await RateLimitingService.recordAttempt('test@example.com', 'login', '127.0.0.1', false);

      // Should only keep the most recent 100 attempts
      const setCall = mockRedisService.set.mock.calls[0];
      const storedAttempts = setCall[1] as number[];
      expect(storedAttempts.length).toBe(100);
    });
  });

  describe('checkLoginRateLimit', () => {
    it('should check lockout status first', async () => {
      // Mock active lockout
      const lockoutData = {
        lockoutTime: Date.now() - 60000, // 1 minute ago
        duration: 1800 // 30 minutes
      };
      mockRedisService.get
        .mockResolvedValueOnce(lockoutData) // lockout check
        .mockResolvedValueOnce(null); // attempts check

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
        .mockResolvedValueOnce(null); // attempts check after lockout cleared

      const result = await RateLimitingService.checkLoginRateLimit('test@example.com', '127.0.0.1');

      expect(result.allowed).toBe(true);
      expect(result.isLockedOut).toBe(false);
      expect(mockRedisService.del).toHaveBeenCalledWith(
        expect.stringContaining('lockout:test@example.com:127.0.0.1')
      );
    });

    it('should check regular rate limit when not locked out', async () => {
      mockRedisService.get
        .mockResolvedValueOnce(null) // no lockout
        .mockResolvedValueOnce(null); // no attempts

      const result = await RateLimitingService.checkLoginRateLimit('test@example.com', '127.0.0.1');

      expect(result.allowed).toBe(true);
      expect(result.isLockedOut).toBe(false);
      expect(result.remaining).toBe(4); // 5 max - 1 = 4
    });
  });

  describe('clearAttempts', () => {
    it('should clear attempts for successful login', async () => {
      await RateLimitingService.clearAttempts('test@example.com', 'login', '127.0.0.1');

      expect(mockRedisService.del).toHaveBeenCalledWith(
        expect.stringContaining('auth_login:test@example.com:127.0.0.1')
      );
    });
  });

  describe('getRateLimitStatus', () => {
    it('should return comprehensive rate limit status', async () => {
      mockRedisService.get.mockResolvedValue(null);

      const status = await RateLimitingService.getRateLimitStatus(
        'test@example.com', 
        'login', 
        '127.0.0.1'
      );

      expect(status.config).toBeDefined();
      expect(status.config.maxAttempts).toBe(5);
      expect(status.config.windowMs).toBe(15 * 60 * 1000);
      expect(status.current).toBeDefined();
      expect(status.current.allowed).toBe(true);
      expect(status.lockout).toBeDefined();
      expect(status.lockout?.isLockedOut).toBe(false);
    });

    it('should include lockout status for login action', async () => {
      const lockoutData = {
        lockoutTime: Date.now(),
        duration: 1800
      };
      mockRedisService.get
        .mockResolvedValueOnce(lockoutData) // lockout check
        .mockResolvedValueOnce(null); // attempts check

      const status = await RateLimitingService.getRateLimitStatus(
        'test@example.com', 
        'login', 
        '127.0.0.1'
      );

      expect(status.lockout?.isLockedOut).toBe(true);
    });

    it('should not include lockout status for non-login actions', async () => {
      mockRedisService.get.mockResolvedValue(null);

      const status = await RateLimitingService.getRateLimitStatus(
        'test@example.com', 
        'passwordReset', 
        '127.0.0.1'
      );

      expect(status.lockout).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('should handle Redis errors gracefully', async () => {
      mockRedisService.get.mockRejectedValue(new Error('Redis connection failed'));

      // Should not throw, but return a default result
      const result = await RateLimitingService.checkRateLimit('test@example.com', 'login', '127.0.0.1');

      expect(result.allowed).toBe(true); // Default to allowing on error
      expect(result.totalHits).toBe(0);
    });

    it('should handle malformed Redis data', async () => {
      mockRedisService.get.mockResolvedValue('invalid-data');

      const result = await RateLimitingService.checkRateLimit('test@example.com', 'login', '127.0.0.1');

      expect(result.allowed).toBe(true);
      expect(result.totalHits).toBe(0);
    });
  });
});