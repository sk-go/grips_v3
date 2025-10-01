import { AuthService } from '../services/auth';
import { EmailVerificationService } from '../services/emailVerificationService';
import { RateLimitingService } from '../services/rateLimitingService';
import { DatabaseService } from '../services/database';
import { RedisService } from '../services/redis';

// Mock dependencies
jest.mock('../services/database');
jest.mock('../services/redis');
jest.mock('../services/emailVerificationService');
jest.mock('../services/rateLimitingService');
jest.mock('../services/email/emailNotificationService');

const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;
const mockRedisService = RedisService as jest.Mocked<typeof RedisService>;
const mockEmailVerificationService = EmailVerificationService as jest.Mocked<typeof EmailVerificationService>;
const mockRateLimitingService = RateLimitingService as jest.Mocked<typeof RateLimitingService>;

describe('AuthService Registration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mocks
    mockRateLimitingService.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 5,
      resetTime: Date.now() + 3600000,
      totalHits: 0
    });
    
    mockRateLimitingService.recordAttempt.mockResolvedValue();
    
    mockEmailVerificationService.getRegistrationSettings.mockResolvedValue({
      id: 'settings-1',
      requireAdminApproval: false,
      allowedEmailDomains: null,
      maxRegistrationsPerDay: 100,
      verificationTokenExpiryHours: 24,
      updatedAt: new Date()
    });
    
    mockEmailVerificationService.generateVerificationToken.mockResolvedValue('mock-token-123');
    
    mockDatabaseService.query.mockImplementation((query: string) => {
      if (query.includes('SELECT id, email_verified FROM users WHERE email')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (query.includes('SELECT id FROM users WHERE email')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (query.includes('INSERT INTO users')) {
        return Promise.resolve({
          rows: [{
            id: 'user-123',
            email: 'john.doe@example.com',
            first_name: 'John',
            last_name: 'Doe',
            role: 'agent',
            is_active: true,
            email_verified: false,
            created_at: new Date()
          }],
          rowCount: 1
        });
      }
      if (query.includes('INSERT INTO registration_audit_log')) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  });

  describe('registerUser', () => {
    it('should successfully register a new user', async () => {
      const registrationData = {
        email: 'john.doe@example.com',
        password: 'SecurePass123!',
        firstName: 'John',
        lastName: 'Doe',
        role: 'agent' as const,
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      };

      const result = await AuthService.registerUser(registrationData);

      expect(result.success).toBe(true);
      expect(result.userId).toBe('user-123');
      expect(result.requiresVerification).toBe(true);
      expect(result.requiresApproval).toBe(false);
      expect(result.message).toContain('Registration successful');
      expect(result.user).toBeDefined();
      expect(result.user?.email).toBe('john.doe@example.com');
    });

    it('should reject registration with weak password', async () => {
      const registrationData = {
        email: 'jane.smith@example.com',
        password: 'weak',
        firstName: 'Jane',
        lastName: 'Smith'
      };

      await expect(AuthService.registerUser(registrationData))
        .rejects.toThrow(/Password validation failed/);
    });

    it('should reject registration with invalid email', async () => {
      const registrationData = {
        email: 'invalid-email',
        password: 'SecurePass123!',
        firstName: 'Jane',
        lastName: 'Smith'
      };

      await expect(AuthService.registerUser(registrationData))
        .rejects.toThrow(/Email validation failed/);
    });

    it('should reject registration when rate limited', async () => {
      mockRateLimitingService.checkRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetTime: Date.now() + 3600000,
        totalHits: 5,
        retryAfter: 3600
      });

      const registrationData = {
        email: 'jane.smith@example.com',
        password: 'SecurePass123!',
        firstName: 'Jane',
        lastName: 'Smith'
      };

      await expect(AuthService.registerUser(registrationData))
        .rejects.toThrow(/Registration rate limit exceeded/);
    });

    it('should reject registration with existing email', async () => {
      mockDatabaseService.query.mockImplementation((query: string) => {
        if (query.includes('SELECT id, email_verified FROM users WHERE email')) {
          return Promise.resolve({
            rows: [{ id: 'existing-user', email_verified: true }],
            rowCount: 1
          });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      const registrationData = {
        email: 'existing@example.com',
        password: 'SecurePass123!',
        firstName: 'Jane',
        lastName: 'Smith'
      };

      await expect(AuthService.registerUser(registrationData))
        .rejects.toThrow(/If this email is available/);
    });
  });

  describe('validateRegistrationPassword', () => {
    it('should accept strong password', () => {
      const result = AuthService.validateRegistrationPassword('SecurePass123!');
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.strength).toBe('strong');
      expect(result.score).toBeGreaterThan(80);
    });

    it('should reject weak password', () => {
      const result = AuthService.validateRegistrationPassword('weak');
      
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.strength).toBe('weak');
    });

    it('should reject password with repeated characters', () => {
      const result = AuthService.validateRegistrationPassword('Aaaa1111!');
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('repeated characters'))).toBe(true);
    });

    it('should reject common passwords', () => {
      const result = AuthService.validateRegistrationPassword('password');
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('common word'))).toBe(true);
    });
  });

  describe('validateRegistrationNames', () => {
    it('should accept valid names', () => {
      const result = AuthService.validateRegistrationNames('John', 'Doe');
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject empty names', () => {
      const result = AuthService.validateRegistrationNames('', '');
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('required'))).toBe(true);
    });

    it('should reject suspicious names', () => {
      const result = AuthService.validateRegistrationNames('test', 'user');
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('real first and last name'))).toBe(true);
    });

    it('should reject names with invalid characters', () => {
      const result = AuthService.validateRegistrationNames('John123', 'Doe456');
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('can only contain letters'))).toBe(true);
    });
  });
});