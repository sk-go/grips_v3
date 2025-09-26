import { AuthService, PasswordValidationResult, CreateUserRequest } from '../services/auth';
import { PasswordResetService } from '../services/passwordResetService';
import { DatabaseService } from '../services/database';
import { RedisService } from '../services/redis';
import { QueryResult } from '../types/database';
import * as bcrypt from 'bcryptjs';

// Mock dependencies
jest.mock('../services/database');
jest.mock('../services/redis');
jest.mock('../utils/logger');
jest.mock('../services/email/emailNotificationService');

const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;
const mockRedisService = RedisService as jest.Mocked<typeof RedisService>;

// Helper function to create mock QueryResult
const createMockQueryResult = (rows: any[], rowCount?: number): QueryResult => ({
  rows,
  rowCount: rowCount ?? rows.length,
  fields: []
});

describe('AuthService Comprehensive Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Password Hashing and Validation', () => {
    describe('hashPassword', () => {
      test('should hash password with bcrypt', async () => {
        const password = 'TestPassword123!';
        const hash = await AuthService.hashPassword(password);
        
        expect(hash).toBeDefined();
        expect(hash).not.toBe(password);
        expect(hash.startsWith('$2a$12$')).toBe(true);
      });

      test('should generate different hashes for same password', async () => {
        const password = 'TestPassword123!';
        const hash1 = await AuthService.hashPassword(password);
        const hash2 = await AuthService.hashPassword(password);
        
        expect(hash1).not.toBe(hash2);
      });
    });

    describe('comparePassword', () => {
      test('should return true for correct password', async () => {
        const password = 'TestPassword123!';
        const hash = await bcrypt.hash(password, 12);
        
        const result = await AuthService.comparePassword(password, hash);
        expect(result).toBe(true);
      });

      test('should return false for incorrect password', async () => {
        const password = 'TestPassword123!';
        const wrongPassword = 'WrongPassword123!';
        const hash = await bcrypt.hash(password, 12);
        
        const result = await AuthService.comparePassword(wrongPassword, hash);
        expect(result).toBe(false);
      });
    });

    describe('validatePassword', () => {
      test('should validate strong password', () => {
        const result = AuthService.validatePassword('StrongP@ssw0rd123');
        
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.strength).toBe('strong');
        expect(result.score).toBeGreaterThan(80);
      });

      test('should reject password too short', () => {
        const result = AuthService.validatePassword('Short1!');
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Password must be at least 8 characters long');
        expect(result.strength).toBe('weak');
      });

      test('should reject password too long', () => {
        const longPassword = 'A'.repeat(130) + '1!';
        const result = AuthService.validatePassword(longPassword);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Password must not exceed 128 characters');
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

      test('should penalize common patterns', () => {
        const commonPasswords = [
          'Password123!',
          'Admin123!',
          'User123!',
          'Login123!'
        ];

        commonPasswords.forEach(password => {
          const result = AuthService.validatePassword(password);
          expect(result.score).toBeLessThan(80);
        });
      });

      test('should penalize repeated characters', () => {
        const result = AuthService.validatePassword('Aaaa1111!!!!');
        expect(result.score).toBeLessThan(60);
      });

      test('should give bonus for longer passwords', () => {
        const shortPassword = AuthService.validatePassword('Strong1!');
        const longPassword = AuthService.validatePassword('VeryLongStrongPassword1!');
        
        expect(longPassword.score).toBeGreaterThan(shortPassword.score);
      });

      test('should handle edge cases', () => {
        expect(AuthService.validatePassword('')).toMatchObject({
          isValid: false,
          strength: 'weak'
        });
        
        expect(AuthService.validatePassword('a')).toMatchObject({
          isValid: false,
          strength: 'weak'
        });
      });
    });

    describe('validateEmail', () => {
      test('should validate correct email formats', () => {
        const validEmails = [
          'user@example.com',
          'test.email+tag@domain.co.uk',
          'user123@test-domain.org',
          'firstname.lastname@company.com'
        ];

        validEmails.forEach(email => {
          expect(AuthService.validateEmail(email)).toBe(true);
        });
      });

      test('should reject invalid email formats', () => {
        const invalidEmails = [
          'invalid-email',
          'user@',
          '@domain.com',
          'user@domain',
          'user..double.dot@domain.com',
          'user@domain..com',
          ''
        ];

        invalidEmails.forEach(email => {
          expect(AuthService.validateEmail(email)).toBe(false);
        });
      });

      test('should reject email exceeding maximum length', () => {
        const longEmail = 'a'.repeat(250) + '@example.com';
        expect(AuthService.validateEmail(longEmail)).toBe(false);
      });
    });
  });

  describe('Rate Limiting', () => {
    describe('checkRateLimit', () => {
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

      test('should handle rate limiting without IP address', async () => {
        mockRedisService.get.mockResolvedValueOnce(null); // No lockout
        mockRedisService.get.mockResolvedValueOnce('3'); // 3 attempts

        const result = await AuthService.checkRateLimit('user@example.com');

        expect(result.isLimited).toBe(false);
        expect(result.remainingAttempts).toBe(2);
      });
    });

    describe('recordLoginAttempt', () => {
      test('should clear attempts on successful login', async () => {
        mockRedisService.del.mockResolvedValueOnce(undefined);

        await AuthService.recordLoginAttempt('user@example.com', true, '192.168.1.1');

        expect(mockRedisService.del).toHaveBeenCalledWith('login_attempts:user@example.com:192.168.1.1');
        expect(mockRedisService.del).toHaveBeenCalledWith('login_lockout:user@example.com:192.168.1.1');
      });

      test('should increment attempts on failed login', async () => {
        mockRedisService.get.mockResolvedValueOnce('2'); // 2 existing attempts
        mockRedisService.set.mockResolvedValueOnce(undefined);

        await AuthService.recordLoginAttempt('user@example.com', false, '192.168.1.1');

        expect(mockRedisService.set).toHaveBeenCalledWith(
          'login_attempts:user@example.com:192.168.1.1',
          '3',
          900 // 15 minutes
        );
      });

      test('should handle first failed attempt', async () => {
        mockRedisService.get.mockResolvedValueOnce(null); // No existing attempts
        mockRedisService.set.mockResolvedValueOnce(undefined);

        await AuthService.recordLoginAttempt('user@example.com', false, '192.168.1.1');

        expect(mockRedisService.set).toHaveBeenCalledWith(
          'login_attempts:user@example.com:192.168.1.1',
          '1',
          900
        );
      });
    });
  });

  describe('JWT Token Management', () => {
    const mockPayload = {
      userId: 'user-123',
      email: 'user@example.com',
      role: 'agent'
    };

    describe('generateAccessToken', () => {
      test('should generate valid JWT access token', () => {
        const token = AuthService.generateAccessToken(mockPayload);
        
        expect(token).toBeDefined();
        expect(typeof token).toBe('string');
        expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
      });

      test('should include correct claims in token', () => {
        const token = AuthService.generateAccessToken(mockPayload);
        const decoded = AuthService.verifyAccessToken(token);
        
        expect(decoded.userId).toBe(mockPayload.userId);
        expect(decoded.email).toBe(mockPayload.email);
        expect(decoded.role).toBe(mockPayload.role);
      });
    });

    describe('generateRefreshToken', () => {
      test('should generate valid JWT refresh token', () => {
        const token = AuthService.generateRefreshToken(mockPayload);
        
        expect(token).toBeDefined();
        expect(typeof token).toBe('string');
        expect(token.split('.')).toHaveLength(3);
      });
    });

    describe('verifyAccessToken', () => {
      test('should verify valid access token', () => {
        const token = AuthService.generateAccessToken(mockPayload);
        const decoded = AuthService.verifyAccessToken(token);
        
        expect(decoded.userId).toBe(mockPayload.userId);
        expect(decoded.email).toBe(mockPayload.email);
        expect(decoded.role).toBe(mockPayload.role);
      });

      test('should throw error for invalid token', () => {
        expect(() => {
          AuthService.verifyAccessToken('invalid.token.here');
        }).toThrow('Invalid or expired token');
      });

      test('should throw error for malformed token', () => {
        expect(() => {
          AuthService.verifyAccessToken('not-a-jwt-token');
        }).toThrow('Invalid or expired token');
      });
    });

    describe('verifyRefreshToken', () => {
      test('should verify valid refresh token', () => {
        const token = AuthService.generateRefreshToken(mockPayload);
        const decoded = AuthService.verifyRefreshToken(token);
        
        expect(decoded.userId).toBe(mockPayload.userId);
        expect(decoded.email).toBe(mockPayload.email);
        expect(decoded.role).toBe(mockPayload.role);
      });

      test('should throw error for invalid refresh token', () => {
        expect(() => {
          AuthService.verifyRefreshToken('invalid.token.here');
        }).toThrow('Invalid or expired refresh token');
      });
    });
  });

  describe('User Management', () => {
    describe('createUser', () => {
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

      test('should default role to agent', async () => {
        const userData: CreateUserRequest = {
          email: 'newuser@example.com',
          password: 'StrongP@ssw0rd123',
          firstName: 'John',
          lastName: 'Doe'
          // No role specified
        };

        mockDatabaseService.query
          .mockResolvedValueOnce(createMockQueryResult([]))
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
        expect(user.role).toBe('agent');
      });
    });

    describe('getUserById', () => {
      test('should return user when found', async () => {
        mockDatabaseService.query.mockResolvedValueOnce(createMockQueryResult([{
          id: 'user-123',
          email: 'user@example.com',
          first_name: 'John',
          last_name: 'Doe',
          role: 'agent',
          is_active: true,
          email_verified: true,
          keycloak_id: null
        }]));

        const user = await AuthService.getUserById('user-123');

        expect(user).not.toBeNull();
        expect(user!.id).toBe('user-123');
        expect(user!.email).toBe('user@example.com');
        expect(user!.firstName).toBe('John');
        expect(user!.lastName).toBe('Doe');
      });

      test('should return null when user not found', async () => {
        mockDatabaseService.query.mockResolvedValueOnce(createMockQueryResult([]));

        const user = await AuthService.getUserById('nonexistent');

        expect(user).toBeNull();
      });
    });

    describe('updateUserProfile', () => {
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
          createMockQueryResult([{ id: 'other-user' }])
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

      test('should reject update with no fields', async () => {
        await expect(
          AuthService.updateUserProfile('user-123', {})
        ).rejects.toThrow('No valid fields to update');
      });
    });
  });
});