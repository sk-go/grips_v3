import { AuthService } from '../../services/auth';
import { DatabaseService } from '../../services/database';
import { RateLimitingService } from '../../services/rateLimitingService';
import { EmailVerificationService } from '../../services/emailVerificationService';
import { logger } from '../../utils/logger';
import bcrypt from 'bcryptjs';

// Mock dependencies
jest.mock('../../services/database');
jest.mock('../../services/rateLimitingService');
jest.mock('../../services/emailVerificationService');
jest.mock('../../utils/logger');
jest.mock('bcryptjs');

const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;
const mockRateLimitingService = RateLimitingService as jest.Mocked<typeof RateLimitingService>;
const mockEmailVerificationService = EmailVerificationService as jest.Mocked<typeof EmailVerificationService>;
const mockLogger = logger as jest.Mocked<typeof logger>;
const mockBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('AuthService - Registration Unit Tests', () => {
  const mockRegistrationData = {
    email: 'test@example.com',
    password: 'SecurePass123!',
    firstName: 'John',
    lastName: 'Doe',
    role: 'agent' as const,
    ipAddress: '192.168.1.1',
    userAgent: 'Mozilla/5.0 Test Browser'
  };

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    first_name: 'John',
    last_name: 'Doe',
    role: 'agent',
    is_active: true,
    email_verified: false
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Default successful mocks
    mockRateLimitingService.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 5,
      resetTime: Date.now() + 3600000,
      totalHits: 0
    });

    mockBcrypt.hash.mockResolvedValue('hashed-password');
    process.env.FRONTEND_URL = 'http://localhost:3000';
  });

  describe('registerUser', () => {
    beforeEach(() => {
      // Default mocks for successful registration
      mockRateLimitingService.recordAttempt.mockResolvedValue();
      mockDatabaseService.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Check existing user
        .mockResolvedValueOnce({ rows: [mockUser], rowCount: 1 }); // Create user

      mockEmailVerificationService.getRegistrationSettings.mockResolvedValue({
        id: 'settings-1',
        requireAdminApproval: false,
        allowedEmailDomains: null,
        maxRegistrationsPerDay: 100,
        verificationTokenExpiryHours: 24,
        updatedAt: new Date()
      });

      mockEmailVerificationService.generateVerificationToken.mockResolvedValue('verification-token-123');

      // Mock the email service
      const mockEmailService = {
        sendVerificationEmail: jest.fn().mockResolvedValue(undefined)
      };
      (AuthService as any).emailService = mockEmailService;

      // Mock private methods
      jest.spyOn(AuthService as any, 'checkSuspiciousRegistration').mockResolvedValue({
        isSuspicious: false,
        reasons: []
      });
      jest.spyOn(AuthService as any, 'logRegistrationEvent').mockResolvedValue(undefined);
    });

    it('should register user successfully with email verification', async () => {
      // Act
      const result = await AuthService.registerUser(mockRegistrationData);

      // Assert
      expect(result).toEqual({
        success: true,
        userId: mockUser.id,
        requiresVerification: true,
        requiresApproval: false,
        message: 'Registration successful. Please check your email for verification instructions.',
        user: expect.objectContaining({
          id: mockUser.id,
          email: mockUser.email,
          firstName: mockUser.first_name,
          lastName: mockUser.last_name
        })
      });

      // Verify rate limiting check
      expect(mockRateLimitingService.checkRateLimit).toHaveBeenCalledWith(
        mockRegistrationData.email.toLowerCase(),
        'register',
        mockRegistrationData.ipAddress
      );

      // Verify user creation
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO users'),
        expect.arrayContaining([
          mockRegistrationData.email.toLowerCase(),
          'hashed-password',
          mockRegistrationData.firstName.trim(),
          mockRegistrationData.lastName.trim(),
          mockRegistrationData.role,
          false // email_verified
        ])
      );

      // Verify verification token generation
      expect(mockEmailVerificationService.generateVerificationToken).toHaveBeenCalledWith(mockUser.id);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'User registration completed',
        expect.objectContaining({
          userId: mockUser.id,
          email: mockUser.email,
          role: mockUser.role
        })
      );
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

      // Act & Assert
      await expect(AuthService.registerUser(mockRegistrationData))
        .rejects.toThrow('Registration rate limit exceeded. Try again in 60 minutes.');

      expect(mockRateLimitingService.recordAttempt).toHaveBeenCalledWith(
        mockRegistrationData.email.toLowerCase(),
        'register',
        mockRegistrationData.ipAddress
      );

      // Should not proceed to user creation
      expect(mockDatabaseService.query).not.toHaveBeenCalled();
    });

    it('should handle existing user email', async () => {
      // Arrange
      mockDatabaseService.query
        .mockResolvedValueOnce({ rows: [{ id: 'existing-user', email_verified: true }], rowCount: 1 }); // Existing user found

      // Act & Assert
      await expect(AuthService.registerUser(mockRegistrationData))
        .rejects.toThrow('If this email is available, you will receive a verification email shortly.');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Registration attempt with existing email',
        expect.objectContaining({
          email: mockRegistrationData.email.toLowerCase(),
          ipAddress: mockRegistrationData.ipAddress
        })
      );

      // Should not proceed to user creation
      expect(mockDatabaseService.query).toHaveBeenCalledTimes(1); // Only the check query
    });

    it('should validate email format', async () => {
      // Test invalid email format
      const invalidEmailData = { ...mockRegistrationData, email: 'invalid-email' };
      
      await expect(AuthService.registerUser(invalidEmailData))
        .rejects.toThrow('Email validation failed');
    });

    it('should validate password strength for registration', async () => {
      // Test weak password
      const weakPasswordData = { ...mockRegistrationData, password: '123' };
      
      await expect(AuthService.registerUser(weakPasswordData))
        .rejects.toThrow('Password validation failed');

      // Test password with insufficient complexity
      const simplePasswordData = { ...mockRegistrationData, password: 'password' };
      
      await expect(AuthService.registerUser(simplePasswordData))
        .rejects.toThrow('Password validation failed');
    });

    it('should validate names for registration', async () => {
      // Test empty names
      const emptyNameData = { ...mockRegistrationData, firstName: '', lastName: '' };
      
      await expect(AuthService.registerUser(emptyNameData))
        .rejects.toThrow('Name validation failed');

      // Test names with invalid characters
      const invalidNameData = { ...mockRegistrationData, firstName: 'John123', lastName: 'Doe@#$' };
      
      await expect(AuthService.registerUser(invalidNameData))
        .rejects.toThrow('Name validation failed');
    });

    it('should handle verification token generation failure', async () => {
      // Arrange
      const tokenError = new Error('Token generation failed');
      mockEmailVerificationService.generateVerificationToken.mockRejectedValue(tokenError);

      // Act & Assert
      await expect(AuthService.registerUser(mockRegistrationData))
        .rejects.toThrow('Token generation failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'User registration failed',
        expect.objectContaining({
          email: mockRegistrationData.email.toLowerCase(),
          error: 'Token generation failed'
        })
      );
    });

    it('should handle email sending failure', async () => {
      // Arrange
      const emailService = (AuthService as any).emailService;
      const emailError = new Error('Email service unavailable');
      emailService.sendVerificationEmail.mockRejectedValue(emailError);

      // Act & Assert
      await expect(AuthService.registerUser(mockRegistrationData))
        .rejects.toThrow('Email service unavailable');
    });

    it('should normalize email to lowercase', async () => {
      // Arrange
      const upperCaseEmailData = { ...mockRegistrationData, email: 'TEST@EXAMPLE.COM' };

      // Act
      await AuthService.registerUser(upperCaseEmailData);

      // Assert
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, email_verified FROM users WHERE email = $1'),
        ['test@example.com']
      );

      expect(mockRateLimitingService.checkRateLimit).toHaveBeenCalledWith(
        'test@example.com',
        'register',
        mockRegistrationData.ipAddress
      );
    });

    it('should trim whitespace from names', async () => {
      // Arrange
      const whitespaceNameData = {
        ...mockRegistrationData,
        firstName: '  John  ',
        lastName: '  Doe  '
      };

      // Act
      await AuthService.registerUser(whitespaceNameData);

      // Assert
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO users'),
        expect.arrayContaining([
          expect.any(String), // email
          expect.any(String), // password hash
          'John', // trimmed firstName
          'Doe',  // trimmed lastName
          expect.any(String), // role
          expect.any(Boolean) // email_verified
        ])
      );
    });
  });

  describe('validateRegistrationPassword', () => {
    it('should validate strong passwords', () => {
      const strongPasswords = [
        'SecurePass123!',
        'MyP@ssw0rd2024',
        'C0mpl3x!P@ssw0rd',
        'Str0ng&S3cur3P@ss'
      ];

      strongPasswords.forEach(password => {
        const result = AuthService.validateRegistrationPassword(password);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(['good', 'strong']).toContain(result.strength);
        expect(result.score).toBeGreaterThanOrEqual(60);
      });
    });

    it('should reject weak passwords', () => {
      const weakPasswords = [
        '123',
        'password',
        'Password',
        'Password1',
        'ALLUPPERCASE123!',
        'alllowercase123!',
        'NoNumbers!',
        'NoSpecialChars123'
      ];

      weakPasswords.forEach(password => {
        const result = AuthService.validateRegistrationPassword(password);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    it('should detect common patterns and sequences', () => {
      const patternPasswords = [
        'Password123',
        'qwerty123!',
        'abcdef123!',
        'aaaaaa123!',
        '123456789!A'
      ];

      patternPasswords.forEach(password => {
        const result = AuthService.validateRegistrationPassword(password);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(error => 
          error.includes('pattern') || 
          error.includes('sequence') || 
          error.includes('repeated')
        )).toBe(true);
      });
    });

    it('should provide detailed error messages', () => {
      const result = AuthService.validateRegistrationPassword('weak');
      
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('8 characters'),
          expect.stringContaining('uppercase'),
          expect.stringContaining('number'),
          expect.stringContaining('special character')
        ])
      );
    });
  });

  describe('validateRegistrationEmail', () => {
    beforeEach(() => {
      mockEmailVerificationService.getRegistrationSettings.mockResolvedValue({
        id: 'settings-1',
        requireAdminApproval: false,
        allowedEmailDomains: null,
        maxRegistrationsPerDay: 100,
        verificationTokenExpiryHours: 24,
        updatedAt: new Date()
      });
    });

    it('should validate correct email formats', async () => {
      const validEmails = [
        'user@example.com',
        'test.email@domain.org',
        'user+tag@company.co.uk',
        'firstname.lastname@subdomain.example.com'
      ];

      for (const email of validEmails) {
        const result = await AuthService.validateRegistrationEmail(email);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }
    });

    it('should reject invalid email formats', async () => {
      const invalidEmails = [
        'invalid-email',
        '@domain.com',
        'user@',
        'user..double.dot@domain.com',
        'user@domain',
        ''
      ];

      for (const email of invalidEmails) {
        const result = await AuthService.validateRegistrationEmail(email);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Invalid email format');
      }
    });

    it('should enforce domain restrictions when configured', async () => {
      // Arrange
      mockEmailVerificationService.getRegistrationSettings.mockResolvedValue({
        id: 'settings-1',
        requireAdminApproval: false,
        allowedEmailDomains: ['company.com', 'partner.org'],
        maxRegistrationsPerDay: 100,
        verificationTokenExpiryHours: 24,
        updatedAt: new Date()
      });

      // Test allowed domains
      const allowedEmails = ['user@company.com', 'test@partner.org', 'admin@sub.company.com'];
      for (const email of allowedEmails) {
        const result = await AuthService.validateRegistrationEmail(email);
        expect(result.isValid).toBe(true);
      }

      // Test blocked domains
      const blockedEmails = ['user@external.com', 'test@other.org'];
      for (const email of blockedEmails) {
        const result = await AuthService.validateRegistrationEmail(email);
        expect(result.isValid).toBe(false);
        expect(result.errors[0]).toContain('not allowed');
      }
    });

    it('should detect temporary email domains', async () => {
      const tempEmails = [
        'user@10minutemail.com',
        'test@guerrillamail.com',
        'temp@mailinator.com'
      ];

      for (const email of tempEmails) {
        const result = await AuthService.validateRegistrationEmail(email);
        expect(result.isValid).toBe(false);
        expect(result.errors[0]).toContain('Temporary email addresses are not allowed');
      }
    });

    it('should suggest corrections for common typos', async () => {
      const typoEmails = [
        'user@gmial.com',
        'test@gmai.com',
        'admin@yahooo.com'
      ];

      const expectedSuggestions = [
        'user@gmail.com',
        'test@gmail.com',
        'admin@yahoo.com'
      ];

      for (let i = 0; i < typoEmails.length; i++) {
        const result = await AuthService.validateRegistrationEmail(typoEmails[i]);
        expect(result.isValid).toBe(false);
        expect(result.errors[0]).toContain(expectedSuggestions[i]);
      }
    });
  });

  describe('validateRegistrationNames', () => {
    it('should validate correct names', () => {
      const validNames = [
        ['John', 'Doe'],
        ['Mary-Jane', 'Smith'],
        ["O'Connor", 'Johnson'],
        ['Jean-Luc', 'Picard'],
        ['José', 'García'],
        ['Anne Marie', 'Van Der Berg']
      ];

      validNames.forEach(([firstName, lastName]) => {
        const result = AuthService.validateRegistrationNames(firstName, lastName);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    it('should reject empty or missing names', () => {
      const invalidNames = [
        ['', 'Doe'],
        ['John', ''],
        ['   ', 'Doe'],
        ['John', '   '],
        [null as any, 'Doe'],
        ['John', null as any]
      ];

      invalidNames.forEach(([firstName, lastName]) => {
        const result = AuthService.validateRegistrationNames(firstName, lastName);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    it('should reject names with invalid characters', () => {
      const invalidNames = [
        ['John123', 'Doe'],
        ['John', 'Doe@#$'],
        ['John<script>', 'Doe'],
        ['John', 'Doe&Co']
      ];

      invalidNames.forEach(([firstName, lastName]) => {
        const result = AuthService.validateRegistrationNames(firstName, lastName);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(error => error.includes('can only contain'))).toBe(true);
      });
    });

    it('should detect suspicious name patterns', () => {
      const suspiciousNames = [
        ['test', 'user'],
        ['admin', 'admin'],
        ['123456', '789012'],
        ['aaaa', 'bbbb'],
        ['first', 'last'],
        ['fname', 'lname']
      ];

      suspiciousNames.forEach(([firstName, lastName]) => {
        const result = AuthService.validateRegistrationNames(firstName, lastName);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(error => error.includes('real first and last name'))).toBe(true);
      });
    });

    it('should enforce length limits', () => {
      const longName = 'a'.repeat(51);
      
      const result = AuthService.validateRegistrationNames(longName, 'Doe');
      expect(result.isValid).toBe(false);
      expect(result.errors.some(error => error.includes('between 1 and 50 characters'))).toBe(true);
    });

    it('should trim whitespace before validation', () => {
      const result = AuthService.validateRegistrationNames('  John  ', '  Doe  ');
      expect(result.isValid).toBe(true);
    });
  });
});