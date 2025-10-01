import request from 'supertest';
import { app } from '../../server';
import { DatabaseService } from '../../services/database';
import { CaptchaService } from '../../services/security/captchaService';
import { RedisService } from '../../services/redis';

// Mock axios for CAPTCHA verification
jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('CAPTCHA Integration Tests', () => {
  const testUser = {
    email: 'captcha.test@example.com',
    password: 'TestPassword123!',
    firstName: 'Captcha',
    lastName: 'Test',
    role: 'agent'
  };

  beforeAll(async () => {
    await DatabaseService.initialize();
  });

  afterAll(async () => {
    await DatabaseService.close();
    await RedisService.close();
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    
    // Clean up test user
    try {
      await DatabaseService.query('DELETE FROM users WHERE email = $1', [testUser.email]);
    } catch (error) {
      // Ignore if user doesn't exist
    }
  });

  describe('CAPTCHA Configuration Endpoint', () => {
    it('should return CAPTCHA configuration when enabled', async () => {
      // Mock CAPTCHA as enabled
      process.env.CAPTCHA_ENABLED = 'true';
      process.env.CAPTCHA_SITE_KEY = 'test-site-key';
      process.env.CAPTCHA_SECRET_KEY = 'test-secret-key';
      process.env.CAPTCHA_PROVIDER = 'recaptcha';
      process.env.CAPTCHA_VERSION = 'v2';
      CaptchaService.initialize();

      const response = await request(app)
        .get('/auth/captcha-config')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        config: {
          enabled: true,
          provider: 'recaptcha',
          siteKey: 'test-site-key',
          version: 'v2',
          action: 'registration'
        }
      });
    });

    it('should return disabled configuration when CAPTCHA is disabled', async () => {
      process.env.CAPTCHA_ENABLED = 'false';
      CaptchaService.initialize();

      const response = await request(app)
        .get('/auth/captcha-config')
        .expect(200);

      expect(response.body.config.enabled).toBe(false);
    });
  });

  describe('Accessibility Challenge Endpoint', () => {
    beforeEach(() => {
      process.env.CAPTCHA_ENABLED = 'true';
      process.env.CAPTCHA_SITE_KEY = 'test-site-key';
      process.env.CAPTCHA_SECRET_KEY = 'test-secret-key';
      CaptchaService.initialize();
    });

    it('should generate accessibility challenge when CAPTCHA is enabled', async () => {
      const response = await request(app)
        .post('/auth/accessibility-challenge')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        challenge: {
          id: expect.any(String),
          question: expect.any(String)
        }
      });

      expect(response.body.challenge.id.length).toBeGreaterThan(0);
      expect(response.body.challenge.question.length).toBeGreaterThan(0);
    });

    it('should return 404 when CAPTCHA is disabled', async () => {
      process.env.CAPTCHA_ENABLED = 'false';
      CaptchaService.initialize();

      const response = await request(app)
        .post('/auth/accessibility-challenge')
        .expect(404);

      expect(response.body).toMatchObject({
        success: false,
        message: 'CAPTCHA is not enabled'
      });
    });
  });

  describe('Registration with CAPTCHA', () => {
    beforeEach(() => {
      process.env.CAPTCHA_ENABLED = 'true';
      process.env.CAPTCHA_SITE_KEY = 'test-site-key';
      process.env.CAPTCHA_SECRET_KEY = 'test-secret-key';
      process.env.CAPTCHA_VERSION = 'v2';
      CaptchaService.initialize();
    });

    it('should register successfully with valid CAPTCHA token', async () => {
      // Mock successful CAPTCHA verification
      mockedAxios.post.mockResolvedValue({
        data: {
          success: true,
          hostname: 'localhost',
          challenge_ts: '2023-01-01T00:00:00Z'
        }
      });

      const response = await request(app)
        .post('/auth/register')
        .send({
          ...testUser,
          captchaToken: 'valid-captcha-token'
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('registered successfully');
    });

    it('should fail registration with invalid CAPTCHA token', async () => {
      // Mock failed CAPTCHA verification
      mockedAxios.post.mockResolvedValue({
        data: {
          success: false,
          'error-codes': ['invalid-input-response']
        }
      });

      const response = await request(app)
        .post('/auth/register')
        .send({
          ...testUser,
          captchaToken: 'invalid-captcha-token'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Invalid CAPTCHA response. Please try again.');
      expect(response.body.code).toBe('CAPTCHA_VERIFICATION_FAILED');
    });

    it('should fail registration without CAPTCHA token when required', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send(testUser)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('CAPTCHA verification required. Please complete the security challenge.');
      expect(response.body.code).toBe('CAPTCHA_VERIFICATION_FAILED');
    });

    it('should register successfully with valid accessibility challenge', async () => {
      // First, generate an accessibility challenge
      const challengeResponse = await request(app)
        .post('/auth/accessibility-challenge')
        .expect(200);

      const challengeId = challengeResponse.body.challenge.id;
      
      // Mock the cached answer (in real test, this would be set by the challenge generation)
      const redisClient = RedisService.getClient();
      await redisClient.setEx(`accessibility_challenge:${challengeId}`, 600, '8');

      const response = await request(app)
        .post('/auth/register')
        .send({
          ...testUser,
          accessibilityChallenge: {
            id: challengeId,
            answer: '8'
          }
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('registered successfully');

      // Verify the challenge was cleaned up
      const redisClient2 = RedisService.getClient();
      const cachedAnswer = await redisClient2.get(`accessibility_challenge:${challengeId}`);
      expect(cachedAnswer).toBeNull();
    });

    it('should fail registration with incorrect accessibility challenge answer', async () => {
      // First, generate an accessibility challenge
      const challengeResponse = await request(app)
        .post('/auth/accessibility-challenge')
        .expect(200);

      const challengeId = challengeResponse.body.challenge.id;
      
      // Mock the cached answer
      const redisClient3 = RedisService.getClient();
      await redisClient3.setEx(`accessibility_challenge:${challengeId}`, 600, '8');

      const response = await request(app)
        .post('/auth/register')
        .send({
          ...testUser,
          accessibilityChallenge: {
            id: challengeId,
            answer: 'wrong-answer'
          }
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Incorrect answer to accessibility challenge. Please try again.');
      expect(response.body.code).toBe('CAPTCHA_VERIFICATION_FAILED');
    });

    it('should register successfully when CAPTCHA is disabled', async () => {
      process.env.CAPTCHA_ENABLED = 'false';
      CaptchaService.initialize();

      const response = await request(app)
        .post('/auth/register')
        .send(testUser)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('registered successfully');
    });
  });

  describe('reCAPTCHA v3 Integration', () => {
    beforeEach(() => {
      process.env.CAPTCHA_ENABLED = 'true';
      process.env.CAPTCHA_SITE_KEY = 'test-site-key';
      process.env.CAPTCHA_SECRET_KEY = 'test-secret-key';
      process.env.CAPTCHA_VERSION = 'v3';
      process.env.CAPTCHA_MINIMUM_SCORE = '0.5';
      process.env.CAPTCHA_ACTION = 'registration';
      CaptchaService.initialize();
    });

    it('should register successfully with good reCAPTCHA v3 score', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          success: true,
          score: 0.8,
          action: 'registration',
          hostname: 'localhost',
          challenge_ts: '2023-01-01T00:00:00Z'
        }
      });

      const response = await request(app)
        .post('/auth/register')
        .send({
          ...testUser,
          captchaToken: 'valid-v3-token'
        })
        .expect(201);

      expect(response.body.success).toBe(true);
    });

    it('should fail registration with low reCAPTCHA v3 score', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          success: true,
          score: 0.3,
          action: 'registration',
          hostname: 'localhost',
          challenge_ts: '2023-01-01T00:00:00Z'
        }
      });

      const response = await request(app)
        .post('/auth/register')
        .send({
          ...testUser,
          captchaToken: 'low-score-token'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Security verification failed. Please try again or contact support.');
    });

    it('should fail registration with action mismatch', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          success: true,
          score: 0.8,
          action: 'login',
          hostname: 'localhost',
          challenge_ts: '2023-01-01T00:00:00Z'
        }
      });

      const response = await request(app)
        .post('/auth/register')
        .send({
          ...testUser,
          captchaToken: 'wrong-action-token'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('CAPTCHA verification failed. Please refresh and try again.');
    });
  });

  describe('CAPTCHA Error Handling', () => {
    beforeEach(() => {
      process.env.CAPTCHA_ENABLED = 'true';
      process.env.CAPTCHA_SITE_KEY = 'test-site-key';
      process.env.CAPTCHA_SECRET_KEY = 'test-secret-key';
      CaptchaService.initialize();
    });

    it('should handle CAPTCHA service timeout', async () => {
      mockedAxios.post.mockRejectedValue(new Error('timeout'));

      const response = await request(app)
        .post('/auth/register')
        .send({
          ...testUser,
          captchaToken: 'timeout-token'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('CAPTCHA verification failed. Please try again.');
    });

    it('should handle expired accessibility challenge', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({
          ...testUser,
          accessibilityChallenge: {
            id: 'expired-challenge-id',
            answer: '8'
          }
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Incorrect answer to accessibility challenge. Please try again.');
    });
  });
});