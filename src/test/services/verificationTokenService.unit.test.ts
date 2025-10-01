import { VerificationTokenService } from '../../services/verificationTokenService';
import { EmailVerificationService } from '../../services/emailVerificationService';
import { RateLimitingService } from '../../services/rateLimitingService';
import { logger } from '../../utils/logger';

// Mock dependencies
jest.mock('../../services/emailVerificationService');
jest.mock('../../services/rateLimitingService');
jest.mock('../../utils/logger');

const mockEmailVerificationService = EmailVerificationService as jest.Mocked<typeof EmailVerificationService>;
const mockRateLimitingService = RateLimitingService as jest.Mocked<typeof RateLimitingService>;
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('VerificationTokenService - Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    VerificationTokenService.stopAutomaticCleanup();
  });

  afterEach(() => {
    VerificationTokenService.stopAutomaticCleanup();
  });

  describe('validateToken', () => {
    const mockToken = 'valid-token-12345678901234567890123456789012';
    const mockUserId = 'test-user-id';
    const mockIpAddress = '192.168.1.1';

    beforeEach(() => {
      // Default successful rate limit check
      mockRateLimitingService.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 5,
        resetTime: Date.now() + 3600000,
        totalHits: 0
      });
    });

    it('should validate token successfully with rate limiting', async () => {
      // Arrange
      mockEmailVerificationService.validateVerificationToken.mockResolvedValue({
        isValid: true,
        isExpired: false,
        userId: mockUserId
      });

      mockEmailVerificationService.markEmailAsVerified.mockResolvedValue();
      mockRateLimitingService.recordAttempt.mockResolvedValue();
      mockRateLimitingService.clearAttempts.mockResolvedValue();

      // Act
      const result = await VerificationTokenService.validateToken(mockToken, mockIpAddress);

      // Assert
      expect(result).toEqual({
        success: true,
        userId: mockUserId,
        rateLimitExceeded: false
      });

      expect(mockRateLimitingService.checkRateLimit).toHaveBeenCalledWith(
        `verify:${mockToken.substring(0, 16)}`,
        'api',
        mockIpAddress
      );

      expect(mockEmailVerificationService.validateVerificationToken).toHaveBeenCalledWith(mockToken);
      expect(mockEmailVerificationService.markEmailAsVerified).toHaveBeenCalledWith(mockUserId, mockToken);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Email verification successful',
        expect.objectContaining({
          userId: mockUserId,
          token: mockToken.substring(0, 8) + '...',
          ipAddress: mockIpAddress
        })
      );
    });

    it('should reject invalid token format', async () => {
      // Test cases for invalid token formats
      const invalidTokens = ['', '   ', null, undefined];

      for (const invalidToken of invalidTokens) {
        const result = await VerificationTokenService.validateToken(invalidToken as any, mockIpAddress);
        
        expect(result).toEqual({
          success: false,
          rateLimitExceeded: false,
          error: 'Invalid token format'
        });
      }

      // Should not call rate limiting or validation for invalid formats
      expect(mockRateLimitingService.checkRateLimit).not.toHaveBeenCalled();
      expect(mockEmailVerificationService.validateVerificationToken).not.toHaveBeenCalled();
    });

    it('should handle rate limit exceeded', async () => {
      // Arrange
      mockRateLimitingService.checkRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetTime: Date.now() + 3600000,
        totalHits: 10,
        retryAfter: 3600
      });

      // Act
      const result = await VerificationTokenService.validateToken(mockToken, mockIpAddress);

      // Assert
      expect(result).toEqual({
        success: false,
        rateLimitExceeded: true,
        retryAfter: 3600,
        error: 'Too many verification attempts. Please try again later.'
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Verification rate limit exceeded',
        expect.objectContaining({
          token: mockToken.substring(0, 8) + '...',
          ipAddress: mockIpAddress,
          remaining: 0,
          retryAfter: 3600
        })
      );

      // Should not proceed to token validation
      expect(mockEmailVerificationService.validateVerificationToken).not.toHaveBeenCalled();
    });

    it('should handle invalid verification token', async () => {
      // Arrange
      mockEmailVerificationService.validateVerificationToken.mockResolvedValue({
        isValid: false,
        isExpired: false,
        error: 'Token not found'
      });

      mockRateLimitingService.recordAttempt.mockResolvedValue();

      // Act
      const result = await VerificationTokenService.validateToken(mockToken, mockIpAddress);

      // Assert
      expect(result).toEqual({
        success: false,
        rateLimitExceeded: false,
        tokenExpired: false,
        error: 'Token not found'
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid verification token attempt',
        expect.objectContaining({
          token: mockToken.substring(0, 8) + '...',
          ipAddress: mockIpAddress,
          error: 'Token not found',
          isExpired: false
        })
      );

      // Should not mark email as verified
      expect(mockEmailVerificationService.markEmailAsVerified).not.toHaveBeenCalled();
    });

    it('should handle expired verification token', async () => {
      // Arrange
      mockEmailVerificationService.validateVerificationToken.mockResolvedValue({
        isValid: false,
        isExpired: true,
        userId: mockUserId,
        error: 'Token has expired'
      });

      mockRateLimitingService.recordAttempt.mockResolvedValue();

      // Act
      const result = await VerificationTokenService.validateToken(mockToken, mockIpAddress);

      // Assert
      expect(result).toEqual({
        success: false,
        rateLimitExceeded: false,
        tokenExpired: true,
        userId: mockUserId,
        error: 'Token has expired'
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid verification token attempt',
        expect.objectContaining({
          isExpired: true
        })
      );
    });

    it('should handle service errors gracefully', async () => {
      // Arrange
      const verificationError = new Error('Database connection failed');
      mockEmailVerificationService.validateVerificationToken.mockRejectedValue(verificationError);
      mockRateLimitingService.recordAttempt.mockResolvedValue();

      // Act
      const result = await VerificationTokenService.validateToken(mockToken, mockIpAddress);

      // Assert
      expect(result).toEqual({
        success: false,
        rateLimitExceeded: false,
        error: 'Verification failed due to server error'
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error during token validation',
        expect.objectContaining({
          token: mockToken.substring(0, 8) + '...',
          ipAddress: mockIpAddress,
          error: 'Database connection failed'
        })
      );
    });
  });

  describe('checkResendRateLimit', () => {
    const mockEmail = 'test@example.com';
    const mockIpAddress = '192.168.1.1';

    it('should check resend rate limit successfully', async () => {
      // Arrange
      const rateLimitResult = {
        allowed: true,
        remaining: 2,
        resetTime: Date.now() + 900000,
        totalHits: 1
      };

      mockRateLimitingService.checkRateLimit.mockResolvedValue(rateLimitResult);

      // Act
      const result = await VerificationTokenService.checkResendRateLimit(mockEmail, mockIpAddress);

      // Assert
      expect(result).toEqual(rateLimitResult);
      expect(mockRateLimitingService.checkRateLimit).toHaveBeenCalledWith(
        `resend:${mockEmail.toLowerCase()}`,
        'passwordReset',
        mockIpAddress
      );
    });

    it('should normalize email to lowercase', async () => {
      // Arrange
      const upperCaseEmail = 'TEST@EXAMPLE.COM';
      mockRateLimitingService.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 2,
        resetTime: Date.now() + 900000,
        totalHits: 0
      });

      // Act
      await VerificationTokenService.checkResendRateLimit(upperCaseEmail, mockIpAddress);

      // Assert
      expect(mockRateLimitingService.checkRateLimit).toHaveBeenCalledWith(
        'resend:test@example.com',
        'passwordReset',
        mockIpAddress
      );
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('should cleanup expired tokens successfully', async () => {
      // Arrange
      const deletedCount = 10;
      mockEmailVerificationService.cleanupExpiredTokens.mockResolvedValue(deletedCount);

      // Act
      const result = await VerificationTokenService.cleanupExpiredTokens();

      // Assert
      expect(result).toBe(deletedCount);
      expect(mockEmailVerificationService.cleanupExpiredTokens).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Expired verification tokens cleaned up',
        expect.objectContaining({
          deletedCount,
          timestamp: expect.any(String)
        })
      );
    });

    it('should handle cleanup errors gracefully', async () => {
      // Arrange
      const cleanupError = new Error('Cleanup failed');
      mockEmailVerificationService.cleanupExpiredTokens.mockRejectedValue(cleanupError);

      // Act
      const result = await VerificationTokenService.cleanupExpiredTokens();

      // Assert
      expect(result).toBe(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to cleanup expired tokens',
        { error: cleanupError }
      );
    });
  });

  describe('invalidateUserTokens', () => {
    const mockUserId = 'test-user-id';

    it('should invalidate user tokens successfully', async () => {
      // Arrange
      const invalidatedCount = 3;
      mockEmailVerificationService.invalidateUserTokens.mockResolvedValue(invalidatedCount);

      // Act
      const result = await VerificationTokenService.invalidateUserTokens(mockUserId);

      // Assert
      expect(result).toBe(invalidatedCount);
      expect(mockEmailVerificationService.invalidateUserTokens).toHaveBeenCalledWith(mockUserId);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'User verification tokens invalidated',
        expect.objectContaining({
          userId: mockUserId,
          invalidatedCount
        })
      );
    });

    it('should handle invalidation errors', async () => {
      // Arrange
      const invalidationError = new Error('Invalidation failed');
      mockEmailVerificationService.invalidateUserTokens.mockRejectedValue(invalidationError);

      // Act & Assert
      await expect(VerificationTokenService.invalidateUserTokens(mockUserId))
        .rejects.toThrow('Failed to invalidate tokens: Invalidation failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to invalidate user tokens',
        expect.objectContaining({
          userId: mockUserId,
          error: 'Invalidation failed'
        })
      );
    });
  });

  describe('initialize and cleanup', () => {
    it('should initialize service and start automatic cleanup', () => {
      // Act
      VerificationTokenService.initialize();

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Verification token service initialized',
        expect.objectContaining({
          cleanupInterval: 60
        })
      );
    });

    it('should not initialize twice', () => {
      // Act
      VerificationTokenService.initialize();
      VerificationTokenService.initialize();

      // Assert - should only log once
      expect(mockLogger.info).toHaveBeenCalledTimes(1);
    });

    it('should stop automatic cleanup when requested', () => {
      // Arrange
      VerificationTokenService.initialize();

      // Act
      VerificationTokenService.stopAutomaticCleanup();

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith('Automatic token cleanup stopped');
    });
  });
});