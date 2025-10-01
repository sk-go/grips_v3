import { CaptchaService } from '../../services/security/captchaService';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock environment variables
const originalEnv = process.env;

describe('CaptchaService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('initialization', () => {
    it('should initialize with CAPTCHA disabled by default', () => {
      process.env.CAPTCHA_ENABLED = 'false';
      CaptchaService.initialize();
      
      expect(CaptchaService.isEnabled()).toBe(false);
    });

    it('should initialize with CAPTCHA enabled when configured', () => {
      process.env.CAPTCHA_ENABLED = 'true';
      process.env.CAPTCHA_SITE_KEY = 'test-site-key';
      process.env.CAPTCHA_SECRET_KEY = 'test-secret-key';
      CaptchaService.initialize();
      
      expect(CaptchaService.isEnabled()).toBe(true);
    });

    it('should disable CAPTCHA if keys are missing', () => {
      process.env.CAPTCHA_ENABLED = 'true';
      process.env.CAPTCHA_SITE_KEY = '';
      process.env.CAPTCHA_SECRET_KEY = '';
      CaptchaService.initialize();
      
      expect(CaptchaService.isEnabled()).toBe(false);
    });

    it('should use default configuration values', () => {
      process.env.CAPTCHA_ENABLED = 'true';
      process.env.CAPTCHA_SITE_KEY = 'test-site-key';
      process.env.CAPTCHA_SECRET_KEY = 'test-secret-key';
      CaptchaService.initialize();
      
      const config = CaptchaService.getConfig();
      expect(config.provider).toBe('recaptcha');
      expect(config.version).toBe('v2');
      expect(config.action).toBe('registration');
    });
  });

  describe('getConfig', () => {
    beforeEach(() => {
      process.env.CAPTCHA_ENABLED = 'true';
      process.env.CAPTCHA_SITE_KEY = 'test-site-key';
      process.env.CAPTCHA_SECRET_KEY = 'test-secret-key';
      process.env.CAPTCHA_PROVIDER = 'recaptcha';
      process.env.CAPTCHA_VERSION = 'v3';
      process.env.CAPTCHA_ACTION = 'test-action';
      CaptchaService.initialize();
    });

    it('should return public configuration', () => {
      const config = CaptchaService.getConfig();
      
      expect(config).toEqual({
        enabled: true,
        provider: 'recaptcha',
        siteKey: 'test-site-key',
        version: 'v3',
        action: 'test-action'
      });
    });

    it('should not expose secret key', () => {
      const config = CaptchaService.getConfig();
      expect(config).not.toHaveProperty('secretKey');
    });
  });

  describe('verifyCaptcha', () => {
    beforeEach(() => {
      process.env.CAPTCHA_ENABLED = 'true';
      process.env.CAPTCHA_SITE_KEY = 'test-site-key';
      process.env.CAPTCHA_SECRET_KEY = 'test-secret-key';
      CaptchaService.initialize();
    });

    it('should return success when CAPTCHA is disabled', async () => {
      process.env.CAPTCHA_ENABLED = 'false';
      CaptchaService.initialize();
      
      const result = await CaptchaService.verifyCaptcha('test-token');
      expect(result.success).toBe(true);
    });

    it('should return failure when no token provided', async () => {
      const result = await CaptchaService.verifyCaptcha('');
      expect(result.success).toBe(false);
      expect(result.errorCodes).toContain('missing-input-response');
    });

    it('should verify reCAPTCHA v2 successfully', async () => {
      process.env.CAPTCHA_VERSION = 'v2';
      CaptchaService.initialize();

      mockedAxios.post.mockResolvedValue({
        data: {
          success: true,
          hostname: 'localhost',
          challenge_ts: '2023-01-01T00:00:00Z'
        }
      });

      const result = await CaptchaService.verifyCaptcha('test-token', '127.0.0.1');
      
      expect(result.success).toBe(true);
      expect(result.hostname).toBe('localhost');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://www.google.com/recaptcha/api/siteverify',
        expect.any(URLSearchParams),
        expect.objectContaining({
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000
        })
      );
    });

    it('should verify reCAPTCHA v3 successfully with good score', async () => {
      process.env.CAPTCHA_VERSION = 'v3';
      process.env.CAPTCHA_MINIMUM_SCORE = '0.5';
      process.env.CAPTCHA_ACTION = 'registration';
      CaptchaService.initialize();

      mockedAxios.post.mockResolvedValue({
        data: {
          success: true,
          score: 0.8,
          action: 'registration',
          hostname: 'localhost',
          challenge_ts: '2023-01-01T00:00:00Z'
        }
      });

      const result = await CaptchaService.verifyCaptcha('test-token', '127.0.0.1', 'registration');
      
      expect(result.success).toBe(true);
      expect(result.score).toBe(0.8);
      expect(result.action).toBe('registration');
    });

    it('should fail reCAPTCHA v3 with low score', async () => {
      process.env.CAPTCHA_VERSION = 'v3';
      process.env.CAPTCHA_MINIMUM_SCORE = '0.5';
      process.env.CAPTCHA_ACTION = 'registration';
      CaptchaService.initialize();

      mockedAxios.post.mockResolvedValue({
        data: {
          success: true,
          score: 0.3,
          action: 'registration',
          hostname: 'localhost',
          challenge_ts: '2023-01-01T00:00:00Z'
        }
      });

      const result = await CaptchaService.verifyCaptcha('test-token', '127.0.0.1', 'registration');
      
      expect(result.success).toBe(false);
      expect(result.score).toBe(0.3);
      expect(result.errorCodes).toContain('score-too-low');
    });

    it('should fail reCAPTCHA v3 with action mismatch', async () => {
      process.env.CAPTCHA_VERSION = 'v3';
      process.env.CAPTCHA_ACTION = 'registration';
      CaptchaService.initialize();

      mockedAxios.post.mockResolvedValue({
        data: {
          success: true,
          score: 0.8,
          action: 'login',
          hostname: 'localhost',
          challenge_ts: '2023-01-01T00:00:00Z'
        }
      });

      const result = await CaptchaService.verifyCaptcha('test-token', '127.0.0.1', 'registration');
      
      expect(result.success).toBe(false);
      expect(result.errorCodes).toContain('action-mismatch');
    });

    it('should handle reCAPTCHA API errors', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          success: false,
          'error-codes': ['invalid-input-response', 'timeout-or-duplicate']
        }
      });

      const result = await CaptchaService.verifyCaptcha('test-token');
      
      expect(result.success).toBe(false);
      expect(result.errorCodes).toEqual(['invalid-input-response', 'timeout-or-duplicate']);
    });

    it('should handle network errors', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Network error'));

      const result = await CaptchaService.verifyCaptcha('test-token');
      
      expect(result.success).toBe(false);
      expect(result.errorCodes).toContain('verification-failed');
    });

    it('should verify hCaptcha successfully', async () => {
      process.env.CAPTCHA_PROVIDER = 'hcaptcha';
      CaptchaService.initialize();

      mockedAxios.post.mockResolvedValue({
        data: {
          success: true,
          hostname: 'localhost',
          challenge_ts: '2023-01-01T00:00:00Z'
        }
      });

      const result = await CaptchaService.verifyCaptcha('test-token', '127.0.0.1');
      
      expect(result.success).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://hcaptcha.com/siteverify',
        expect.any(URLSearchParams),
        expect.objectContaining({
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000
        })
      );
    });
  });

  describe('generateAccessibilityFallback', () => {
    it('should generate a challenge with question and answer', () => {
      const challenge = CaptchaService.generateAccessibilityFallback();
      
      expect(challenge).toHaveProperty('challenge');
      expect(challenge).toHaveProperty('answer');
      expect(challenge).toHaveProperty('id');
      expect(typeof challenge.challenge).toBe('string');
      expect(typeof challenge.answer).toBe('string');
      expect(typeof challenge.id).toBe('string');
      expect(challenge.challenge.length).toBeGreaterThan(0);
      expect(challenge.answer.length).toBeGreaterThan(0);
      expect(challenge.id.length).toBeGreaterThan(0);
    });

    it('should generate different challenges on multiple calls', () => {
      const challenge1 = CaptchaService.generateAccessibilityFallback();
      const challenge2 = CaptchaService.generateAccessibilityFallback();
      
      expect(challenge1.id).not.toBe(challenge2.id);
      // Note: challenges might be the same due to random selection, but IDs should be different
    });
  });

  describe('verifyAccessibilityFallback', () => {
    it('should verify correct answer', () => {
      const result = CaptchaService.verifyAccessibilityFallback('8', '8');
      expect(result).toBe(true);
    });

    it('should verify correct answer case-insensitively', () => {
      const result = CaptchaService.verifyAccessibilityFallback('WEDNESDAY', 'wednesday');
      expect(result).toBe(true);
    });

    it('should verify correct answer with whitespace', () => {
      const result = CaptchaService.verifyAccessibilityFallback('  8  ', '8');
      expect(result).toBe(true);
    });

    it('should reject incorrect answer', () => {
      const result = CaptchaService.verifyAccessibilityFallback('7', '8');
      expect(result).toBe(false);
    });

    it('should reject empty answers', () => {
      expect(CaptchaService.verifyAccessibilityFallback('', '8')).toBe(false);
      expect(CaptchaService.verifyAccessibilityFallback('8', '')).toBe(false);
      expect(CaptchaService.verifyAccessibilityFallback('', '')).toBe(false);
    });
  });

  describe('getErrorMessage', () => {
    it('should return specific error messages for known codes', () => {
      expect(CaptchaService.getErrorMessage(['missing-input-response']))
        .toBe('Please complete the CAPTCHA challenge.');
      
      expect(CaptchaService.getErrorMessage(['invalid-input-response']))
        .toBe('Invalid CAPTCHA response. Please try again.');
      
      expect(CaptchaService.getErrorMessage(['score-too-low']))
        .toBe('Security verification failed. Please try again or contact support.');
    });

    it('should return first known error for multiple codes', () => {
      const message = CaptchaService.getErrorMessage(['unknown-error', 'invalid-input-response']);
      expect(message).toBe('Invalid CAPTCHA response. Please try again.');
    });

    it('should return generic message for unknown error codes', () => {
      const message = CaptchaService.getErrorMessage(['unknown-error']);
      expect(message).toBe('CAPTCHA verification failed. Please try again.');
    });

    it('should return generic message for empty error codes', () => {
      const message = CaptchaService.getErrorMessage([]);
      expect(message).toBe('CAPTCHA verification failed. Please try again.');
    });
  });
});