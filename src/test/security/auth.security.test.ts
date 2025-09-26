import { AuthService } from '../../services/auth';
import { PasswordResetService } from '../../services/passwordResetService';
import { DatabaseService } from '../../services/database';
import { RedisService } from '../../services/redis';
import { QueryResult } from '../../types/database';
import * as bcrypt from 'bcryptjs';

// Mock dependencies
jest.mock('../../services/database');
jest.mock('../../services/redis');
jest.mock('../../utils/logger');
jest.mock('../../services/email/emailNotificationService');

const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;
const mockRedisService = RedisService as jest.Mocked<typeof RedisService>;

// Helper function to create mock QueryResult
const createMockQueryResult = (rows: any[], rowCount?: number): QueryResult => ({
  rows,
  rowCount: rowCount ?? rows.length,
  fields: []
});

describe('Authentication Security Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rate Limiting Security', () => {
    test('should implement progressive lockout times', async () => {
      const email = 'user@example.com';
      const ipAddress = '192.168.1.1';

      // Test first lockout (5 attempts)
      mockRedisService.get
        .mockResolvedValueOnce(null) // No existing lockout
        .mockResolvedValueOnce('5'); // 5 attempts

      mockRedisService.set.mockResolvedValue(undefined);
      mockRedisService.del.mockResolvedValue(undefined);

      const result = await AuthService.checkRateLimit(email, ipAddress);

      expect(result.isLimited).toBe(true);
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'login_lockout:user@example.com:192.168.1.1',
        expect.any(String),
        1800 // 30 minutes lockout
      );
    });

    test('should handle concurrent rate limit checks', async () => {
      const email = 'user@example.com';
      const ipAddress = '192.168.1.1';

      // Simulate concurrent requests
      mockRedisService.get
        .mockResolvedValue(null) // No lockout
        .mockResolvedValue('4'); // 4 attempts

      const promises = Array(3).fill(null).map(() => 
        AuthService.checkRateLimit(email, ipAddress)
      );

      const results = await Promise.all(promises);

      // All should return the same result
      results.forEach(result => {
        expect(result.isLimited).toBe(false);
        expect(result.remainingAttempts).toBe(1);
      });
    });

    test('should differentiate rate limiting by IP address', async () => {
      const email = 'user@example.com';
      const ip1 = '192.168.1.1';
      const ip2 = '192.168.1.2';

      // Mock different attempt counts for different IPs
      mockRedisService.get
        .mockResolvedValueOnce(null) // No lockout for IP1
        .mockResolvedValueOnce('3') // 3 attempts for IP1
        .mockResolvedValueOnce(null) // No lockout for IP2
        .mockResolvedValueOnce('1'); // 1 attempt for IP2

      const result1 = await AuthService.checkRateLimit(email, ip1);
      const result2 = await AuthService.checkRateLimit(email, ip2);

      expect(result1.remainingAttempts).toBe(2); // 5 - 3 = 2
      expect(result2.remainingAttempts).toBe(4); // 5 - 1 = 4
    });

    test('should handle rate limiting without IP address', async () => {
      const email = 'user@example.com';

      mockRedisService.get
        .mockResolvedValueOnce(null) // No lockout
        .mockResolvedValueOnce('2'); // 2 attempts

      const result = await AuthService.checkRateLimit(email);

      expect(result.isLimited).toBe(false);
      expect(result.remainingAttempts).toBe(3);

      // Should use email-only key
      expect(mockRedisService.get).toHaveBeenCalledWith('login_lockout:user@example.com');
      expect(mockRedisService.get).toHaveBeenCalledWith('login_attempts:user@example.com');
    });

    test('should prevent timing attacks in rate limiting', async () => {
      const email = 'user@example.com';
      const ipAddress = '192.168.1.1';

      // Mock Redis operations with consistent timing
      mockRedisService.get.mockImplementation((key) => {
        return new Promise(resolve => {
          setTimeout(() => resolve(null), 10); // Consistent 10ms delay
        });
      });

      const startTime = Date.now();
      await AuthService.checkRateLimit(email, ipAddress);
      const endTime = Date.now();

      // Should have consistent timing regardless of result
      expect(endTime - startTime).toBeGreaterThanOrEqual(20); // At least 2 Redis calls
    });
  });

  describe('Password Security', () => {
    test('should use secure bcrypt hashing with proper salt rounds', async () => {
      const password = 'TestPassword123!';
      const hash = await AuthService.hashPassword(password);

      // Verify bcrypt format and salt rounds
      expect(hash).toMatch(/^\$2[aby]\$12\$/); // bcrypt with 12 rounds
      expect(hash.length).toBeGreaterThan(50); // Proper hash length
    });

    test('should generate different salts for identical passwords', async () => {
      const password = 'TestPassword123!';
      
      const hash1 = await AuthService.hashPassword(password);
      const hash2 = await AuthService.hashPassword(password);

      expect(hash1).not.toBe(hash2);
      
      // Both should verify correctly
      expect(await AuthService.comparePassword(password, hash1)).toBe(true);
      expect(await AuthService.comparePassword(password, hash2)).toBe(true);
    });

    test('should resist timing attacks in password comparison', async () => {
      const correctPassword = 'CorrectPassword123!';
      const wrongPassword = 'WrongPassword123!';
      const hash = await bcrypt.hash(correctPassword, 12);

      // Measure timing for correct password
      const correctStart = Date.now();
      await AuthService.comparePassword(correctPassword, hash);
      const correctTime = Date.now() - correctStart;

      // Measure timing for wrong password
      const wrongStart = Date.now();
      await AuthService.comparePassword(wrongPassword, hash);
      const wrongTime = Date.now() - wrongStart;

      // Timing should be similar (within reasonable variance)
      const timeDifference = Math.abs(correctTime - wrongTime);
      expect(timeDifference).toBeLessThan(50); // Less than 50ms difference
    });

    test('should enforce password complexity requirements', () => {
      const weakPasswords = [
        'password', // Common word
        '12345678', // Only numbers
        'abcdefgh', // Only lowercase
        'ABCDEFGH', // Only uppercase
        'Password', // Missing number and special char
        'Pass123',  // Too short
        'password123', // Missing uppercase and special char
      ];

      weakPasswords.forEach(password => {
        const result = AuthService.validatePassword(password);
        expect(result.isValid).toBe(false);
        expect(result.strength).toMatch(/weak|fair/);
      });
    });

    test('should detect and penalize common password patterns', () => {
      const commonPatterns = [
        'Password123!', // Contains "password"
        'Admin123!',    // Contains "admin"
        'User123!',     // Contains "user"
        'Login123!',    // Contains "login"
        'Aaaa1111!',    // Repeated characters
        'Abcd1234!',    // Sequential pattern
        'Qwerty123!',   // Keyboard pattern
      ];

      commonPatterns.forEach(password => {
        const result = AuthService.validatePassword(password);
        expect(result.score).toBeLessThan(80); // Should be penalized
      });
    });

    test('should handle password validation edge cases', () => {
      // Empty password
      expect(AuthService.validatePassword('')).toMatchObject({
        isValid: false,
        strength: 'weak',
        score: 0
      });

      // Very long password
      const longPassword = 'A'.repeat(200) + '1!';
      const result = AuthService.validatePassword(longPassword);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must not exceed 128 characters');

      // Unicode characters
      const unicodePassword = 'Pässwörd123!';
      const unicodeResult = AuthService.validatePassword(unicodePassword);
      expect(unicodeResult.isValid).toBe(true);
    });
  });

  describe('JWT Token Security', () => {
    test('should generate cryptographically secure tokens', () => {
      const payload = {
        userId: 'user-123',
        email: 'user@example.com',
        role: 'agent'
      };

      const token1 = AuthService.generateAccessToken(payload);
      const token2 = AuthService.generateAccessToken(payload);

      // Tokens should be different due to timestamp and random elements
      expect(token1).not.toBe(token2);
      
      // Both should be valid JWT format
      expect(token1.split('.')).toHaveLength(3);
      expect(token2.split('.')).toHaveLength(3);
    });

    test('should include proper JWT claims and security headers', () => {
      const payload = {
        userId: 'user-123',
        email: 'user@example.com',
        role: 'agent'
      };

      const token = AuthService.generateAccessToken(payload);
      const decoded = AuthService.verifyAccessToken(token);

      // Verify required claims
      expect(decoded.userId).toBe(payload.userId);
      expect(decoded.email).toBe(payload.email);
      expect(decoded.role).toBe(payload.role);
      expect(decoded.iss).toBe('relationship-care-platform');
      expect(decoded.aud).toBe('rcp-users');
      expect(decoded.exp).toBeDefined();
      expect(decoded.iat).toBeDefined();
    });

    test('should reject tokens with invalid signatures', () => {
      const payload = {
        userId: 'user-123',
        email: 'user@example.com',
        role: 'agent'
      };

      const token = AuthService.generateAccessToken(payload);
      const parts = token.split('.');
      
      // Tamper with the signature
      const tamperedToken = parts[0] + '.' + parts[1] + '.tampered-signature';

      expect(() => {
        AuthService.verifyAccessToken(tamperedToken);
      }).toThrow('Invalid or expired token');
    });

    test('should reject tokens with tampered payload', () => {
      const payload = {
        userId: 'user-123',
        email: 'user@example.com',
        role: 'agent'
      };

      const token = AuthService.generateAccessToken(payload);
      const parts = token.split('.');
      
      // Tamper with the payload (change role to admin)
      const tamperedPayload = Buffer.from(JSON.stringify({
        ...payload,
        role: 'admin'
      })).toString('base64url');
      
      const tamperedToken = parts[0] + '.' + tamperedPayload + '.' + parts[2];

      expect(() => {
        AuthService.verifyAccessToken(tamperedToken);
      }).toThrow('Invalid or expired token');
    });

    test('should handle token expiration properly', () => {
      // Mock short expiration for testing
      const originalExpiresIn = process.env.JWT_EXPIRES_IN;
      process.env.JWT_EXPIRES_IN = '1ms'; // Very short expiration

      const payload = {
        userId: 'user-123',
        email: 'user@example.com',
        role: 'agent'
      };

      const token = AuthService.generateAccessToken(payload);

      // Wait for token to expire
      return new Promise(resolve => {
        setTimeout(() => {
          expect(() => {
            AuthService.verifyAccessToken(token);
          }).toThrow('Invalid or expired token');
          
          // Restore original expiration
          process.env.JWT_EXPIRES_IN = originalExpiresIn;
          resolve(undefined);
        }, 10);
      });
    });
  });

  describe('Password Reset Security', () => {
    test('should generate cryptographically secure reset tokens', async () => {
      const email = 'user@example.com';

      mockDatabaseService.query
        .mockResolvedValueOnce(createMockQueryResult([{
          id: 'user-123',
          email: email,
          is_active: true
        }]))
        .mockResolvedValueOnce(createMockQueryResult([])) // Invalidate existing
        .mockResolvedValueOnce(createMockQueryResult([])); // Insert new

      const token1 = await PasswordResetService.generateResetToken(email);
      
      // Reset mocks for second token
      mockDatabaseService.query
        .mockResolvedValueOnce(createMockQueryResult([{
          id: 'user-123',
          email: email,
          is_active: true
        }]))
        .mockResolvedValueOnce(createMockQueryResult([]))
        .mockResolvedValueOnce(createMockQueryResult([]));

      const token2 = await PasswordResetService.generateResetToken(email);

      // Tokens should be different and cryptographically secure
      expect(token1).not.toBe(token2);
      expect(token1).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(token2).toHaveLength(64);
      expect(/^[a-f0-9]{64}$/.test(token1)).toBe(true);
      expect(/^[a-f0-9]{64}$/.test(token2)).toBe(true);
    });

    test('should invalidate existing tokens when generating new ones', async () => {
      const email = 'user@example.com';

      mockDatabaseService.query
        .mockResolvedValueOnce(createMockQueryResult([{
          id: 'user-123',
          email: email,
          is_active: true
        }]))
        .mockResolvedValueOnce(createMockQueryResult([])) // Invalidate existing
        .mockResolvedValueOnce(createMockQueryResult([])); // Insert new

      await PasswordResetService.generateResetToken(email);

      // Verify existing tokens were invalidated
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE password_reset_tokens'),
        ['user-123']
      );
    });

    test('should prevent email enumeration in password reset', async () => {
      const nonExistentEmail = 'nonexistent@example.com';

      mockDatabaseService.query.mockResolvedValueOnce(createMockQueryResult([]));

      // Should not throw error for non-existent email
      await expect(
        PasswordResetService.initiatePasswordReset(nonExistentEmail)
      ).resolves.not.toThrow();
    });

    test('should enforce token expiration strictly', async () => {
      const token = 'expired-token';

      // Mock expired token
      mockDatabaseService.query.mockResolvedValueOnce(createMockQueryResult([{
        id: 'token-123',
        user_id: 'user-123',
        expires_at: new Date(Date.now() - 1000), // 1 second ago
        used_at: null,
        email: 'user@example.com',
        is_active: true
      }]));

      await expect(
        PasswordResetService.validateResetToken(token)
      ).rejects.toThrow('Reset token has expired');
    });

    test('should prevent token reuse', async () => {
      const token = 'used-token';

      // Mock used token
      mockDatabaseService.query.mockResolvedValueOnce(createMockQueryResult([{
        id: 'token-123',
        user_id: 'user-123',
        expires_at: new Date(Date.now() + 3600000), // Valid expiry
        used_at: new Date(Date.now() - 1800000), // Used 30 minutes ago
        email: 'user@example.com',
        is_active: true
      }]));

      await expect(
        PasswordResetService.validateResetToken(token)
      ).rejects.toThrow('Reset token has already been used');
    });
  });

  describe('Input Validation Security', () => {
    test('should sanitize email input', () => {
      const maliciousEmails = [
        'user@example.com<script>alert("xss")</script>',
        'user@example.com\'; DROP TABLE users; --',
        'user@example.com\x00',
        'user@example.com\n\r',
      ];

      maliciousEmails.forEach(email => {
        expect(AuthService.validateEmail(email)).toBe(false);
      });
    });

    test('should handle SQL injection attempts in authentication', async () => {
      const maliciousEmail = "admin@example.com'; DROP TABLE users; --";
      const password = 'password123';

      // Mock rate limiting
      mockRedisService.get
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('1');

      // Should fail email validation before reaching database
      await expect(
        AuthService.authenticateUser(maliciousEmail, password)
      ).rejects.toThrow('Invalid email format');

      // Database should not be called with malicious input
      expect(mockDatabaseService.query).not.toHaveBeenCalled();
    });

    test('should prevent NoSQL injection in user creation', async () => {
      const maliciousUserData = {
        email: 'user@example.com',
        password: 'StrongP@ssw0rd123',
        firstName: { $ne: null }, // NoSQL injection attempt
        lastName: 'Doe'
      };

      // Should handle object inputs safely
      await expect(
        AuthService.createUser(maliciousUserData as any)
      ).rejects.toThrow();
    });

    test('should validate and sanitize profile update inputs', async () => {
      const maliciousUpdates = {
        firstName: '<script>alert("xss")</script>',
        lastName: 'DROP TABLE users;',
        email: 'user@example.com\x00'
      };

      // Email validation should catch malicious email
      await expect(
        AuthService.updateUserProfile('user-123', maliciousUpdates)
      ).rejects.toThrow('Invalid email format');
    });
  });

  describe('Session Security', () => {
    test('should revoke all sessions on password change', async () => {
      const userId = 'user-123';
      const oldPassword = 'OldPassword123!';
      const newPassword = 'NewPassword123!';

      mockDatabaseService.query
        .mockResolvedValueOnce(createMockQueryResult([{
          password_hash: '$2a$12$oldhash',
          email: 'user@example.com',
          first_name: 'John'
        }]))
        .mockResolvedValueOnce(createMockQueryResult([]));

      jest.spyOn(AuthService, 'comparePassword')
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      mockRedisService.del.mockResolvedValue(undefined);

      await AuthService.changePassword(userId, oldPassword, newPassword);

      // Verify all refresh tokens were revoked
      expect(mockRedisService.del).toHaveBeenCalledWith(`refresh_token:${userId}`);
    });

    test('should handle concurrent session operations safely', async () => {
      const userId = 'user-123';
      
      mockRedisService.del.mockResolvedValue(undefined);

      // Simulate concurrent logout operations
      const promises = Array(5).fill(null).map(() => 
        AuthService.logout(userId)
      );

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });
  });
});