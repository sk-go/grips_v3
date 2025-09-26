import { AuthService, PasswordValidationResult, CreateUserRequest } from '../services/auth';
import { DatabaseService } from '../services/database';
import { RedisService } from '../services/redis';
import { QueryResult } from '../types/database';

// Mock dependencies
jest.mock('../services/database');
jest.mock('../services/redis');
jest.mock('../utils/logger');

const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;
const mockRedisService = RedisService as jest.Mocked<typeof RedisService>;

// Helper function to create mock QueryResult
const createMockQueryResult = (rows: any[], rowCount?: number): QueryResult => ({
  rows,
  rowCount: rowCount ?? rows.length,
  fields: []
});

describe('AuthService Enhanced Features', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Password Validation', () => {
    test('should validate strong password', () => {
      const result = AuthService.validatePassword('StrongP@ssw0rd123');
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.strength).toBe('strong');
      expect(result.score).toBeGreaterThan(80);
    });

    test('should reject weak password', () => {
      const result = AuthService.validatePassword('weak');
      
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.strength).toBe('weak');
      expect(result.score).toBeLessThan(40);
    });

    test('should require minimum length', () => {
      const result = AuthService.validatePassword('Short1!');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters long');
    });

    test('should require uppercase letter', () => {
      const result = AuthService.validatePassword('lowercase123!');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one uppercase letter');
    });

    test('should require lowercase letter', () => {
      const result = AuthService.validatePassword('UPPERCASE123!');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one lowercase letter');
    });

    test('should require number', () => {
      const result = AuthService.validatePassword('NoNumbers!');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one number');
    });

    test('should require special character', () => {
      const result = AuthService.validatePassword('NoSpecialChars123');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one special character');
    });

    test('should reject password exceeding maximum length', () => {
      const longPassword = 'A'.repeat(130) + '1!';
      const result = AuthService.validatePassword(longPassword);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must not exceed 128 characters');
    });

    test('should penalize common patterns', () => {
      const result = AuthService.validatePassword('Password123!');
      
      expect(result.score).toBeLessThan(80); // Should be penalized for containing "password"
    });
  });

  describe('Email Validation', () => {
    test('should validate correct email format', () => {
      expect(AuthService.validateEmail('user@example.com')).toBe(true);
      expect(AuthService.validateEmail('test.email+tag@domain.co.uk')).toBe(true);
    });

    test('should reject invalid email formats', () => {
      expect(AuthService.validateEmail('invalid-email')).toBe(false);
      expect(AuthService.validateEmail('user@')).toBe(false);
      expect(AuthService.validateEmail('@domain.com')).toBe(false);
      expect(AuthService.validateEmail('user@domain')).toBe(false);
    });

    test('should reject email exceeding maximum length', () => {
      const longEmail = 'a'.repeat(250) + '@example.com';
      expect(AuthService.validateEmail(longEmail)).toBe(false);
    });
  });

  describe('Rate Limiting', () => {
    test('should allow login when under rate limit', async () => {
      mockRedisService.get.mockResolvedValueOnce(null); // No lockout
      mockRedisService.get.mockResolvedValueOnce('2'); // 2 attempts

      const result = await AuthService.checkRateLimit('user@example.com', '192.168.1.1');

      expect(result.isLimited).toBe(false);
      expect(result.remainingAttempts).toBe(3); // 5 - 2 = 3
    });

    test('should block login when rate limit exceeded', async () => {
      mockRedisService.get.mockResolvedValueOnce(null); // No existing lockout
      mockRedisService.get.mockResolvedValueOnce('5'); // 5 attempts (at limit)
      mockRedisService.set.mockResolvedValueOnce(undefined);
      mockRedisService.del.mockResolvedValueOnce(undefined);

      const result = await AuthService.checkRateLimit('user@example.com', '192.168.1.1');

      expect(result.isLimited).toBe(true);
      expect(result.lockoutTime).toBeDefined();
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'login_lockout:user@example.com:192.168.1.1',
        expect.any(String),
        1800 // 30 minutes
      );
    });

    test('should respect existing lockout', async () => {
      const lockoutTime = Date.now().toString();
      mockRedisService.get.mockResolvedValueOnce(lockoutTime);

      const result = await AuthService.checkRateLimit('user@example.com', '192.168.1.1');

      expect(result.isLimited).toBe(true);
      expect(result.lockoutTime).toBe(parseInt(lockoutTime));
    });
  });

  describe('Enhanced User Creation', () => {
    test('should create user with valid data', async () => {
      const userData: CreateUserRequest = {
        email: 'newuser@example.com',
        password: 'StrongP@ssw0rd123',
        firstName: 'John',
        lastName: 'Doe',
        role: 'agent'
      };

      mockDatabaseService.query
        .mockResolvedValueOnce(createMockQueryResult([])) // No existing user
        .mockResolvedValueOnce(createMockQueryResult([{
          id: 'user-123',
          email: 'newuser@example.com',
          first_name: 'John',
          last_name: 'Doe',
          role: 'agent',
          is_active: true,
          email_verified: false,
          created_at: new Date()
        }]));

      const user = await AuthService.createUser(userData);

      expect(user.id).toBe('user-123');
      expect(user.email).toBe('newuser@example.com');
      expect(user.firstName).toBe('John');
      expect(user.lastName).toBe('Doe');
      expect(user.role).toBe('agent');
      expect(user.emailVerified).toBe(false);
    });

    test('should reject user creation with invalid email', async () => {
      const userData: CreateUserRequest = {
        email: 'invalid-email',
        password: 'StrongP@ssw0rd123',
        firstName: 'John',
        lastName: 'Doe'
      };

      await expect(AuthService.createUser(userData)).rejects.toThrow('Invalid email format');
    });

    test('should reject user creation with weak password', async () => {
      const userData: CreateUserRequest = {
        email: 'user@example.com',
        password: 'weak',
        firstName: 'John',
        lastName: 'Doe'
      };

      await expect(AuthService.createUser(userData)).rejects.toThrow('Password validation failed');
    });

    test('should reject duplicate email', async () => {
      const userData: CreateUserRequest = {
        email: 'existing@example.com',
        password: 'StrongP@ssw0rd123',
        firstName: 'John',
        lastName: 'Doe'
      };

      mockDatabaseService.query.mockResolvedValueOnce(
        createMockQueryResult([{ id: 'existing-user' }])
      );

      await expect(AuthService.createUser(userData)).rejects.toThrow('User with this email already exists');
    });
  });

  describe('Enhanced Authentication', () => {
    test('should authenticate user with rate limiting check', async () => {
      // Mock rate limiting check
      mockRedisService.get.mockResolvedValueOnce(null); // No lockout
      mockRedisService.get.mockResolvedValueOnce('1'); // 1 attempt

      // Mock user lookup
      mockDatabaseService.query.mockResolvedValueOnce(createMockQueryResult([{
        id: 'user-123',
        email: 'user@example.com',
        password_hash: '$2a$12$hashedpassword',
        first_name: 'John',
        last_name: 'Doe',
        role: 'agent',
        is_active: true,
        email_verified: true,
        keycloak_id: null
      }]));

      // Mock password comparison
      jest.spyOn(AuthService, 'comparePassword').mockResolvedValueOnce(true);

      // Mock Redis operations for successful login
      mockRedisService.del.mockResolvedValueOnce(undefined);
      mockRedisService.set.mockResolvedValueOnce(undefined);

      const result = await AuthService.authenticateUser('user@example.com', 'password123', '192.168.1.1');

      expect(result.user.id).toBe('user-123');
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    test('should reject authentication when rate limited', async () => {
      const lockoutTime = Date.now() + 30 * 60 * 1000; // 30 minutes from now
      mockRedisService.get.mockResolvedValueOnce(lockoutTime.toString());

      await expect(
        AuthService.authenticateUser('user@example.com', 'password123', '192.168.1.1')
      ).rejects.toThrow('Too many failed attempts');
    });

    test('should handle user without password hash', async () => {
      mockRedisService.get.mockResolvedValueOnce(null); // No lockout
      mockRedisService.get.mockResolvedValueOnce('1'); // 1 attempt

      mockDatabaseService.query.mockResolvedValueOnce(createMockQueryResult([{
        id: 'user-123',
        email: 'user@example.com',
        password_hash: null, // No password set (legacy user)
        first_name: 'John',
        last_name: 'Doe',
        role: 'agent',
        is_active: true,
        email_verified: true,
        keycloak_id: null
      }]));

      mockRedisService.set.mockResolvedValueOnce(undefined); // Record failed attempt

      await expect(
        AuthService.authenticateUser('user@example.com', 'password123', '192.168.1.1')
      ).rejects.toThrow('Password not set. Please reset your password.');
    });
  });

  describe('Password Change', () => {
    test('should change password successfully', async () => {
      mockDatabaseService.query
        .mockResolvedValueOnce(createMockQueryResult([{
          password_hash: '$2a$12$oldhash'
        }]))
        .mockResolvedValueOnce(createMockQueryResult([])); // Update query

      jest.spyOn(AuthService, 'comparePassword')
        .mockResolvedValueOnce(true) // Old password correct
        .mockResolvedValueOnce(false); // New password different

      mockRedisService.del.mockResolvedValueOnce(undefined);

      await expect(
        AuthService.changePassword('user-123', 'oldPassword', 'NewStrongP@ssw0rd123')
      ).resolves.not.toThrow();

      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET password_hash'),
        expect.any(Array)
      );
    });

    test('should reject password change with incorrect old password', async () => {
      mockDatabaseService.query.mockResolvedValueOnce(createMockQueryResult([{
        password_hash: '$2a$12$oldhash'
      }]));

      jest.spyOn(AuthService, 'comparePassword').mockResolvedValueOnce(false);

      await expect(
        AuthService.changePassword('user-123', 'wrongPassword', 'NewStrongP@ssw0rd123')
      ).rejects.toThrow('Current password is incorrect');
    });

    test('should reject password change when new password is same as old', async () => {
      mockDatabaseService.query.mockResolvedValueOnce(createMockQueryResult([{
        password_hash: '$2a$12$oldhash'
      }]));

      jest.spyOn(AuthService, 'comparePassword')
        .mockResolvedValueOnce(true) // Old password correct
        .mockResolvedValueOnce(true); // New password same as old

      await expect(
        AuthService.changePassword('user-123', 'StrongP@ssw0rd123', 'StrongP@ssw0rd123')
      ).rejects.toThrow('New password must be different from current password');
    });
  });

  describe('User Profile Updates', () => {
    test('should update user profile successfully', async () => {
      mockDatabaseService.query
        .mockResolvedValueOnce(createMockQueryResult([])) // No email conflict
        .mockResolvedValueOnce(createMockQueryResult([{
          id: 'user-123',
          email: 'newemail@example.com',
          first_name: 'Jane',
          last_name: 'Smith',
          role: 'agent',
          is_active: true,
          email_verified: false,
          keycloak_id: null
        }]));

      const updates = {
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'newemail@example.com'
      };

      const user = await AuthService.updateUserProfile('user-123', updates);

      expect(user.firstName).toBe('Jane');
      expect(user.lastName).toBe('Smith');
      expect(user.email).toBe('newemail@example.com');
    });

    test('should reject email update if email is taken', async () => {
      mockDatabaseService.query.mockResolvedValueOnce(
        createMockQueryResult([{ id: 'other-user' }]) // Email already exists
      );

      const updates = { email: 'taken@example.com' };

      await expect(
        AuthService.updateUserProfile('user-123', updates)
      ).rejects.toThrow('Email is already taken');
    });

    test('should reject invalid email format in update', async () => {
      const updates = { email: 'invalid-email' };

      await expect(
        AuthService.updateUserProfile('user-123', updates)
      ).rejects.toThrow('Invalid email format');
    });
  });
});