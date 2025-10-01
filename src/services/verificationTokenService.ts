import { EmailVerificationService, TokenValidationResult } from './emailVerificationService';
import { RateLimitingService, RateLimitResult } from './rateLimitingService';
import { logger } from '../utils/logger';

export interface VerificationAttemptResult {
  success: boolean;
  userId?: string;
  error?: string;
  rateLimitExceeded: boolean;
  retryAfter?: number;
  tokenExpired?: boolean;
}

export interface VerificationRateLimitConfig {
  maxAttemptsPerHour: number;
  maxResendPerHour: number;
  cleanupIntervalMinutes: number;
}

/**
 * Service for handling email verification token validation and cleanup with rate limiting
 * Implements comprehensive security measures for verification attempts
 */
export class VerificationTokenService {
  private static readonly DEFAULT_CONFIG: VerificationRateLimitConfig = {
    maxAttemptsPerHour: 10,
    maxResendPerHour: 3,
    cleanupIntervalMinutes: 60
  };

  private static cleanupInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize the verification token service with automatic cleanup
   */
  static initialize(): void {
    if (this.cleanupInterval) {
      return; // Already initialized
    }

    // Start automatic cleanup of expired tokens
    this.startAutomaticCleanup();
    
    logger.info('Verification token service initialized', {
      cleanupInterval: this.DEFAULT_CONFIG.cleanupIntervalMinutes
    });
  }

  /**
   * Validate a verification token with rate limiting
   * @param token - The verification token to validate
   * @param ipAddress - IP address of the request for rate limiting
   * @returns Promise<VerificationAttemptResult>
   */
  static async validateToken(
    token: string,
    ipAddress?: string
  ): Promise<VerificationAttemptResult> {
    try {
      // Validate token format first
      if (!token || typeof token !== 'string' || token.trim() === '') {
        return {
          success: false,
          rateLimitExceeded: false,
          error: 'Invalid token format'
        };
      }

      // Check rate limit first
      const rateLimitResult = await this.checkVerificationRateLimit(token, ipAddress);
      
      if (!rateLimitResult.allowed) {
        logger.warn('Verification rate limit exceeded', {
          token: token.substring(0, 8) + '...',
          ipAddress,
          remaining: rateLimitResult.remaining,
          retryAfter: rateLimitResult.retryAfter
        });

        return {
          success: false,
          rateLimitExceeded: true,
          retryAfter: rateLimitResult.retryAfter,
          error: 'Too many verification attempts. Please try again later.'
        };
      }

      // Record the attempt
      await this.recordVerificationAttempt(token, ipAddress);

      // Validate the token
      const validationResult = await EmailVerificationService.validateVerificationToken(token);

      if (!validationResult.isValid) {
        logger.warn('Invalid verification token attempt', {
          token: token.substring(0, 8) + '...',
          ipAddress,
          error: validationResult.error,
          isExpired: validationResult.isExpired
        });

        return {
          success: false,
          rateLimitExceeded: false,
          tokenExpired: validationResult.isExpired,
          userId: validationResult.userId,
          error: validationResult.error || 'Invalid verification token'
        };
      }

      // Token is valid, mark email as verified
      await EmailVerificationService.markEmailAsVerified(validationResult.userId!, token);

      // Clear rate limit on successful verification
      await this.clearVerificationAttempts(token, ipAddress);

      logger.info('Email verification successful', {
        userId: validationResult.userId,
        token: token.substring(0, 8) + '...',
        ipAddress
      });

      return {
        success: true,
        userId: validationResult.userId,
        rateLimitExceeded: false
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error during token validation', {
        token: token ? token.substring(0, 8) + '...' : 'null/undefined',
        ipAddress,
        error: errorMessage
      });

      return {
        success: false,
        rateLimitExceeded: false,
        error: 'Verification failed due to server error'
      };
    }
  }

  /**
   * Check if a user can resend verification email (rate limiting)
   * @param email - User's email address
   * @param ipAddress - IP address for rate limiting
   * @returns Promise<RateLimitResult>
   */
  static async checkResendRateLimit(
    email: string,
    ipAddress?: string
  ): Promise<RateLimitResult> {
    const identifier = `resend:${email.toLowerCase()}`;
    
    return await RateLimitingService.checkRateLimit(
      identifier,
      'passwordReset', // Reuse password reset config for similar security level
      ipAddress
    );
  }

  /**
   * Record a resend verification attempt
   * @param email - User's email address
   * @param ipAddress - IP address for rate limiting
   * @param success - Whether the resend was successful
   */
  static async recordResendAttempt(
    email: string,
    ipAddress?: string,
    success: boolean = false
  ): Promise<void> {
    const identifier = `resend:${email.toLowerCase()}`;
    
    await RateLimitingService.recordAttempt(
      identifier,
      'passwordReset',
      ipAddress,
      success
    );

    logger.info('Verification resend attempt recorded', {
      email: email.toLowerCase(),
      ipAddress,
      success
    });
  }

  /**
   * Clean up expired verification tokens
   * @returns Promise<number> - Number of tokens cleaned up
   */
  static async cleanupExpiredTokens(): Promise<number> {
    try {
      const deletedCount = await EmailVerificationService.cleanupExpiredTokens();
      
      logger.info('Expired verification tokens cleaned up', {
        deletedCount,
        timestamp: new Date().toISOString()
      });

      return deletedCount;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to cleanup expired tokens', { error: errorMessage });
      return 0;
    }
  }

  /**
   * Get verification statistics for monitoring
   * @returns Promise<object> - Verification statistics
   */
  static async getVerificationStats(): Promise<{
    totalActiveTokens: number;
    expiredTokensCount: number;
    cleanupStats: {
      lastCleanup: Date;
      tokensCleanedUp: number;
    };
  }> {
    try {
      // This would require additional database queries to get comprehensive stats
      // For now, return basic information
      const cleanupResult = await this.cleanupExpiredTokens();
      
      return {
        totalActiveTokens: 0, // Would need additional query
        expiredTokensCount: cleanupResult,
        cleanupStats: {
          lastCleanup: new Date(),
          tokensCleanedUp: cleanupResult
        }
      };
    } catch (error) {
      logger.error('Failed to get verification stats', { error });
      return {
        totalActiveTokens: 0,
        expiredTokensCount: 0,
        cleanupStats: {
          lastCleanup: new Date(),
          tokensCleanedUp: 0
        }
      };
    }
  }

  /**
   * Invalidate all verification tokens for a user (security measure)
   * @param userId - User ID whose tokens to invalidate
   * @returns Promise<number> - Number of tokens invalidated
   */
  static async invalidateUserTokens(userId: string): Promise<number> {
    try {
      const invalidatedCount = await EmailVerificationService.invalidateUserTokens(userId);
      
      logger.info('User verification tokens invalidated', {
        userId,
        invalidatedCount
      });

      return invalidatedCount;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to invalidate user tokens', {
        userId,
        error: errorMessage
      });
      throw new Error(`Failed to invalidate tokens: ${errorMessage}`);
    }
  }

  /**
   * Check verification rate limit for a specific token/IP combination
   */
  private static async checkVerificationRateLimit(
    token: string,
    ipAddress?: string
  ): Promise<RateLimitResult> {
    // Use a combination of token prefix and IP for rate limiting
    const identifier = `verify:${token.substring(0, 16)}`;
    
    return await RateLimitingService.checkRateLimit(
      identifier,
      'api', // Use API rate limit config for verification attempts
      ipAddress
    );
  }

  /**
   * Record a verification attempt for rate limiting
   */
  private static async recordVerificationAttempt(
    token: string,
    ipAddress?: string,
    success: boolean = false
  ): Promise<void> {
    const identifier = `verify:${token.substring(0, 16)}`;
    
    await RateLimitingService.recordAttempt(
      identifier,
      'api',
      ipAddress,
      success
    );
  }

  /**
   * Clear verification attempts on successful verification
   */
  private static async clearVerificationAttempts(
    token: string,
    ipAddress?: string
  ): Promise<void> {
    const identifier = `verify:${token.substring(0, 16)}`;
    
    await RateLimitingService.clearAttempts(
      identifier,
      'api',
      ipAddress
    );
  }

  /**
   * Start automatic cleanup of expired tokens
   */
  private static startAutomaticCleanup(): void {
    const intervalMs = this.DEFAULT_CONFIG.cleanupIntervalMinutes * 60 * 1000;
    
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.cleanupExpiredTokens();
      } catch (error) {
        logger.error('Automatic token cleanup failed', { error });
      }
    }, intervalMs);

    logger.info('Automatic token cleanup started', {
      intervalMinutes: this.DEFAULT_CONFIG.cleanupIntervalMinutes
    });
  }

  /**
   * Stop automatic cleanup (for testing or shutdown)
   */
  static stopAutomaticCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('Automatic token cleanup stopped');
    }
  }

  /**
   * Manual cleanup trigger for administrative use
   * @param force - Force cleanup even if not due
   * @returns Promise<number> - Number of tokens cleaned up
   */
  static async manualCleanup(force: boolean = false): Promise<number> {
    logger.info('Manual token cleanup triggered', { force });
    return await this.cleanupExpiredTokens();
  }
}