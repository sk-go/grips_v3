import request from 'supertest';
import express from 'express';
import { DatabaseService } from '../../services/database';
import { RedisService } from '../../services/redis';
import { AuthService } from '../../services/auth';
import usersRoutes from '../../routes/users';
import { authenticateToken, requireRole } from '../../middleware/auth';
import { errorHandler } from '../../middleware/errorHandler';

describe('User Management Integration Tests', () => {
  let app: express.Application;
  let adminUser: any;
  let agentUser: any;
  let adminTokens: any;
  let agentTokens: any;

  beforeAll(async () => {
    // Initialize test database and Redis
    await DatabaseService.initialize();
    await RedisService.initialize();

    // Setup Express app
    app = express();
    app.use(express.json());
    app.use('/api/users', usersRoutes);
    app.use(errorHandler);

    // Create test admin user
    adminUser = await AuthService.createUser({
      email: 'admin@integration.test',
      password: 'AdminPass123!',
      firstName: 'Test',
      lastName: 'Admin',
      role: 'admin'
    });

    // Create test agent user
    agentUser = await AuthService.createUser({
      email: 'agent@integration.test',
      password: 'AgentPass123!',
      firstName: 'Test',
      lastName: 'Agent',
      role: 'agent'
    });

    // Authenticate users to get tokens
    adminTokens = await AuthService.authenticateUser('admin@integration.test', 'AdminPass123!');
    agentTokens = await AuthService.authenticateUser('agent@integration.test', 'AgentPass123!');
  });

  afterAll(async () => {
    // Clean up test data
    try {
      await DatabaseService.query('DELETE FROM users WHERE email LIKE \'%@integration.test\'', []);
    } catch (error) {
      console.warn('Cleanup warning:', error);
    }
    
    await DatabaseService.close();
    await RedisService.close();
  });

  describe('Admin User Creation', () => {
    it('should create a new agent user successfully', async () => {
      const newUserData = {
        email: 'newagent@integration.test',
        password: 'NewAgentPass123!',
        firstName: 'New',
        lastName: 'Agent',
        role: 'agent'
      };

      const response = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send(newUserData);

      expect(response.status).toBe(201);
      expect(response.body.message).toBe('User created successfully');
      expect(response.body.user).toMatchObject({
        email: newUserData.email,
        firstName: newUserData.firstName,
        lastName: newUserData.lastName,
        role: newUserData.role,
        isActive: true,
        emailVerified: false
      });

      // Verify user was actually created in database
      const createdUser = await AuthService.getUserById(response.body.user.id);
      expect(createdUser).toBeTruthy();
      expect(createdUser!.email).toBe(newUserData.email);
    });

    it('should create a new admin user successfully', async () => {
      const newAdminData = {
        email: 'newadmin@integration.test',
        password: 'NewAdminPass123!',
        firstName: 'New',
        lastName: 'Admin',
        role: 'admin'
      };

      const response = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send(newAdminData);

      expect(response.status).toBe(201);
      expect(response.body.user.role).toBe('admin');

      // Verify admin can authenticate
      const authResult = await AuthService.authenticateUser(newAdminData.email, newAdminData.password);
      expect(authResult.user.role).toBe('admin');
    });

    it('should reject duplicate email addresses', async () => {
      const duplicateUserData = {
        email: adminUser.email, // Use existing admin email
        password: 'DuplicatePass123!',
        firstName: 'Duplicate',
        lastName: 'User',
        role: 'agent'
      };

      const response = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send(duplicateUserData);

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('User with this email already exists');
    });

    it('should reject weak passwords', async () => {
      const weakPasswordData = {
        email: 'weakpass@integration.test',
        password: '123', // Too weak
        firstName: 'Weak',
        lastName: 'Password',
        role: 'agent'
      };

      const response = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send(weakPasswordData);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Password validation failed');
    });
  });

  describe('User Profile Management', () => {
    let testUser: any;

    beforeEach(async () => {
      // Create a test user for profile operations
      testUser = await AuthService.createUser({
        email: `testuser${Date.now()}@integration.test`,
        password: 'TestPass123!',
        firstName: 'Test',
        lastName: 'User',
        role: 'agent'
      });
    });

    it('should allow admin to update any user profile', async () => {
      const updateData = {
        firstName: 'Updated',
        lastName: 'Name',
        email: `updated${Date.now()}@integration.test`
      };

      const response = await request(app)
        .put(`/api/users/${testUser.id}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('User profile updated successfully');
      expect(response.body.user).toMatchObject(updateData);

      // Verify changes in database
      const updatedUser = await AuthService.getUserById(testUser.id);
      expect(updatedUser!.firstName).toBe(updateData.firstName);
      expect(updatedUser!.lastName).toBe(updateData.lastName);
      expect(updatedUser!.email).toBe(updateData.email);
    });

    it('should allow user to update their own profile', async () => {
      // Authenticate as the test user
      const testUserTokens = await AuthService.authenticateUser(testUser.email, 'TestPass123!');

      const updateData = {
        firstName: 'Self Updated'
      };

      const response = await request(app)
        .put(`/api/users/${testUser.id}`)
        .set('Authorization', `Bearer ${testUserTokens.accessToken}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.user.firstName).toBe('Self Updated');
    });

    it('should prevent agent from updating other user profiles', async () => {
      const updateData = {
        firstName: 'Unauthorized Update'
      };

      const response = await request(app)
        .put(`/api/users/${testUser.id}`)
        .set('Authorization', `Bearer ${agentTokens.accessToken}`)
        .send(updateData);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Insufficient permissions to update this user');
    });

    it('should reject email updates to existing emails', async () => {
      const updateData = {
        email: adminUser.email // Try to use admin's email
      };

      const response = await request(app)
        .put(`/api/users/${testUser.id}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .send(updateData);

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Email is already taken by another user');
    });
  });

  describe('User Deactivation and Reactivation', () => {
    let testUser: any;

    beforeEach(async () => {
      // Create a test user for deactivation operations
      testUser = await AuthService.createUser({
        email: `deactivateuser${Date.now()}@integration.test`,
        password: 'TestPass123!',
        firstName: 'Deactivate',
        lastName: 'User',
        role: 'agent'
      });
    });

    it('should allow admin to deactivate a user', async () => {
      const response = await request(app)
        .delete(`/api/users/${testUser.id}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('User deactivated successfully');
      expect(response.body.user.isActive).toBe(false);

      // Verify user is deactivated in database
      const deactivatedUser = await AuthService.getUserById(testUser.id);
      expect(deactivatedUser!.isActive).toBe(false);

      // Verify user cannot authenticate
      await expect(
        AuthService.authenticateUser(testUser.email, 'TestPass123!')
      ).rejects.toThrow('Account is inactive');
    });

    it('should allow admin to reactivate a deactivated user', async () => {
      // First deactivate the user
      await request(app)
        .delete(`/api/users/${testUser.id}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`);

      // Then reactivate
      const response = await request(app)
        .post(`/api/users/${testUser.id}/reactivate`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('User reactivated successfully');
      expect(response.body.user.isActive).toBe(true);

      // Verify user is reactivated in database
      const reactivatedUser = await AuthService.getUserById(testUser.id);
      expect(reactivatedUser!.isActive).toBe(true);

      // Verify user can authenticate again
      const authResult = await AuthService.authenticateUser(testUser.email, 'TestPass123!');
      expect(authResult.user.id).toBe(testUser.id);
    });

    it('should prevent admin from deactivating themselves', async () => {
      const response = await request(app)
        .delete(`/api/users/${adminUser.id}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Cannot deactivate your own account');

      // Verify admin is still active
      const adminStillActive = await AuthService.getUserById(adminUser.id);
      expect(adminStillActive!.isActive).toBe(true);
    });

    it('should prevent non-admin from deactivating users', async () => {
      const response = await request(app)
        .delete(`/api/users/${testUser.id}`)
        .set('Authorization', `Bearer ${agentTokens.accessToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Insufficient permissions');

      // Verify user is still active
      const userStillActive = await AuthService.getUserById(testUser.id);
      expect(userStillActive!.isActive).toBe(true);
    });
  });

  describe('User Listing and Search', () => {
    let testUsers: any[] = [];

    beforeAll(async () => {
      // Create multiple test users for listing tests
      for (let i = 0; i < 5; i++) {
        const user = await AuthService.createUser({
          email: `listuser${i}@integration.test`,
          password: 'TestPass123!',
          firstName: `User${i}`,
          lastName: `Test${i}`,
          role: i % 2 === 0 ? 'agent' : 'admin'
        });
        testUsers.push(user);
      }
    });

    it('should return paginated user list for admin', async () => {
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .query({ page: 1, limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.users).toBeInstanceOf(Array);
      expect(response.body.users.length).toBeGreaterThan(0);
      expect(response.body.pagination).toMatchObject({
        page: 1,
        limit: 10,
        total: expect.any(Number),
        totalPages: expect.any(Number),
        hasNext: expect.any(Boolean),
        hasPrev: false
      });
    });

    it('should filter users by role', async () => {
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .query({ role: 'admin' });

      expect(response.status).toBe(200);
      expect(response.body.users.every((user: any) => user.role === 'admin')).toBe(true);
    });

    it('should search users by name', async () => {
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`)
        .query({ search: 'User0' });

      expect(response.status).toBe(200);
      expect(response.body.users.some((user: any) => 
        user.firstName.includes('User0') || user.lastName.includes('User0')
      )).toBe(true);
    });

    it('should prevent non-admin from listing users', async () => {
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${agentTokens.accessToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Insufficient permissions');
    });
  });

  describe('User Profile Viewing', () => {
    it('should allow admin to view any user profile', async () => {
      const response = await request(app)
        .get(`/api/users/${agentUser.id}`)
        .set('Authorization', `Bearer ${adminTokens.accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.user).toMatchObject({
        id: agentUser.id,
        email: agentUser.email,
        firstName: agentUser.firstName,
        lastName: agentUser.lastName,
        role: agentUser.role,
        isActive: true
      });
    });

    it('should allow user to view their own profile', async () => {
      const response = await request(app)
        .get(`/api/users/${agentUser.id}`)
        .set('Authorization', `Bearer ${agentTokens.accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.user.id).toBe(agentUser.id);
    });

    it('should prevent agent from viewing other user profiles', async () => {
      const response = await request(app)
        .get(`/api/users/${adminUser.id}`)
        .set('Authorization', `Bearer ${agentTokens.accessToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Insufficient permissions to view this user');
    });

    it('should return 404 for non-existent user', async () => {
      const response = await request(app)
        .get('/api/users/non-existent-id')
        .set('Authorization', `Bearer ${adminTokens.accessToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('User not found');
    });
  });
});