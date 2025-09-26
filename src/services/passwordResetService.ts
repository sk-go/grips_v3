import * as crypto from 'crypto';
import { DatabaseService } from './database';
import { logger } from '../utils/logger';
import { EmailNotificationService } from './email/emailNotificationService';

interface PasswordResetToken {
    id: string;
    userId: string;
    token: string;
    expiresAt: Date;
    usedAt?: Date;
    createdAt: Date;
}

interface TokenValidationResult {
    userId: string;
    email: string;
}

class PasswordResetService {
    private static readonly TOKEN_EXPIRY_HOURS = 1; // 1 hour expiry
    private static readonly TOKEN_LENGTH = 32; // 32 bytes = 64 hex characters
    private static emailService = new EmailNotificationService();

    /**
     * Initiate password reset process by generating token and sending email
     * @param email User's email address
     * @param baseUrl Base URL for constructing reset link
     * @returns Promise that resolves when email is sent (or would be sent)
     * @throws Error if user not found or inactive
     */
    static async initiatePasswordReset(email: string, baseUrl: string = ''): Promise<void> {
        const token = await this.generateResetToken(email);
        
        // Get user details for email
        const userResult = await DatabaseService.query(
            'SELECT first_name FROM users WHERE email = $1 AND is_active = true',
            [email]
        );

        if (userResult.rows.length === 0) {
            // Still return success to prevent email enumeration
            logger.info('Password reset requested for non-existent email (security)', { email });
            return;
        }

        const user = userResult.rows[0];
        const resetUrl = `${baseUrl}/reset-password?token=${token}`;
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + this.TOKEN_EXPIRY_HOURS);

        try {
            await this.emailService.sendPasswordResetEmail({
                email,
                firstName: user.first_name,
                resetToken: token,
                resetUrl,
                expiresAt
            });

            logger.info('Password reset email sent', { email, expiresAt: expiresAt.toISOString() });
        } catch (error) {
            logger.error('Failed to send password reset email', { email, error });
            // Don't throw error to prevent revealing email existence
        }
    }

    /**
     * Generate a secure password reset token for the given email
     * @param email User's email address
     * @returns The generated token string
     * @throws Error if user not found or inactive
     */
    static async generateResetToken(email: string): Promise<string> {
        // First, verify the user exists and is active
        const userResult = await DatabaseService.query(
            'SELECT id, email, is_active FROM users WHERE email = $1',
            [email]
        );

        if (userResult.rows.length === 0) {
            logger.warn('Password reset requested for non-existent email', { email });
            // Don't reveal that the email doesn't exist for security
            throw new Error('If the email exists, a reset link will be sent');
        }

        const user = userResult.rows[0];
        if (!user.is_active) {
            logger.warn('Password reset requested for inactive user', { email, userId: user.id });
            throw new Error('Account is inactive');
        }

        // Generate a cryptographically secure random token
        const token = crypto.randomBytes(this.TOKEN_LENGTH).toString('hex');
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + this.TOKEN_EXPIRY_HOURS);

        // Invalidate any existing unused tokens for this user
        await DatabaseService.query(
            `UPDATE password_reset_tokens 
       SET used_at = CURRENT_TIMESTAMP 
       WHERE user_id = $1 AND used_at IS NULL`,
            [user.id]
        );

        // Insert the new token
        await DatabaseService.query(
            `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
            [user.id, token, expiresAt]
        );

        logger.info('Password reset token generated', {
            userId: user.id,
            email: user.email,
            expiresAt: expiresAt.toISOString()
        });

        return token;
    }

    /**
     * Validate a password reset token and return user information
     * @param token The reset token to validate
     * @returns User ID and email if token is valid
     * @throws Error if token is invalid, expired, or already used
     */
    static async validateResetToken(token: string): Promise<TokenValidationResult> {
        const result = await DatabaseService.query(
            `SELECT prt.id, prt.user_id, prt.expires_at, prt.used_at, u.email, u.is_active
       FROM password_reset_tokens prt
       JOIN users u ON prt.user_id = u.id
       WHERE prt.token = $1`,
            [token]
        );

        if (result.rows.length === 0) {
            logger.warn('Invalid password reset token attempted', { token: token.substring(0, 8) + '...' });
            throw new Error('Invalid or expired reset token');
        }

        const tokenData = result.rows[0];

        // Check if token has already been used
        if (tokenData.used_at) {
            logger.warn('Already used password reset token attempted', {
                tokenId: tokenData.id,
                userId: tokenData.user_id,
                usedAt: tokenData.used_at
            });
            throw new Error('Reset token has already been used');
        }

        // Check if token has expired
        const now = new Date();
        const expiresAt = new Date(tokenData.expires_at);
        if (now > expiresAt) {
            logger.warn('Expired password reset token attempted', {
                tokenId: tokenData.id,
                userId: tokenData.user_id,
                expiresAt: tokenData.expires_at
            });
            throw new Error('Reset token has expired');
        }

        // Check if user is still active
        if (!tokenData.is_active) {
            logger.warn('Password reset attempted for inactive user', {
                userId: tokenData.user_id,
                email: tokenData.email
            });
            throw new Error('Account is inactive');
        }

        logger.info('Password reset token validated successfully', {
            tokenId: tokenData.id,
            userId: tokenData.user_id,
            email: tokenData.email
        });

        return {
            userId: tokenData.user_id,
            email: tokenData.email
        };
    }



    /**
     * Complete password reset process by validating token and updating password
     * @param token The reset token
     * @param newPassword The new password
     * @param ipAddress Optional IP address for logging
     * @returns Promise that resolves when password is reset
     * @throws Error if token is invalid or password update fails
     */
    static async completePasswordReset(token: string, newPassword: string, ipAddress?: string): Promise<void> {
        // Import AuthService here to avoid circular dependency
        const { AuthService } = await import('./auth');
        
        // Validate the token
        const tokenValidation = await this.validateResetToken(token);
        
        // Validate new password strength
        const passwordValidation = AuthService.validatePassword(newPassword);
        if (!passwordValidation.isValid) {
            throw new Error(`Password validation failed: ${passwordValidation.errors.join(', ')}`);
        }

        // Hash the new password
        const passwordHash = await AuthService.hashPassword(newPassword);

        // Update password and mark token as used in a transaction
        const client = await DatabaseService.getClient();
        try {
            await client.query('BEGIN');

            // Update user password
            await client.query(
                'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [passwordHash, tokenValidation.userId]
            );

            // Mark token as used
            await client.query(
                'UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE token = $1',
                [token]
            );

            // Invalidate all other unused tokens for this user
            await client.query(
                'UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND token != $2 AND used_at IS NULL',
                [tokenValidation.userId, token]
            );

            await client.query('COMMIT');

            logger.info('Password reset completed successfully', {
                userId: tokenValidation.userId,
                email: tokenValidation.email,
                ipAddress,
                passwordStrength: passwordValidation.strength
            });

            // Send password change notification
            try {
                const userResult = await DatabaseService.query(
                    'SELECT first_name FROM users WHERE id = $1',
                    [tokenValidation.userId]
                );

                if (userResult.rows.length > 0) {
                    await this.emailService.sendPasswordChangeNotification({
                        email: tokenValidation.email,
                        firstName: userResult.rows[0].first_name,
                        changeTime: new Date(),
                        ipAddress
                    });
                }
            } catch (emailError) {
                logger.warn('Failed to send password change notification', { 
                    userId: tokenValidation.userId, 
                    error: emailError 
                });
                // Don't fail the password reset if notification fails
            }

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Password reset failed', {
                userId: tokenValidation.userId,
                email: tokenValidation.email,
                error
            });
            throw new Error('Failed to reset password');
        } finally {
            if (client.release) {
                client.release();
            }
        }
    }

    /**
     * Mark a password reset token as used
     * @param token The reset token to mark as used
     */
    static async markTokenAsUsed(token: string): Promise<void> {
        const result = await DatabaseService.query(
            `UPDATE password_reset_tokens 
       SET used_at = CURRENT_TIMESTAMP 
       WHERE token = $1 AND used_at IS NULL
       RETURNING id, user_id`,
            [token]
        );

        if (result.rows.length > 0) {
            const tokenData = result.rows[0];
            logger.info('Password reset token marked as used', {
                tokenId: tokenData.id,
                userId: tokenData.user_id
            });
        }
    }

    /**
     * Clean up expired password reset tokens
     * @returns Number of tokens cleaned up
     */
    static async cleanupExpiredTokens(): Promise<number> {
        const result = await DatabaseService.query(
            `DELETE FROM password_reset_tokens 
       WHERE expires_at < CURRENT_TIMESTAMP 
       AND used_at IS NULL
       RETURNING id`
        );

        const deletedCount = result.rows.length;

        if (deletedCount > 0) {
            logger.info('Cleaned up expired password reset tokens', { count: deletedCount });
        }

        return deletedCount;
    }

    /**
     * Get all active (unused and not expired) tokens for a user
     * @param userId User ID to check tokens for
     * @returns Array of active password reset tokens
     */
    static async getActiveTokensForUser(userId: string): Promise<PasswordResetToken[]> {
        const result = await DatabaseService.query(
            `SELECT id, user_id, token, expires_at, used_at, created_at
       FROM password_reset_tokens
       WHERE user_id = $1 
       AND used_at IS NULL 
       AND expires_at > CURRENT_TIMESTAMP
       ORDER BY created_at DESC`,
            [userId]
        );

        return result.rows.map(row => ({
            id: row.id,
            userId: row.user_id,
            token: row.token,
            expiresAt: new Date(row.expires_at),
            usedAt: row.used_at ? new Date(row.used_at) : undefined,
            createdAt: new Date(row.created_at)
        }));
    }

    /**
     * Invalidate all unused tokens for a user (useful when password is changed)
     * @param userId User ID to invalidate tokens for
     * @returns Number of tokens invalidated
     */
    static async invalidateUserTokens(userId: string): Promise<number> {
        const result = await DatabaseService.query(
            `UPDATE password_reset_tokens 
       SET used_at = CURRENT_TIMESTAMP 
       WHERE user_id = $1 AND used_at IS NULL
       RETURNING id`,
            [userId]
        );

        const invalidatedCount = result.rows.length;

        if (invalidatedCount > 0) {
            logger.info('Invalidated password reset tokens for user', {
                userId,
                count: invalidatedCount
            });
        }

        return invalidatedCount;
    }

    /**
     * Get token statistics for monitoring
     * @returns Object with token statistics
     */
    static async getTokenStatistics(): Promise<{
        totalActive: number;
        totalExpired: number;
        totalUsed: number;
    }> {
        const result = await DatabaseService.query(`
      SELECT 
        COUNT(CASE WHEN used_at IS NULL AND expires_at > CURRENT_TIMESTAMP THEN 1 END) as active_count,
        COUNT(CASE WHEN used_at IS NULL AND expires_at <= CURRENT_TIMESTAMP THEN 1 END) as expired_count,
        COUNT(CASE WHEN used_at IS NOT NULL THEN 1 END) as used_count
      FROM password_reset_tokens
    `);

        const stats = result.rows[0];
        return {
            totalActive: parseInt(stats.active_count) || 0,
            totalExpired: parseInt(stats.expired_count) || 0,
            totalUsed: parseInt(stats.used_count) || 0
        };
    }
}

export {
    PasswordResetService,
    PasswordResetToken,
    TokenValidationResult
};