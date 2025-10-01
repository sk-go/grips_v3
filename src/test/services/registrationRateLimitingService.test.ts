import { RegistrationRateLimitingService } from '../../services/registrationRateLimitingService';
import { RedisService } from '../../services/redis';
import { logger } from '../../utils/logger';

// Mock dependencies
jest.mock('../../services/redis');
jest.mock('../../utils/logger');

const mockRedisService = RedisService as jest.Mocked<typeof RedisService>;
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('RegistrationRateLimitingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisService.get.mockResolvedValue(null);
    mockRedisService.set.mockResolvedValue(undefined);
    mockRedisService.del.mockResolvedValue(undefined);
  });

  describe('checkRegistrationRateLimitByIP', () => {
    it('should allow registration when under IP limit', async () => {
      const ipAddress = '192.168.1.1';
      const userAgent = 'Mozilla/5.0';
      
      mockRedisService.get.mockResolvedValue([]);
      
      const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(
        ipAddress,
        userAgent
      );
      
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4); // 5 limit - 0 current - 1
      expect(result.totalHits).toBe(0);
      expect(result.progressiveDelay).toBe(0);
      expect(result.suspiciousActivity).toBe(false);
    });

    it('should block registration when IP limit exceeded', async () => {
      const ipAddress = '192.168.1.1';
      const now = Date.now();
      
      // Mock 5 recent attempts (at the limit)
      const attempts = Array.from({ length: 5 }, (_, i) => ({
        timestamp: now - (i * 60000), // 1 minute apart
        ipAddress,
        email: `user${i}@example.com`,
        success: false
      }));
      
      mockRedisService.get.mockResolvedValue(attempts);
      
      const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(ipAddress);
      
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.totalHits).toBe(5);
      expect(result.retryAfter).toBe(2 * 60 * 60); // 2 hours
      expect(result.alertTriggered).toBe(true);
    });

    it('should calculate progressive delays correctly', async () => {
      const ipAddress = '192.168.1.1';
      const now = Date.now();
      
      // Test different attempt counts and their delays
      const testCases = [
        { attempts: 0, expectedDelay: 0 },
        { attempts: 1, expectedDelay: 5 },
        { attempts: 2, expectedDelay: 15 },
        { attempts: 3, expectedDelay: 30 },
        { attempts: 4, expectedDelay: 60 },
        { attempts: 5, expectedDelay: 120 },
        { attempts: 10, expectedDelay: 300 } // Max delay
      ];
      
      for (const testCase of testCases) {
        const attempts = Array.from({ length: testCase.attempts }, (_, i) => ({
          timestamp: now - (i * 60000),
          ipAddress,
          email: `user${i}@example.com`,
          success: false
        }));
        
        mockRedisService.get.mockResolvedValue(attempts);
        
        const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(ipAddress);
        
        expect(result.progressiveDelay).toBe(testCase.expectedDelay);
      }
    });

    it('should detect suspicious activity', async () => {
      const ipAddress = '192.168.1.1';
      const now = Date.now();
      
      // Create 15 attempts in the last hour (exceeds threshold of 10)
      const attempts = Array.from({ length: 15 }, (_, i) => ({
        timestamp: now - (i * 60000), // 1 minute apart
        ipAddress,
        email: `user${i}@example.com`,
        success: false
      }));
      
      mockRedisService.get.mockResolvedValue(attempts);
      
      const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(ipAddress);
      
      expect(result.suspiciousActivity).toBe(true);
      expect(result.allowed).toBe(false);
      expect(result.alertTriggered).toBe(true);
    });

    it('should handle Redis errors gracefully', async () => {
      const ipAddress = '192.168.1.1';
      
      mockRedisService.get.mockRejectedValue(new Error('Redis connection failed'));
      
      const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(ipAddress);
      
      expect(result.allowed).toBe(true); // Permissive on error
      expect(result.remaining).toBe(999);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error checking IP registration rate limit',
        expect.any(Object)
      );
    });
  });

  describe('checkRegistrationRateLimitByEmail', () => {
    it('should allow registration when under email limit', async () => {
      const email = 'user@example.com';
      const ipAddress = '192.168.1.1';
      
      mockRedisService.get.mockResolvedValue([]);
      
      const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByEmail(
        email,
        ipAddress
      );
      
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2); // 3 limit - 0 current - 1
      expect(result.totalHits).toBe(0);
    });

    it('should block registration when email limit exceeded', async () => {
      const email = 'user@example.com';
      const ipAddress = '192.168.1.1';
      const now = Date.now();
      
      // Mock 3 attempts in 24 hours (at the limit)
      const attempts = Array.from({ length: 3 }, (_, i) => ({
        timestamp: now - (i * 60000),
        ipAddress,
        email: email.toLowerCase(),
        success: false
      }));
      
      mockRedisService.get.mockResolvedValue(attempts);
      
      const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByEmail(
        email,
        ipAddress
      );
      
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.totalHits).toBe(3);
      expect(result.retryAfter).toBe(24 * 60 * 60); // 24 hours
      expect(result.alertTriggered).toBe(true);
    });

    it('should normalize email addresses', async () => {
      const email = 'USER@EXAMPLE.COM';
      const ipAddress = '192.168.1.1';
      
      mockRedisService.get.mockResolvedValue([]);
      
      await RegistrationRateLimitingService.checkRegistrationRateLimitByEmail(email, ipAddress);
      
      expect(mockRedisService.get).toHaveBeenCalledWith('registration:email:user@example.com');
    });
  });

  describe('checkResendVerificationRateLimit', () => {
    it('should allow resend when under limit', async () => {
      const email = 'user@example.com';
      const ipAddress = '192.168.1.1';
      
      mockRedisService.get.mockResolvedValue([]);
      
      const result = await RegistrationRateLimitingService.checkResendVerificationRateLimit(
        email,
        ipAddress
      );
      
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2); // 3 limit - 0 current - 1
    });

    it('should block resend when limit exceeded', async () => {
      const email = 'user@example.com';
      const ipAddress = '192.168.1.1';
      const now = Date.now();
      
      // Mock 3 attempts in 15 minutes (at the limit)
      const attempts = [now - 60000, now - 120000, now - 180000];
      
      mockRedisService.get.mockResolvedValue(attempts);
      
      const result = await RegistrationRateLimitingService.checkResendVerificationRateLimit(
        email,
        ipAddress
      );
      
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.totalHits).toBe(3);
    });
  });

  describe('recordRegistrationAttempt', () => {
    it('should record attempt for both IP and email', async () => {
      const email = 'user@example.com';
      const ipAddress = '192.168.1.1';
      const userAgent = 'Mozilla/5.0';
      
      mockRedisService.get.mockResolvedValue([]);
      
      await RegistrationRateLimitingService.recordRegistrationAttempt(
        email,
        ipAddress,
        false,
        userAgent
      );
      
      // Should call Redis set for IP key, email key, and global key
      expect(mockRedisService.set).toHaveBeenCalledTimes(3);
      
      // Check IP key
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'registration:ip:192.168.1.1',
        expect.arrayContaining([
          expect.objectContaining({
            email: 'user@example.com',
            ipAddress: '192.168.1.1',
            userAgent: 'Mozilla/5.0',
            success: false
          })
        ]),
        25 * 60 * 60
      );
      
      // Check email key
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'registration:email:user@example.com',
        expect.arrayContaining([
          expect.objectContaining({
            email: 'user@example.com',
            ipAddress: '192.168.1.1',
            success: false
          })
        ]),
        25 * 60 * 60
      );
    });

    it('should handle Redis errors gracefully', async () => {
      const email = 'user@example.com';
      const ipAddress = '192.168.1.1';
      
      mockRedisService.get.mockRejectedValue(new Error('Redis error'));
      
      await expect(
        RegistrationRateLimitingService.recordRegistrationAttempt(email, ipAddress, false)
      ).resolves.not.toThrow();
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error recording registration attempt',
        expect.any(Object)
      );
    });
  });

  describe('clearRegistrationAttempts', () => {
    it('should clear attempts for both IP and email', async () => {
      const email = 'user@example.com';
      const ipAddress = '192.168.1.1';
      
      await RegistrationRateLimitingService.clearRegistrationAttempts(email, ipAddress);
      
      expect(mockRedisService.del).toHaveBeenCalledWith('registration:ip:192.168.1.1');
      expect(mockRedisService.del).toHaveBeenCalledWith('registration:email:user@example.com');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Registration attempts cleared for successful registration',
        { email: 'user@example.com', ipAddress: '192.168.1.1' }
      );
    });
  });

  describe('getRegistrationStatistics', () => {
    it('should return registration statistics', async () => {
      const now = Date.now();
      const attempts = [
        {
          timestamp: now - 30000,
          ipAddress: '192.168.1.1',
          email: 'user1@example.com',
          success: true
        },
        {
          timestamp: now - 60000,
          ipAddress: '192.168.1.2',
          email: 'user2@example.com',
          success: false
        },
        {
          timestamp: now - 90000,
          ipAddress: '192.168.1.1',
          email: 'user3@example.com',
          success: true
        }
      ];
      
      mockRedisService.get
        .mockResolvedValueOnce(attempts) // Global attempts
        .mockResolvedValueOnce(5); // Alert count
      
      const stats = await RegistrationRateLimitingService.getRegistrationStatistics();
      
      expect(stats).toEqual({
        totalAttempts: 3,
        successfulRegistrations: 2,
        failedAttempts: 1,
        uniqueIPs: 2,
        uniqueEmails: 3,
        alertsTriggered: 5
      });
    });

    it('should handle missing data gracefully', async () => {
      mockRedisService.get.mockResolvedValue(null);
      
      const stats = await RegistrationRateLimitingService.getRegistrationStatistics();
      
      expect(stats).toEqual({
        totalAttempts: 0,
        successfulRegistrations: 0,
        failedAttempts: 0,
        uniqueIPs: 0,
        uniqueEmails: 0,
        alertsTriggered: 0
      });
    });
  });

  describe('suspicious activity detection', () => {
    it('should detect too many registrations per IP', async () => {
      const ipAddress = '192.168.1.1';
      const now = Date.now();
      
      // Create 12 attempts in the last hour (exceeds threshold of 10)
      const attempts = Array.from({ length: 12 }, (_, i) => ({
        timestamp: now - (i * 60000),
        ipAddress,
        email: `user${i}@example.com`,
        success: i % 2 === 0 // Mix of success/failure
      }));
      
      mockRedisService.get.mockResolvedValue(attempts);
      
      const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(ipAddress);
      
      expect(result.suspiciousActivity).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Suspicious registration activity detected',
        expect.objectContaining({
          ipAddress,
          totalAttempts: 12
        })
      );
    });

    it('should detect too many unique emails per IP', async () => {
      const ipAddress = '192.168.1.1';
      const now = Date.now();
      
      // Create 10 attempts with 10 unique emails (exceeds threshold of 8)
      const attempts = Array.from({ length: 10 }, (_, i) => ({
        timestamp: now - (i * 60000),
        ipAddress,
        email: `user${i}@example.com`,
        success: false
      }));
      
      mockRedisService.get.mockResolvedValue(attempts);
      
      const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(ipAddress);
      
      expect(result.suspiciousActivity).toBe(true);
    });

    it('should detect too many failed attempts per IP', async () => {
      const ipAddress = '192.168.1.1';
      const now = Date.now();
      
      // Create 25 failed attempts (exceeds threshold of 20)
      const attempts = Array.from({ length: 25 }, (_, i) => ({
        timestamp: now - (i * 60000),
        ipAddress,
        email: `user${i % 5}@example.com`, // Reuse some emails
        success: false
      }));
      
      mockRedisService.get.mockResolvedValue(attempts);
      
      const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(ipAddress);
      
      expect(result.suspiciousActivity).toBe(true);
    });
  });

  describe('security alerts', () => {
    it('should trigger and store security alerts', async () => {
      const ipAddress = '192.168.1.1';
      const now = Date.now();
      
      // Create attempts that exceed the limit
      const attempts = Array.from({ length: 6 }, (_, i) => ({
        timestamp: now - (i * 60000),
        ipAddress,
        email: `user${i}@example.com`,
        success: false
      }));
      
      mockRedisService.get
        .mockResolvedValueOnce(attempts) // For rate limit check
        .mockResolvedValueOnce(0); // For alert counter
      
      const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(ipAddress);
      
      expect(result.alertTriggered).toBe(true);
      
      // Should store alert data
      expect(mockRedisService.set).toHaveBeenCalledWith(
        expect.stringMatching(/^registration:alert:ip_registration_limit:/),
        expect.objectContaining({
          type: 'ip_registration_limit',
          timestamp: expect.any(Number),
          data: expect.objectContaining({
            ipAddress,
            attempts: 6
          })
        }),
        24 * 60 * 60
      );
      
      // Should increment alert counter
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'registration:alerts:count',
        1,
        24 * 60 * 60
      );
    });
  });
});