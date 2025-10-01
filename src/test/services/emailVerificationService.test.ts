import { EmailVerificationService, TokenValidationResult } from '../../services/emailVerificationService';
import { DatabaseService } from '../../services/database/DatabaseService';

// Mock the DatabaseService
jest.mock('../../services/database/DatabaseService');
const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;

describe('EmailVerificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateVerificationToken', () => {
    it('should generate a secure verification token', async () => {
      const userId = 'test-user-id';
      
      // Mock the settings query first
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [{ verification_token_expiry_hours: 24 }],
        rowCount: 1,
        fields: []
      });

      // Mock the insert query - return the token that was inserted
      mockDatabaseService.query.mockImplementationOnce(async (query, params) => {
        const token = params![1]; // The token is the second parameter
        return {
          rows: [{ token }],
          rowCount: 1,
          fields: []
        };
      });

      const token = await EmailVerificationService.generateVerificationToken(userId);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBe(64); // 32 bytes * 2 (hex encoding)
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO email_verification_tokens'),
        expect.arrayContaining([userId, expect.any(String), expect.any(Date)])
      );
    });

    it('should handle database errors gracefully', async () => {
      const userId = 'test-user-id';
      
      mockDatabaseService.query.mockRejectedValueOnce(new Error('Database error'));

      await expect(EmailVerificationService.generateVerificationToken(userId))
        .rejects.toThrow('Failed to generate verification token');
    });
  });

  describe('validateVerificationToken', () => {
    it('should validate a valid token successfully', async () => {
      const token = 'valid-token-123';
      const userId = 'test-user-id';
      const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [{
          id: 'token-id',
          user_id: userId,
          token: token,
          expires_at: futureDate.toISOString(),
          created_at: new Date().toISOString(),
          used_at: null
        }],
        rowCount: 1,
        fields: []
      });

      const result = await EmailVerificationService.validateVerificationToken(token);

      expect(result.isValid).toBe(true);
      expect(result.userId).toBe(userId);
      expect(result.isExpired).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it('should reject expired tokens', async () => {
      const token = 'expired-token-123';
      const userId = 'test-user-id';
      const pastDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [{
          id: 'token-id',
          user_id: userId,
          token: token,
          expires_at: pastDate.toISOString(),
          created_at: new Date().toISOString(),
          used_at: null
        }],
        rowCount: 1,
        fields: []
      });

      const result = await EmailVerificationService.validateVerificationToken(token);

      expect(result.isValid).toBe(false);
      expect(result.isExpired).toBe(true);
      expect(result.userId).toBe(userId);
      expect(result.error).toBe('Token has expired');
    });

    it('should reject non-existent tokens', async () => {
      const token = 'non-existent-token';

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        fields: []
      });

      const result = await EmailVerificationService.validateVerificationToken(token);

      expect(result.isValid).toBe(false);
      expect(result.isExpired).toBe(false);
      expect(result.error).toBe('Token not found or already used');
    });

    it('should handle invalid token format', async () => {
      const result = await EmailVerificationService.validateVerificationToken('');

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid token format');
    });
  });

  describe('markEmailAsVerified', () => {
    it('should mark email as verified and invalidate token', async () => {
      const userId = 'test-user-id';
      const token = 'valid-token-123';
      
      const mockClient = {
        query: jest.fn(),
        release: jest.fn()
      };

      mockDatabaseService.getClient.mockResolvedValueOnce(mockClient as any);
      
      // Mock successful token update
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 }); // BEGIN
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE token
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE user
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 }); // COMMIT

      await EmailVerificationService.markEmailAsVerified(userId, token);

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE email_verification_tokens'),
        [userId, token]
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        [userId]
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should rollback on token not found', async () => {
      const userId = 'test-user-id';
      const token = 'invalid-token';
      
      const mockClient = {
        query: jest.fn(),
        release: jest.fn()
      };

      mockDatabaseService.getClient.mockResolvedValueOnce(mockClient as any);
      
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 }); // BEGIN
      mockClient.query.mockResolvedValueOnce({ rowCount: 0 }); // UPDATE token (not found)

      await expect(EmailVerificationService.markEmailAsVerified(userId, token))
        .rejects.toThrow('Failed to verify email');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('should cleanup expired tokens and return count', async () => {
      const deletedCount = 5;

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [{ cleanup_expired_email_verification_tokens: deletedCount }],
        rowCount: 1,
        fields: []
      });

      const result = await EmailVerificationService.cleanupExpiredTokens();

      expect(result).toBe(deletedCount);
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        'SELECT cleanup_expired_email_verification_tokens()'
      );
    });
  });

  describe('getRegistrationSettings', () => {
    it('should return registration settings', async () => {
      const mockSettings = {
        id: 'settings-id',
        require_admin_approval: false,
        allowed_email_domains: null,
        max_registrations_per_day: 100,
        verification_token_expiry_hours: 24,
        updated_by: null,
        updated_at: new Date().toISOString()
      };

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [mockSettings],
        rowCount: 1,
        fields: []
      });

      const result = await EmailVerificationService.getRegistrationSettings();

      expect(result).toEqual({
        id: mockSettings.id,
        requireAdminApproval: mockSettings.require_admin_approval,
        allowedEmailDomains: mockSettings.allowed_email_domains,
        maxRegistrationsPerDay: mockSettings.max_registrations_per_day,
        verificationTokenExpiryHours: mockSettings.verification_token_expiry_hours,
        updatedBy: mockSettings.updated_by,
        updatedAt: new Date(mockSettings.updated_at)
      });
    });

    it('should return null when no settings found', async () => {
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        fields: []
      });

      const result = await EmailVerificationService.getRegistrationSettings();

      expect(result).toBeNull();
    });
  });
});