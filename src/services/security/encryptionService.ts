import crypto from 'crypto';
import { logger } from '../../utils/logger';

export interface EncryptionConfig {
  algorithm: string;
  keyLength: number;
  ivLength: number;
  tagLength: number;
  keyRotationDays: number;
}

export interface EncryptedData {
  data: string;
  iv: string;
  tag: string;
  keyId: string;
  timestamp: number;
}

export class EncryptionService {
  private config: EncryptionConfig;
  private currentKey!: Buffer;
  private keyId!: string;
  private keyCreatedAt!: Date;
  private keyHistory: Map<string, { key: Buffer; createdAt: Date }>;

  constructor(config?: Partial<EncryptionConfig>) {
    this.config = {
      algorithm: 'aes-256-gcm',
      keyLength: 32, // 256 bits
      ivLength: 16,  // 128 bits
      tagLength: 16, // 128 bits
      keyRotationDays: 90, // Quarterly rotation
      ...config
    };

    this.keyHistory = new Map();
    this.initializeEncryption();
  }

  /**
   * Initialize encryption with a new key
   */
  private initializeEncryption(): void {
    this.rotateKey();
    logger.info('Encryption service initialized with AES-256-GCM');
  }

  /**
   * Generate a new encryption key and rotate if needed
   */
  public rotateKey(): void {
    // Store old key in history if it exists
    if (this.currentKey && this.keyId) {
      this.keyHistory.set(this.keyId, {
        key: this.currentKey,
        createdAt: this.keyCreatedAt
      });
    }

    // Generate new key
    this.currentKey = crypto.randomBytes(this.config.keyLength);
    this.keyId = crypto.randomUUID();
    this.keyCreatedAt = new Date();

    logger.info(`Encryption key rotated: ${this.keyId}`);
  }

  /**
   * Check if key rotation is needed based on age
   */
  public isKeyRotationNeeded(): boolean {
    if (!this.keyCreatedAt) return true;
    
    const daysSinceCreation = (Date.now() - this.keyCreatedAt.getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceCreation >= this.config.keyRotationDays;
  }

  /**
   * Encrypt sensitive data using AES-256-GCM
   */
  public encrypt(plaintext: string): EncryptedData {
    try {
      // Check if key rotation is needed
      if (this.isKeyRotationNeeded()) {
        this.rotateKey();
      }

      const iv = crypto.randomBytes(this.config.ivLength);
      const cipher = crypto.createCipheriv(this.config.algorithm, this.currentKey, iv);
      (cipher as any).setAAD(Buffer.from(this.keyId)); // Additional authenticated data

      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const tag = (cipher as any).getAuthTag();

      return {
        data: encrypted,
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        keyId: this.keyId,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('Encryption failed:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypt data using the appropriate key
   */
  public decrypt(encryptedData: EncryptedData): string {
    try {
      let key: Buffer;
      
      // Use current key or find in history
      if (encryptedData.keyId === this.keyId) {
        key = this.currentKey;
      } else {
        const historicalKey = this.keyHistory.get(encryptedData.keyId);
        if (!historicalKey) {
          throw new Error(`Encryption key not found: ${encryptedData.keyId}`);
        }
        key = historicalKey.key;
      }

      const iv = Buffer.from(encryptedData.iv, 'hex');
      const decipher = crypto.createDecipheriv(this.config.algorithm, key, iv);
      (decipher as any).setAAD(Buffer.from(encryptedData.keyId));
      (decipher as any).setAuthTag(Buffer.from(encryptedData.tag, 'hex'));

      let decrypted = decipher.update(encryptedData.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      logger.error('Decryption failed:', error);
      throw new Error('Failed to decrypt data');
    }
  }

  /**
   * Encrypt field-level data for sensitive information
   */
  public encryptField(_fieldName: string, value: string): string {
    const encryptedData = this.encrypt(value);
    return JSON.stringify(encryptedData);
  }

  /**
   * Decrypt field-level data
   */
  public decryptField(encryptedField: string): string {
    try {
      const encryptedData: EncryptedData = JSON.parse(encryptedField);
      return this.decrypt(encryptedData);
    } catch (error) {
      logger.error('Field decryption failed:', error);
      throw new Error('Failed to decrypt field data');
    }
  }

  /**
   * Hash sensitive data for indexing (one-way)
   */
  public hashForIndex(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Clean up old keys beyond retention period
   */
  public cleanupOldKeys(retentionDays: number = 365): void {
    const cutoffDate = new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000));
    
    for (const [keyId, keyData] of this.keyHistory.entries()) {
      if (keyData.createdAt < cutoffDate) {
        this.keyHistory.delete(keyId);
        logger.info(`Cleaned up old encryption key: ${keyId}`);
      }
    }
  }

  /**
   * Get encryption status and key information
   */
  public getStatus(): {
    currentKeyId: string;
    keyAge: number;
    rotationNeeded: boolean;
    historicalKeysCount: number;
  } {
    const keyAge = this.keyCreatedAt ? 
      (Date.now() - this.keyCreatedAt.getTime()) / (1000 * 60 * 60 * 24) : 0;

    return {
      currentKeyId: this.keyId,
      keyAge: Math.floor(keyAge),
      rotationNeeded: this.isKeyRotationNeeded(),
      historicalKeysCount: this.keyHistory.size
    };
  }
}

// Singleton instance
export const encryptionService = new EncryptionService();