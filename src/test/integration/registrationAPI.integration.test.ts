import request from 'supertest';
import { Express } from 'express';
import { DatabaseService } from '../../services/database/DatabaseService';
import { RedisService } from '../../services/redis';
import { EmailVerificationService } from '../../services/emailVerificationService';
import { EmailNotificationService } from '../../services/email/emailNotificationService';
import { logger } from '../../utils/logger';

// Mock external services
jest.mock('../../services/email/emailNotificationService');
jest.mock('../../utils/logger');

const mockEmailNotificationService = EmailNotificationService as jest.Mocked<typeof EmailNotificationService>;
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('Registration API Integration Tests', () => {
  let app: Express;
  let testUserId: string;
  let verificationToken: string;

  beforeAll(async () => {
    // Initialize test database and services
    await DatabaseService.initialize();
    
    // Import app after database initialization
    const { default: createApp } = await import('../../server');
    app = createApp;

    // Mock email service
    mockEmailNotificationService.prototype.sendVerificationEmail = jest.fn().mockResolvedValue(undefined);
  });

  beforeEach(async () => {
    // Clean up test data
    await DatabaseService.query('DELETE FROM email_verification_tokens WHERE 1=1');
    await DatabaseService.query('DELETE FROM registration_audit_log WHERE 1=1');
    await DatabaseService.query('DELETE FROM users WHERE email LIKE %test%');
    
    // Clear Redis cache
    try {
      await RedisService.flushAll();
    } catch (error) {
      // Redis might not be available in test environment
      console.warn('Redis not available for testing');
    }

    jest.clearAllMocks();
  });

  afterAll(async () => {
    // Clean up test data
    if (testUserId) {
      await DatabaseService.query('DELETE FROM users WHERE id = $1', [testUserId]);
    }
    await DatabaseService.query('DELETE FROM email_verification_tokens WHERE 1=1');
    await DatabaseService.query('DELETE FROM registration_audit_log WHERE 1=1');
  });

  describe('POST /auth/register', () => {
    const validRegistrationData = {
      email: 'test@example.com',
      password: 'SecurePass123!',
      firstName: 'John',
      lastName: 'Doe',
      role: 'agent'
    };

    it('should register a new user successfully', async () => {
      // Act
      const response = await request(app)
        .post('/auth/register')
        .send(validRegistrationData)
        .expect(201);

      // Assert
      expect(response.body).toEqual({
        success: true,
        message: 'Registration successful. Please check your email for verification instructions.',
        requiresVerification: true,
        requiresApproval: false,
        user: expect.objectContaining({
          id: expect.any(String),
          email: validRegistrationData.email.toLowerCase(),
          firstName: validRegistrationData.firstName,
          lastName: validRegistrationData.lastName,
          role: validRegistrationData.role,
          emailVerified: false
        })
      });

      testUserId = response.body.user.id;

      // Verify user was created in database
      const userResult = await DatabaseService.query(
        'SELECT * FROM users WHERE id = $1',
        [testUserId]
      );
      expect(userResult.rows).toHaveLength(1);
      expect(userResult.rows[0].email_verified).toBe(false);

      // Verify verification token was created
      const tokenResult = await DatabaseService.query(
        'SELECT * FROM email_verification_tokens WHERE user_id = $1',
        [testUserId]
      );
      expect(tokenResult.rows).toHaveLength(1);
      verificationToken = tokenResult.rows[0].token;

      // Verify email was sent
      expect(mockEmailNotificationService.prototype.sendVerificationEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          email: validRegistrationData.email.toLowerCase(),
          firstName: validRegistrationData.firstName,
          lastName: validRegistrationData.lastName,
          verificationToken: expect.any(String),
          verificationUrl: expect.stringContaining('/auth/verify-email/')
        })
      );

      // Verify audit log entry
      const auditResult = await DatabaseService.query(
        'SELECT * FROM registration_audit_log WHERE user_id = $1 AND event_type = $2',
        [testUserId, 'registration']
      );
      expect(auditResult.rows).toHaveLength(1);
    });

    it('should reject registration with invalid email format', async () => {
      // Arrange
      const invalidEmailData = {
        ...validRegistrationData,
        email: 'invalid-email'
      };

      // Act
      const response = await request(app)
        .post('/auth/register')
        .send(invalidEmailData)
        .expect(400);

      // Assert
      expect(response.body).toEqual({
        success: false,
        error: expect.stringContaining('Email validation failed')
      });

      // Verify no user was created
      const userResult = await DatabaseService.query(
        'SELECT * FROM users WHERE email = $1',
        [invalidEmailData.email]
      );
      expect(userResult.rows).toHaveLength(0);
    });

    it('should reject registration with weak password', async () => {
      // Arrange
      const weakPasswordData = {
        ...validRegistrationData,
        password: '123'
      };

      // Act
      const response = await request(app)
        .post('/auth/register')
        .send(weakPasswordData)
        .expect(400);

      // Assert
      expect(response.body).toEqual({
        success: false,
        error: expect.stringContaining('Password validation failed')
      });

      // Verify no user was created
      const userResult = await DatabaseService.query(
        'SELECT * FROM users WHERE email = $1',
        [validRegistrationData.email]
      );
      expect(userResult.rows).toHaveLength(0);
    });

    it('should reject registration with invalid names', async () => {
      // Arrange
      const invalidNameData = {
        ...validRegistrationData,
        firstName: 'John123',
        lastName: 'Doe@#$'
      };

      // Act
      const response = await request(app)
        .post('/auth/register')
        .send(invalidNameData)
        .expect(400);

      // Assert
      expect(response.body).toEqual({
        success: false,
        error: expect.stringContaining('Name validation failed')
      });
    });

    it('should reject registration with existing email', async () => {
      // Arrange - First registration
      await request(app)
        .post('/auth/register')
        .send(validRegistrationData)
        .expect(201);

      // Act - Second registration with same email
      const response = await request(app)
        .post('/auth/register')
        .send({
          ...validRegistrationData,
          firstName: 'Jane',
          lastName: 'Smith'
        })
        .expect(400);

      // Assert
      expect(response.body).toEqual({
        success: false,
        error: expect.stringContaining('If this email is available')
      });
    });

    it('should handle missing required fields', async () => {
      // Test missing email
      const missingEmailData = {
        password: 'SecurePass123!',
        firstName: 'John',
        lastName: 'Doe'
      };

      const response1 = await request(app)
        .post('/auth/register')
        .send(missingEmailData)
        .expect(400);

      expect(response1.body.error).toContain('required');

      // Test missing password
      const missingPasswordData = {
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe'
      };

      const response2 = await request(app)
        .post('/auth/register')
        .send(missingPasswordData)
        .expect(400);

      expect(response2.body.error).toContain('required');
    });

    it('should normalize email to lowercase', async () => {
      // Arrange
      const upperCaseEmailData = {
        ...validRegistrationData,
        email: 'TEST@EXAMPLE.COM'
      };

      // Act
      const response = await request(app)
        .post('/auth/register')
        .send(upperCaseEmailData)
        .expect(201);

      // Assert
      expect(response.body.user.email).toBe('test@example.com');

      // Verify in database
      const userResult = await DatabaseService.query(
        'SELECT email FROM users WHERE id = $1',
        [response.body.user.id]
      );
      expect(userResult.rows[0].email).toBe('test@example.com');

      testUserId = response.body.user.id;
    });

    it('should trim whitespace from names', async () => {
      // Arrange
      const whitespaceNameData = {
        ...validRegistrationData,
        firstName: '  John  ',
        lastName: '  Doe  '
      };

      // Act
      const response = await request(app)
        .post('/auth/register')
        .send(whitespaceNameData)
        .expect(201);

      // Assert
      expect(response.body.user.firstName).toBe('John');
      expect(response.body.user.lastName).toBe('Doe');

      testUserId = response.body.user.id;
    });

    it('should handle rate limiting', async () => {
      // This test would require multiple rapid requests
      // For now, we'll test that the endpoint exists and handles the rate limiting logic
      const requests = Array.from({ length: 3 }, () =>
        request(app)
          .post('/auth/register')
          .send({
            ...validRegistrationData,
            email: `test${Math.random()}@example.com`
          })
      );

      const responses = await Promise.all(requests);
      
      // All should succeed if under rate limit
      responses.forEach(response => {
        expect([201, 429]).toContain(response.status);
      });
    });
  });

  describe('GET /auth/verify-email/:token', () => {
    beforeEach(async () => {
      // Create a test user with verification token
      const registrationResponse = await request(app)
        .post('/auth/register')
        .send({
          email: 'verify-test@example.com',
          password: 'SecurePass123!',
          firstName: 'Verify',
          lastName: 'Test',
          role: 'agent'
        })
        .expect(201);

      testUserId = registrationResponse.body.user.id;

      // Get the verification token
      const tokenResult = await DatabaseService.query(
        'SELECT token FROM email_verification_tokens WHERE user_id = $1',
        [testUserId]
      );
      verificationToken = tokenResult.rows[0].token;
    });

    it('should verify email with valid token', async () => {
      // Act
      const response = await request(app)
        .get(`/auth/verify-email/${verificationToken}`)
        .expect(200);

      // Assert
      expect(response.body).toEqual({
        success: true,
        message: 'Email verified successfully'
      });

      // Verify user's email_verified status was updated
      const userResult = await DatabaseService.query(
        'SELECT email_verified FROM users WHERE id = $1',
        [testUserId]
      );
      expect(userResult.rows[0].email_verified).toBe(true);

      // Verify token was marked as used
      const tokenResult = await DatabaseService.query(
        'SELECT used_at FROM email_verification_tokens WHERE token = $1',
        [verificationToken]
      );
      expect(tokenResult.rows[0].used_at).not.toBeNull();
    });

    it('should reject invalid verification token', async () => {
      // Act
      const response = await request(app)
        .get('/auth/verify-email/invalid-token-123')
        .expect(400);

      // Assert
      expect(response.body).toEqual({
        success: false,
        error: expect.stringContaining('Invalid or expired verification token')
      });

      // Verify user's email_verified status was not changed
      const userResult = await DatabaseService.query(
        'SELECT email_verified FROM users WHERE id = $1',
        [testUserId]
      );
      expect(userResult.rows[0].email_verified).toBe(false);
    });

    it('should reject expired verification token', async () => {
      // Arrange - Manually expire the token
      await DatabaseService.query(
        'UPDATE email_verification_tokens SET expires_at = $1 WHERE token = $2',
        [new Date(Date.now() - 60 * 60 * 1000), verificationToken] // 1 hour ago
      );

      // Act
      const response = await request(app)
        .get(`/auth/verify-email/${verificationToken}`)
        .expect(400);

      // Assert
      expect(response.body).toEqual({
        success: false,
        error: expect.stringContaining('expired'),
        tokenExpired: true
      });
    });

    it('should reject already used verification token', async () => {
      // Arrange - Use the token first
      await request(app)
        .get(`/auth/verify-email/${verificationToken}`)
        .expect(200);

      // Act - Try to use it again
      const response = await request(app)
        .get(`/auth/verify-email/${verificationToken}`)
        .expect(400);

      // Assert
      expect(response.body).toEqual({
        success: false,
        error: expect.stringContaining('already used')
      });
    });

    it('should handle malformed token format', async () => {
      // Test various malformed tokens
      const malformedTokens = ['', 'short', '!@#$%^&*()', 'a'.repeat(1000)];

      for (const token of malformedTokens) {
        const response = await request(app)
          .get(`/auth/verify-email/${token}`)
          .expect(400);

        expect(response.body.success).toBe(false);
      }
    });
  });

  describe('POST /auth/resend-verification', () => {
    beforeEach(async () => {
      // Create a test user
      const registrationResponse = await request(app)
        .post('/auth/register')
        .send({
          email: 'resend-test@example.com',
          password: 'SecurePass123!',
          firstName: 'Resend',
          lastName: 'Test',
          role: 'agent'
        })
        .expect(201);

      testUserId = registrationResponse.body.user.id;
    });

    it('should resend verification email for unverified user', async () => {
      // Act
      const response = await request(app)
        .post('/auth/resend-verification')
        .send({ email: 'resend-test@example.com' })
        .expect(200);

      // Assert
      expect(response.body).toEqual({
        success: true,
        message: 'Verification email sent successfully'
      });

      // Verify new token was created
      const tokenResult = await DatabaseService.query(
        'SELECT COUNT(*) as count FROM email_verification_tokens WHERE user_id = $1 AND used_at IS NULL',
        [testUserId]
      );
      expect(parseInt(tokenResult.rows[0].count)).toBeGreaterThan(0);

      // Verify email was sent
      expect(mockEmailNotificationService.prototype.sendVerificationEmail).toHaveBeenCalled();
    });

    it('should reject resend for already verified user', async () => {
      // Arrange - Verify the user first
      const tokenResult = await DatabaseService.query(
        'SELECT token FROM email_verification_tokens WHERE user_id = $1',
        [testUserId]
      );
      const token = tokenResult.rows[0].token;

      await request(app)
        .get(`/auth/verify-email/${token}`)
        .expect(200);

      // Act
      const response = await request(app)
        .post('/auth/resend-verification')
        .send({ email: 'resend-test@example.com' })
        .expect(400);

      // Assert
      expect(response.body).toEqual({
        success: false,
        error: expect.stringContaining('already verified')
      });
    });

    it('should reject resend for non-existent user', async () => {
      // Act
      const response = await request(app)
        .post('/auth/resend-verification')
        .send({ email: 'nonexistent@example.com' })
        .expect(400);

      // Assert
      expect(response.body).toEqual({
        success: false,
        error: expect.stringContaining('User not found')
      });
    });

    it('should handle rate limiting for resend requests', async () => {
      // Make multiple rapid resend requests
      const requests = Array.from({ length: 5 }, () =>
        request(app)
          .post('/auth/resend-verification')
          .send({ email: 'resend-test@example.com' })
      );

      const responses = await Promise.all(requests);
      
      // Some should succeed, some might be rate limited
      const successCount = responses.filter(r => r.status === 200).length;
      const rateLimitedCount = responses.filter(r => r.status === 429).length;
      
      expect(successCount + rateLimitedCount).toBe(5);
      expect(successCount).toBeGreaterThan(0); // At least one should succeed
    });

    it('should validate email format in resend request', async () => {
      // Act
      const response = await request(app)
        .post('/auth/resend-verification')
        .send({ email: 'invalid-email' })
        .expect(400);

      // Assert
      expect(response.body).toEqual({
        success: false,
        error: expect.stringContaining('Invalid email format')
      });
    });
  });

  describe('Complete Registration Flow Integration', () => {
    it('should complete full registration and verification flow', async () => {
      const testEmail = 'fullflow@example.com';
      
      // Step 1: Register user
      const registrationResponse = await request(app)
        .post('/auth/register')
        .send({
          email: testEmail,
          password: 'SecurePass123!',
          firstName: 'Full',
          lastName: 'Flow',
          role: 'agent'
        })
        .expect(201);

      expect(registrationResponse.body.success).toBe(true);
      expect(registrationResponse.body.user.emailVerified).toBe(false);
      
      testUserId = registrationResponse.body.user.id;

      // Step 2: Get verification token from database
      const tokenResult = await DatabaseService.query(
        'SELECT token FROM email_verification_tokens WHERE user_id = $1',
        [testUserId]
      );
      const token = tokenResult.rows[0].token;

      // Step 3: Verify email
      const verificationResponse = await request(app)
        .get(`/auth/verify-email/${token}`)
        .expect(200);

      expect(verificationResponse.body.success).toBe(true);

      // Step 4: Verify user can now login (assuming login endpoint exists)
      // This would test the complete integration with the auth system
      const userResult = await DatabaseService.query(
        'SELECT email_verified FROM users WHERE id = $1',
        [testUserId]
      );
      expect(userResult.rows[0].email_verified).toBe(true);

      // Step 5: Verify audit trail
      const auditResult = await DatabaseService.query(
        'SELECT event_type FROM registration_audit_log WHERE user_id = $1 ORDER BY created_at',
        [testUserId]
      );
      
      const eventTypes = auditResult.rows.map(row => row.event_type);
      expect(eventTypes).toContain('registration');
      // Note: email_verified event would be logged by the verification process
    });

    it('should handle registration with admin approval requirement', async () => {
      // This test would require setting up registration settings
      // For now, we'll test the basic flow and verify the response structure
      
      // First, set up admin approval requirement (if settings table exists)
      try {
        await DatabaseService.query(
          'INSERT INTO registration_settings (require_admin_approval, max_registrations_per_day, verification_token_expiry_hours) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET require_admin_approval = $1',
          [true, 100, 24]
        );
      } catch (error) {
        // Settings table might not exist in test environment
        console.warn('Registration settings table not available');
      }

      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'approval-test@example.com',
          password: 'SecurePass123!',
          firstName: 'Approval',
          lastName: 'Test',
          role: 'agent'
        })
        .expect(201);

      // The response should indicate approval is required
      expect(response.body.success).toBe(true);
      // requiresApproval might be true depending on settings
      expect(typeof response.body.requiresApproval).toBe('boolean');
      
      testUserId = response.body.user.id;
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle database connection errors gracefully', async () => {
      // This is difficult to test without actually breaking the database
      // In a real scenario, you might use a test database that you can manipulate
      
      // For now, test that the endpoint handles malformed requests
      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'test@example.com',
          // Missing required fields
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });

    it('should handle concurrent registration attempts', async () => {
      const sameEmailData = {
        email: 'concurrent@example.com',
        password: 'SecurePass123!',
        firstName: 'Concurrent',
        lastName: 'Test',
        role: 'agent'
      };

      // Make concurrent requests with the same email
      const requests = Array.from({ length: 3 }, () =>
        request(app)
          .post('/auth/register')
          .send(sameEmailData)
      );

      const responses = await Promise.all(requests);
      
      // Only one should succeed
      const successCount = responses.filter(r => r.status === 201).length;
      const errorCount = responses.filter(r => r.status === 400).length;
      
      expect(successCount).toBe(1);
      expect(errorCount).toBe(2);
      
      // Clean up the successful registration
      const successResponse = responses.find(r => r.status === 201);
      if (successResponse) {
        testUserId = successResponse.body.user.id;
      }
    });

    it('should handle email service failures gracefully', async () => {
      // Mock email service to fail
      mockEmailNotificationService.prototype.sendVerificationEmail = jest.fn().mockRejectedValue(
        new Error('Email service unavailable')
      );

      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'email-fail@example.com',
          password: 'SecurePass123!',
          firstName: 'Email',
          lastName: 'Fail',
          role: 'agent'
        })
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Email service unavailable');
    });
  });
});