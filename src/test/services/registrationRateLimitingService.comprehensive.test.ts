import { RegistrationRateLimitingService, RegistrationRateLimitResult, RegistrationAttemptData } from '../../services/registrationRateLimitingService';
import { RedisService } from '../../services/redis';
import { RateLimitingService } from '../../services/rateLimitingService';
import { logger } from '../../utils/logger';

// Mock dependencies
jest.mock('../../services/redis');
jest.mock('../../services/rateLimitingService');
jest.mock('../../utils/logger');

const mockRedisService = RedisService as jest.Mocked<typeof RedisService>;
const mockRateLimitingService = RateLimitingService as jest.Mocked<typeof RateLimitingService>;
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('RegistrationRateLimitingService', () => {
  const mockIpAddress = '192.168.1.1';
  const mockEmail = 'test@example.com';
  const mockUserAgent = 'Mozilla/5.0 Test Browser';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  describe('checkRegistrationRateLimitByIP', () => {
    it('should allow registration when under IP limit', async () => {
      // Arrange
      const mockAttempts: RegistrationAttemptData[] = [
        {
          timestamp: Date.now() - 30 * 60 * 1000, // 30 minutes ago
          ipAddress: mockIpAddress,
          email: 'user1@example.com',
          success: true
        },
        {
          timestamp: Date.now() - 15 * 60 * 1000, // 15 minutes ago
          ipAddress: mockIpAddress,
          email: 'user2@example.com',
          success: false
        }
      ];

      mockRedisService.get.mockResolvedValue(mockAttempts);

      // Act
      const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(
        mockIpAddress,
        mockUserAgent
      );

      // Assert
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2); // 5 limit - 2 current - 1 for this attempt
      expect(result.totalHits).toBe(2);
      expect(result.progressiveDelay).toBe(15); // Third attempt gets 15s delay
      expect(result.suspiciousActivity).toBe(false);
      expect(result.alertTriggered).toBeUndefined();
    });

    it('should block registration when IP limit exceeded', async () => {
      // Arrange
      const mockAttempts: RegistrationAttemptData[] = Array.from({ length: 5 }, (_, i) => ({
        timestamp: Date.now() - (i + 1) * 10 * 60 * 1000, // Spread over last hour
        ipAddress: mockIpAddress,
        email: `user${i}@example.com`,
        success: i % 2 === 0 // Mix of success/failure
      }));

      mockRedisService.get.mockResolvedValue(mockAttempts);
      mockRedisService.set.mockResolvedValue('OK');

      // Act
      const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(
        mockIpAddress,
        mockUserAgent
      );

      // Assert
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.totalHits).toBe(5);
      expect(result.retryAfter).toBe(2 * 60 * 60); // 2 hours block duration
      expect(result.alertTriggered).toBe(true);

      // Verify alert was triggered
      expect(mockRedisService.set).toHaveBeenCalledWith(
        expect.stringContaining('registration:alert:ip_registration_limit'),
        expect.objectContaining({
          type: 'ip_registration_limit',
          data: expect.objectContaining({
            ipAddress: mockIpAddress,
            userAgent: mockUserAgent,
            attempts: 5
          })
        }),
        24 * 60 * 60
      );
    });

    it('should detect suspicious activity patterns', async () => {
      // Arrange - Create suspicious pattern: many unique emails from same IP
      const mockAttempts: RegistrationAttemptData[] = Array.from({ length: 9 }, (_, i) => ({
        timestamp: Date.now() - i * 5 * 60 * 1000, // Recent attempts
        ipAddress: mockIpAddress,
        email: `user${i}@example.com`, // 9 unique emails
        success: false // All failed
      }));

      mockRedisService.get.mockResolvedValue(mockAttempts);
      mockRedisService.set.mockResolvedValue('OK');

      // Act
      const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(
        mockIpAddress,
        mockUserAgent
      );

      // Assert
      expect(result.allowed).toBe(false); // Blocked due to suspicious activity
      expect(result.suspiciousActivity).toBe(true);
      expect(result.alertTriggered).toBe(true);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Suspicious registration activity detected',
        expect.objectContaining({
          ipAddress: mockIpAddress,
          totalAttempts: 9,
          uniqueEmails: 9,
          failedAttempts: 9
        })
      );
    });

    it('should calculate progressive delays correctly', async () => {
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
        const mockAttempts: RegistrationAttemptData[] = Array.from({ length: testCase.attempts }, (_, i) => ({
          timestamp: Date.now() - i * 10 * 60 * 1000,
          ipAddress: mockIpAddress,
          email: `user${i}@example.com`,
          success: false
        }));

        mockRedisService.get.mockResolvedValue(mockAttempts);

        const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(mockIpAddress);
        expect(result.progressiveDelay).toBe(testCase.expectedDelay);
      }
    });

    it('should handle Redis errors gracefully', async () => {
      // Arrange
      const redisError = new Error('Redis connection failed');
      mockRedisService.get.mockRejectedValue(redisError);

      // Act
      const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(mockIpAddress);

      // Assert - Should return permissive result on error
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(999);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error checking IP registration rate limit',
        expect.objectContaining({
          error: redisError,
          ipAddress: mockIpAddress
        })
      );
    });

    it('should filter out expired attempts', async () => {
      // Arrange
      const now = Date.now();
      const mockAttempts: RegistrationAttemptData[] = [
        {
          timestamp: now - 2 * 60 * 60 * 1000, // 2 hours ago (expired)
          ipAddress: mockIpAddress,
          email: 'old@example.com',
          success: false
        },
        {
          timestamp: now - 30 * 60 * 1000, // 30 minutes ago (valid)
          ipAddress: mockIpAddress,
          email: 'recent@example.com',
          success: true
        }
      ];

      mockRedisService.get.mockResolvedValue(mockAttempts);

      // Act
      const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(mockIpAddress);

      // Assert
      expect(result.totalHits).toBe(1); // Only the recent attempt should count
      expect(result.allowed).toBe(true);
    });
  });

  describe('checkRegistrationRateLimitByEmail', () => {
    it('should allow registration when under email limit', async () => {
      // Arrange
      const mockAttempts: RegistrationAttemptData[] = [
        {
          timestamp: Date.now() - 12 * 60 * 60 * 1000, // 12 hours ago
          ipAddress: '192.168.1.2',
          email: mockEmail.toLowerCase(),
          success: false
        }
      ];

      mockRedisService.get.mockResolvedValue(mockAttempts);

      // Act
      const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByEmail(
        mockEmail.toUpperCase(), // Test case normalization
        mockIpAddress
      );

      // Assert
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1); // 3 limit - 1 current - 1 for this attempt
      expect(result.totalHits).toBe(1);
      expect(result.progressiveDelay).toBe(5); // Second attempt gets 5s delay
    });

    it('should block registration when email limit exceeded', async () => {
      // Arrange
      const mockAttempts: RegistrationAttemptData[] = Array.from({ length: 3 }, (_, i) => ({
        timestamp: Date.now() - (i + 1) * 6 * 60 * 60 * 1000, // Spread over 24 hours
        ipAddress: `192.168.1.${i + 1}`,
        email: mockEmail.toLowerCase(),
        success: false
      }));

      mockRedisService.get.mockResolvedValue(mockAttempts);
      mockRedisService.set.mockResolvedValue('OK');

      // Act
      const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByEmail(
        mockEmail,
        mockIpAddress
      );

      // Assert
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBe(24 * 60 * 60); // 24 hours block duration
      expect(result.alertTriggered).toBe(true);
    });

    it('should normalize email to lowercase', async () => {
      // Arrange
      const upperCaseEmail = 'TEST@EXAMPLE.COM';
      mockRedisService.get.mockResolvedValue([]);

      // Act
      await RegistrationRateLimitingService.checkRegistrationRateLimitByEmail(
        upperCaseEmail,
        mockIpAddress
      );

      // Assert
      expect(mockRedisService.get).toHaveBeenCalledWith(
        'registration:email:test@example.com'
      );
    });

    it('should handle Redis errors gracefully', async () => {
      // Arrange
      const redisError = new Error('Redis timeout');
      mockRedisService.get.mockRejectedValue(redisError);

      // Act
      const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByEmail(
        mockEmail,
        mockIpAddress
      );

      // Assert
      expect(result.allowed).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error checking email registration rate limit',
        expect.objectContaining({
          error: redisError,
          email: mockEmail
        })
      );
    });
  });

  describe('checkVerificationRateLimit', () => {
    it('should delegate to RateLimitingService', async () => {
      // Arrange
      const mockRateLimitResult = {
        allowed: true,
        remaining: 5,
        resetTime: Date.now() + 3600000,
        totalHits: 2
      };

      mockRateLimitingService.checkRateLimit.mockResolvedValue(mockRateLimitResult);

      // Act
      const result = await RegistrationRateLimitingService.checkVerificationRateLimit(
        mockEmail,
        mockIpAddress
      );

      // Assert
      expect(result).toEqual(mockRateLimitResult);
      expect(mockRateLimitingService.checkRateLimit).toHaveBeenCalledWith(
        mockEmail.toLowerCase(),
        'register',
        mockIpAddress
      );
    });
  });

  describe('checkResendVerificationRateLimit', () => {
    it('should check resend rate limit correctly', async () => {
      // Arrange
      const mockAttempts = [
        Date.now() - 10 * 60 * 1000, // 10 minutes ago
        Date.now() - 5 * 60 * 1000   // 5 minutes ago
      ];

      mockRedisService.get.mockResolvedValue(mockAttempts);

      // Act
      const result = await RegistrationRateLimitingService.checkResendVerificationRateLimit(
        mockEmail,
        mockIpAddress
      );

      // Assert
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0); // 3 limit - 2 current - 1 for this attempt
      expect(result.totalHits).toBe(2);
    });

    it('should block when resend limit exceeded', async () => {
      // Arrange
      const mockAttempts = [
        Date.now() - 14 * 60 * 1000, // 14 minutes ago
        Date.now() - 10 * 60 * 1000, // 10 minutes ago
        Date.now() - 5 * 60 * 1000   // 5 minutes ago
      ];

      mockRedisService.get.mockResolvedValue(mockAttempts);

      // Act
      const result = await RegistrationRateLimitingService.checkResendVerificationRateLimit(
        mockEmail,
        mockIpAddress
      );

      // Assert
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should filter expired resend attempts', async () => {
      // Arrange
      const mockAttempts = [
        Date.now() - 20 * 60 * 1000, // 20 minutes ago (expired, window is 15 minutes)
        Date.now() - 10 * 60 * 1000  // 10 minutes ago (valid)
      ];

      mockRedisService.get.mockResolvedValue(mockAttempts);

      // Act
      const result = await RegistrationRateLimitingService.checkResendVerificationRateLimit(
        mockEmail,
        mockIpAddress
      );

      // Assert
      expect(result.totalHits).toBe(1); // Only the valid attempt should count
    });
  });

  describe('recordRegistrationAttempt', () => {
    it('should record registration attempt successfully', async () => {
      // Arrange
      mockRedisService.get.mockResolvedValue([]);
      mockRedisService.set.mockResolvedValue('OK');

      // Act
      await RegistrationRateLimitingService.recordRegistrationAttempt(
        mockEmail.toUpperCase(), // Test normalization
        mockIpAddress,
        true,
        mockUserAgent
      );

      // Assert
      expect(mockRedisService.set).toHaveBeenCalledTimes(3); // IP key, email key, global key

      // Verify IP key storage
      const ipKeyCall = mockRedisService.set.mock.calls.find(call => 
        call[0].includes('registration:ip:')
      );
      expect(ipKeyCall).toBeDefined();
      expect(ipKeyCall![1]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            email: mockEmail.toLowerCase(),
            ipAddress: mockIpAddress,
            success: true,
            userAgent: mockUserAgent
          })
        ])
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Registration attempt recorded',
        expect.objectContaining({
          email: mockEmail.toLowerCase(),
          ipAddress: mockIpAddress,
          success: true,
          userAgent: mockUserAgent
        })
      );
    });

    it('should handle recording errors gracefully', async () => {
      // Arrange
      const redisError = new Error('Redis write failed');
      mockRedisService.get.mockRejectedValue(redisError);

      // Act
      await RegistrationRateLimitingService.recordRegistrationAttempt(
        mockEmail,
        mockIpAddress,
        false
      );

      // Assert
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error recording registration attempt',
        expect.objectContaining({
          error: redisError,
          email: mockEmail,
          ipAddress: mockIpAddress
        })
      );
    });

    it('should limit stored attempts to prevent memory issues', async () => {
      // Arrange - Simulate 150 existing attempts
      const existingAttempts = Array.from({ length: 150 }, (_, i) => ({
        timestamp: Date.now() - i * 60 * 1000,
        ipAddress: mockIpAddress,
        email: `user${i}@example.com`,
        success: i % 2 === 0
      }));

      mockRedisService.get.mockResolvedValue(existingAttempts);
      mockRedisService.set.mockResolvedValue('OK');

      // Act
      await RegistrationRateLimitingService.recordRegistrationAttempt(
        mockEmail,
        mockIpAddress,
        true
      );

      // Assert - Should keep only last 100 attempts
      const setCall = mockRedisService.set.mock.calls.find(call => 
        call[0].includes('registration:ip:')
      );
      expect(setCall![1]).toHaveLength(100); // Limited to 100 attempts
    });
  });

  describe('recordVerificationAttempt', () => {
    it('should delegate to RateLimitingService', async () => {
      // Arrange
      mockRateLimitingService.recordAttempt.mockResolvedValue();

      // Act
      await RegistrationRateLimitingService.recordVerificationAttempt(
        mockEmail.toUpperCase(),
        mockIpAddress,
        true
      );

      // Assert
      expect(mockRateLimitingService.recordAttempt).toHaveBeenCalledWith(
        mockEmail.toLowerCase(),
        'register',
        mockIpAddress,
        true
      );
    });
  });

  describe('recordResendVerificationAttempt', () => {
    it('should record resend attempt', async () => {
      // Arrange
      mockRedisService.get.mockResolvedValue([]);
      mockRedisService.set.mockResolvedValue('OK');

      // Act
      await RegistrationRateLimitingService.recordResendVerificationAttempt(
        mockEmail,
        mockIpAddress
      );

      // Assert
      expect(mockRedisService.set).toHaveBeenCalledWith(
        `registration:resend:${mockEmail.toLowerCase()}:${mockIpAddress}`,
        expect.arrayContaining([expect.any(Number)]),
        60 * 60 // 1 hour TTL
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Resend verification attempt recorded',
        expect.objectContaining({
          email: mockEmail.toLowerCase(),
          ipAddress: mockIpAddress
        })
      );
    });
  });

  describe('clearRegistrationAttempts', () => {
    it('should clear attempts for successful registration', async () => {
      // Arrange
      mockRedisService.del.mockResolvedValue(1);

      // Act
      await RegistrationRateLimitingService.clearRegistrationAttempts(
        mockEmail.toUpperCase(),
        mockIpAddress
      );

      // Assert
      expect(mockRedisService.del).toHaveBeenCalledWith(
        `registration:ip:${mockIpAddress}`
      );
      expect(mockRedisService.del).toHaveBeenCalledWith(
        `registration:email:${mockEmail.toLowerCase()}`
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Registration attempts cleared for successful registration',
        expect.objectContaining({
          email: mockEmail.toLowerCase(),
          ipAddress: mockIpAddress
        })
      );
    });

    it('should handle clear errors gracefully', async () => {
      // Arrange
      const redisError = new Error('Redis delete failed');
      mockRedisService.del.mockRejectedValue(redisError);

      // Act
      await RegistrationRateLimitingService.clearRegistrationAttempts(
        mockEmail,
        mockIpAddress
      );

      // Assert
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error clearing registration attempts',
        expect.objectContaining({
          error: redisError,
          email: mockEmail,
          ipAddress: mockIpAddress
        })
      );
    });
  });

  describe('getRegistrationStatistics', () => {
    it('should return comprehensive statistics', async () => {
      // Arrange
      const mockGlobalAttempts: RegistrationAttemptData[] = [
        {
          timestamp: Date.now() - 30 * 60 * 1000,
          ipAddress: '192.168.1.1',
          email: 'user1@example.com',
          success: true
        },
        {
          timestamp: Date.now() - 45 * 60 * 1000,
          ipAddress: '192.168.1.2',
          email: 'user2@example.com',
          success: false
        },
        {
          timestamp: Date.now() - 50 * 60 * 1000,
          ipAddress: '192.168.1.1',
          email: 'user3@example.com',
          success: true
        }
      ];

      mockRedisService.get
        .mockResolvedValueOnce(mockGlobalAttempts) // Global attempts
        .mockResolvedValueOnce(5); // Alerts count

      // Act
      const result = await RegistrationRateLimitingService.getRegistrationStatistics();

      // Assert
      expect(result).toEqual({
        totalAttempts: 3,
        successfulRegistrations: 2,
        failedAttempts: 1,
        uniqueIPs: 2,
        uniqueEmails: 3,
        alertsTriggered: 5
      });
    });

    it('should handle missing data gracefully', async () => {
      // Arrange
      mockRedisService.get
        .mockResolvedValueOnce([]) // No global attempts
        .mockResolvedValueOnce(null); // No alerts

      // Act
      const result = await RegistrationRateLimitingService.getRegistrationStatistics();

      // Assert
      expect(result).toEqual({
        totalAttempts: 0,
        successfulRegistrations: 0,
        failedAttempts: 0,
        uniqueIPs: 0,
        uniqueEmails: 0,
        alertsTriggered: 0
      });
    });

    it('should filter by time window correctly', async () => {
      // Arrange
      const now = Date.now();
      const mockGlobalAttempts: RegistrationAttemptData[] = [
        {
          timestamp: now - 30 * 60 * 1000, // 30 minutes ago (within 1 hour window)
          ipAddress: '192.168.1.1',
          email: 'recent@example.com',
          success: true
        },
        {
          timestamp: now - 2 * 60 * 60 * 1000, // 2 hours ago (outside 1 hour window)
          ipAddress: '192.168.1.2',
          email: 'old@example.com',
          success: false
        }
      ];

      mockRedisService.get
        .mockResolvedValueOnce(mockGlobalAttempts)
        .mockResolvedValueOnce(0);

      // Act
      const result = await RegistrationRateLimitingService.getRegistrationStatistics(
        60 * 60 * 1000 // 1 hour window
      );

      // Assert
      expect(result.totalAttempts).toBe(1); // Only the recent attempt
      expect(result.successfulRegistrations).toBe(1);
      expect(result.failedAttempts).toBe(0);
    });

    it('should handle statistics errors gracefully', async () => {
      // Arrange
      const redisError = new Error('Redis stats failed');
      mockRedisService.get.mockRejectedValue(redisError);

      // Act
      const result = await RegistrationRateLimitingService.getRegistrationStatistics();

      // Assert
      expect(result).toEqual({
        totalAttempts: 0,
        successfulRegistrations: 0,
        failedAttempts: 0,
        uniqueIPs: 0,
        uniqueEmails: 0,
        alertsTriggered: 0
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error getting registration statistics',
        { error: redisError }
      );
    });
  });

  describe('security alert system', () => {
    it('should trigger and store security alerts', async () => {
      // Arrange
      const alertData = {
        ipAddress: mockIpAddress,
        userAgent: mockUserAgent,
        attempts: 10,
        suspiciousActivity: true
      };

      mockRedisService.set.mockResolvedValue('OK');
      mockRedisService.get.mockResolvedValue(5); // Current alert count

      // Create a scenario that triggers an alert
      const mockAttempts: RegistrationAttemptData[] = Array.from({ length: 10 }, (_, i) => ({
        timestamp: Date.now() - i * 5 * 60 * 1000,
        ipAddress: mockIpAddress,
        email: `user${i}@example.com`,
        success: false
      }));

      mockRedisService.get.mockResolvedValueOnce(mockAttempts);

      // Act
      const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(
        mockIpAddress,
        mockUserAgent
      );

      // Assert
      expect(result.alertTriggered).toBe(true);
      
      // Verify alert storage
      expect(mockRedisService.set).toHaveBeenCalledWith(
        expect.stringContaining('registration:alert:ip_registration_limit'),
        expect.objectContaining({
          type: 'ip_registration_limit',
          timestamp: expect.any(Number),
          data: expect.objectContaining(alertData)
        }),
        24 * 60 * 60
      );

      // Verify alert counter increment
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'registration:alerts:count',
        6, // 5 + 1
        24 * 60 * 60
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Security alert triggered',
        expect.objectContaining({
          alertType: 'ip_registration_limit',
          data: alertData
        })
      );
    });
  });
});