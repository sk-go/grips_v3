import axios from 'axios';
import { logger } from '../../utils/logger';

export interface CaptchaVerificationResult {
  success: boolean;
  score?: number; // For reCAPTCHA v3
  action?: string;
  hostname?: string;
  challengeTs?: string;
  errorCodes?: string[];
}

export interface CaptchaConfig {
  enabled: boolean;
  provider: 'recaptcha' | 'hcaptcha';
  siteKey: string;
  secretKey: string;
  version: 'v2' | 'v3';
  minimumScore?: number; // For v3, minimum score to accept (0.0 to 1.0)
  action?: string; // For v3, action name
}

export class CaptchaService {
  private static config: CaptchaConfig;

  static initialize(): void {
    this.config = {
      enabled: process.env.CAPTCHA_ENABLED === 'true',
      provider: (process.env.CAPTCHA_PROVIDER as 'recaptcha' | 'hcaptcha') || 'recaptcha',
      siteKey: process.env.CAPTCHA_SITE_KEY || '',
      secretKey: process.env.CAPTCHA_SECRET_KEY || '',
      version: (process.env.CAPTCHA_VERSION as 'v2' | 'v3') || 'v2',
      minimumScore: parseFloat(process.env.CAPTCHA_MINIMUM_SCORE || '0.5'),
      action: process.env.CAPTCHA_ACTION || 'registration'
    };

    if (this.config.enabled && (!this.config.siteKey || !this.config.secretKey)) {
      logger.warn('CAPTCHA is enabled but site key or secret key is missing');
      this.config.enabled = false;
    }

    logger.info('CAPTCHA service initialized', {
      enabled: this.config.enabled,
      provider: this.config.provider,
      version: this.config.version,
      hasSiteKey: !!this.config.siteKey,
      hasSecretKey: !!this.config.secretKey
    });
  }

  static isEnabled(): boolean {
    return this.config?.enabled || false;
  }

  static getConfig(): Partial<CaptchaConfig> {
    return {
      enabled: this.config?.enabled || false,
      provider: this.config?.provider || 'recaptcha',
      siteKey: this.config?.siteKey || '',
      version: this.config?.version || 'v2',
      action: this.config?.action || 'registration'
    };
  }

  static async verifyCaptcha(
    token: string, 
    userIP?: string,
    action?: string
  ): Promise<CaptchaVerificationResult> {
    if (!this.config?.enabled) {
      logger.debug('CAPTCHA verification skipped - service disabled');
      return { success: true };
    }

    if (!token) {
      logger.warn('CAPTCHA verification failed - no token provided');
      return { 
        success: false, 
        errorCodes: ['missing-input-response'] 
      };
    }

    try {
      const result = await this.verifyWithProvider(token, userIP, action);
      
      logger.info('CAPTCHA verification completed', {
        success: result.success,
        score: result.score,
        action: result.action,
        provider: this.config.provider,
        version: this.config.version,
        errorCodes: result.errorCodes
      });

      return result;
    } catch (error) {
      logger.error('CAPTCHA verification error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        provider: this.config.provider,
        version: this.config.version
      });

      return { 
        success: false, 
        errorCodes: ['verification-failed'] 
      };
    }
  }

  private static async verifyWithProvider(
    token: string, 
    userIP?: string,
    action?: string
  ): Promise<CaptchaVerificationResult> {
    if (this.config.provider === 'recaptcha') {
      return this.verifyRecaptcha(token, userIP, action);
    } else if (this.config.provider === 'hcaptcha') {
      return this.verifyHCaptcha(token, userIP);
    }

    throw new Error(`Unsupported CAPTCHA provider: ${this.config.provider}`);
  }

  private static async verifyRecaptcha(
    token: string, 
    userIP?: string,
    action?: string
  ): Promise<CaptchaVerificationResult> {
    const verifyUrl = 'https://www.google.com/recaptcha/api/siteverify';
    
    const params = new URLSearchParams({
      secret: this.config.secretKey,
      response: token
    });

    if (userIP) {
      params.append('remoteip', userIP);
    }

    const response = await axios.post(verifyUrl, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 10000 // 10 second timeout
    });

    const data = response.data;

    // For reCAPTCHA v3, check score and action
    if (this.config.version === 'v3') {
      const expectedAction = action || this.config.action;
      
      if (data.action !== expectedAction) {
        logger.warn('reCAPTCHA v3 action mismatch', {
          expected: expectedAction,
          received: data.action
        });
        return {
          success: false,
          errorCodes: ['action-mismatch']
        };
      }

      if (data.score < this.config.minimumScore!) {
        logger.warn('reCAPTCHA v3 score too low', {
          score: data.score,
          minimumScore: this.config.minimumScore
        });
        return {
          success: false,
          score: data.score,
          errorCodes: ['score-too-low']
        };
      }
    }

    return {
      success: data.success,
      score: data.score,
      action: data.action,
      hostname: data.hostname,
      challengeTs: data.challenge_ts,
      errorCodes: data['error-codes'] || []
    };
  }

  private static async verifyHCaptcha(
    token: string, 
    userIP?: string
  ): Promise<CaptchaVerificationResult> {
    const verifyUrl = 'https://hcaptcha.com/siteverify';
    
    const params = new URLSearchParams({
      secret: this.config.secretKey,
      response: token
    });

    if (userIP) {
      params.append('remoteip', userIP);
    }

    const response = await axios.post(verifyUrl, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 10000 // 10 second timeout
    });

    const data = response.data;

    return {
      success: data.success,
      hostname: data.hostname,
      challengeTs: data.challenge_ts,
      errorCodes: data['error-codes'] || []
    };
  }

  /**
   * Generate fallback challenge for accessibility
   * This could be a simple math problem or text-based challenge
   */
  static generateAccessibilityFallback(): {
    challenge: string;
    answer: string;
    id: string;
  } {
    const challenges = [
      {
        question: 'What is 5 + 3?',
        answer: '8'
      },
      {
        question: 'What is 12 - 4?',
        answer: '8'
      },
      {
        question: 'What is 2 × 6?',
        answer: '12'
      },
      {
        question: 'What is 15 ÷ 3?',
        answer: '5'
      },
      {
        question: 'What comes after Tuesday?',
        answer: 'wednesday'
      },
      {
        question: 'How many days are in a week?',
        answer: '7'
      }
    ];

    const selected = challenges[Math.floor(Math.random() * challenges.length)];
    const id = Math.random().toString(36).substring(2, 15);

    return {
      challenge: selected.question,
      answer: selected.answer.toLowerCase(),
      id
    };
  }

  /**
   * Verify accessibility fallback answer
   */
  static verifyAccessibilityFallback(
    userAnswer: string, 
    correctAnswer: string
  ): boolean {
    if (!userAnswer || !correctAnswer) {
      return false;
    }

    return userAnswer.toLowerCase().trim() === correctAnswer.toLowerCase().trim();
  }

  /**
   * Get user-friendly error message for CAPTCHA errors
   */
  static getErrorMessage(errorCodes: string[]): string {
    if (!errorCodes || errorCodes.length === 0) {
      return 'CAPTCHA verification failed. Please try again.';
    }

    const errorMessages: Record<string, string> = {
      'missing-input-secret': 'CAPTCHA configuration error. Please contact support.',
      'invalid-input-secret': 'CAPTCHA configuration error. Please contact support.',
      'missing-input-response': 'Please complete the CAPTCHA challenge.',
      'invalid-input-response': 'Invalid CAPTCHA response. Please try again.',
      'bad-request': 'Invalid CAPTCHA request. Please refresh and try again.',
      'timeout-or-duplicate': 'CAPTCHA has expired or been used. Please try again.',
      'action-mismatch': 'CAPTCHA verification failed. Please refresh and try again.',
      'score-too-low': 'Security verification failed. Please try again or contact support.',
      'verification-failed': 'CAPTCHA verification service unavailable. Please try again later.'
    };

    // Return the first known error message, or a generic one
    for (const code of errorCodes) {
      if (errorMessages[code]) {
        return errorMessages[code];
      }
    }

    return 'CAPTCHA verification failed. Please try again.';
  }
}

// Initialize the service when the module is loaded
CaptchaService.initialize();