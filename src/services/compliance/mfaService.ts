import { DatabaseService } from '../database';
import { logger } from '../../utils/logger';
import { AuditLoggingService } from './auditLoggingService';
import * as crypto from 'crypto';
import * as speakeasy from 'speakeasy';

export interface MFASetup {
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
}

export interface MFASettings {
  id: string;
  userId: string;
  isEnabled: boolean;
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class MFAService {
  private static readonly BACKUP_CODE_COUNT = 10;
  private static readonly BACKUP_CODE_LENGTH = 8;

  /**
   * Setup MFA for a user
   */
  static async setupMFA(userId: string, sessionId?: string): Promise<MFASetup> {
    try {
      // Generate TOTP secret
      const secret = speakeasy.generateSecret({
        name: `Relationship Care Platform (${userId})`,
        issuer: 'Relationship Care Platform'
      });

      // Generate backup codes
      const backupCodes = this.generateBackupCodes();

      // Encrypt sensitive data
      const encryptedSecret = this.encryptData(secret.base32);
      const encryptedBackupCodes = this.encryptData(JSON.stringify(backupCodes));

      // Store in database
      const query = `
        INSERT INTO mfa_settings (user_id, secret_key, backup_codes)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id) 
        DO UPDATE SET 
          secret_key = EXCLUDED.secret_key,
          backup_codes = EXCLUDED.backup_codes,
          is_enabled = false,
          updated_at = NOW()
        RETURNING id
      `;

      await DatabaseService.query(query, [
        userId,
        encryptedSecret,
        encryptedBackupCodes
      ]);

      // Log MFA setup
      await AuditLoggingService.logAction({
        userId,
        sessionId,
        actionType: 'mfa_setup_initiated',
        resourceType: 'authentication',
        details: {
          hasSecret: true,
          backupCodesGenerated: backupCodes.length
        },
        riskLevel: 'medium'
      });

      logger.info('MFA setup initiated for user', { userId });

      return {
        secret: secret.base32,
        qrCodeUrl: secret.otpauth_url || '',
        backupCodes
      };
    } catch (error) {
      logger.error('Failed to setup MFA', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId
      });
      throw new Error('Failed to setup MFA');
    }
  }

  /**
   * Enable MFA after verification
   */
  static async enableMFA(
    userId: string,
    token: string,
    sessionId?: string
  ): Promise<void> {
    try {
      // Verify the token first
      const isValid = await this.verifyTOTP(userId, token);
      if (!isValid) {
        throw new Error('Invalid verification token');
      }

      // Enable MFA
      const query = `
        UPDATE mfa_settings 
        SET is_enabled = true, updated_at = NOW()
        WHERE user_id = $1
      `;

      await DatabaseService.query(query, [userId]);

      // Log MFA enablement
      await AuditLoggingService.logAction({
        userId,
        sessionId,
        actionType: 'mfa_enabled',
        resourceType: 'authentication',
        details: {
          verificationMethod: 'totp'
        },
        riskLevel: 'high'
      });

      logger.info('MFA enabled for user', { userId });
    } catch (error) {
      logger.error('Failed to enable MFA', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId
      });
      throw error;
    }
  }

  /**
   * Disable MFA
   */
  static async disableMFA(
    userId: string,
    token: string,
    sessionId?: string
  ): Promise<void> {
    try {
      // Verify current token before disabling
      const isValid = await this.verifyTOTP(userId, token);
      if (!isValid) {
        throw new Error('Invalid verification token');
      }

      const query = `
        UPDATE mfa_settings 
        SET is_enabled = false, updated_at = NOW()
        WHERE user_id = $1
      `;

      await DatabaseService.query(query, [userId]);

      // Log MFA disablement
      await AuditLoggingService.logAction({
        userId,
        sessionId,
        actionType: 'mfa_disabled',
        resourceType: 'authentication',
        details: {
          verificationMethod: 'totp'
        },
        riskLevel: 'high'
      });

      logger.warn('MFA disabled for user', { userId });
    } catch (error) {
      logger.error('Failed to disable MFA', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId
      });
      throw error;
    }
  }

  /**
   * Verify TOTP token
   */
  static async verifyTOTP(
    userId: string,
    token: string,
    sessionId?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<boolean> {
    try {
      // Get user's MFA settings
      const query = `
        SELECT secret_key, is_enabled 
        FROM mfa_settings 
        WHERE user_id = $1
      `;

      const result = await DatabaseService.query(query, [userId]);
      
      if (result.rows.length === 0 || !result.rows[0].is_enabled) {
        return false;
      }

      const encryptedSecret = result.rows[0].secret_key;
      const secret = this.decryptData(encryptedSecret);

      // Verify token
      const verified = speakeasy.totp.verify({
        secret,
        encoding: 'base32',
        token,
        window: 2 // Allow 2 time steps (60 seconds) of drift
      });

      // Log attempt
      await this.logMFAAttempt(userId, 'totp', verified, ipAddress, userAgent);

      if (verified) {
        // Update last used timestamp
        await DatabaseService.query(
          'UPDATE mfa_settings SET last_used_at = NOW() WHERE user_id = $1',
          [userId]
        );

        await AuditLoggingService.logAction({
          userId,
          sessionId,
          actionType: 'mfa_verification_success',
          resourceType: 'authentication',
          details: {
            method: 'totp'
          },
          ipAddress,
          userAgent,
          riskLevel: 'low'
        });
      } else {
        await AuditLoggingService.logAction({
          userId,
          sessionId,
          actionType: 'mfa_verification_failed',
          resourceType: 'authentication',
          details: {
            method: 'totp',
            reason: 'invalid_token'
          },
          ipAddress,
          userAgent,
          riskLevel: 'medium'
        });
      }

      return verified;
    } catch (error) {
      logger.error('Failed to verify TOTP', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId
      });
      return false;
    }
  }

  /**
   * Verify backup code
   */
  static async verifyBackupCode(
    userId: string,
    code: string,
    sessionId?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<boolean> {
    try {
      const query = `
        SELECT backup_codes, is_enabled 
        FROM mfa_settings 
        WHERE user_id = $1
      `;

      const result = await DatabaseService.query(query, [userId]);
      
      if (result.rows.length === 0 || !result.rows[0].is_enabled) {
        return false;
      }

      const encryptedBackupCodes = result.rows[0].backup_codes;
      const backupCodes: string[] = JSON.parse(this.decryptData(encryptedBackupCodes));

      const codeIndex = backupCodes.indexOf(code);
      const verified = codeIndex !== -1;

      // Log attempt
      await this.logMFAAttempt(userId, 'backup_code', verified, ipAddress, userAgent);

      if (verified) {
        // Remove used backup code
        backupCodes.splice(codeIndex, 1);
        const updatedEncryptedCodes = this.encryptData(JSON.stringify(backupCodes));

        await DatabaseService.query(
          'UPDATE mfa_settings SET backup_codes = $1, last_used_at = NOW() WHERE user_id = $2',
          [updatedEncryptedCodes, userId]
        );

        await AuditLoggingService.logAction({
          userId,
          sessionId,
          actionType: 'mfa_verification_success',
          resourceType: 'authentication',
          details: {
            method: 'backup_code',
            remainingCodes: backupCodes.length
          },
          ipAddress,
          userAgent,
          riskLevel: 'medium'
        });

        // Warn if running low on backup codes
        if (backupCodes.length <= 2) {
          logger.warn('User running low on backup codes', {
            userId,
            remainingCodes: backupCodes.length
          });
        }
      } else {
        await AuditLoggingService.logAction({
          userId,
          sessionId,
          actionType: 'mfa_verification_failed',
          resourceType: 'authentication',
          details: {
            method: 'backup_code',
            reason: 'invalid_code'
          },
          ipAddress,
          userAgent,
          riskLevel: 'medium'
        });
      }

      return verified;
    } catch (error) {
      logger.error('Failed to verify backup code', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId
      });
      return false;
    }
  }

  /**
   * Get MFA settings for user
   */
  static async getMFASettings(userId: string): Promise<MFASettings | null> {
    try {
      const query = `
        SELECT id, user_id, is_enabled, last_used_at, created_at, updated_at
        FROM mfa_settings 
        WHERE user_id = $1
      `;

      const result = await DatabaseService.query(query, [userId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        userId: row.user_id,
        isEnabled: row.is_enabled,
        lastUsedAt: row.last_used_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    } catch (error) {
      logger.error('Failed to get MFA settings', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId
      });
      throw new Error('Failed to get MFA settings');
    }
  }

  /**
   * Generate new backup codes
   */
  static async regenerateBackupCodes(
    userId: string,
    token: string,
    sessionId?: string
  ): Promise<string[]> {
    try {
      // Verify current token
      const isValid = await this.verifyTOTP(userId, token);
      if (!isValid) {
        throw new Error('Invalid verification token');
      }

      const backupCodes = this.generateBackupCodes();
      const encryptedBackupCodes = this.encryptData(JSON.stringify(backupCodes));

      await DatabaseService.query(
        'UPDATE mfa_settings SET backup_codes = $1, updated_at = NOW() WHERE user_id = $2',
        [encryptedBackupCodes, userId]
      );

      await AuditLoggingService.logAction({
        userId,
        sessionId,
        actionType: 'mfa_backup_codes_regenerated',
        resourceType: 'authentication',
        details: {
          newCodeCount: backupCodes.length
        },
        riskLevel: 'medium'
      });

      logger.info('Backup codes regenerated for user', { userId });
      return backupCodes;
    } catch (error) {
      logger.error('Failed to regenerate backup codes', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId
      });
      throw error;
    }
  }

  /**
   * Check if MFA is required for user
   */
  static async isMFARequired(userId: string): Promise<boolean> {
    try {
      const query = `
        SELECT is_enabled 
        FROM mfa_settings 
        WHERE user_id = $1
      `;

      const result = await DatabaseService.query(query, [userId]);
      return result.rows.length > 0 && result.rows[0].is_enabled;
    } catch (error) {
      logger.error('Failed to check MFA requirement', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId
      });
      return false;
    }
  }

  /**
   * Generate backup codes
   */
  private static generateBackupCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < this.BACKUP_CODE_COUNT; i++) {
      codes.push(this.generateRandomCode(this.BACKUP_CODE_LENGTH));
    }
    return codes;
  }

  /**
   * Generate random alphanumeric code
   */
  private static generateRandomCode(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Encrypt sensitive data
   */
  private static encryptData(data: string): string {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(process.env.MFA_ENCRYPTION_KEY || 'default-key', 'salt', 32);
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipher(algorithm, key);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt sensitive data
   */
  private static decryptData(encryptedData: string): string {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(process.env.MFA_ENCRYPTION_KEY || 'default-key', 'salt', 32);
    
    const parts = encryptedData.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    const decipher = crypto.createDecipher(algorithm, key);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Log MFA attempt
   */
  private static async logMFAAttempt(
    userId: string,
    attemptType: 'totp' | 'backup_code',
    success: boolean,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    try {
      const query = `
        INSERT INTO mfa_attempts (user_id, attempt_type, success, ip_address, user_agent)
        VALUES ($1, $2, $3, $4, $5)
      `;

      await DatabaseService.query(query, [
        userId,
        attemptType,
        success,
        ipAddress || null,
        userAgent || null
      ]);
    } catch (error) {
      logger.error('Failed to log MFA attempt', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        attemptType,
        success
      });
    }
  }
}