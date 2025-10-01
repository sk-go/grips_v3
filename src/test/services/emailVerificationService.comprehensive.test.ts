import { EmailVerificationService, TokenValidationResult, RegistrationSettings } from '../../services/emailVerificationService';
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

describe('EmailVerificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  describe('generateVerificationToken', () => {
    const mockUserId = 'test-user-id';
    const mockToken = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    const mockTokenBytes = Buffer.from('test-token-bytes');

    beforeEach(() => {
      mockCrypto.randomBytes.mockReturnValue(mockTokenBytes);
      mockTokenBytes.toString = jest.fn().mockReturnValue(mockToken);
    });

    it('should generate a secure verification token successfully', async () => {
      // Arrange
      const mockSettings: RegistrationSettings = {
        id: 'settings-id',
        requireAdminApproval: false,
        allowedEmailDomains: null,
        maxRegistrationsPerDay: 100,
        verificationTokenExpiryHours: 24,
        updatedAt: new Date()
      };

      mockDatabaseService.query
        .mockResolvedValueOnce({ rows: [mockSettings], rowCount: 1 }) // getRegistrationSettings
        .mockResolvedValueOnce({ rows: [{ token: mockToken }], rowCount: 1 }); // INSERT token

      // Act
      const result = await EmailVerificationService.generateVerificationToken(mockUserId);

      // Assert
      expect(result).toBe(mockToken);
      expect(mockCrypto.randomBytes).toHaveBeenCalledWith(32);
      expect(mockDatabaseService.query).toHaveBeenCalledTimes(2);
      
      // Verify token insertion query
      const insertCall = mockDatabaseService.query.mock.calls[1];
      expect(insertCall[0]).toContain('INSERT INTO email_verification_tokens');
      expect(insertCall[1]![0]).toBe(mockUserId);
      expect(insertCall[1]![1]).toBe(mockToken);
      expect(insertCall[1]![2]).toBeInstanceOf(Date);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Email verification token generated',
        expect.objectContaining({
          userId: mockUserId,
          tokenLength: mockToken.length
        })
      );
    });

    it('should use default expiry when settings not found', async () => {
      // Arrange
      mockDatabaseService.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // getRegistrationSettings returns empty
        .mockResolvedValueOnce({ rows: [{ token: mockToken }], rowCount: 1 }); // INSERT token

      // Act
      const result = await EmailVerificationService.generateVerificationToken(mockUserId);

      // Assert
      expect(result).toBe(mockToken);
      
      // Verify expiry calculation uses default 24 hours
      const insertCall = mockDatabaseService.query.mock.calls[1];
      const expiresAt = insertCall[1]![2] as Date;
      const now = new Date();
      const expectedExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      
      // Allow 1 minute tolerance for test execution time
      expect(Math.abs(expiresAt.getTime() - expectedExpiry.getTime())).toBeLessThan(60000);
    });

    it('should use custom expiry from settings', async () => {
      // Arrange
      const customExpiryHours = 48;
      const mockSettings: RegistrationSettings = {
        id: 'settings-id',
        requireAdminApproval: false,
        allowedEmailDomains: null,
        maxRegistrationsPerDay: 100,
        verificationTokenExpiryHours: customExpiryHours,
        updatedAt: new Date()
      };

      mockDatabaseService.query
        .mockResolvedValueOnce({ rows: [mockSettings] })
        .mockResolvedValueOnce({ rows: [{ token: mockToken }] });

      // Act
      await EmailVerificationService.generateVerificationToken(mockUserId);

      // Assert
      const insertCall = mockDatabaseService.query.mock.calls[1];
      const expiresAt = insertCall[1][2] as Date;
      const now = new Date();
      const expectedExpiry = new Date(now.getTime() + customExpiryHours * 60 * 60 * 1000);
      
      expect(Math.abs(expiresAt.getTime() - expectedExpiry.getTime())).toBeLessThan(60000);
    });

    it('should throw error when token storage fails', async () => {
      // Arrange
      mockDatabaseService.query
        .mockResolvedValueOnce({ rows: [] }) // getRegistrationSettings
        .mockResolvedValueOnce({ rows: [] }); // INSERT fails (no rows returned)

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
      const dbError = new Error('Database connection failed');
      mockDatabaseService.query.mockRejectedValueOnce(dbError);

      // Act & Assert
      await expect(EmailVerificationService.generateVerificationToken(mockUserId))
        .rejects.toThrow('Failed to generate verification token: Database connection failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to generate verification token',
        expect.objectContaining({
          userId: mockUserId,
          error: 'Database connection failed'
        })
      );
    });

    it('should generate cryptographically secure tokens', async () => {
      // Arrange
      mockDatabaseService.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ token: mockToken }] });

      // Act
      await EmailVerificationService.generateVerificationToken(mockUserId);

      // Assert
      expect(mockCrypto.randomBytes).toHaveBeenCalledWith(32); // 32 bytes = 256 bits
      expect(mockTokenBytes.toString).toHaveBeenCalledWith('hex');
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

      mockDatabaseService.query.mockResolvedValueOnce({ rows: [mockTokenData] });

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
      const invalidTokens = [
        '',
        null,
        undefined,
        123,
        {},
        []
      ];

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
      mockDatabaseService.query.mockResolvedValueOnce({ rows: [] });

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

      mockDatabaseService.query.mockResolvedValueOnce({ rows: [mockTokenData] });

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

    it('should handle database errors gracefully', async () => {
      // Arrange
      const dbError = new Error('Database query failed');
      mockDatabaseService.query.mockRejectedValueOnce(dbError);

      // Act
      const result = await EmailVerificationService.validateVerificationToken(mockToken);

      // Assert
      expect(result).toEqual({
        isValid: false,
        isExpired: false,
        error: 'Validation failed: Database query failed'
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to validate verification token',
        expect.objectContaining({
          token: mockToken.substring(0, 8) + '...',
          error: 'Database query failed'
        })
      );
    });

    it('should calculate token age correctly', async () => {
      // Arrange
      const createdAt = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes from now
      const mockTokenData = {
        id: 'token-id',
        user_id: mockUserId,
        token: mockToken,
        expires_at: expiresAt.toISOString(),
        created_at: createdAt.toISOString(),
        used_at: null
      };

      mockDatabaseService.query.mockResolvedValueOnce({ rows: [mockTokenData] });

      // Act
      await EmailVerificationService.validateVerificationToken(mockToken);

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Verification token validated successfully',
        expect.objectContaining({
          userId: mockUserId,
          tokenAge: expect.any(Number)
        })
      );

      const logCall = mockLogger.info.mock.calls[0][1] as any;
      expect(logCall.tokenAge).toBeGreaterThan(25); // Should be around 30 minutes
      expect(logCall.tokenAge).toBeLessThan(35);
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
        .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE token
        .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE user
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
        .mockResolvedValueOnce({ rowCount: 0 }); // UPDATE token fails (no rows affected)

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

    it('should rollback when user update fails', async () => {
      // Arrange
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE token succeeds
        .mockResolvedValueOnce({ rowCount: 0 }); // UPDATE user fails

      // Act & Assert
      await expect(EmailVerificationService.markEmailAsVerified(mockUserId, mockToken))
        .rejects.toThrow('Failed to verify email: User not found');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should handle database transaction errors', async () => {
      // Arrange
      const dbError = new Error('Transaction failed');
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(dbError); // UPDATE token fails

      // Act & Assert
      await expect(EmailVerificationService.markEmailAsVerified(mockUserId, mockToken))
        .rejects.toThrow('Failed to verify email: Transaction failed');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should release client even when release method is undefined', async () => {
      // Arrange
      const clientWithoutRelease = { query: jest.fn() };
      mockDatabaseService.getClient.mockResolvedValue(clientWithoutRelease as any);
      
      clientWithoutRelease.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE token
        .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE user
        .mockResolvedValueOnce(undefined); // COMMIT

      // Act
      await EmailVerificationService.markEmailAsVerified(mockUserId, mockToken);

      // Assert - should not throw error when release is undefined
      expect(clientWithoutRelease.query).toHaveBeenCalledWith('COMMIT');
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('should cleanup expired tokens successfully', async () => {
      // Arrange
      const deletedCount = 5;
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [{ cleanup_expired_email_verification_tokens: deletedCount }]
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
        rows: [{ cleanup_expired_email_verification_tokens: null }]
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

  describe('getRegistrationSettings', () => {
    it('should return registration settings when found', async () => {
      // Arrange
      const mockSettings = {
        id: 'settings-id',
        require_admin_approval: true,
        allowed_email_domains: ['company.com', 'partner.org'],
        max_registrations_per_day: 50,
        verification_token_expiry_hours: 48,
        updated_by: 'admin-id',
        updated_at: new Date().toISOString()
      };

      mockDatabaseService.query.mockResolvedValueOnce({ rows: [mockSettings] });

      // Act
      const result = await EmailVerificationService.getRegistrationSettings();

      // Assert
      expect(result).toEqual({
        id: mockSettings.id,
        requireAdminApproval: mockSettings.require_admin_approval,
        allowedEmailDomains: mockSettings.allowed_email_domains,
        maxRegistrationsPerDay: mockSettings.max_registrations_per_day,
        verificationTokenExpiryHours: mockSettings.verification_token_expiry_hours,
        updatedBy: mockSettings.updated_by,
        updatedAt: new Date(mockSettings.updated_at)
      });

      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, require_admin_approval'),
        []
      );
    });

    it('should return null when no settings found', async () => {
      // Arrange
      mockDatabaseService.query.mockResolvedValueOnce({ rows: [] });

      // Act
      const result = await EmailVerificationService.getRegistrationSettings();

      // Assert
      expect(result).toBeNull();
    });

    it('should handle database errors', async () => {
      // Arrange
      const dbError = new Error('Settings query failed');
      mockDatabaseService.query.mockRejectedValueOnce(dbError);

      // Act & Assert
      await expect(EmailVerificationService.getRegistrationSettings())
        .rejects.toThrow('Failed to get registration settings: Settings query failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get registration settings',
        { error: 'Settings query failed' }
      );
    });
  });

  describe('getVerificationTokenByUserId', () => {
    const mockUserId = 'test-user-id';

    it('should return verification token when found', async () => {
      // Arrange
      const mockTokenData = {
        id: 'token-id',
        user_id: mockUserId,
        token: 'verification-token-123',
        expires_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        used_at: null
      };

      mockDatabaseService.query.mockResolvedValueOnce({ rows: [mockTokenData] });

      // Act
      const result = await EmailVerificationService.getVerificationTokenByUserId(mockUserId);

      // Assert
      expect(result).toEqual({
        id: mockTokenData.id,
        userId: mockTokenData.user_id,
        token: mockTokenData.token,
        expiresAt: new Date(mockTokenData.expires_at),
        createdAt: new Date(mockTokenData.created_at),
        usedAt: undefined
      });

      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = $1 AND used_at IS NULL'),
        [mockUserId]
      );
    });

    it('should return null when no token found', async () => {
      // Arrange
      mockDatabaseService.query.mockResolvedValueOnce({ rows: [] });

      // Act
      const result = await EmailVerificationService.getVerificationTokenByUserId(mockUserId);

      // Assert
      expect(result).toBeNull();
    });

    it('should handle used_at timestamp correctly', async () => {
      // Arrange
      const usedAtDate = new Date();
      const mockTokenData = {
        id: 'token-id',
        user_id: mockUserId,
        token: 'verification-token-123',
        expires_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        used_at: usedAtDate.toISOString()
      };

      mockDatabaseService.query.mockResolvedValueOnce({ rows: [mockTokenData] });

      // Act
      const result = await EmailVerificationService.getVerificationTokenByUserId(mockUserId);

      // Assert
      expect(result?.usedAt).toEqual(usedAtDate);
    });

    it('should handle database errors', async () => {
      // Arrange
      const dbError = new Error('Token query failed');
      mockDatabaseService.query.mockRejectedValueOnce(dbError);

      // Act & Assert
      await expect(EmailVerificationService.getVerificationTokenByUserId(mockUserId))
        .rejects.toThrow('Failed to get verification token: Token query failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get verification token by user ID',
        expect.objectContaining({
          userId: mockUserId,
          error: 'Token query failed'
        })
      );
    });
  });

  describe('invalidateUserTokens', () => {
    const mockUserId = 'test-user-id';

    it('should invalidate user tokens successfully', async () => {
      // Arrange
      const invalidatedCount = 3;
      mockDatabaseService.query.mockResolvedValueOnce({ rowCount: invalidatedCount });

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
      mockDatabaseService.query.mockResolvedValueOnce({ rowCount: 0 });

      // Act
      const result = await EmailVerificationService.invalidateUserTokens(mockUserId);

      // Assert
      expect(result).toBe(0);
    });

    it('should handle null rowCount', async () => {
      // Arrange
      mockDatabaseService.query.mockResolvedValueOnce({ rowCount: null });

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