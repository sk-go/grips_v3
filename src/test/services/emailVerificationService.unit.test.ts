import { EmailVerificationService } from '../../services/emailVerificationService';
import { DatabaseService } from '../../services/database/DatabaseService';
import { logger } from '../../utils/logger';
import crypto from 'crypto';

// Mock dependencies
jest.mock('../../services/database/DatabaseService');
jest.mock('../../utils/logger');
jest.mock('crypto');

const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;
const mockLogger = logger as jest.Mocked<typeof logger>;
const mockCrypto = crypto as jest.Mocked<typeof crypto>;

describe('EmailVerificationService - Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateVerificationToken', () => {
    const mockUserId = 'test-user-id';
    const mockToken = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

    it('should generate a secure verification token successfully', async () => {
      // Arrange
      const mockTokenBytes = Buffer.from('test-token-bytes');
      (mockCrypto.randomBytes as jest.Mock).mockReturnValue(mockTokenBytes);
      mockTokenBytes.toString = jest.fn().mockReturnValue(mockToken);

      mockDatabaseService.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // getRegistrationSettings
        .mockResolvedValueOnce({ rows: [{ token: mockToken }], rowCount: 1 }); // INSERT token

      // Act
      const result = await EmailVerificationService.generateVerificationToken(mockUserId);

      // Assert
      expect(result).toBe(mockToken);
      expect(mockCrypto.randomBytes).toHaveBeenCalledWith(32);
      expect(mockDatabaseService.query).toHaveBeenCalledTimes(2);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Email verification token generated',
        expect.objectContaining({
          userId: mockUserId,
          tokenLength: mockToken.length
        })
      );
    });

    it('should throw error when token storage fails', async () => {
      // Arrange
      const mockTokenBytes = Buffer.from('test-token-bytes');
      (mockCrypto.randomBytes as jest.Mock).mockReturnValue(mockTokenBytes);
      mockTokenBytes.toString = jest.fn().mockReturnValue(mockToken);

      mockDatabaseService.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // getRegistrationSettings
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // INSERT fails (no rows returned)

      // Act & Assert
      await expect(EmailVerificationService.generateVerificationToken(mockUserId))
        .rejects.toThrow('Failed to generate verification token: Failed to store verification token');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to generate verification token',
        expect.objectContaining({
          userId: mockUserId,
          error: 'Failed to store verification token'
        })
      );
    });

    it('should handle database errors gracefully', async () => {
      // Arrange
      const mockTokenBytes = Buffer.from('test-token-bytes');
      (mockCrypto.randomBytes as jest.Mock).mockReturnValue(mockTokenBytes);
      mockTokenBytes.toString = jest.fn().mockReturnValue(mockToken);

      const dbError = new Error('Database connection failed');
      mockDatabaseService.query.mockRejectedValueOnce(dbError);

      // Act & Assert
      await expect(EmailVerificationService.generateVerificationToken(mockUserId))
        .rejects.toThrow('Failed to generate verification token');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to generate verification token',
        expect.objectContaining({
          userId: mockUserId,
          error: 'Database connection failed'
        })
      );
    });
  });

  describe('validateVerificationToken', () => {
    const mockToken = 'valid-token-12345678901234567890123456789012';
    const mockUserId = 'test-user-id';

    it('should validate a valid, non-expired token successfully', async () => {
      // Arrange
      const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      const mockTokenData = {
        id: 'token-id',
        user_id: mockUserId,
        token: mockToken,
        expires_at: futureDate.toISOString(),
        created_at: new Date().toISOString(),
        used_at: null
      };

      mockDatabaseService.query.mockResolvedValueOnce({ 
        rows: [mockTokenData], 
        rowCount: 1 
      });

      // Act
      const result = await EmailVerificationService.validateVerificationToken(mockToken);

      // Assert
      expect(result).toEqual({
        isValid: true,
        isExpired: false,
        userId: mockUserId
      });

      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, user_id, token, expires_at, created_at, used_at'),
        [mockToken]
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Verification token validated successfully',
        expect.objectContaining({
          userId: mockUserId
        })
      );
    });

    it('should reject invalid token format', async () => {
      // Test cases for invalid token formats
      const invalidTokens = ['', null, undefined, 123, {}, []];

      for (const invalidToken of invalidTokens) {
        const result = await EmailVerificationService.validateVerificationToken(invalidToken as any);
        
        expect(result).toEqual({
          isValid: false,
          isExpired: false,
          error: 'Invalid token format'
        });
      }

      expect(mockDatabaseService.query).not.toHaveBeenCalled();
    });

    it('should reject token not found in database', async () => {
      // Arrange
      mockDatabaseService.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      // Act
      const result = await EmailVerificationService.validateVerificationToken(mockToken);

      // Assert
      expect(result).toEqual({
        isValid: false,
        isExpired: false,
        error: 'Token not found or already used'
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Verification token not found or already used',
        { token: mockToken.substring(0, 8) + '...' }
      );
    });

    it('should reject expired token', async () => {
      // Arrange
      const pastDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      const mockTokenData = {
        id: 'token-id',
        user_id: mockUserId,
        token: mockToken,
        expires_at: pastDate.toISOString(),
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        used_at: null
      };

      mockDatabaseService.query.mockResolvedValueOnce({ 
        rows: [mockTokenData], 
        rowCount: 1 
      });

      // Act
      const result = await EmailVerificationService.validateVerificationToken(mockToken);

      // Assert
      expect(result).toEqual({
        isValid: false,
        isExpired: true,
        userId: mockUserId,
        error: 'Token has expired'
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Verification token expired',
        expect.objectContaining({
          token: mockToken.substring(0, 8) + '...',
          expiresAt: pastDate.toISOString()
        })
      );
    });
  });

  describe('markEmailAsVerified', () => {
    const mockUserId = 'test-user-id';
    const mockToken = 'valid-token-123';
    const mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    beforeEach(() => {
      mockDatabaseService.getClient.mockResolvedValue(mockClient as any);
    });

    it('should mark email as verified successfully', async () => {
      // Arrange
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // UPDATE token
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // UPDATE user
        .mockResolvedValueOnce(undefined); // COMMIT

      // Act
      await EmailVerificationService.markEmailAsVerified(mockUserId, mockToken);

      // Assert
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE email_verification_tokens'),
        [mockUserId, mockToken]
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        [mockUserId]
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Email verified successfully',
        expect.objectContaining({
          userId: mockUserId,
          token: mockToken.substring(0, 8) + '...'
        })
      );
    });

    it('should rollback when token update fails', async () => {
      // Arrange
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // UPDATE token fails (no rows affected)

      // Act & Assert
      await expect(EmailVerificationService.markEmailAsVerified(mockUserId, mockToken))
        .rejects.toThrow('Failed to verify email: Token not found or already used');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to mark email as verified',
        expect.objectContaining({
          userId: mockUserId,
          error: 'Token not found or already used'
        })
      );
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('should cleanup expired tokens successfully', async () => {
      // Arrange
      const deletedCount = 5;
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [{ cleanup_expired_email_verification_tokens: deletedCount }],
        rowCount: 1
      });

      // Act
      const result = await EmailVerificationService.cleanupExpiredTokens();

      // Assert
      expect(result).toBe(deletedCount);
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        'SELECT cleanup_expired_email_verification_tokens()'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Cleaned up expired verification tokens',
        { deletedCount }
      );
    });

    it('should handle cleanup function returning null', async () => {
      // Arrange
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [{ cleanup_expired_email_verification_tokens: null }],
        rowCount: 1
      });

      // Act
      const result = await EmailVerificationService.cleanupExpiredTokens();

      // Assert
      expect(result).toBe(0);
    });

    it('should handle database errors during cleanup', async () => {
      // Arrange
      const dbError = new Error('Cleanup function failed');
      mockDatabaseService.query.mockRejectedValueOnce(dbError);

      // Act & Assert
      await expect(EmailVerificationService.cleanupExpiredTokens())
        .rejects.toThrow('Failed to cleanup expired tokens: Cleanup function failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to cleanup expired tokens',
        { error: 'Cleanup function failed' }
      );
    });
  });

  describe('invalidateUserTokens', () => {
    const mockUserId = 'test-user-id';

    it('should invalidate user tokens successfully', async () => {
      // Arrange
      const invalidatedCount = 3;
      mockDatabaseService.query.mockResolvedValueOnce({ 
        rows: [], 
        rowCount: invalidatedCount 
      });

      // Act
      const result = await EmailVerificationService.invalidateUserTokens(mockUserId);

      // Assert
      expect(result).toBe(invalidatedCount);
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE email_verification_tokens'),
        [mockUserId]
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Invalidated user verification tokens',
        expect.objectContaining({
          userId: mockUserId,
          invalidatedCount
        })
      );
    });

    it('should handle zero tokens invalidated', async () => {
      // Arrange
      mockDatabaseService.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      // Act
      const result = await EmailVerificationService.invalidateUserTokens(mockUserId);

      // Assert
      expect(result).toBe(0);
    });

    it('should handle database errors', async () => {
      // Arrange
      const dbError = new Error('Invalidation failed');
      mockDatabaseService.query.mockRejectedValueOnce(dbError);

      // Act & Assert
      await expect(EmailVerificationService.invalidateUserTokens(mockUserId))
        .rejects.toThrow('Failed to invalidate user tokens: Invalidation failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to invalidate user tokens',
        expect.objectContaining({
          userId: mockUserId,
          error: 'Invalidation failed'
        })
      );
    });
  });
});