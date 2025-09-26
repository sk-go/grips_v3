import { PasswordResetService } from '../services/passwordResetService';
import { DatabaseService } from '../services/database';
import { logger } from '../utils/logger';

// Mock the dependencies
jest.mock('../services/database');
jest.mock('../utils/logger');

const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('PasswordResetService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock current time for consistent testing
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-15T10:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('generateResetToken', () => {
    it('should generate a token for valid active user', async () => {
      const email = 'test@example.com';
      const userId = 'user-123';

      // Mock user lookup
      mockDatabaseService.query
        .mockResolvedValueOnce({
          rows: [{ id: userId, email, is_active: true }],
          rowCount: 1
        } as any)
        // Mock invalidate existing tokens
        .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
        // Mock insert new token
        .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

      const token = await PasswordResetService.generateResetToken(email);

      expect(token).toBeDefined();
      expect(token).toHaveLength(64); // 32 bytes = 64 hex characters
      expect(mockDatabaseService.query).toHaveBeenCalledTimes(3);
      
      // Verify user lookup
      expect(mockDatabaseService.query).toHaveBeenNthCalledWith(1,
        'SELECT id, email, is_active FROM users WHERE email = $1',
        [email]
      );

      // Verify existing tokens invalidation
      expect(mockDatabaseService.query).toHaveBeenNthCalledWith(2,
        expect.stringContaining('UPDATE password_reset_tokens'),
        [userId]
      );

      // Verify new token insertion
      expect(mockDatabaseService.query).toHaveBeenNthCalledWith(3,
        expect.stringContaining('INSERT INTO password_reset_tokens'),
        expect.arrayContaining([userId, token, expect.any(Date)])
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Password reset token generated',
        expect.objectContaining({ userId, email })
      );
    });

    it('should throw error for non-existent user', async () => {
      const email = 'nonexistent@example.com';

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0
      } as any);

      await expect(PasswordResetService.generateResetToken(email))
        .rejects.toThrow('If the email exists, a reset link will be sent');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Password reset requested for non-existent email',
        { email }
      );
    });

    it('should throw error for inactive user', async () => {
      const email = 'inactive@example.com';
      const userId = 'user-456';

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [{ id: userId, email, is_active: false }],
        rowCount: 1
      } as any);

      await expect(PasswordResetService.generateResetToken(email))
        .rejects.toThrow('Account is inactive');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Password reset requested for inactive user',
        { email, userId }
      );
    });
  });

  describe('validateResetToken', () => {
    it('should validate a valid unused token', async () => {
      const token = 'valid-token-123';
      const userId = 'user-123';
      const email = 'test@example.com';
      const futureDate = new Date('2024-01-15T11:00:00Z'); // 1 hour in future

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [{
          id: 'token-id-123',
          user_id: userId,
          expires_at: futureDate,
          used_at: null,
          email,
          is_active: true
        }],
        rowCount: 1
      } as any);

      const result = await PasswordResetService.validateResetToken(token);

      expect(result).toEqual({ userId, email });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Password reset token validated successfully',
        expect.objectContaining({ userId, email })
      );
    });

    it('should throw error for non-existent token', async () => {
      const token = 'invalid-token';

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0
      } as any);

      await expect(PasswordResetService.validateResetToken(token))
        .rejects.toThrow('Invalid or expired reset token');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid password reset token attempted',
        { token: 'invalid-...' }
      );
    });

    it('should throw error for already used token', async () => {
      const token = 'used-token-123';
      const usedDate = new Date('2024-01-15T09:00:00Z');

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [{
          id: 'token-id-123',
          user_id: 'user-123',
          expires_at: new Date('2024-01-15T11:00:00Z'),
          used_at: usedDate,
          email: 'test@example.com',
          is_active: true
        }],
        rowCount: 1
      } as any);

      await expect(PasswordResetService.validateResetToken(token))
        .rejects.toThrow('Reset token has already been used');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Already used password reset token attempted',
        expect.objectContaining({ usedAt: usedDate })
      );
    });

    it('should throw error for expired token', async () => {
      const token = 'expired-token-123';
      const pastDate = new Date('2024-01-15T09:00:00Z'); // 1 hour in past

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [{
          id: 'token-id-123',
          user_id: 'user-123',
          expires_at: pastDate,
          used_at: null,
          email: 'test@example.com',
          is_active: true
        }],
        rowCount: 1
      } as any);

      await expect(PasswordResetService.validateResetToken(token))
        .rejects.toThrow('Reset token has expired');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Expired password reset token attempted',
        expect.objectContaining({ expiresAt: pastDate })
      );
    });

    it('should throw error for inactive user', async () => {
      const token = 'valid-token-inactive-user';
      const userId = 'user-123';
      const email = 'inactive@example.com';

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [{
          id: 'token-id-123',
          user_id: userId,
          expires_at: new Date('2024-01-15T11:00:00Z'),
          used_at: null,
          email,
          is_active: false
        }],
        rowCount: 1
      } as any);

      await expect(PasswordResetService.validateResetToken(token))
        .rejects.toThrow('Account is inactive');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Password reset attempted for inactive user',
        { userId, email }
      );
    });
  });

  describe('markTokenAsUsed', () => {
    it('should mark token as used successfully', async () => {
      const token = 'token-to-mark-used';
      const tokenId = 'token-id-123';
      const userId = 'user-123';

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [{ id: tokenId, user_id: userId }],
        rowCount: 1
      } as any);

      await PasswordResetService.markTokenAsUsed(token);

      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE password_reset_tokens'),
        [token]
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Password reset token marked as used',
        { tokenId, userId }
      );
    });

    it('should handle token not found gracefully', async () => {
      const token = 'non-existent-token';

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0
      } as any);

      await PasswordResetService.markTokenAsUsed(token);

      expect(mockLogger.info).not.toHaveBeenCalled();
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('should clean up expired tokens and return count', async () => {
      const expiredTokenIds = ['token-1', 'token-2', 'token-3'];

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: expiredTokenIds.map(id => ({ id })),
        rowCount: expiredTokenIds.length
      } as any);

      const result = await PasswordResetService.cleanupExpiredTokens();

      expect(result).toBe(3);
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM password_reset_tokens')
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Cleaned up expired password reset tokens',
        { count: 3 }
      );
    });

    it('should return 0 when no expired tokens found', async () => {
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0
      } as any);

      const result = await PasswordResetService.cleanupExpiredTokens();

      expect(result).toBe(0);
      expect(mockLogger.info).not.toHaveBeenCalled();
    });
  });

  describe('getActiveTokensForUser', () => {
    it('should return active tokens for user', async () => {
      const userId = 'user-123';
      const mockTokens = [
        {
          id: 'token-1',
          user_id: userId,
          token: 'active-token-1',
          expires_at: new Date('2024-01-15T11:00:00Z'),
          used_at: null,
          created_at: new Date('2024-01-15T10:00:00Z')
        },
        {
          id: 'token-2',
          user_id: userId,
          token: 'active-token-2',
          expires_at: new Date('2024-01-15T12:00:00Z'),
          used_at: null,
          created_at: new Date('2024-01-15T10:30:00Z')
        }
      ];

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: mockTokens,
        rowCount: mockTokens.length
      } as any);

      const result = await PasswordResetService.getActiveTokensForUser(userId);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'token-1',
        userId,
        token: 'active-token-1',
        expiresAt: new Date('2024-01-15T11:00:00Z'),
        usedAt: undefined,
        createdAt: new Date('2024-01-15T10:00:00Z')
      });
    });
  });

  describe('invalidateUserTokens', () => {
    it('should invalidate all unused tokens for user', async () => {
      const userId = 'user-123';
      const invalidatedTokens = ['token-1', 'token-2'];

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: invalidatedTokens.map(id => ({ id })),
        rowCount: invalidatedTokens.length
      } as any);

      const result = await PasswordResetService.invalidateUserTokens(userId);

      expect(result).toBe(2);
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE password_reset_tokens'),
        [userId]
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Invalidated password reset tokens for user',
        { userId, count: 2 }
      );
    });
  });

  describe('getTokenStatistics', () => {
    it('should return token statistics', async () => {
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [{
          active_count: '5',
          expired_count: '3',
          used_count: '12'
        }],
        rowCount: 1
      } as any);

      const result = await PasswordResetService.getTokenStatistics();

      expect(result).toEqual({
        totalActive: 5,
        totalExpired: 3,
        totalUsed: 12
      });
    });

    it('should handle null counts gracefully', async () => {
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [{
          active_count: null,
          expired_count: null,
          used_count: null
        }],
        rowCount: 1
      } as any);

      const result = await PasswordResetService.getTokenStatistics();

      expect(result).toEqual({
        totalActive: 0,
        totalExpired: 0,
        totalUsed: 0
      });
    });
  });
});