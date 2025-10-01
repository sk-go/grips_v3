import crypto from 'crypto';
import { DatabaseService } from './database/DatabaseService';
import { logger } from '../utils/logger';

export interface EmailVerificationToken {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  usedAt?: Date;
}

export interface TokenValidationResult {
  isValid: boolean;
  userId?: string;
  isExpired: boolean;
  error?: string;
}

export interface RegistrationSettings {
  id: string;
  requireAdminApproval: boolean;
  allowedEmailDomains: string[] | null;
  maxRegistrationsPerDay: number;
  verificationTokenExpiryHours: number;
  updatedBy?: string;
  updatedAt: Date;
}

/**
 * Service for managing email verification tokens and validation
 * Implements secure token generation, storage, and validation logic
 */
export class EmailVerificationService {
  private static readonly TOKEN_LENGTH = 32; // 32 bytes = 256 bits
  private static readonly DEFAULT_EXPIRY_HOURS = 24;

  /**
   * Generate a secure verification token for a user
   * @param userId - The user ID to generate token for
   * @returns Promise<string> - The generated verification token
   */
  static async generateVerificationToken(userId: string): Promise<string> {
    try {
      // Generate cryptographically secure random token
      const tokenBytes = crypto.randomBytes(this.TOKEN_LENGTH);
      const token = tokenBytes.toString('hex');

      // Get token expiry from settings or use default
      const settings = await this.getRegistrationSettings();
      const expiryHours = settings?.verificationTokenExpiryHours || this.DEFAULT_EXPIRY_HOURS;
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + expiryHours);

      // Store token in database
      const query = `
        INSERT INTO email_verification_tokens (user_id, token, expires_at)
        VALUES ($1, $2, $3)
        RETURNING token
      `;
      
      const result = await DatabaseService.query(query, [userId, token, expiresAt]);
      
      if (result.rows.length === 0) {
        throw new Error('Failed to store verification token');
      }

      logger.info('Email verification token generated', {
        userId,
        tokenLength: token.length,
        expiresAt: expiresAt.toISOString()
      });

      return token;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to generate verification token', {
        userId,
        error: errorMessage
      });
      throw new Error(`Failed to generate verification token: ${errorMessage}`);
    }
  }

  /**
   * Validate a verification token
   * @param token - The verification token to validate
   * @returns Promise<TokenValidationResult> - Validation result with user ID if valid
   */
  static async validateVerificationToken(token: string): Promise<TokenValidationResult> {
    try {
      if (!token || typeof token !== 'string') {
        return {
          isValid: false,
          isExpired: false,
          error: 'Invalid token format'
        };
      }

      // Query token from database
      const query = `
        SELECT id, user_id, token, expires_at, created_at, used_at
        FROM email_verification_tokens
        WHERE token = $1
        AND used_at IS NULL
      `;
      
      const result = await DatabaseService.query(query, [token]);
      
      if (result.rows.length === 0) {
        logger.warn('Verification token not found or already used', { token: token.substring(0, 8) + '...' });
        return {
          isValid: false,
          isExpired: false,
          error: 'Token not found or already used'
        };
      }

      const tokenData = result.rows[0];
      const expiresAt = new Date(tokenData.expires_at);
      const now = new Date();

      // Check if token is expired
      if (now > expiresAt) {
        logger.warn('Verification token expired', {
          token: token.substring(0, 8) + '...',
          expiresAt: expiresAt.toISOString(),
          now: now.toISOString()
        });
        return {
          isValid: false,
          isExpired: true,
          userId: tokenData.user_id,
          error: 'Token has expired'
        };
      }

      logger.info('Verification token validated successfully', {
        userId: tokenData.user_id,
        tokenAge: Math.floor((now.getTime() - new Date(tokenData.created_at).getTime()) / 1000 / 60) // minutes
      });

      return {
        isValid: true,
        isExpired: false,
        userId: tokenData.user_id
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to validate verification token', {
        token: token.substring(0, 8) + '...',
        error: errorMessage
      });
      return {
        isValid: false,
        isExpired: false,
        error: `Validation failed: ${errorMessage}`
      };
    }
  }

  /**
   * Mark email as verified and invalidate the token
   * @param userId - The user ID whose email to verify
   * @param token - The verification token to mark as used
   * @returns Promise<void>
   */
  static async markEmailAsVerified(userId: string, token: string): Promise<void> {
    const client = await DatabaseService.getClient();
    
    try {
      await client.query('BEGIN');

      // Mark token as used
      const tokenQuery = `
        UPDATE email_verification_tokens
        SET used_at = CURRENT_TIMESTAMP
        WHERE user_id = $1 AND token = $2 AND used_at IS NULL
      `;
      
      const tokenResult = await client.query(tokenQuery, [userId, token]);
      
      if (tokenResult.rowCount === 0) {
        throw new Error('Token not found or already used');
      }

      // Update user's email_verified status
      const userQuery = `
        UPDATE users
        SET email_verified = true, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `;
      
      const userResult = await client.query(userQuery, [userId]);
      
      if (userResult.rowCount === 0) {
        throw new Error('User not found');
      }

      await client.query('COMMIT');

      logger.info('Email verified successfully', {
        userId,
        token: token.substring(0, 8) + '...'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to mark email as verified', {
        userId,
        token: token.substring(0, 8) + '...',
        error: errorMessage
      });
      throw new Error(`Failed to verify email: ${errorMessage}`);
    } finally {
      if (client.release) {
        client.release();
      }
    }
  }

  /**
   * Clean up expired verification tokens
   * @returns Promise<number> - Number of tokens cleaned up
   */
  static async cleanupExpiredTokens(): Promise<number> {
    try {
      const result = await DatabaseService.query('SELECT cleanup_expired_email_verification_tokens()');
      const deletedCount = result.rows[0]?.cleanup_expired_email_verification_tokens || 0;

      logger.info('Cleaned up expired verification tokens', { deletedCount });
      return deletedCount;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to cleanup expired tokens', { error: errorMessage });
      throw new Error(`Failed to cleanup expired tokens: ${errorMessage}`);
    }
  }

  /**
   * Get registration settings from database
   * @returns Promise<RegistrationSettings | null>
   */
  static async getRegistrationSettings(): Promise<RegistrationSettings | null> {
    try {
      const query = `
        SELECT id, require_admin_approval, allowed_email_domains, 
               max_registrations_per_day, verification_token_expiry_hours,
               updated_by, updated_at
        FROM registration_settings
        ORDER BY updated_at DESC
        LIMIT 1
      `;
      
      const result = await DatabaseService.query(query);
      
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        requireAdminApproval: row.require_admin_approval,
        allowedEmailDomains: row.allowed_email_domains,
        maxRegistrationsPerDay: row.max_registrations_per_day,
        verificationTokenExpiryHours: row.verification_token_expiry_hours,
        updatedBy: row.updated_by,
        updatedAt: new Date(row.updated_at)
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get registration settings', { error: errorMessage });
      throw new Error(`Failed to get registration settings: ${errorMessage}`);
    }
  }

  /**
   * Get verification token by user ID (for resending)
   * @param userId - The user ID to get token for
   * @returns Promise<EmailVerificationToken | null>
   */
  static async getVerificationTokenByUserId(userId: string): Promise<EmailVerificationToken | null> {
    try {
      const query = `
        SELECT id, user_id, token, expires_at, created_at, used_at
        FROM email_verification_tokens
        WHERE user_id = $1 AND used_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `;
      
      const result = await DatabaseService.query(query, [userId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        userId: row.user_id,
        token: row.token,
        expiresAt: new Date(row.expires_at),
        createdAt: new Date(row.created_at),
        usedAt: row.used_at ? new Date(row.used_at) : undefined
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get verification token by user ID', {
        userId,
        error: errorMessage
      });
      throw new Error(`Failed to get verification token: ${errorMessage}`);
    }
  }

  /**
   * Invalidate all unused verification tokens for a user
   * @param userId - The user ID whose tokens to invalidate
   * @returns Promise<number> - Number of tokens invalidated
   */
  static async invalidateUserTokens(userId: string): Promise<number> {
    try {
      const query = `
        UPDATE email_verification_tokens
        SET used_at = CURRENT_TIMESTAMP
        WHERE user_id = $1 AND used_at IS NULL
      `;
      
      const result = await DatabaseService.query(query, [userId]);
      const invalidatedCount = result.rowCount || 0;

      logger.info('Invalidated user verification tokens', {
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
      throw new Error(`Failed to invalidate user tokens: ${errorMessage}`);
    }
  }
}