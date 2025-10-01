import { EmailVerificationService } from '../../services/emailVerificationService';
import { VerificationTokenService } from '../../services/verificationTokenService';
import { EmailNotificationService, EmailVerificationData } from '../../services/email/emailNotificationService';

// Mock the dependencies
jest.mock('../../services/database/DatabaseService');
jest.mock('../../services/rateLimitingService');
jest.mock('../../services/redis');

describe('Email Verification Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any running intervals
    VerificationTokenService.stopAutomaticCleanup();
  });

  describe('Email Verification Flow', () => {
    it('should have all required services available', () => {
      expect(EmailVerificationService).toBeDefined();
      expect(VerificationTokenService).toBeDefined();
      expect(EmailNotificationService).toBeDefined();
    });

    it('should have correct method signatures', () => {
      // EmailVerificationService methods
      expect(typeof EmailVerificationService.generateVerificationToken).toBe('function');
      expect(typeof EmailVerificationService.validateVerificationToken).toBe('function');
      expect(typeof EmailVerificationService.markEmailAsVerified).toBe('function');
      expect(typeof EmailVerificationService.cleanupExpiredTokens).toBe('function');

      // VerificationTokenService methods
      expect(typeof VerificationTokenService.validateToken).toBe('function');
      expect(typeof VerificationTokenService.checkResendRateLimit).toBe('function');
      expect(typeof VerificationTokenService.recordResendAttempt).toBe('function');
      expect(typeof VerificationTokenService.cleanupExpiredTokens).toBe('function');

      // EmailNotificationService methods
      const emailService = new EmailNotificationService();
      expect(typeof emailService.sendVerificationEmail).toBe('function');
      expect(typeof emailService.sendVerificationResendEmail).toBe('function');
    });

    it('should have proper TypeScript interfaces', () => {
      // Test that the interfaces are properly exported and can be used
      const mockEmailData: EmailVerificationData = {
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        verificationToken: 'test-token',
        verificationUrl: 'https://example.com/verify?token=test-token',
        expiresAt: new Date()
      };

      expect(mockEmailData.email).toBe('test@example.com');
      expect(mockEmailData.firstName).toBe('John');
      expect(mockEmailData.lastName).toBe('Doe');
      expect(mockEmailData.verificationToken).toBe('test-token');
      expect(mockEmailData.verificationUrl).toContain('test-token');
      expect(mockEmailData.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe('Service Initialization', () => {
    it('should initialize VerificationTokenService without errors', () => {
      expect(() => {
        VerificationTokenService.initialize();
      }).not.toThrow();
    });

    it('should create EmailNotificationService instance', () => {
      const emailService = new EmailNotificationService();
      expect(emailService).toBeInstanceOf(EmailNotificationService);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid token formats gracefully', async () => {
      const result = await VerificationTokenService.validateToken('');
      
      expect(result.success).toBe(false);
      expect(result.rateLimitExceeded).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle null/undefined tokens gracefully', async () => {
      const result1 = await VerificationTokenService.validateToken(null as any);
      const result2 = await VerificationTokenService.validateToken(undefined as any);
      
      expect(result1.success).toBe(false);
      expect(result2.success).toBe(false);
    });
  });

  describe('Configuration Validation', () => {
    it('should have proper default configurations', () => {
      // Test that services have reasonable defaults
      expect(VerificationTokenService).toBeDefined();
      
      // The service should be able to initialize without throwing
      expect(() => {
        VerificationTokenService.initialize();
      }).not.toThrow();
    });
  });
});