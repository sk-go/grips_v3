import request from 'supertest';
import express from 'express';
import { DatabaseService } from '../../services/database';
import { AuthService } from '../../services/auth';
import { PasswordResetService } from '../../services/passwordResetService';
import { EmailNotificationService } from '../../services/email/emailNotificationService';
import { authenticateToken } from '../../middleware/auth';
import passwordManagementRoutes from '../../routes/passwordManagement';

// Mock dependencies
jest.mock('../../services/database');
jest.mock('../../services/email/emailNotificationService');
jest.mock('../../middleware/auth');
jest.mock('../../utils/logger');

const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;
const mockAuthenticateToken = authenticateToken as jest.MockedFunction<typeof authenticateToken>;
const mockEmailService = EmailNotificationService as jest.MockedClass<typeof EmailNotificationService>;

describe('Password Management API Integration', () => {
  let app: express.Application;
  let mockEmailInstance: jest.Mocked<EmailNotificationService>;

  // Helper function to create mock query results
  const mockQueryResult = (rows: any[], rowCount?: number) => ({
    rows,
    rowCount: rowCount ?? rows.length
  });

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/auth/password', passwordManagementRoutes);
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

    // Mock authentication middleware
    mockAuthenticateToken.mockImplementation((req: any, res: any, next: any) => {
      req.user = {
        id: 'user-1',
        email: 'test@example.com',
        role: 'agent'
      };
      next();
      return Promise.resolve();
    });
  });

  describe('POST /api/auth/password/forgot', () => {
    it('should initiate password reset for valid email', async () => {
      // Mock user exists
      mockDatabaseService.query
        .mockResolvedValueOnce(mockQueryResult([{ id: 'user-1', email: 'test@example.com', is_active: true }]))
        .mockResolvedValueOnce(mockQueryResult([])) // Invalidate existing tokens
        .mockResolvedValueOnce(mockQueryResult([])) // Insert new token
        .mockResolvedValueOnce(mockQueryResult([{ first_name: 'John' }])); // Get user details

      const response = await request(app)
        .post('/api/auth/password/forgot')
        .send({ email: 'test@example.com' });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('password reset link has been sent');
      expect(mockEmailInstance.sendPasswordResetEmail).toHaveBeenCalled();
    });

    it('should return success even for non-existent email', async () => {
      // Mock user does not exist
      mockDatabaseService.query.mockResolvedValueOnce(mockQueryResult([]));

      const response = await request(app)
        .post('/api/auth/password/forgot')
        .send({ email: 'nonexistent@example.com' });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('password reset link has been sent');
      expect(mockEmailInstance.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('should validate email format', async () => {
      const response = await request(app)
        .post('/api/auth/password/forgot')
        .send({ email: 'invalid-email' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid email format');
    });

    it('should require email field', async () => {
      const response = await request(app)
        .post('/api/auth/password/forgot')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Email is required');
    });

    it('should handle service errors gracefully', async () => {
      // Mock database error
      mockDatabaseService.query.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .post('/api/auth/password/forgot')
        .send({ email: 'test@example.com' });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('password reset link has been sent');
    });
  });

  describe('POST /api/auth/password/reset', () => {
    const mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    beforeEach(() => {
      mockDatabaseService.getClient.mockResolvedValue(mockClient as any);
    });

    it('should reset password with valid token', async () => {
      const token = 'valid-token';
      const newPassword = 'NewSecurePassword123!';

      // Mock token validation
      mockDatabaseService.query
        .mockResolvedValueOnce(mockQueryResult([{
          id: 'token-1',
          user_id: 'user-1',
          expires_at: new Date(Date.now() + 3600000),
          used_at: null,
          email: 'test@example.com',
          is_active: true
        }]))
        .mockResolvedValueOnce(mockQueryResult([{ first_name: 'John' }]));

      // Mock transaction
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce(undefined) // UPDATE users
        .mockResolvedValueOnce(undefined) // UPDATE token
        .mockResolvedValueOnce(undefined) // Invalidate other tokens
        .mockResolvedValueOnce(undefined); // COMMIT

      const response = await request(app)
        .post('/api/auth/password/reset')
        .send({ token, password: newPassword });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Password has been reset successfully');
      expect(mockEmailInstance.sendPasswordChangeNotification).toHaveBeenCalled();
    });

    it('should reject invalid token', async () => {
      // Mock invalid token
      mockDatabaseService.query.mockResolvedValueOnce(mockQueryResult([]));

      const response = await request(app)
        .post('/api/auth/password/reset')
        .send({ 
          token: 'invalid-token', 
          password: 'NewSecurePassword123!' 
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid or expired');
    });

    it('should reject expired token', async () => {
      // Mock expired token
      mockDatabaseService.query.mockResolvedValueOnce(mockQueryResult([{
        id: 'token-1',
        user_id: 'user-1',
        expires_at: new Date(Date.now() - 3600000), // 1 hour ago
        used_at: null,
        email: 'test@example.com',
        is_active: true
      }]));

      const response = await request(app)
        .post('/api/auth/password/reset')
        .send({ 
          token: 'expired-token', 
          password: 'NewSecurePassword123!' 
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('expired');
    });

    it('should reject weak passwords', async () => {
      // Mock valid token
      mockDatabaseService.query.mockResolvedValueOnce(mockQueryResult([{
        id: 'token-1',
        user_id: 'user-1',
        expires_at: new Date(Date.now() + 3600000),
        used_at: null,
        email: 'test@example.com',
        is_active: true
      }]));

      const response = await request(app)
        .post('/api/auth/password/reset')
        .send({ 
          token: 'valid-token', 
          password: '123' // Weak password
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Password validation failed');
    });

    it('should require token and password', async () => {
      let response = await request(app)
        .post('/api/auth/password/reset')
        .send({ password: 'NewSecurePassword123!' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Reset token is required');

      response = await request(app)
        .post('/api/auth/password/reset')
        .send({ token: 'valid-token' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('New password is required');
    });
  });

  describe('POST /api/auth/password/change', () => {
    it('should change password for authenticated user', async () => {
      const currentPassword = 'CurrentPassword123!';
      const newPassword = 'NewPassword123!';

      // Mock user data
      mockDatabaseService.query
        .mockResolvedValueOnce(mockQueryResult([{
          password_hash: await AuthService.hashPassword(currentPassword),
          email: 'test@example.com',
          first_name: 'John'
        }]))
        .mockResolvedValueOnce(mockQueryResult([])); // Update password

      const response = await request(app)
        .post('/api/auth/password/change')
        .send({ 
          currentPassword, 
          newPassword 
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Password changed successfully');
      expect(mockEmailInstance.sendPasswordChangeNotification).toHaveBeenCalled();
    });

    it('should reject incorrect current password', async () => {
      // Mock user data with different password
      mockDatabaseService.query.mockResolvedValueOnce(mockQueryResult([{
        password_hash: await AuthService.hashPassword('DifferentPassword123!'),
        email: 'test@example.com',
        first_name: 'John'
      }]));

      const response = await request(app)
        .post('/api/auth/password/change')
        .send({ 
          currentPassword: 'WrongPassword', 
          newPassword: 'NewPassword123!' 
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Current password is incorrect');
    });

    it('should reject weak new passwords', async () => {
      const currentPassword = 'CurrentPassword123!';

      // Mock user data
      mockDatabaseService.query.mockResolvedValueOnce(mockQueryResult([{
        password_hash: await AuthService.hashPassword(currentPassword),
        email: 'test@example.com',
        first_name: 'John'
      }]));

      const response = await request(app)
        .post('/api/auth/password/change')
        .send({ 
          currentPassword, 
          newPassword: '123' // Weak password
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Password validation failed');
    });

    it('should require authentication', async () => {
      // Mock authentication failure
      mockAuthenticateToken.mockImplementation((req: any, res: any, next: any) => {
        res.status(401).json({ error: 'Unauthorized' });
        return Promise.resolve();
      });

      const response = await request(app)
        .post('/api/auth/password/change')
        .send({ 
          currentPassword: 'CurrentPassword123!', 
          newPassword: 'NewPassword123!' 
        });

      expect(response.status).toBe(401);
    });

    it('should require both current and new passwords', async () => {
      let response = await request(app)
        .post('/api/auth/password/change')
        .send({ newPassword: 'NewPassword123!' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Current password is required');

      response = await request(app)
        .post('/api/auth/password/change')
        .send({ currentPassword: 'CurrentPassword123!' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('New password is required');
    });
  });

  describe('POST /api/auth/password/validate', () => {
    it('should validate strong password', async () => {
      const response = await request(app)
        .post('/api/auth/password/validate')
        .send({ password: 'StrongPassword123!' });

      expect(response.status).toBe(200);
      expect(response.body.isValid).toBe(true);
      expect(response.body.strength).toBe('strong');
      expect(response.body.score).toBeGreaterThan(80);
      expect(response.body.errors).toHaveLength(0);
    });

    it('should validate weak password', async () => {
      const response = await request(app)
        .post('/api/auth/password/validate')
        .send({ password: '123' });

      expect(response.status).toBe(200);
      expect(response.body.isValid).toBe(false);
      expect(response.body.strength).toBe('weak');
      expect(response.body.score).toBeLessThan(40);
      expect(response.body.errors.length).toBeGreaterThan(0);
    });

    it('should require password field', async () => {
      const response = await request(app)
        .post('/api/auth/password/validate')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Password is required');
    });
  });

  describe('GET /api/auth/password/reset-token/:token/validate', () => {
    it('should validate valid token', async () => {
      const token = 'valid-token';

      // Mock valid token
      mockDatabaseService.query.mockResolvedValueOnce(mockQueryResult([{
        id: 'token-1',
        user_id: 'user-1',
        expires_at: new Date(Date.now() + 3600000),
        used_at: null,
        email: 'test@example.com',
        is_active: true
      }]));

      const response = await request(app)
        .get(`/api/auth/password/reset-token/${token}/validate`);

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
      expect(response.body.email).toBe('test@example.com');
    });

    it('should reject invalid token', async () => {
      // Mock invalid token
      mockDatabaseService.query.mockResolvedValueOnce(mockQueryResult([]));

      const response = await request(app)
        .get('/api/auth/password/reset-token/invalid-token/validate');

      expect(response.status).toBe(400);
      expect(response.body.valid).toBe(false);
      expect(response.body.error).toContain('Invalid or expired');
    });

    it('should reject expired token', async () => {
      const token = 'expired-token';

      // Mock expired token
      mockDatabaseService.query.mockResolvedValueOnce(mockQueryResult([{
        id: 'token-1',
        user_id: 'user-1',
        expires_at: new Date(Date.now() - 3600000), // 1 hour ago
        used_at: null,
        email: 'test@example.com',
        is_active: true
      }]));

      const response = await request(app)
        .get(`/api/auth/password/reset-token/${token}/validate`);

      expect(response.status).toBe(400);
      expect(response.body.valid).toBe(false);
      expect(response.body.error).toContain('expired');
    });
  });
});