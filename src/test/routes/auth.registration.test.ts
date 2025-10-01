import request from 'supertest';
import { app } from '../../server';
import { DatabaseService } from '../../services/database';
import { EmailVerificationService } from '../../services/emailVerificationService';

describe('Registration API Routes', () => {
  beforeAll(async () => {
    await DatabaseService.initialize();
  });

  afterAll(async () => {
    // Clean up test data
    await DatabaseService.query('DELETE FROM users WHERE email LIKE %test%');
  });

  describe('POST /auth/register', () => {
    it('should register a new user successfully', async () => {
      const userData = {
        email: 'test.registration@example.com',
        password: 'TestPassword123!',
        firstName: 'Test',
        lastName: 'User',
        role: 'agent'
      };

      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.requiresVerification).toBe(true);
      expect(response.body.user).toBeDefined();
      expect(response.body.user.email).toBe(userData.email);
      expect(response.body.user.emailVerified).toBe(false);
    });

    it('should reject registration with weak password', async () => {
      const userData = {
        email: 'test.weak@example.com',
        password: '123',
        firstName: 'Test',
        lastName: 'User'
      };

      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.success).toBeFalsy();
    });

    it('should reject registration with invalid email', async () => {
      const userData = {
        email: 'invalid-email',
        password: 'TestPassword123!',
        firstName: 'Test',
        lastName: 'User'
      };

      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.success).toBeFalsy();
    });
  });

  describe('GET /auth/verify-email/:token', () => {
    it('should return error for invalid token', async () => {
      const response = await request(app)
        .get('/auth/verify-email/invalid-token')
        .expect(400);

      expect(response.body.success).toBeFalsy();
    });
  });

  describe('POST /auth/resend-verification', () => {
    it('should handle resend verification request', async () => {
      const response = await request(app)
        .post('/auth/resend-verification')
        .send({ email: 'test@example.com' })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should reject invalid email format', async () => {
      const response = await request(app)
        .post('/auth/resend-verification')
        .send({ email: 'invalid-email' })
        .expect(400);

      expect(response.body.success).toBeFalsy();
    });
  });

  describe('GET /auth/registration-status', () => {
    it('should require authentication', async () => {
      await request(app)
        .get('/auth/registration-status')
        .expect(401);
    });
  });

  describe('Admin endpoints', () => {
    describe('GET /auth/admin/pending-registrations', () => {
      it('should require authentication', async () => {
        await request(app)
          .get('/auth/admin/pending-registrations')
          .expect(401);
      });
    });

    describe('POST /auth/admin/approve-registration/:userId', () => {
      it('should require authentication', async () => {
        await request(app)
          .post('/auth/admin/approve-registration/test-id')
          .expect(401);
      });
    });

    describe('POST /auth/admin/reject-registration/:userId', () => {
      it('should require authentication', async () => {
        await request(app)
          .post('/auth/admin/reject-registration/test-id')
          .send({ reason: 'Test rejection' })
          .expect(401);
      });
    });
  });
});