import { logger } from '../utils/logger';

export interface StandardErrorResponse {
  error: string;
  code?: string;
  details?: any;
  timestamp: string;
  requestId?: string;
}

export interface ValidationErrorResponse extends StandardErrorResponse {
  validationErrors: Array<{
    field: string;
    message: string;
    value?: any;
  }>;
}

export interface RateLimitErrorResponse extends StandardErrorResponse {
  retryAfter: number; // seconds
  limit: number;
  remaining: number;
  resetTime: number; // timestamp
}

export class ErrorHandlingService {
  /**
   * Creates a standardized error response
   */
  static createErrorResponse(
    message: string,
    code?: string,
    details?: any,
    requestId?: string
  ): StandardErrorResponse {
    return {
      error: message,
      code,
      details: process.env.NODE_ENV === 'development' ? details : undefined,
      timestamp: new Date().toISOString(),
      requestId
    };
  }

  /**
   * Creates a validation error response
   */
  static createValidationErrorResponse(
    message: string,
    validationErrors: Array<{ field: string; message: string; value?: any }>,
    requestId?: string
  ): ValidationErrorResponse {
    return {
      error: message,
      code: 'VALIDATION_ERROR',
      validationErrors,
      timestamp: new Date().toISOString(),
      requestId
    };
  }

  /**
   * Creates a rate limit error response
   */
  static createRateLimitErrorResponse(
    message: string,
    retryAfter: number,
    limit: number,
    remaining: number,
    resetTime: number,
    requestId?: string
  ): RateLimitErrorResponse {
    return {
      error: message,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter,
      limit,
      remaining,
      resetTime,
      timestamp: new Date().toISOString(),
      requestId
    };
  }

  /**
   * Sanitizes error messages to prevent information disclosure
   */
  static sanitizeAuthError(error: Error, context: 'login' | 'register' | 'password_reset' | 'token_refresh' | 'email_verification'): string {
    const message = error.message.toLowerCase();

    switch (context) {
      case 'login':
        // Generic message for all login failures to prevent user enumeration
        if (message.includes('user not found') || 
            message.includes('invalid credentials') || 
            message.includes('invalid password') ||
            message.includes('password not set')) {
          return 'Invalid email or password';
        }
        
        if (message.includes('account is inactive') || message.includes('user inactive')) {
          return 'Account is not active. Please contact support.';
        }
        
        if (message.includes('too many failed attempts') || message.includes('locked')) {
          return error.message; // Keep rate limiting messages as they are
        }
        
        return 'Authentication failed. Please try again.';

      case 'register':
        if (message.includes('already exists') || message.includes('duplicate')) {
          return 'An account with this email already exists';
        }
        
        if (message.includes('validation failed') || message.includes('invalid email')) {
          return error.message; // Keep validation messages
        }
        
        return 'Registration failed. Please check your information and try again.';

      case 'password_reset':
        // Always return generic success message for password reset requests
        // to prevent email enumeration
        if (message.includes('user not found') || message.includes('email not found')) {
          return 'If the email exists, a password reset link has been sent';
        }
        
        if (message.includes('invalid token') || 
            message.includes('expired') || 
            message.includes('already been used')) {
          return error.message; // Keep token-specific errors
        }
        
        return 'Password reset failed. Please try again.';

      case 'token_refresh':
        if (message.includes('invalid') || 
            message.includes('expired') || 
            message.includes('not found')) {
          return 'Session expired. Please log in again.';
        }
        
        return 'Authentication failed. Please log in again.';

      default:
        return 'An error occurred. Please try again.';
    }
  }

  /**
   * Logs security events with appropriate detail level
   */
  static logSecurityEvent(
    event: 'login_attempt' | 'login_success' | 'login_failure' | 'rate_limit_exceeded' | 'password_change' | 'token_refresh' | 
           'registration_success' | 'registration_failure' | 'email_verification_success' | 'email_verification_failed' | 
           'verification_resend_success' | 'registration_approved' | 'registration_rejected' | 'captcha_verification_failed' | 
           'captcha_verification_success',
    details: {
      userId?: string;
      email?: string;
      ipAddress?: string;
      userAgent?: string;
      attemptCount?: number;
      lockoutTime?: number;
      [key: string]: any;
    }
  ): void {
    const logData = {
      event,
      timestamp: new Date().toISOString(),
      ...details
    };

    switch (event) {
      case 'login_success':
        logger.info('Successful login', logData);
        break;
        
      case 'login_failure':
      case 'rate_limit_exceeded':
        logger.warn(`Security event: ${event}`, logData);
        break;
        
      case 'password_change':
        logger.info('Password changed', logData);
        break;
        
      case 'token_refresh':
        logger.info('Token refreshed', logData);
        break;
        
      default:
        logger.info(`Security event: ${event}`, logData);
    }
  }

  /**
   * Determines if an error should be logged as a security concern
   */
  static isSecurityRelevantError(error: Error, context: string): boolean {
    const message = error.message.toLowerCase();
    
    const securityKeywords = [
      'invalid credentials',
      'too many attempts',
      'rate limit',
      'unauthorized',
      'forbidden',
      'token',
      'authentication',
      'password'
    ];

    return securityKeywords.some(keyword => 
      message.includes(keyword) || context.includes('auth')
    );
  }

  /**
   * Creates a consistent error response for database errors
   */
  static handleDatabaseError(error: any, context: string): StandardErrorResponse {
    let message = 'An error occurred while processing your request';
    let code = 'DATABASE_ERROR';

    if (error.code) {
      switch (error.code) {
        case '23505': // Unique violation
          message = 'A record with this information already exists';
          code = 'DUPLICATE_RECORD';
          break;
          
        case '23503': // Foreign key violation
          message = 'Invalid reference to related data';
          code = 'INVALID_REFERENCE';
          break;
          
        case '23502': // Not null violation
          message = 'Required information is missing';
          code = 'MISSING_REQUIRED_FIELD';
          break;
          
        case '42P01': // Undefined table
          message = 'System configuration error';
          code = 'SYSTEM_ERROR';
          break;
          
        default:
          logger.error('Unhandled database error', { 
            code: error.code, 
            message: error.message, 
            context 
          });
      }
    }

    return this.createErrorResponse(message, code);
  }

  /**
   * Validates and sanitizes input to prevent injection attacks
   */
  static validateInput(input: any, type: 'email' | 'password' | 'name' | 'general'): { isValid: boolean; sanitized?: string; error?: string } {
    if (typeof input !== 'string') {
      return { isValid: false, error: 'Input must be a string' };
    }

    // Remove null bytes and control characters
    const sanitized = input.replace(/[\x00-\x1F\x7F]/g, '');

    switch (type) {
      case 'email':
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(sanitized) || sanitized.length > 254) {
          return { isValid: false, error: 'Invalid email format' };
        }
        break;
        
      case 'password':
        if (sanitized.length < 8 || sanitized.length > 128) {
          return { isValid: false, error: 'Password must be between 8 and 128 characters' };
        }
        break;
        
      case 'name':
        if (sanitized.length < 1 || sanitized.length > 100) {
          return { isValid: false, error: 'Name must be between 1 and 100 characters' };
        }
        // Check for potentially malicious patterns
        if (/[<>\"'&]/.test(sanitized)) {
          return { isValid: false, error: 'Name contains invalid characters' };
        }
        break;
        
      case 'general':
        if (sanitized.length > 1000) {
          return { isValid: false, error: 'Input too long' };
        }
        break;
    }

    return { isValid: true, sanitized };
  }
}