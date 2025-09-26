import request from 'supertest';
import express, { Request, Response } from 'express';
import { authenticateToken, requireRole, optionalAuth, authenticateWithRefresh } from '../../middleware/auth';
import { AuthService } from '../../services/auth';
import { DatabaseService } from '../../services/database';

// Mock dependencies
jest.mock('../../services/database');
const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;

describe('Authentication Middleware Integration', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = express();
    app.use(express.json());

    // Test routes
    app.get('/protected', authenticateToken, (req, res) => {
      res.json({ 
        message: 'Protected route accessed',
        user: req.user,
        authMethod: req.user?.authMethod
      });
    });

    app.get('/admin-only', authenticateToken, requireRole('admin'), (req, res) => {
      res.json({ message: 'Admin route accessed', user: req.user });
    });

    app.get('/optional', optionalAuth, (req, res) => {
      res.json({ 
        message: 'Optional auth route',
        authenticated: !!req.user,
        user: req.user
      });
    });

    app.get('/with-refresh', authenticateWithRefresh, (req: Request, res: Response) => {
      res.json({ 
        message: 'Route with refresh capability',
        user: req.user
      });
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Local JWT Authentication', () => {
    const mockUser = {
      id: 'user-123',
      email: 'test@example.com',
      first_name: 'John',
      last_name: 'Doe',
      role: 'agent',
      is_active: true,
      keycloak_id: null,
      email_verified: true
    };

    it('should allow access to protected route with valid local JWT', async () => {
      // Create a valid JWT token
      const tokenPayload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'agent'
      };
      const token = AuthService.generateAccessToken(tokenPayload);

      // Mock database response
      mockDatabaseService.query.mockResolvedValue({
        rows: [mockUser],
        rowCount: 1
      });

      const response = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.message).toBe('Protected route accessed');
      expect(response.body.user.id).toBe('user-123');
      expect(response.body.user.email).toBe('test@example.com');
      expect(response.body.authMethod).toBe('local');
    });

    it('should deny access to admin route for non-admin user', async () => {
      const tokenPayload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'agent' // Not admin
      };
      const token = AuthService.generateAccessToken(tokenPayload);

      mockDatabaseService.query.mockResolvedValue({
        rows: [mockUser],
        rowCount: 1
      });

      const response = await request(app)
        .get('/admin-only')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(response.body.error).toBe('Insufficient permissions');
      expect(response.body.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should allow access to admin route for admin user', async () => {
      const adminUser = { ...mockUser, role: 'admin' };
      const tokenPayload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'admin'
      };
      const token = AuthService.generateAccessToken(tokenPayload);

      mockDatabaseService.query.mockResolvedValue({
        rows: [adminUser],
        rowCount: 1
      });

      const response = await request(app)
        .get('/admin-only')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.message).toBe('Admin route accessed');
      expect(response.body.user.role).toBe('admin');
    });

    it('should work with optional auth when token is provided', async () => {
      const tokenPayload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'agent'
      };
      const token = AuthService.generateAccessToken(tokenPayload);

      mockDatabaseService.query.mockResolvedValue({
        rows: [mockUser],
        rowCount: 1
      });

      const response = await request(app)
        .get('/optional')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.authenticated).toBe(true);
      expect(response.body.user.id).toBe('user-123');
    });

    it('should work with optional auth when no token is provided', async () => {
      const response = await request(app)
        .get('/optional')
        .expect(200);

      expect(response.body.authenticated).toBe(false);
      expect(response.body.user).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    it('should return 401 for missing token', async () => {
      const response = await request(app)
        .get('/protected')
        .expect(401);

      expect(response.body.error).toBe('Access token required');
      expect(response.body.code).toBe('TOKEN_MISSING');
    });

    it('should return 401 for invalid token', async () => {
      const response = await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.error).toBe('Invalid or expired token');
      expect(response.body.code).toBe('TOKEN_INVALID');
    });

    it('should return 401 for inactive user', async () => {
      const inactiveUser = {
        id: 'user-123',
        email: 'test@example.com',
        first_name: 'John',
        last_name: 'Doe',
        role: 'agent',
        is_active: false, // Inactive
        keycloak_id: null,
        email_verified: true
      };

      const tokenPayload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'agent'
      };
      const token = AuthService.generateAccessToken(tokenPayload);

      mockDatabaseService.query.mockResolvedValue({
        rows: [inactiveUser],
        rowCount: 1
      });

      const response = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);

      expect(response.body.error).toBe('User account is inactive');
      expect(response.body.code).toBe('ACCOUNT_INACTIVE');
    });

    it('should return 401 for token email mismatch', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'different@example.com', // Different email
        first_name: 'John',
        last_name: 'Doe',
        role: 'agent',
        is_active: true,
        keycloak_id: null,
        email_verified: true
      };

      const tokenPayload = {
        userId: 'user-123',
        email: 'test@example.com', // Different email in token
        role: 'agent'
      };
      const token = AuthService.generateAccessToken(tokenPayload);

      mockDatabaseService.query.mockResolvedValue({
        rows: [mockUser],
        rowCount: 1
      });

      const response = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);

      expect(response.body.error).toBe('Invalid token');
      expect(response.body.code).toBe('TOKEN_INVALID');
    });
  });

  describe('Token Structure Validation', () => {
    it('should reject malformed JWT tokens', async () => {
      const response = await request(app)
        .get('/with-refresh')
        .set('Authorization', 'Bearer malformed.token')
        .expect(401);

      expect(response.body.error).toBe('Invalid token format');
      expect(response.body.code).toBe('TOKEN_MALFORMED');
    });

    it('should reject tokens with invalid base64 encoding', async () => {
      const response = await request(app)
        .get('/with-refresh')
        .set('Authorization', 'Bearer invalid-base64.invalid-base64.signature')
        .expect(401);

      expect(response.body.error).toBe('Invalid token format');
      expect(response.body.code).toBe('TOKEN_MALFORMED');
    });
  });
});