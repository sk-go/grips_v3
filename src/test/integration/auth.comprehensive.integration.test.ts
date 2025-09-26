import { AuthService } from '../../services/auth';
import { PasswordResetService } from '../../services/passwordResetService';
import { DatabaseService } from '../../services/database';
import { RedisService } from '../../services/redis';
import { QueryResult } from '../../types/database';

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

// Mock database client for transactions
const mockClient = {
  query: jest.fn(),
  release: jest.fn()
};

describe('Authentication System Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDatabaseService.getClient.mockResolvedValue(mockClient as any);
  });

  describe('Complete Login Flow', () => {
    test('should complete successful login flow with rate limiting', async () => {
      const email = 'user@example.com';
      const password = 'StrongP@ssw0rd123';
      const ipAddress = '192.168.1.1';

      // Mock rate limiting check (no lockout, 2 previous attempts)
      mockRedisService.get
        .mockResolvedValueOnce(null) // No lockout
        .mockResolvedValueOnce('2'); // 2 attempts

      // Mock user lookup
      mockDatabaseService.query.mockResolvedValueOnce(createMockQueryResult([{
        id: 'user-123',
        email: email,
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
      mockRedisService.del.mockResolvedValue(undefined);
      mockRedisService.set.mockResolvedValue(undefined);

      const result = await AuthService.authenticateUser(email, password, ipAddress);

      // Verify authentication result
      expect(result.user.id).toBe('user-123');
      expect(result.user.email).toBe(email);
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();

      // Verify rate limiting was checked
      expect(mockRedisService.get).toHaveBeenCalledWith('login_lockout:user@example.com:192.168.1.1');
      expect(mockRedisService.get).toHaveBeenCalledWith('login_attempts:user@example.com:192.168.1.1');

      // Verify successful login was recorded (attempts cleared)
      expect(mockRedisService.del).toHaveBeenCalledWith('login_attempts:user@example.com:192.168.1.1');
      expect(mockRedisService.del).toHaveBeenCalledWith('login_lockout:user@example.com:192.168.1.1');

      // Verify refresh token was stored
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'refresh_token:user-123',
        result.refreshToken,
        604800 // 7 days
      );
    });

    test('should handle failed login with rate limiting', async () => {
      const email = 'user@example.com';
      const password = 'wrongpassword';
      const ipAddress = '192.168.1.1';

      // Mock rate limiting check (no lockout, 3 previous attempts)
      mockRedisService.get
        .mockResolvedValueOnce(null) // No lockout
        .mockResolvedValueOnce('3'); // 3 attempts

      // Mock user lookup
      mockDatabaseService.query.mockResolvedValueOnce(createMockQueryResult([{
        id: 'user-123',
        email: email,
        password_hash: '$2a$12$hashedpassword',
        first_name: 'John',
        last_name: 'Doe',
        role: 'agent',
        is_active: true,
        email_verified: true,
        keycloak_id: null
      }]));

      // Mock password comparison (wrong password)
      jest.spyOn(AuthService, 'comparePassword').mockResolvedValueOnce(false);

      // Mock Redis operations for failed login
      mockRedisService.get.mockResolvedValueOnce('3'); // Current attempt count
      mockRedisService.set.mockResolvedValue(undefined);

      await expect(
        AuthService.authenticateUser(email, password, ipAddress)
      ).rejects.toThrow('Invalid credentials');

      // Verify failed attempt was recorded
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'login_attempts:user@example.com:192.168.1.1',
        '4',
        900 // 15 minutes
      );
    });

    test('should block login when rate limit exceeded', async () => {
      const email = 'user@example.com';
      const password = 'password123';
      const ipAddress = '192.168.1.1';

      // Mock rate limiting check (5 attempts, triggering lockout)
      mockRedisService.get
        .mockResolvedValueOnce(null) // No existing lockout
        .mockResolvedValueOnce('5'); // 5 attempts (at limit)

      mockRedisService.set.mockResolvedValue(undefined);
      mockRedisService.del.mockResolvedValue(undefined);

      await expect(
        AuthService.authenticateUser(email, password, ipAddress)
      ).rejects.toThrow('Too many failed attempts');

      // Verify lockout was set
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'login_lockout:user@example.com:192.168.1.1',
        expect.any(String),
        1800 // 30 minutes
      );
    });

    test('should handle inactive user login attempt', async () => {
      const email = 'inactive@example.com';
      const password = 'password123';
      const ipAddress = '192.168.1.1';

      // Mock rate limiting check
      mockRedisService.get
        .mockResolvedValueOnce(null) // No lockout
        .mockResolvedValueOnce('1'); // 1 attempt

      // Mock inactive user lookup
      mockDatabaseService.query.mockResolvedValueOnce(createMockQueryResult([{
        id: 'user-123',
        email: email,
        password_hash: '$2a$12$hashedpassword',
        first_name: 'John',
        last_name: 'Doe',
        role: 'agent',
        is_active: false, // Inactive user
        email_verified: true,
        keycloak_id: null
      }]));

      mockRedisService.set.mockResolvedValue(undefined);

      await expect(
        AuthService.authenticateUser(email, password, ipAddress)
      ).rejects.toThrow('Account is inactive');

      // Verify failed attempt was recorded
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'login_attempts:inactive@example.com:192.168.1.1',
        '2',
        900
      );
    });
  });

  describe('Complete Password Reset Flow', () => {
    test('should complete full password reset flow', async () => {
      const email = 'user@example.com';
      const newPassword = 'NewStrongP@ssw0rd123';
      const token = 'reset-token-123';
      const ipAddress = '192.168.1.1';

      // Step 1: Initiate password reset
      mockDatabaseService.query
        .mockResolvedValueOnce(createMockQueryResult([{
          id: 'user-123',
          email: email,
          is_active: true
        }])) // User lookup for token generation
        .mockResolvedValueOnce(createMockQueryResult([])) // Invalidate existing tokens
        .mockResolvedValueOnce(createMockQueryResult([])); // Insert new token

      await PasswordResetService.initiatePasswordReset(email, 'https://example.com');

      // Step 2: Validate token and complete reset
      mockDatabaseService.query.mockResolvedValueOnce(createMockQueryResult([{
        id: 'token-123',
        user_id: 'user-123',
        expires_at: new Date(Date.now() + 3600000), // 1 hour from now
        used_at: null,
        email: email,
        is_active: true
      }]));

      // Mock transaction operations
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce(createMockQueryResult([])) // Update password
        .mockResolvedValueOnce(createMockQueryResult([])) // Mark token as used
        .mockResolvedValueOnce(createMockQueryResult([])) // Invalidate other tokens
        .mockResolvedValueOnce(undefined); // COMMIT

      // Mock user lookup for notification
      mockDatabaseService.query.mockResolvedValueOnce(createMockQueryResult([{
        first_name: 'John'
      }]));

      await expect(
        PasswordResetService.completePasswordReset(token, newPassword, ipAddress)
      ).resolves.not.toThrow();

      // Verify transaction was used
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should reject password reset with invalid token', async () => {
      const token = 'invalid-token';
      const newPassword = 'NewStrongP@ssw0rd123';

      // Mock token validation (token not found)
      mockDatabaseService.query.mockResolvedValueOnce(createMockQueryResult([]));

      await expect(
        PasswordResetService.completePasswordReset(token, newPassword)
      ).rejects.toThrow('Invalid or expired reset token');
    });

    test('should reject password reset with expired token', async () => {
      const token = 'expired-token';
      const newPassword = 'NewStrongP@ssw0rd123';

      // Mock expired token
      mockDatabaseService.query.mockResolvedValueOnce(createMockQueryResult([{
        id: 'token-123',
        user_id: 'user-123',
        expires_at: new Date(Date.now() - 3600000), // 1 hour ago (expired)
        used_at: null,
        email: 'user@example.com',
        is_active: true
      }]));

      await expect(
        PasswordResetService.completePasswordReset(token, newPassword)
      ).rejects.toThrow('Reset token has expired');
    });

    test('should reject password reset with already used token', async () => {
      const token = 'used-token';
      const newPassword = 'NewStrongP@ssw0rd123';

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
        PasswordResetService.completePasswordReset(token, newPassword)
      ).rejects.toThrow('Reset token has already been used');
    });

    test('should handle password reset transaction failure', async () => {
      const token = 'valid-token';
      const newPassword = 'NewStrongP@ssw0rd123';

      // Mock valid token
      mockDatabaseService.query.mockResolvedValueOnce(createMockQueryResult([{
        id: 'token-123',
        user_id: 'user-123',
        expires_at: new Date(Date.now() + 3600000),
        used_at: null,
        email: 'user@example.com',
        is_active: true
      }]));

      // Mock transaction failure
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(new Error('Database error')); // Update password fails

      await expect(
        PasswordResetService.completePasswordReset(token, newPassword)
      ).rejects.toThrow('Failed to reset password');

      // Verify rollback was called
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('Token Refresh Flow', () => {
    test('should refresh tokens successfully', async () => {
      const userId = 'user-123';
      const refreshToken = AuthService.generateRefreshToken({
        userId,
        email: 'user@example.com',
        role: 'agent'
      });

      // Mock refresh token validation
      mockRedisService.get.mockResolvedValueOnce(refreshToken);

      // Mock user lookup
      mockDatabaseService.query.mockResolvedValueOnce(createMockQueryResult([{
        id: userId,
        email: 'user@example.com',
        first_name: 'John',
        last_name: 'Doe',
        role: 'agent',
        is_active: true
      }]));

      // Mock new refresh token storage
      mockRedisService.set.mockResolvedValue(undefined);

      const result = await AuthService.refreshTokens(refreshToken);

      expect(result.user.id).toBe(userId);
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.refreshToken).not.toBe(refreshToken); // Should be new token

      // Verify new refresh token was stored
      expect(mockRedisService.set).toHaveBeenCalledWith(
        `refresh_token:${userId}`,
        result.refreshToken,
        604800
      );
    });

    test('should reject refresh with invalid token', async () => {
      const userId = 'user-123';
      const refreshToken = 'invalid-refresh-token';

      expect(() => {
        AuthService.verifyRefreshToken(refreshToken);
      }).toThrow('Invalid or expired refresh token');
    });

    test('should reject refresh when token not in Redis', async () => {
      const userId = 'user-123';
      const refreshToken = AuthService.generateRefreshToken({
        userId,
        email: 'user@example.com',
        role: 'agent'
      });

      // Mock token not found in Redis
      mockRedisService.get.mockResolvedValueOnce(null);

      await expect(
        AuthService.refreshTokens(refreshToken)
      ).rejects.toThrow('Invalid refresh token');
    });

    test('should reject refresh for inactive user', async () => {
      const userId = 'user-123';
      const refreshToken = AuthService.generateRefreshToken({
        userId,
        email: 'user@example.com',
        role: 'agent'
      });

      mockRedisService.get.mockResolvedValueOnce(refreshToken);

      // Mock inactive user
      mockDatabaseService.query.mockResolvedValueOnce(createMockQueryResult([{
        id: userId,
        email: 'user@example.com',
        first_name: 'John',
        last_name: 'Doe',
        role: 'agent',
        is_active: false // Inactive
      }]));

      await expect(
        AuthService.refreshTokens(refreshToken)
      ).rejects.toThrow('User not found or inactive');
    });
  });

  describe('Password Change Flow', () => {
    test('should change password successfully', async () => {
      const userId = 'user-123';
      const oldPassword = 'OldPassword123!';
      const newPassword = 'NewStrongP@ssw0rd123';
      const ipAddress = '192.168.1.1';

      // Mock user lookup
      mockDatabaseService.query
        .mockResolvedValueOnce(createMockQueryResult([{
          password_hash: '$2a$12$oldhash',
          email: 'user@example.com',
          first_name: 'John'
        }]))
        .mockResolvedValueOnce(createMockQueryResult([])); // Update query

      // Mock password comparisons
      jest.spyOn(AuthService, 'comparePassword')
        .mockResolvedValueOnce(true) // Old password correct
        .mockResolvedValueOnce(false); // New password different

      // Mock refresh token revocation
      mockRedisService.del.mockResolvedValue(undefined);

      await expect(
        AuthService.changePassword(userId, oldPassword, newPassword, ipAddress)
      ).resolves.not.toThrow();

      // Verify password was updated
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET password_hash'),
        expect.any(Array)
      );

      // Verify refresh tokens were revoked
      expect(mockRedisService.del).toHaveBeenCalledWith(`refresh_token:${userId}`);
    });

    test('should reject password change with incorrect old password', async () => {
      const userId = 'user-123';
      const oldPassword = 'WrongPassword123!';
      const newPassword = 'NewStrongP@ssw0rd123';

      mockDatabaseService.query.mockResolvedValueOnce(createMockQueryResult([{
        password_hash: '$2a$12$oldhash',
        email: 'user@example.com',
        first_name: 'John'
      }]));

      jest.spyOn(AuthService, 'comparePassword').mockResolvedValueOnce(false);

      await expect(
        AuthService.changePassword(userId, oldPassword, newPassword)
      ).rejects.toThrow('Current password is incorrect');
    });

    test('should reject password change when new password is same as old', async () => {
      const userId = 'user-123';
      const password = 'SamePassword123!';

      mockDatabaseService.query.mockResolvedValueOnce(createMockQueryResult([{
        password_hash: '$2a$12$oldhash',
        email: 'user@example.com',
        first_name: 'John'
      }]));

      jest.spyOn(AuthService, 'comparePassword')
        .mockResolvedValueOnce(true) // Old password correct
        .mockResolvedValueOnce(true); // New password same as old

      await expect(
        AuthService.changePassword(userId, password, password)
      ).rejects.toThrow('New password must be different from current password');
    });
  });

  describe('Logout Flow', () => {
    test('should logout user successfully', async () => {
      const userId = 'user-123';

      mockRedisService.del.mockResolvedValue(undefined);

      await AuthService.logout(userId);

      expect(mockRedisService.del).toHaveBeenCalledWith(`refresh_token:${userId}`);
    });
  });
});