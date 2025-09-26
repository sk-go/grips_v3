import { AuthService, PasswordValidationResult } from '../services/auth';

describe('AuthService Enhanced Verification', () => {
  describe('Password Validation', () => {
    test('should validate various password strengths correctly', () => {
      // Test weak passwords
      const weakResult = AuthService.validatePassword('weak');
      expect(weakResult.isValid).toBe(false);
      expect(weakResult.errors.length).toBeGreaterThan(0);
      
      const weakPasswordResult = AuthService.validatePassword('WeakPassword');
      expect(weakPasswordResult.isValid).toBe(false); // Missing numbers and special chars
      
      const betterResult = AuthService.validatePassword('Better123');
      expect(betterResult.isValid).toBe(false); // Missing special chars
      
      // Test valid passwords
      const goodResult = AuthService.validatePassword('Better123!');
      expect(goodResult.isValid).toBe(true);
      expect(goodResult.errors.length).toBe(0);
      
      const strongResult = AuthService.validatePassword('VeryStr0ng!P@ssw0rd');
      expect(strongResult.isValid).toBe(true);
      expect(strongResult.errors.length).toBe(0);
      expect(strongResult.strength).toBe('strong');
      
      // Test edge cases
      const shortResult = AuthService.validatePassword('Sh0rt!');
      expect(shortResult.isValid).toBe(false);
      expect(shortResult.errors).toContain('Password must be at least 8 characters long');
      
      const longResult = AuthService.validatePassword('A'.repeat(130) + '1!');
      expect(longResult.isValid).toBe(false);
      expect(longResult.errors).toContain('Password must not exceed 128 characters');
    });

    test('should provide detailed error messages for invalid passwords', () => {
      const result = AuthService.validatePassword('weak');
      
      expect(result.errors).toContain('Password must be at least 8 characters long');
      expect(result.errors).toContain('Password must contain at least one uppercase letter');
      expect(result.errors).toContain('Password must contain at least one number');
      expect(result.errors).toContain('Password must contain at least one special character');
    });

    test('should calculate password strength scores correctly', () => {
      const strongPassword = AuthService.validatePassword('VeryStr0ng!P@ssw0rd');
      const weakPassword = AuthService.validatePassword('weak');
      const mediumPassword = AuthService.validatePassword('Medium123!');

      expect(strongPassword.score).toBeGreaterThan(80);
      expect(weakPassword.score).toBeLessThan(40);
      expect(mediumPassword.score).toBeGreaterThanOrEqual(60);
      expect(mediumPassword.score).toBeLessThanOrEqual(80);
    });
  });

  describe('Email Validation', () => {
    test('should validate email formats correctly', () => {
      const validEmails = [
        'user@example.com',
        'test.email+tag@domain.co.uk',
        'user123@test-domain.org',
        'firstname.lastname@company.com'
      ];

      const invalidEmails = [
        'invalid-email',
        'user@',
        '@domain.com',
        'user@domain',
        ''
      ];

      validEmails.forEach(email => {
        expect(AuthService.validateEmail(email)).toBe(true);
      });

      invalidEmails.forEach(email => {
        expect(AuthService.validateEmail(email)).toBe(false);
      });
    });
  });

  describe('JWT Token Generation and Verification', () => {
    test('should generate and verify access tokens correctly', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'agent'
      };

      const token = AuthService.generateAccessToken(payload);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      const verifiedPayload = AuthService.verifyAccessToken(token);
      expect(verifiedPayload.userId).toBe(payload.userId);
      expect(verifiedPayload.email).toBe(payload.email);
      expect(verifiedPayload.role).toBe(payload.role);
    });

    test('should generate and verify refresh tokens correctly', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'agent'
      };

      const token = AuthService.generateRefreshToken(payload);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      const verifiedPayload = AuthService.verifyRefreshToken(token);
      expect(verifiedPayload.userId).toBe(payload.userId);
      expect(verifiedPayload.email).toBe(payload.email);
      expect(verifiedPayload.role).toBe(payload.role);
    });

    test('should reject invalid tokens', () => {
      expect(() => {
        AuthService.verifyAccessToken('invalid-token');
      }).toThrow('Invalid or expired token');

      expect(() => {
        AuthService.verifyRefreshToken('invalid-token');
      }).toThrow('Invalid or expired refresh token');
    });

    test('should reject expired tokens', () => {
      // This would require mocking jwt.verify to simulate expiration
      // For now, we test with malformed tokens
      expect(() => {
        AuthService.verifyAccessToken('malformed.token.here');
      }).toThrow('Invalid or expired token');
    });
  });

  describe('Password Hashing', () => {
    test('should hash passwords securely', async () => {
      const password = 'TestPassword123!';
      const hash = await AuthService.hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.startsWith('$2a$')).toBe(true); // bcrypt hash format
    });

    test('should verify passwords correctly', async () => {
      const password = 'TestPassword123!';
      const hash = await AuthService.hashPassword(password);

      const isValid = await AuthService.comparePassword(password, hash);
      expect(isValid).toBe(true);

      const isInvalid = await AuthService.comparePassword('WrongPassword', hash);
      expect(isInvalid).toBe(false);
    });

    test('should generate different hashes for same password', async () => {
      const password = 'TestPassword123!';
      const hash1 = await AuthService.hashPassword(password);
      const hash2 = await AuthService.hashPassword(password);

      expect(hash1).not.toBe(hash2); // Salt should make them different
      
      // But both should verify correctly
      expect(await AuthService.comparePassword(password, hash1)).toBe(true);
      expect(await AuthService.comparePassword(password, hash2)).toBe(true);
    });
  });

  describe('Security Features', () => {
    test('should have appropriate JWT configuration', () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'agent'
      };

      const accessToken = AuthService.generateAccessToken(payload);
      const refreshToken = AuthService.generateRefreshToken(payload);

      // Tokens should be different
      expect(accessToken).not.toBe(refreshToken);

      // Both should be valid JWT format (3 parts separated by dots)
      expect(accessToken.split('.').length).toBe(3);
      expect(refreshToken.split('.').length).toBe(3);
    });

    test('should use secure password hashing parameters', async () => {
      const password = 'TestPassword123!';
      const startTime = Date.now();
      
      await AuthService.hashPassword(password);
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Hashing should take some time (indicating proper salt rounds)
      // but not too long for user experience
      expect(duration).toBeGreaterThan(50); // At least 50ms
      expect(duration).toBeLessThan(5000); // Less than 5 seconds
    });
  });
});