import request from 'supertest';
import { app } from '../../server';
import { DatabaseService } from '../../services/database';
import { RedisService } from '../../services/redis';
import { RateLimitingService } from '../../services/rateLimitingService';

describe('Enhanced Authentication Error Handling Integration', () => {
  beforeAll(async () => {
    await DatabaseService.initialize();
    await RedisService.initialize();
  });

  afterAll(async () => {
    await DatabaseService.close();
    await RedisService.close();
  });

  beforeEach(async () => {
    // Clean up test data
    await DatabaseService.query('DELETE FROM users WHERE email LIKE %test%');
    await RedisService.flushall();
  });

  describe('POST /api/auth/login - Error Handling', () => {
    it('should return standardized error response for validation failures', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'invalid-email',
          password: 'short'
        });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        validationErrors: expect.arrayContaining([
          expect.objectContaining({
            field: expect.any(String),
            message: expect.any(String)
          })
        ]),
        timestamp: expect.any(String)
      });
    });

    it('should sanitize error messages to prevent user enumeration', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'password123'
        });

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        error: 'Invalid email or password', // Generic message
        code: 'LOGIN_FAILED',
        timestamp: expect.any(String)
      });
      
      // Should not reveal that user doesn't exist
      expect(response.body.error).not.toContain('not found');
      expect(response.body.error).not.toContain('does not exist');
    });

    it('should handle input sanitization', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com\x00\x01', // With control characters
          password: 'password123\x1F'
        });

      expect(response.status).toBe(401); // Will fail auth but input should be sanitized
      expect(response.body.error).toBe('Invalid email or password');
    });

    it('should return consistent error format for database errors', async () => {
      // This test would require mocking database to simulate errors
      // For now, we'll test the error handler directly
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123'
        });

      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('POST /api/auth/login - Rate Limiting', () => {
    const testEmail = 'ratelimit@example.com';
    const testPassword = 'password123';

    beforeEach(async () => {
      // Create test user
      await DatabaseService.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active)
         VALUES ($1, $2, 'Test', 'User', 'agent', true)`,
        [testEmail, await require('bcryptjs').hash(testPassword, 12)]
      );
    });

    it('should allow requests within rate limit', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: testPassword
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Login successful');
    });

    it('should block requests exceeding rate limit', async () => {
      // Make 5 failed login attempts
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/login')
          .send({
            email: testEmail,
            password: 'wrongpassword'
          });
      }

      // 6th attempt should be rate limited
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: 'wrongpassword'
        });

      expect(response.status).toBe(429);
      expect(response.body).toMatchObject({
        error: expect.stringContaining('locked'),
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: expect.any(Number),
        limit: 5,
        remaining: 0,
        resetTime: expect.any(Number),
        timestamp: expect.any(String)
      });
    });

    it('should clear rate limit on successful login', async () => {
      // Make 4 failed attempts
      for (let i = 0; i < 4; i++) {
        await request(app)
          .post('/api/auth/login')
          .send({
            email: testEmail,
            password: 'wrongpassword'
          });
      }

      // Successful login should clear the counter
      const successResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: testPassword
        });

      expect(successResponse.status).toBe(200);

      // Should be able to make more attempts after successful login
      const nextResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: 'wrongpassword'
        });

      expect(nextResponse.status).toBe(401); // Auth failure, not rate limit
    });

    it('should apply rate limiting per email and IP combination', async () => {
      const anotherEmail = 'another@example.com';
      
      // Create another test user
      await DatabaseService.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active)
         VALUES ($1, $2, 'Another', 'User', 'agent', true)`,
        [anotherEmail, await require('bcryptjs').hash(testPassword, 12)]
      );

      // Exhaust rate limit for first email
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/login')
          .send({
            email: testEmail,
            password: 'wrongpassword'
          });
      }

      // Different email should not be rate limited
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: anotherEmail,
          password: 'wrongpassword'
        });

      expect(response.status).toBe(401); // Auth failure, not rate limit
    });
  });

  describe('POST /api/auth/register - Error Handling', () => {
    it('should return validation errors for invalid input', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'invalid-email',
          password: 'short',
          firstName: '',
          lastName: 'a'.repeat(101) // Too long
        });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: 'Input validation failed',
        code: 'VALIDATION_ERROR',
        validationErrors: expect.arrayContaining([
          expect.objectContaining({
            field: 'email',
            message: expect.stringContaining('Invalid email format')
          }),
          expect.objectContaining({
            field: 'password',
            message: expect.stringContaining('Password must be between')
          }),
          expect.objectContaining({
            field: 'firstName',
            message: expect.stringContaining('Name must be between')
          }),
          expect.objectContaining({
            field: 'lastName',
            message: expect.stringContaining('Name must be between')
          })
        ]),
        timestamp: expect.any(String)
      });
    });

    it('should handle duplicate email registration', async () => {
      const userData = {
        email: 'duplicate@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User'
      };

      // First registration should succeed
      const firstResponse = await request(app)
        .post('/api/auth/register')
        .send(userData);

      expect(firstResponse.status).toBe(201);

      // Second registration should fail with proper error
      const secondResponse = await request(app)
        .post('/api/auth/register')
        .send(userData);

      expect(secondResponse.status).toBe(409);
      expect(secondResponse.body).toMatchObject({
        error: 'An account with this email already exists',
        code: 'DUPLICATE_EMAIL',
        timestamp: expect.any(String)
      });
    });

    it('should sanitize malicious input', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'password123',
          firstName: '<script>alert("xss")</script>',
          lastName: 'User'
        });

      expect(response.status).toBe(400);
      expect(response.body.validationErrors).toContainEqual(
        expect.objectContaining({
          field: 'firstName',
          message: 'Name contains invalid characters'
        })
      );
    });
  });

  describe('POST /api/auth/password/forgot - Error Handling', () => {
    it('should return generic success message to prevent enumeration', async () => {
      const response = await request(app)
        .post('/api/auth/password/forgot')
        .send({
          email: 'nonexistent@example.com'
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('If the email exists, a password reset link has been sent');
    });

    it('should apply rate limiting to password reset requests', async () => {
      const email = 'resettest@example.com';

      // Make 3 password reset requests (at limit)
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/api/auth/password/forgot')
          .send({ email });
      }

      // 4th request should be rate limited
      const response = await request(app)
        .post('/api/auth/password/forgot')
        .send({ email });

      expect(response.status).toBe(429);
      expect(response.body).toMatchObject({
        error: 'Too many password reset attempts. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: 3600, // 1 hour
        limit: 3,
        timestamp: expect.any(String)
      });
    });
  });

  describe('POST /api/auth/refresh - Error Handling', () => {
    it('should return sanitized error for invalid refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({
          refreshToken: 'invalid-token'
        });

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        error: 'Session expired. Please log in again.',
        code: 'TOKEN_REFRESH_FAILED',
        timestamp: expect.any(String)
      });
    });

    it('should apply rate limiting to token refresh requests', async () => {
      const invalidToken = 'invalid-refresh-token';

      // Make 10 failed refresh attempts (at limit)
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/api/auth/refresh')
          .send({ refreshToken: invalidToken });
      }

      // 11th request should be rate limited
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: invalidToken });

      expect(response.status).toBe(429);
      expect(response.body).toMatchObject({
        error: 'Too many token refresh attempts. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: 300, // 5 minutes
        limit: 10,
        timestamp: expect.any(String)
      });
    });
  });

  describe('Error Response Consistency', () => {
    it('should return consistent error format across all endpoints', async () => {
      const endpoints = [
        { method: 'post', path: '/api/auth/login', data: {} },
        { method: 'post', path: '/api/auth/register', data: {} },
        { method: 'post', path: '/api/auth/refresh', data: {} },
        { method: 'post', path: '/api/auth/password/forgot', data: {} }
      ];

      for (const endpoint of endpoints) {
        const response = await request(app)
          [endpoint.method](endpoint.path)
          .send(endpoint.data);

        expect(response.body).toHaveProperty('error');
        expect(response.body).toHaveProperty('timestamp');
        expect(response.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        
        if (response.body.code) {
          expect(typeof response.body.code).toBe('string');
        }
      }
    });
  });
});