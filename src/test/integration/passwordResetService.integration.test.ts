import { PasswordResetService } from '../../services/passwordResetService';
import { AuthService } from '../../services/auth';
import { DatabaseService } from '../../services/database';

describe('PasswordResetService Integration Tests', () => {
  let testUserId: string;
  let testEmail: string;

  beforeAll(async () => {
    // Initialize database connection
    await DatabaseService.initialize();
    
    // Create a test user
    testEmail = `test-${Date.now()}@example.com`;
    const user = await AuthService.createUser(
      testEmail,
      'TestPassword123!',
      'Test',
      'User',
      'agent'
    );
    testUserId = user.id;
  });

  afterAll(async () => {
    // Clean up test user and tokens
    if (testUserId) {
      await DatabaseService.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [testUserId]);
      await DatabaseService.query('DELETE FROM users WHERE id = $1', [testUserId]);
    }
    
    // Close database connection
    await DatabaseService.close();
  });

  beforeEach(async () => {
    // Clean up any existing tokens for the test user
    await DatabaseService.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [testUserId]);
  });

  describe('Full password reset flow', () => {
    it('should complete a full password reset workflow', async () => {
      // Step 1: Generate reset token
      const token = await PasswordResetService.generateResetToken(testEmail);
      expect(token).toBeDefined();
      expect(token).toHaveLength(64);

      // Step 2: Validate the token
      const validation = await PasswordResetService.validateResetToken(token);
      expect(validation.userId).toBe(testUserId);
      expect(validation.email).toBe(testEmail);

      // Step 3: Mark token as used
      await PasswordResetService.markTokenAsUsed(token);

      // Step 4: Verify token cannot be used again
      await expect(PasswordResetService.validateResetToken(token))
        .rejects.toThrow('Reset token has already been used');
    });

    it('should invalidate existing tokens when generating new ones', async () => {
      // Generate first token
      const token1 = await PasswordResetService.generateResetToken(testEmail);
      
      // Verify first token is valid
      const validation1 = await PasswordResetService.validateResetToken(token1);
      expect(validation1.userId).toBe(testUserId);

      // Generate second token (should invalidate first)
      const token2 = await PasswordResetService.generateResetToken(testEmail);
      
      // Verify first token is now invalid
      await expect(PasswordResetService.validateResetToken(token1))
        .rejects.toThrow('Reset token has already been used');

      // Verify second token is still valid
      const validation2 = await PasswordResetService.validateResetToken(token2);
      expect(validation2.userId).toBe(testUserId);
    });

    it('should handle token expiration correctly', async () => {
      // This test would require manipulating the database directly to set an expired date
      // or mocking the current time, which is complex in integration tests
      // For now, we'll test the cleanup functionality instead
      
      const token = await PasswordResetService.generateResetToken(testEmail);
      
      // Manually expire the token by updating the database
      await DatabaseService.query(
        `UPDATE password_reset_tokens 
         SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'
         WHERE token = $1`,
        [token]
      );

      // Verify expired token is rejected
      await expect(PasswordResetService.validateResetToken(token))
        .rejects.toThrow('Reset token has expired');
    });
  });

  describe('Token management operations', () => {
    it('should get active tokens for user', async () => {
      // Generate a token
      const token = await PasswordResetService.generateResetToken(testEmail);
      
      // Get active tokens
      const activeTokens = await PasswordResetService.getActiveTokensForUser(testUserId);
      
      expect(activeTokens).toHaveLength(1);
      expect(activeTokens[0].token).toBe(token);
      expect(activeTokens[0].userId).toBe(testUserId);
      expect(activeTokens[0].usedAt).toBeUndefined();
    });

    it('should invalidate all user tokens', async () => {
      // Generate multiple tokens (each one invalidates previous ones, so we'll have one active)
      await PasswordResetService.generateResetToken(testEmail);
      
      // Verify we have active tokens
      let activeTokens = await PasswordResetService.getActiveTokensForUser(testUserId);
      expect(activeTokens.length).toBeGreaterThan(0);

      // Invalidate all tokens
      const invalidatedCount = await PasswordResetService.invalidateUserTokens(testUserId);
      expect(invalidatedCount).toBeGreaterThan(0);

      // Verify no active tokens remain
      activeTokens = await PasswordResetService.getActiveTokensForUser(testUserId);
      expect(activeTokens).toHaveLength(0);
    });

    it('should clean up expired tokens', async () => {
      // Generate a token
      const token = await PasswordResetService.generateResetToken(testEmail);
      
      // Manually expire it
      await DatabaseService.query(
        `UPDATE password_reset_tokens 
         SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'
         WHERE token = $1`,
        [token]
      );

      // Run cleanup
      const cleanedCount = await PasswordResetService.cleanupExpiredTokens();
      expect(cleanedCount).toBeGreaterThanOrEqual(1);

      // Verify token is gone
      const activeTokens = await PasswordResetService.getActiveTokensForUser(testUserId);
      expect(activeTokens).toHaveLength(0);
    });
  });

  describe('Statistics and monitoring', () => {
    it('should provide accurate token statistics', async () => {
      // Clean slate
      await DatabaseService.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [testUserId]);

      // Generate and use some tokens
      const token1 = await PasswordResetService.generateResetToken(testEmail);
      await PasswordResetService.markTokenAsUsed(token1);

      const token2 = await PasswordResetService.generateResetToken(testEmail);
      // Leave token2 active

      // Create an expired token
      const token3 = await PasswordResetService.generateResetToken(testEmail);
      await DatabaseService.query(
        `UPDATE password_reset_tokens 
         SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'
         WHERE token = $3 AND user_id = $1`,
        [testUserId, token2, token3] // token2 should remain active, token3 should be expired
      );

      const stats = await PasswordResetService.getTokenStatistics();
      
      // We should have at least 1 used, 1 active, and 1 expired token
      expect(stats.totalUsed).toBeGreaterThanOrEqual(1);
      expect(stats.totalActive).toBeGreaterThanOrEqual(1);
      expect(stats.totalExpired).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Error handling', () => {
    it('should handle non-existent email gracefully', async () => {
      const nonExistentEmail = 'nonexistent@example.com';
      
      await expect(PasswordResetService.generateResetToken(nonExistentEmail))
        .rejects.toThrow('If the email exists, a reset link will be sent');
    });

    it('should handle invalid tokens gracefully', async () => {
      const invalidToken = 'invalid-token-that-does-not-exist';
      
      await expect(PasswordResetService.validateResetToken(invalidToken))
        .rejects.toThrow('Invalid or expired reset token');
    });

    it('should handle inactive user accounts', async () => {
      // Deactivate the test user
      await DatabaseService.query(
        'UPDATE users SET is_active = false WHERE id = $1',
        [testUserId]
      );

      // Try to generate reset token
      await expect(PasswordResetService.generateResetToken(testEmail))
        .rejects.toThrow('Account is inactive');

      // Reactivate user for cleanup
      await DatabaseService.query(
        'UPDATE users SET is_active = true WHERE id = $1',
        [testUserId]
      );
    });
  });
});