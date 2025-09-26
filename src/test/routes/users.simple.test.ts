import request from 'supertest';
import express from 'express';
import { DatabaseService } from '../../services/database';
import { AuthService } from '../../services/auth';
import usersRoutes from '../../routes/users';
import { errorHandler } from '../../middleware/errorHandler';

// Mock services
jest.mock('../../services/database');
jest.mock('../../services/auth');
jest.mock('../../utils/logger');

const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;
const mockAuthService = AuthService as jest.Mocked<typeof AuthService>;

// Mock the auth middleware to bypass authentication for testing
jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req: any, res: any, next: any) => {
    // Mock admin user
    req.user = {
      id: 'admin-123',
      email: 'admin@test.com',
      role: 'admin',
      firstName: 'Admin',
      lastName: 'User',
      isActive: true
    };
    next();
  },
  requireRole: (roles: string | string[]) => (req: any, res: any, next: any) => {
    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  }
}));

describe('Users Routes - Core Functionality', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/users', usersRoutes);
    app.use(errorHandler);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/users - User Creation', () => {
    it('should create a new user successfully', async () => {
      const newUser = {
        id: 'new-user-123',
        email: 'newuser@test.com',
        firstName: 'New',
        lastName: 'User',
        role: 'agent',
        isActive: true,
        emailVerified: false
      };

      mockAuthService.createUser.mockResolvedValue(newUser);

      const response = await request(app)
        .post('/api/users')
        .send({
          email: 'newuser@test.com',
          password: 'SecurePass123!',
          firstName: 'New',
          lastName: 'User',
          role: 'agent'
        });

      expect(response.status).toBe(201);
      expect(response.body.message).toBe('User created successfully');
      expect(response.body.user).toEqual({
        id: newUser.id,
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        role: newUser.role,
        isActive: newUser.isActive,
        emailVerified: newUser.emailVerified
      });
      expect(mockAuthService.createUser).toHaveBeenCalledWith({
        email: 'newuser@test.com',
        password: 'SecurePass123!',
        firstName: 'New',
        lastName: 'User',
        role: 'agent'
      });
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/users')
        .send({
          email: 'invalid-email',
          password: '123', // Too short
          firstName: '',
          lastName: 'User'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details).toEqual(
        expect.arrayContaining([
          expect.stringContaining('email'),
        ])
      );
      expect(mockAuthService.createUser).not.toHaveBeenCalled();
    });

    it('should handle duplicate email error', async () => {
      mockAuthService.createUser.mockRejectedValue(new Error('User with this email already exists'));

      const response = await request(app)
        .post('/api/users')
        .send({
          email: 'existing@test.com',
          password: 'SecurePass123!',
          firstName: 'New',
          lastName: 'User'
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('User with this email already exists');
    });

    it('should handle password validation error', async () => {
      mockAuthService.createUser.mockRejectedValue(new Error('Password validation failed: Password must contain at least one uppercase letter'));

      const response = await request(app)
        .post('/api/users')
        .send({
          email: 'newuser@test.com',
          password: 'weakpassword',
          firstName: 'New',
          lastName: 'User'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Password validation failed: Password must contain at least one uppercase letter');
    });
  });

  describe('GET /api/users - User Listing', () => {
    it('should return paginated users list', async () => {
      const mockUsers = [
        {
          id: 'user1',
          email: 'user1@test.com',
          first_name: 'User',
          last_name: 'One',
          role: 'agent',
          is_active: true,
          email_verified: true,
          keycloak_id: null,
          created_at: new Date(),
          updated_at: new Date()
        }
      ];

      // Mock count query and users query
      mockDatabaseService.query
        .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: mockUsers, rowCount: mockUsers.length });

      const response = await request(app)
        .get('/api/users')
        .query({ page: 1, limit: 20 });

      expect(response.status).toBe(200);
      expect(response.body.users).toHaveLength(1);
      expect(response.body.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
        hasNext: false,
        hasPrev: false
      });
    });

    it('should filter users by role', async () => {
      mockDatabaseService.query
        .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const response = await request(app)
        .get('/api/users')
        .query({ role: 'admin' });

      expect(response.status).toBe(200);
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE role = $1'),
        expect.arrayContaining(['admin'])
      );
    });
  });

  describe('GET /api/users/:id - User Profile', () => {
    it('should return user profile', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'user@test.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'agent',
        isActive: true,
        emailVerified: true
      };

      mockAuthService.getUserById.mockResolvedValue(mockUser);

      const response = await request(app)
        .get('/api/users/user-123');

      expect(response.status).toBe(200);
      expect(response.body.user).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        firstName: mockUser.firstName,
        lastName: mockUser.lastName,
        role: mockUser.role,
        isActive: mockUser.isActive,
        emailVerified: mockUser.emailVerified,
        keycloakId: undefined
      });
    });

    it('should return 404 for non-existent user', async () => {
      mockAuthService.getUserById.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/users/non-existent');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('User not found');
    });
  });

  describe('PUT /api/users/:id - User Profile Update', () => {
    it('should update user profile', async () => {
      const updatedUser = {
        id: 'user-123',
        email: 'updated@test.com',
        firstName: 'Updated',
        lastName: 'Name',
        role: 'agent',
        isActive: true,
        emailVerified: true
      };

      mockAuthService.updateUserProfile.mockResolvedValue(updatedUser);

      const response = await request(app)
        .put('/api/users/user-123')
        .send({
          firstName: 'Updated',
          lastName: 'Name',
          email: 'updated@test.com'
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('User profile updated successfully');
      expect(response.body.user.firstName).toBe('Updated');
      expect(response.body.user.lastName).toBe('Name');
      expect(response.body.user.email).toBe('updated@test.com');
      expect(mockAuthService.updateUserProfile).toHaveBeenCalledWith(
        'user-123',
        { firstName: 'Updated', lastName: 'Name', email: 'updated@test.com' }
      );
    });

    it('should validate update fields', async () => {
      const response = await request(app)
        .put('/api/users/user-123')
        .send({
          firstName: '', // Invalid empty string
          email: 'invalid-email'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
      expect(mockAuthService.updateUserProfile).not.toHaveBeenCalled();
    });

    it('should handle email already taken error', async () => {
      mockAuthService.updateUserProfile.mockRejectedValue(new Error('Email is already taken'));

      const response = await request(app)
        .put('/api/users/user-123')
        .send({
          email: 'taken@test.com'
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Email is already taken by another user');
    });

    it('should require at least one field to update', async () => {
      const response = await request(app)
        .put('/api/users/user-123')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
      expect(mockAuthService.updateUserProfile).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/users/:id - User Deactivation', () => {
    it('should deactivate user', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'user@test.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'agent',
        isActive: true,
        emailVerified: true
      };

      const deactivatedUser = {
        id: 'user-123',
        email: 'user@test.com',
        first_name: 'Test',
        last_name: 'User'
      };

      mockAuthService.getUserById.mockResolvedValue(mockUser);
      mockDatabaseService.query.mockResolvedValue({
        rows: [deactivatedUser],
        rowCount: 1
      });
      mockAuthService.revokeAllRefreshTokens.mockResolvedValue();

      const response = await request(app)
        .delete('/api/users/user-123');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('User deactivated successfully');
      expect(response.body.user.isActive).toBe(false);
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET is_active = false'),
        ['user-123']
      );
      expect(mockAuthService.revokeAllRefreshTokens).toHaveBeenCalledWith('user-123');
    });

    it('should handle user not found', async () => {
      mockAuthService.getUserById.mockResolvedValue(null);

      const response = await request(app)
        .delete('/api/users/non-existent');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('User not found');
    });

    it('should handle already deactivated user', async () => {
      const inactiveUser = {
        id: 'user-123',
        email: 'user@test.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'agent',
        isActive: false,
        emailVerified: true
      };

      mockAuthService.getUserById.mockResolvedValue(inactiveUser);

      const response = await request(app)
        .delete('/api/users/user-123');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('User is already deactivated');
    });
  });

  describe('POST /api/users/:id/reactivate - User Reactivation', () => {
    it('should reactivate user', async () => {
      const inactiveUser = {
        id: 'user-123',
        email: 'user@test.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'agent',
        isActive: false,
        emailVerified: true
      };

      const reactivatedUser = {
        id: 'user-123',
        email: 'user@test.com',
        first_name: 'Test',
        last_name: 'User'
      };

      mockAuthService.getUserById.mockResolvedValue(inactiveUser);
      mockDatabaseService.query.mockResolvedValue({
        rows: [reactivatedUser],
        rowCount: 1
      });

      const response = await request(app)
        .post('/api/users/user-123/reactivate');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('User reactivated successfully');
      expect(response.body.user.isActive).toBe(true);
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET is_active = true'),
        ['user-123']
      );
    });

    it('should handle already active user', async () => {
      const activeUser = {
        id: 'user-123',
        email: 'user@test.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'agent',
        isActive: true,
        emailVerified: true
      };

      mockAuthService.getUserById.mockResolvedValue(activeUser);

      const response = await request(app)
        .post('/api/users/user-123/reactivate');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('User is already active');
    });

    it('should handle user not found', async () => {
      mockAuthService.getUserById.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/users/non-existent/reactivate');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('User not found');
    });
  });
});