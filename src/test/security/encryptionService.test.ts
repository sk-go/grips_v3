import { EncryptionService } from '../../services/security/encryptionService';

describe('EncryptionService', () => {
  let encryptionService: EncryptionService;

  beforeEach(() => {
    encryptionService = new EncryptionService({
      keyRotationDays: 1 // Short rotation for testing
    });
  });

  describe('encrypt and decrypt', () => {
    it('should encrypt and decrypt data correctly', () => {
      const plaintext = 'This is sensitive data that needs encryption';
      
      const encrypted = encryptionService.encrypt(plaintext);
      expect(encrypted.data).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.tag).toBeDefined();
      expect(encrypted.keyId).toBeDefined();
      expect(encrypted.timestamp).toBeDefined();
      
      const decrypted = encryptionService.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should produce different encrypted data for same plaintext', () => {
      const plaintext = 'Same data';
      
      const encrypted1 = encryptionService.encrypt(plaintext);
      const encrypted2 = encryptionService.encrypt(plaintext);
      
      expect(encrypted1.data).not.toBe(encrypted2.data);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      
      // But both should decrypt to same plaintext
      expect(encryptionService.decrypt(encrypted1)).toBe(plaintext);
      expect(encryptionService.decrypt(encrypted2)).toBe(plaintext);
    });

    it('should handle empty strings', () => {
      const plaintext = '';
      
      const encrypted = encryptionService.encrypt(plaintext);
      const decrypted = encryptionService.decrypt(encrypted);
      
      expect(decrypted).toBe(plaintext);
    });

    it('should handle unicode characters', () => {
      const plaintext = 'Unicode: 🔐 中文 español';
      
      const encrypted = encryptionService.encrypt(plaintext);
      const decrypted = encryptionService.decrypt(encrypted);
      
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('field encryption', () => {
    it('should encrypt and decrypt field data', () => {
      const fieldName = 'ssn';
      const value = '123-45-6789';
      
      const encrypted = encryptionService.encryptField(fieldName, value);
      expect(encrypted).toContain('"data"');
      expect(encrypted).toContain('"keyId"');
      
      const decrypted = encryptionService.decryptField(encrypted);
      expect(decrypted).toBe(value);
    });

    it('should throw error for invalid encrypted field data', () => {
      expect(() => {
        encryptionService.decryptField('invalid json');
      }).toThrow('Failed to decrypt field data');
    });
  });

  describe('key rotation', () => {
    it('should rotate keys when needed', () => {
      const originalStatus = encryptionService.getStatus();
      const originalKeyId = originalStatus.currentKeyId;
      
      // Force rotation
      encryptionService.rotateKey();
      
      const newStatus = encryptionService.getStatus();
      expect(newStatus.currentKeyId).not.toBe(originalKeyId);
    });

    it('should decrypt data encrypted with old keys after rotation', () => {
      const plaintext = 'Data encrypted before rotation';
      
      // Encrypt with original key
      const encrypted = encryptionService.encrypt(plaintext);
      
      // Rotate key
      encryptionService.rotateKey();
      
      // Should still be able to decrypt old data
      const decrypted = encryptionService.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should detect when key rotation is needed', () => {
      // Create service with very short rotation period
      const shortRotationService = new EncryptionService({
        keyRotationDays: 0 // Immediate rotation needed
      });
      
      expect(shortRotationService.isKeyRotationNeeded()).toBe(true);
    });
  });

  describe('hashing', () => {
    it('should create consistent hashes for same input', () => {
      const data = 'test@example.com';
      
      const hash1 = encryptionService.hashForIndex(data);
      const hash2 = encryptionService.hashForIndex(data);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex length
    });

    it('should create different hashes for different inputs', () => {
      const hash1 = encryptionService.hashForIndex('data1');
      const hash2 = encryptionService.hashForIndex('data2');
      
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('key cleanup', () => {
    it('should clean up old keys beyond retention period', () => {
      // Rotate multiple times to create history
      encryptionService.rotateKey();
      encryptionService.rotateKey();
      encryptionService.rotateKey();
      
      const statusBefore = encryptionService.getStatus();
      expect(statusBefore.historicalKeysCount).toBeGreaterThan(0);
      
      // Clean up with 0 retention (remove all historical keys)
      encryptionService.cleanupOldKeys(0);
      
      const statusAfter = encryptionService.getStatus();
      expect(statusAfter.historicalKeysCount).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should throw error for non-existent key', () => {
      const fakeEncryptedData = {
        data: 'encrypted',
        iv: 'iv',
        tag: 'tag',
        keyId: 'non-existent-key',
        timestamp: Date.now()
      };
      
      expect(() => {
        encryptionService.decrypt(fakeEncryptedData);
      }).toThrow('Encryption key not found');
    });
  });

  describe('status reporting', () => {
    it('should provide accurate status information', () => {
      const status = encryptionService.getStatus();
      
      expect(status.currentKeyId).toBeDefined();
      expect(typeof status.keyAge).toBe('number');
      expect(typeof status.rotationNeeded).toBe('boolean');
      expect(typeof status.historicalKeysCount).toBe('number');
    });
  });
});