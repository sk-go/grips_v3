import { encryptionService } from './encryptionService';
import { logger } from '../../utils/logger';
import cron from 'node-cron';

export interface KeyRotationConfig {
  enabled: boolean;
  schedule: string; // Cron expression
  notificationEmail?: string;
  backupLocation?: string;
}

export interface KeyRotationEvent {
  id: string;
  timestamp: Date;
  oldKeyId: string;
  newKeyId: string;
  triggeredBy: 'automatic' | 'manual' | 'emergency';
  success: boolean;
  error?: string;
}

export class KeyManagementService {
  private config: KeyRotationConfig;
  private rotationHistory: KeyRotationEvent[] = [];
  private cronJob?: cron.ScheduledTask;

  constructor(config: KeyRotationConfig) {
    this.config = config;
    
    if (this.config.enabled) {
      this.initializeScheduledRotation();
    }
  }

  /**
   * Initialize scheduled key rotation
   */
  private initializeScheduledRotation(): void {
    try {
      this.cronJob = cron.schedule(this.config.schedule, async () => {
        await this.performScheduledRotation();
      }, {
        scheduled: true,
        timezone: 'UTC'
      });

      logger.info('Key rotation scheduler initialized', {
        schedule: this.config.schedule,
        enabled: this.config.enabled
      });
    } catch (error) {
      logger.error('Failed to initialize key rotation scheduler:', error);
    }
  }

  /**
   * Perform scheduled key rotation
   */
  private async performScheduledRotation(): Promise<void> {
    try {
      logger.info('Starting scheduled key rotation');
      await this.rotateKeys('automatic');
      logger.info('Scheduled key rotation completed successfully');
    } catch (error) {
      logger.error('Scheduled key rotation failed:', error);
      await this.handleRotationFailure(error as Error, 'automatic');
    }
  }

  /**
   * Manually trigger key rotation
   */
  public async rotateKeys(triggeredBy: 'automatic' | 'manual' | 'emergency' = 'manual'): Promise<KeyRotationEvent> {
    const rotationId = `rotation_${Date.now()}`;
    const oldKeyId = encryptionService.getStatus().currentKeyId;
    
    try {
      logger.info('Starting key rotation', { rotationId, triggeredBy, oldKeyId });

      // Perform the rotation
      encryptionService.rotateKey();
      const newKeyId = encryptionService.getStatus().currentKeyId;

      // Create rotation event
      const event: KeyRotationEvent = {
        id: rotationId,
        timestamp: new Date(),
        oldKeyId,
        newKeyId,
        triggeredBy,
        success: true
      };

      this.rotationHistory.push(event);

      // Clean up old keys if needed
      if (triggeredBy !== 'emergency') {
        encryptionService.cleanupOldKeys();
      }

      logger.info('Key rotation completed successfully', {
        rotationId,
        oldKeyId,
        newKeyId,
        triggeredBy
      });

      // Send notification if configured
      if (this.config.notificationEmail) {
        await this.sendRotationNotification(event);
      }

      return event;
    } catch (error) {
      const event: KeyRotationEvent = {
        id: rotationId,
        timestamp: new Date(),
        oldKeyId,
        newKeyId: 'failed',
        triggeredBy,
        success: false,
        error: (error as Error).message
      };

      this.rotationHistory.push(event);
      
      logger.error('Key rotation failed', {
        rotationId,
        error: (error as Error).message,
        triggeredBy
      });

      throw error;
    }
  }

  /**
   * Emergency key rotation (in case of suspected compromise)
   */
  public async emergencyRotation(reason: string): Promise<KeyRotationEvent> {
    logger.warn('Emergency key rotation triggered', { reason });
    
    try {
      const event = await this.rotateKeys('emergency');
      
      // Additional emergency procedures
      await this.invalidateAllSessions();
      await this.notifySecurityTeam(reason, event);
      
      return event;
    } catch (error) {
      logger.error('Emergency key rotation failed', { reason, error });
      throw error;
    }
  }

  /**
   * Get key rotation history
   */
  public getRotationHistory(limit: number = 50): KeyRotationEvent[] {
    return this.rotationHistory
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Get key management status
   */
  public getStatus(): {
    encryptionStatus: any;
    rotationEnabled: boolean;
    nextRotation?: Date;
    lastRotation?: KeyRotationEvent;
    rotationHistory: number;
  } {
    const lastRotation = this.rotationHistory
      .filter(r => r.success)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];

    return {
      encryptionStatus: encryptionService.getStatus(),
      rotationEnabled: this.config.enabled,
      nextRotation: this.getNextRotationTime(),
      lastRotation,
      rotationHistory: this.rotationHistory.length
    };
  }

  /**
   * Update rotation configuration
   */
  public updateConfig(newConfig: Partial<KeyRotationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Restart scheduler if schedule changed
    if (newConfig.schedule && this.cronJob) {
      this.cronJob.stop();
      this.initializeScheduledRotation();
    }
    
    logger.info('Key management configuration updated', this.config);
  }

  /**
   * Stop scheduled rotation
   */
  public stopScheduledRotation(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      logger.info('Key rotation scheduler stopped');
    }
  }

  /**
   * Start scheduled rotation
   */
  public startScheduledRotation(): void {
    if (!this.cronJob && this.config.enabled) {
      this.initializeScheduledRotation();
    } else if (this.cronJob) {
      this.cronJob.start();
      logger.info('Key rotation scheduler started');
    }
  }

  /**
   * Validate encryption keys integrity
   */
  public async validateKeysIntegrity(): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Test current key encryption/decryption
      const testData = 'integrity_test_' + Date.now();
      const encrypted = encryptionService.encrypt(testData);
      const decrypted = encryptionService.decrypt(encrypted);
      
      if (decrypted !== testData) {
        errors.push('Current key encryption/decryption test failed');
      }

      // Check key age
      const status = encryptionService.getStatus();
      if (status.rotationNeeded) {
        warnings.push(`Key rotation needed (age: ${status.keyAge} days)`);
      }

      // Check rotation history
      const recentFailures = this.rotationHistory
        .filter(r => !r.success && Date.now() - r.timestamp.getTime() < 24 * 60 * 60 * 1000)
        .length;
      
      if (recentFailures > 0) {
        warnings.push(`${recentFailures} failed rotation attempts in last 24 hours`);
      }

    } catch (error) {
      errors.push(`Key validation error: ${(error as Error).message}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Get next rotation time based on schedule
   */
  private getNextRotationTime(): Date | undefined {
    if (!this.config.enabled || !this.cronJob) {
      return undefined;
    }

    // This is a simplified calculation - in production you'd use a proper cron parser
    const now = new Date();
    const nextRotation = new Date(now);
    
    // For quarterly rotation (every 90 days), estimate next rotation
    if (this.config.schedule.includes('0 0 1 */3 *')) {
      const currentMonth = now.getMonth();
      const nextQuarter = Math.ceil((currentMonth + 1) / 3) * 3;
      nextRotation.setMonth(nextQuarter, 1);
      nextRotation.setHours(0, 0, 0, 0);
    }

    return nextRotation;
  }

  /**
   * Handle rotation failure
   */
  private async handleRotationFailure(error: Error, triggeredBy: string): Promise<void> {
    logger.error('Key rotation failure handling', {
      error: error.message,
      triggeredBy,
      timestamp: new Date().toISOString()
    });

    // Implement failure recovery procedures
    // - Alert security team
    // - Attempt emergency procedures
    // - Document incident
  }

  /**
   * Send rotation notification
   */
  private async sendRotationNotification(event: KeyRotationEvent): Promise<void> {
    // Implementation would depend on your notification system
    logger.info('Key rotation notification sent', {
      eventId: event.id,
      email: this.config.notificationEmail,
      success: event.success
    });
  }

  /**
   * Invalidate all user sessions (emergency procedure)
   */
  private async invalidateAllSessions(): Promise<void> {
    // Implementation would depend on your session management
    logger.warn('All user sessions invalidated due to emergency key rotation');
  }

  /**
   * Notify security team of emergency rotation
   */
  private async notifySecurityTeam(reason: string, event: KeyRotationEvent): Promise<void> {
    logger.error('Security team notified of emergency key rotation', {
      reason,
      eventId: event.id,
      timestamp: event.timestamp
    });
  }
}

// Default configuration for quarterly rotation
const defaultConfig: KeyRotationConfig = {
  enabled: process.env.NODE_ENV === 'production',
  schedule: '0 0 1 */3 *', // First day of every quarter at midnight UTC
  notificationEmail: process.env.SECURITY_NOTIFICATION_EMAIL
};

// Singleton instance
export const keyManagementService = new KeyManagementService(defaultConfig);