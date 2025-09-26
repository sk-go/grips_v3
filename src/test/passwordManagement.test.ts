import { PasswordResetService } from '../services/passwordResetService';
import { AuthService } from '../services/auth';
import { EmailNotificationService } from '../services/email/emailNotificationService';
import { DatabaseService } from '../services/database';

// Mock dependencies
jest.mock('../services/database');
jest.mock('../services/email/emailNotificationService');
jest.mock('../utils/logger');

const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;
const mockEmailService = EmailNotificationService as jest.MockedClass<typeof EmailNotificationService>;

describe('Password Management', () => {
  let mockEmailInstance: jest.Mocked<EmailNotificationService>;

  // Helper function to create mock query results
  const mockQueryResult = (rows: any[], rowCount?: number) => ({
    rows,
    rowCount: rowCount ?? rows.length
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock email service instance
    mockEmailInstance = {
      sendPasswordResetEmail: jest.fn(),
      sendPasswordChangeNotification: jest.fn(),
      isReady: jest.fn().mockReturnValue(true),
      testConfiguration: jest.fn()
    } as any;

    // Mock the constructor to return our mock instance
    (mockEmailService as any).mockImplementation(() => mockEmailInstance);
  });

  describe('PasswordResetService', () => {
    describe('initiatePasswordReset', () => {
      it('should generate token and send email for valid user', async () => {
        // Mock user exists and is active
        mockDatabaseService.query
          .mockResolvedValueOnce(mockQueryResult([{ id: 'user-1', email: 'test@example.com', is_active: true }])) // Check user exists
          .mockResolvedValueOnce(mockQueryResult([])) // Invalidate existing tokens
          .mockResolvedValueOnce(mockQueryResult([])) // Insert new token
          .mockResolvedValueOnce(mockQueryResult([{ first_name: 'John' }])); // Get user details for email

        await PasswordResetService.initiatePasswordReset('test@example.com', 'https://app.example.com');

        expect(mockEmailInstance.sendPasswordResetEmail).toHaveBeenCalledWith({
          email: 'test@example.com',
          firstName: 'John',
          resetToken: expect.any(String),
          resetUrl: expect.stringContaining('https://app.example.com/reset-password?token='),
          expiresAt: expect.any(Date)
        });
      });

      it('should not reveal non-existent email addresses', async () => {
        // Mock user does not exist
        mockDatabaseService.query.mockResolvedValueOnce(mockQueryResult([]));

        await expect(
          PasswordResetService.initiatePasswordReset('nonexistent@example.com', 'https://app.example.com')
        ).resolves.not.toThrow();

        expect(mockEmailInstance.sendPasswordResetEmail).not.toHaveBeenCalled();
      });

      it('should handle email sending failures gracefully', async () => {
        // Mock user exists
        mockDatabaseService.query
          .mockResolvedValueOnce(mockQueryResult([{ id: 'user-1', email: 'test@example.com', is_active: true }]))
          .mockResolvedValueOnce(mockQueryResult([]))
          .mockResolvedValueOnce(mockQueryResult([]))
          .mockResolvedValueOnce(mockQueryResult([{ first_name: 'John' }]));

        // Mock email service failure
        mockEmailInstance.sendPasswordResetEmail.mockRejectedValueOnce(new Error('SMTP error'));

        await expect(
          PasswordResetService.initiatePasswordReset('test@example.com', 'https://app.example.com')
        ).resolves.not.toThrow();
      });
    });

    describe('completePasswordReset', () => {
      const mockClient = {
        query: jest.fn(),
        release: jest.fn()
      };

      beforeEach(() => {
        mockDatabaseService.getClient.mockResolvedValue(mockClient as any);
      });

      it('should reset password and send notification for valid token', async () => {
        const token = 'valid-token';
        const newPassword = 'NewSecurePassword123!';

        // Mock token validation
        mockDatabaseService.query.mockResolvedValueOnce(mockQueryResult([{
          id: 'token-1',
          user_id: 'user-1',
          expires_at: new Date(Date.now() + 3600000), // 1 hour from now
          used_at: null,
          email: 'test@example.com',
          is_active: true
        }]));

        // Mock user details for notification
        mockDatabaseService.query.mockResolvedValueOnce(mockQueryResult([{ first_name: 'John' }]));

        // Mock transaction queries
        mockClient.query
          .mockResolvedValueOnce(undefined) // BEGIN
          .mockResolvedValueOnce(undefined) // UPDATE users
          .mockResolvedValueOnce(undefined) // UPDATE token
          .mockResolvedValueOnce(undefined) // Invalidate other tokens
          .mockResolvedValueOnce(undefined); // COMMIT

        await PasswordResetService.completePasswordReset(token, newPassword, '192.168.1.1');

        expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
        expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
        expect(mockEmailInstance.sendPasswordChangeNotification).toHaveBeenCalledWith({
          email: 'test@example.com',
          firstName: 'John',
          changeTime: expect.any(Date),
          ipAddress: '192.168.1.1'
        });
      });

      it('should reject weak passwords', async () => {
        const token = 'valid-token';
        const weakPassword = '123';

        // Mock token validation
        mockDatabaseService.query.mockResolvedValueOnce(mockQueryResult([{
          id: 'token-1',
          user_id: 'user-1',
          expires_at: new Date(Date.now() + 3600000),
          used_at: null,
          email: 'test@example.com',
          is_active: true
        }]));

        await expect(
          PasswordResetService.completePasswordReset(token, weakPassword)
        ).rejects.toThrow('Password validation failed');
      });

      it('should reject expired tokens', async () => {
        const token = 'expired-token';
        const newPassword = 'NewSecurePassword123!';

        // Mock expired token
        mockDatabaseService.query.mockResolvedValueOnce(mockQueryResult([{
          id: 'token-1',
          user_id: 'user-1',
          expires_at: new Date(Date.now() - 3600000), // 1 hour ago
          used_at: null,
          email: 'test@example.com',
          is_active: true
        }]));

        await expect(
          PasswordResetService.completePasswordReset(token, newPassword)
        ).rejects.toThrow('Reset token has expired');
      });

      it('should reject already used tokens', async () => {
        const token = 'used-token';
        const newPassword = 'NewSecurePassword123!';

        // Mock used token
        mockDatabaseService.query.mockResolvedValueOnce(mockQueryResult([{
          id: 'token-1',
          user_id: 'user-1',
          expires_at: new Date(Date.now() + 3600000),
          used_at: new Date(Date.now() - 1800000), // 30 minutes ago
          email: 'test@example.com',
          is_active: true
        }]));

        await expect(
          PasswordResetService.completePasswordReset(token, newPassword)
        ).rejects.toThrow('Reset token has already been used');
      });

      it('should rollback transaction on failure', async () => {
        const token = 'valid-token';
        const newPassword = 'NewSecurePassword123!';

        // Mock token validation
        mockDatabaseService.query.mockResolvedValueOnce(mockQueryResult([{
          id: 'token-1',
          user_id: 'user-1',
          expires_at: new Date(Date.now() + 3600000),
          used_at: null,
          email: 'test@example.com',
          is_active: true
        }]));

        // Mock transaction failure
        mockClient.query
          .mockResolvedValueOnce(undefined) // BEGIN
          .mockRejectedValueOnce(new Error('Database error')); // UPDATE users fails

        await expect(
          PasswordResetService.completePasswordReset(token, newPassword)
        ).rejects.toThrow('Failed to reset password');

        expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      });
    });
  });

  describe('AuthService Password Change', () => {
    it('should change password and send notification for valid request', async () => {
      const userId = 'user-1';
      const oldPassword = 'OldPassword123!';
      const newPassword = 'NewPassword123!';
      const ipAddress = '192.168.1.1';

      // Mock user data
      mockDatabaseService.query
        .mockResolvedValueOnce(mockQueryResult([{
          password_hash: await AuthService.hashPassword(oldPassword),
          email: 'test@example.com',
          first_name: 'John'
        }]))
        .mockResolvedValueOnce(mockQueryResult([])); // Update password

      await AuthService.changePassword(userId, oldPassword, newPassword, ipAddress);

      expect(mockEmailInstance.sendPasswordChangeNotification).toHaveBeenCalledWith({
        email: 'test@example.com',
        firstName: 'John',
        changeTime: expect.any(Date),
        ipAddress
      });
    });

    it('should reject incorrect old password', async () => {
      const userId = 'user-1';
      const oldPassword = 'WrongPassword';
      const newPassword = 'NewPassword123!';

      // Mock user data with different password
      mockDatabaseService.query.mockResolvedValueOnce(mockQueryResult([{
        password_hash: await AuthService.hashPassword('DifferentPassword123!'),
        email: 'test@example.com',
        first_name: 'John'
      }]));

      await expect(
        AuthService.changePassword(userId, oldPassword, newPassword)
      ).rejects.toThrow('Current password is incorrect');
    });

    it('should reject weak new passwords', async () => {
      const userId = 'user-1';
      const oldPassword = 'OldPassword123!';
      const newPassword = '123'; // Weak password

      // Mock user data
      mockDatabaseService.query.mockResolvedValueOnce(mockQueryResult([{
        password_hash: await AuthService.hashPassword(oldPassword),
        email: 'test@example.com',
        first_name: 'John'
      }]));

      await expect(
        AuthService.changePassword(userId, oldPassword, newPassword)
      ).rejects.toThrow('New password validation failed');
    });

    it('should reject same password as current', async () => {
      const userId = 'user-1';
      const password = 'SamePassword123!';

      // Mock user data
      mockDatabaseService.query.mockResolvedValueOnce(mockQueryResult([{
        password_hash: await AuthService.hashPassword(password),
        email: 'test@example.com',
        first_name: 'John'
      }]));

      await expect(
        AuthService.changePassword(userId, password, password)
      ).rejects.toThrow('New password must be different from current password');
    });

    it('should handle email notification failures gracefully', async () => {
      const userId = 'user-1';
      const oldPassword = 'OldPassword123!';
      const newPassword = 'NewPassword123!';

      // Mock user data
      mockDatabaseService.query
        .mockResolvedValueOnce(mockQueryResult([{
          password_hash: await AuthService.hashPassword(oldPassword),
          email: 'test@example.com',
          first_name: 'John'
        }]))
        .mockResolvedValueOnce(mockQueryResult([])); // Update password

      // Mock email service failure
      mockEmailInstance.sendPasswordChangeNotification.mockRejectedValueOnce(
        new Error('SMTP error')
      );

      // Should not throw error even if email fails
      await expect(
        AuthService.changePassword(userId, oldPassword, newPassword)
      ).resolves.not.toThrow();
    });
  });

  describe('EmailNotificationService', () => {
    let emailService: EmailNotificationService;

    beforeEach(() => {
      // Reset mocks and create real instance for testing
      jest.clearAllMocks();
      emailService = new EmailNotificationService();
    });

    it('should generate proper password reset email template', async () => {
      const data = {
        email: 'test@example.com',
        firstName: 'John',
        resetToken: 'test-token-123',
        resetUrl: 'https://app.example.com/reset-password?token=test-token-123',
        expiresAt: new Date(Date.now() + 3600000) // 1 hour from now
      };

      // Mock isReady to return true
      jest.spyOn(emailService, 'isReady').mockReturnValue(true);

      // Mock the transporter
      const mockTransporter = {
        sendMail: jest.fn().mockResolvedValue({ messageId: 'test-message-id' })
      };
      (emailService as any).transporter = mockTransporter;

      await emailService.sendPasswordResetEmail(data);

      expect(mockTransporter.sendMail).toHaveBeenCalledWith({
        from: expect.any(String),
        to: 'test@example.com',
        subject: expect.stringContaining('Password Reset Request'),
        text: expect.stringContaining('Hello John'),
        html: expect.stringContaining('Hello John')
      });

      const callArgs = mockTransporter.sendMail.mock.calls[0][0];
      expect(callArgs.text).toContain(data.resetUrl);
      expect(callArgs.html).toContain(data.resetUrl);
    });

    it('should generate proper password change notification template', async () => {
      const data = {
        email: 'test@example.com',
        firstName: 'John',
        changeTime: new Date(),
        ipAddress: '192.168.1.1'
      };

      // Mock isReady to return true
      jest.spyOn(emailService, 'isReady').mockReturnValue(true);

      // Mock the transporter
      const mockTransporter = {
        sendMail: jest.fn().mockResolvedValue({ messageId: 'test-message-id' })
      };
      (emailService as any).transporter = mockTransporter;

      await emailService.sendPasswordChangeNotification(data);

      expect(mockTransporter.sendMail).toHaveBeenCalledWith({
        from: expect.any(String),
        to: 'test@example.com',
        subject: expect.stringContaining('Password Changed'),
        text: expect.stringContaining('Hello John'),
        html: expect.stringContaining('Hello John')
      });

      const callArgs = mockTransporter.sendMail.mock.calls[0][0];
      expect(callArgs.text).toContain('192.168.1.1');
      expect(callArgs.html).toContain('192.168.1.1');
    });

    it('should handle missing SMTP configuration gracefully', () => {
      // Create service without SMTP config
      const originalUser = process.env.SMTP_USER;
      const originalPass = process.env.SMTP_PASS;
      
      process.env.SMTP_USER = '';
      process.env.SMTP_PASS = '';
      
      const serviceWithoutConfig = new EmailNotificationService();
      expect(serviceWithoutConfig.isReady()).toBe(false);
      
      // Restore original values
      process.env.SMTP_USER = originalUser;
      process.env.SMTP_PASS = originalPass;
    });
  });
});