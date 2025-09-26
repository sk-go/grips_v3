import request from 'supertest';
import express from 'express';
import { DatabaseService } from '../../services/database';
import { RedisService } from '../../services/redis';
import { AuthService } from '../../services/auth';
import usersRoutes from '../../routes/users';
import { errorHandler } from '../../middleware/errorHandler';

// Mock services
jest.mock('../../services/database');
jest.mock('../../services/redis');
jest.mock('../../services/auth');
jest.mock('../../utils/logger');

const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;
const mockRedisService = RedisService as jest.Mocked<typeof RedisService>;
const mockAuthService = AuthService as jest.Mocked<typeof AuthService>;

describe('Users Routes', () => {
  let app: express.Application;
  let adminToken: string;
  let agentToken: string;
  let mockAdminUser: any;
  let mockAgentUser: any;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/users', usersRoutes);
    app.use(errorHandler);

    // Mock users
    mockAdminUser = {
      id: 'admin-123',
      email: 'admin@test.com',
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin',
      isActive: true,
      emailVerified: true
    };

    mockAgentUser = {
      id: 'agent-123',
      email: 'agent@test.com',
      firstName: 'Agent',
      lastName: 'User',
      role: 'agent',
      isActive: true,
      emailVerified: true
    };

    // Generate mock tokens
    adminToken = 'mock-admin-token';
    agentToken = 'mock-agent-token';
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock token verification
    mockAuthService.verifyAccessToken.mockImplementation((token: string) => {
      if (token === adminToken) {
        return {
          userId: mockAdminUser.id,
          email: mockAdminUser.email,
          role: mockAdminUser.role
        };
      }
      if (token === agentToken) {
        return {
          userId: mockAgentUser.id,
          email: mockAgentUser.email,
          role: mockAgentUser.role
        };
      }
      throw new Error('Invalid token');
    });

    // Mock getUserById
    mockAuthService.getUserById.mockImplementation((id: string) => {
      if (id === mockAdminUser.id) return Promise.resolve(mockAdminUser);
      if (id === mockAgentUser.id) return Promise.resolve(mockAgentUser);
      return Promise.resolve(null);
    });

    // Mock database query for user lookup in auth middleware
    mockDatabaseService.query.mockImplementation((query: string, params?: any[]) => {
      if (query.includes('SELECT id, email, first_name, last_name, role, is_active') && params) {
        const userId = params[0];
        if (userId === mockAdminUser.id) {
          return Promise.resolve({
            rows: [{
              id: mockAdminUser.id,
              email: mockAdminUser.email,
              first_name: mockAdminUser.firstName,
              last_name: mockAdminUser.lastName,
              role: mockAdminUser.role,
              is_active: mockAdminUser.isActive,
              keycloak_id: null,
              email_verified: mockAdminUser.emailVerified
            }],
            rowCount: 1
          });
        }
        if (userId === mockAgentUser.id) {
          return Promise.resolve({
            rows: [{
              id: mockAgentUser.id,
              email: mockAgentUser.email,
              first_name: mockAgentUser.firstName,
              last_name: mockAgentUser.lastName,
              role: mockAgentUser.role,
              is_active: mockAgentUser.isActive,
              keycloak_id: null,
              email_verified: mockAgentUser.emailVerified
            }],
            rowCount: 1
          });
        }
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  });

  describe('POST /api/users', () => {
    it('should create a new user when called by admin', async () => {
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
        .set('Authorization', `Bearer ${adminToken}`)
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

    it('should reject user creation when called by non-admin', async () => {
      const response = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          email: 'newuser@test.com',
          password: 'SecurePass123!',
          firstName: 'New',
          lastName: 'User'
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Insufficient permissions');
      expect(mockAuthService.createUser).not.toHaveBeenCalled();
    });

    it('should reject user creation without authentication', async () => {
      const response = await request(app)
        .post('/api/users')
        .send({
          email: 'newuser@test.com',
          password: 'SecurePass123!',
          firstName: 'New',
          lastName: 'User'
        });

      expect(response.status).toBe(401);
      expect(mockAuthService.createUser).not.toHaveBeenCalled();
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
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
          expect.stringContaining('password'),
          expect.stringContaining('firstName')
        ])
      );
      expect(mockAuthService.createUser).not.toHaveBeenCalled();
    });

    it('should handle duplicate email error', async () => {
      mockAuthService.createUser.mockRejectedValue(new Error('User with this email already exists'));

      const response = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
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
        .set('Authorization', `Bearer ${adminToken}`)
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

  describe('GET /api/users', () => {
    it('should return paginated users list for admin', async () => {
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
        },
        {
          id: 'user2',
          email: 'user2@test.com',
          first_name: 'User',
          last_name: 'Two',
          role: 'admin',
          is_active: true,
          email_verified: true,
          keycloak_id: null,
          created_at: new Date(),
          updated_at: new Date()
        }
      ];

      // Mock count query
      mockDatabaseService.query
        .mockResolvedValueOnce({ rows: [{ total: '2' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: mockUsers, rowCount: mockUsers.length });

      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 20 });

      expect(response.status).toBe(200);
      expect(response.body.users).toHaveLength(2);
      expect(response.body.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
        hasNext: false,
        hasPrev: false
      });
    });

    it('should reject users list request from non-admin', async () => {
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${agentToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Insufficient permissions');
    });

    it('should filter users by role', async () => {
      mockDatabaseService.query
        .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ role: 'admin' });

      expect(response.status).toBe(200);
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE role = $1'),
        expect.arrayContaining(['admin'])
      );
    });

    it('should search users by name and email', async () => {
      mockDatabaseService.query
        .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ search: 'john' });

      expect(response.status).toBe(200);
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('LOWER(first_name) LIKE LOWER'),
        expect.arrayContaining(['%john%'])
      );
    });
  });

  describe('GET /api/users/:id', () => {
    it('should return user profile for admin', async () => {
      const response = await request(app)
        .get(`/api/users/${mockAgentUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.user).toEqual({
        id: mockAgentUser.id,
        email: mockAgentUser.email,
        firstName: mockAgentUser.firstName,
        lastName: mockAgentUser.lastName,
        role: mockAgentUser.role,
        isActive: mockAgentUser.isActive,
        emailVerified: mockAgentUser.emailVerified,
        keycloakId: undefined
      });
    });

    it('should allow user to view their own profile', async () => {
      const response = await request(app)
        .get(`/api/users/${mockAgentUser.id}`)
        .set('Authorization', `Bearer ${agentToken}`);

      expect(response.status).toBe(200);
      expect(response.body.user.id).toBe(mockAgentUser.id);
    });

    it('should reject agent viewing another user profile', async () => {
      const response = await request(app)
        .get(`/api/users/${mockAdminUser.id}`)
        .set('Authorization', `Bearer ${agentToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Insufficient permissions to view this user');
    });

    it('should return 404 for non-existent user', async () => {
      mockAuthService.getUserById.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/users/non-existent')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('User not found');
    });
  });

  describe('PUT /api/users/:id', () => {
    it('should update user profile for admin', async () => {
      const updatedUser = {
        ...mockAgentUser,
        firstName: 'Updated',
        lastName: 'Name'
      };

      mockAuthService.updateUserProfile.mockResolvedValue(updatedUser);

      const response = await request(app)
        .put(`/api/users/${mockAgentUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Updated',
          lastName: 'Name'
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('User profile updated successfully');
      expect(response.body.user.firstName).toBe('Updated');
      expect(response.body.user.lastName).toBe('Name');
      expect(mockAuthService.updateUserProfile).toHaveBeenCalledWith(
        mockAgentUser.id,
        { firstName: 'Updated', lastName: 'Name' }
      );
    });

    it('should allow user to update their own profile', async () => {
      const updatedUser = {
        ...mockAgentUser,
        firstName: 'Self Updated'
      };

      mockAuthService.updateUserProfile.mockResolvedValue(updatedUser);

      const response = await request(app)
        .put(`/api/users/${mockAgentUser.id}`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          firstName: 'Self Updated'
        });

      expect(response.status).toBe(200);
      expect(response.body.user.firstName).toBe('Self Updated');
    });

    it('should reject agent updating another user profile', async () => {
      const response = await request(app)
        .put(`/api/users/${mockAdminUser.id}`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          firstName: 'Unauthorized Update'
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Insufficient permissions to update this user');
      expect(mockAuthService.updateUserProfile).not.toHaveBeenCalled();
    });

    it('should validate update fields', async () => {
      const response = await request(app)
        .put(`/api/users/${mockAgentUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
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
        .put(`/api/users/${mockAgentUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'taken@test.com'
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Email is already taken by another user');
    });

    it('should require at least one field to update', async () => {
      const response = await request(app)
        .put(`/api/users/${mockAgentUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
      expect(mockAuthService.updateUserProfile).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/users/:id', () => {
    it('should deactivate user for admin', async () => {
      const deactivatedUser = {
        id: mockAgentUser.id,
        email: mockAgentUser.email,
        first_name: mockAgentUser.firstName,
        last_name: mockAgentUser.lastName
      };

      mockDatabaseService.query.mockResolvedValue({
        rows: [deactivatedUser],
        rowCount: 1
      });

      mockAuthService.revokeAllRefreshTokens.mockResolvedValue();

      const response = await request(app)
        .delete(`/api/users/${mockAgentUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('User deactivated successfully');
      expect(response.body.user.isActive).toBe(false);
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET is_active = false'),
        [mockAgentUser.id]
      );
      expect(mockAuthService.revokeAllRefreshTokens).toHaveBeenCalledWith(mockAgentUser.id);
    });

    it('should reject deactivation by non-admin', async () => {
      const response = await request(app)
        .delete(`/api/users/${mockAdminUser.id}`)
        .set('Authorization', `Bearer ${agentToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Insufficient permissions');
      expect(mockDatabaseService.query).not.toHaveBeenCalled();
    });

    it('should prevent admin from deactivating themselves', async () => {
      const response = await request(app)
        .delete(`/api/users/${mockAdminUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Cannot deactivate your own account');
      expect(mockDatabaseService.query).not.toHaveBeenCalled();
    });

    it('should handle user not found', async () => {
      mockAuthService.getUserById.mockResolvedValue(null);

      const response = await request(app)
        .delete('/api/users/non-existent')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('User not found');
    });

    it('should handle already deactivated user', async () => {
      const inactiveUser = { ...mockAgentUser, isActive: false };
      mockAuthService.getUserById.mockResolvedValue(inactiveUser);

      const response = await request(app)
        .delete(`/api/users/${mockAgentUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('User is already deactivated');
    });
  });

  describe('POST /api/users/:id/reactivate', () => {
    it('should reactivate user for admin', async () => {
      const inactiveUser = { ...mockAgentUser, isActive: false };
      const reactivatedUser = {
        id: mockAgentUser.id,
        email: mockAgentUser.email,
        first_name: mockAgentUser.firstName,
        last_name: mockAgentUser.lastName
      };

      mockAuthService.getUserById.mockResolvedValue(inactiveUser);
      mockDatabaseService.query.mockResolvedValue({
        rows: [reactivatedUser],
        rowCount: 1
      });

      const response = await request(app)
        .post(`/api/users/${mockAgentUser.id}/reactivate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('User reactivated successfully');
      expect(response.body.user.isActive).toBe(true);
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET is_active = true'),
        [mockAgentUser.id]
      );
    });

    it('should reject reactivation by non-admin', async () => {
      const response = await request(app)
        .post(`/api/users/${mockAgentUser.id}/reactivate`)
        .set('Authorization', `Bearer ${agentToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Insufficient permissions');
    });

    it('should handle already active user', async () => {
      const response = await request(app)
        .post(`/api/users/${mockAgentUser.id}/reactivate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('User is already active');
    });

    it('should handle user not found', async () => {
      mockAuthService.getUserById.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/users/non-existent/reactivate')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('User not found');
    });
  });
});