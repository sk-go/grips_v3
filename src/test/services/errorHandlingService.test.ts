import { ErrorHandlingService } from '../../services/errorHandlingService';

describe('ErrorHandlingService', () => {
  describe('createErrorResponse', () => {
    it('should create a standard error response', () => {
      const response = ErrorHandlingService.createErrorResponse(
        'Test error',
        'TEST_ERROR',
        { detail: 'test' }
      );

      expect(response).toMatchObject({
        error: 'Test error',
        code: 'TEST_ERROR',
        timestamp: expect.any(String)
      });
    });

    it('should include details in development mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const response = ErrorHandlingService.createErrorResponse(
        'Test error',
        'TEST_ERROR',
        { detail: 'test' }
      );

      expect(response.details).toEqual({ detail: 'test' });

      process.env.NODE_ENV = originalEnv;
    });

    it('should exclude details in production mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const response = ErrorHandlingService.createErrorResponse(
        'Test error',
        'TEST_ERROR',
        { detail: 'test' }
      );

      expect(response.details).toBeUndefined();

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('createValidationErrorResponse', () => {
    it('should create a validation error response', () => {
      const validationErrors = [
        { field: 'email', message: 'Invalid email format' },
        { field: 'password', message: 'Password too short' }
      ];

      const response = ErrorHandlingService.createValidationErrorResponse(
        'Validation failed',
        validationErrors
      );

      expect(response).toMatchObject({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        validationErrors,
        timestamp: expect.any(String)
      });
    });
  });

  describe('createRateLimitErrorResponse', () => {
    it('should create a rate limit error response', () => {
      const response = ErrorHandlingService.createRateLimitErrorResponse(
        'Too many requests',
        300,
        10,
        5,
        Date.now() + 300000
      );

      expect(response).toMatchObject({
        error: 'Too many requests',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: 300,
        limit: 10,
        remaining: 5,
        resetTime: expect.any(Number),
        timestamp: expect.any(String)
      });
    });
  });

  describe('sanitizeAuthError', () => {
    it('should sanitize login errors to prevent user enumeration', () => {
      const userNotFoundError = new Error('User not found');
      const invalidPasswordError = new Error('Invalid password');
      const accountInactiveError = new Error('Account is inactive');

      expect(ErrorHandlingService.sanitizeAuthError(userNotFoundError, 'login'))
        .toBe('Invalid email or password');
      expect(ErrorHandlingService.sanitizeAuthError(invalidPasswordError, 'login'))
        .toBe('Invalid email or password');
      expect(ErrorHandlingService.sanitizeAuthError(accountInactiveError, 'login'))
        .toBe('Account is not active. Please contact support.');
    });

    it('should preserve rate limiting messages', () => {
      const rateLimitError = new Error('Too many failed attempts. Account locked for 30 minutes.');
      
      expect(ErrorHandlingService.sanitizeAuthError(rateLimitError, 'login'))
        .toBe('Too many failed attempts. Account locked for 30 minutes.');
    });

    it('should sanitize password reset errors to prevent enumeration', () => {
      const userNotFoundError = new Error('User not found');
      const emailNotFoundError = new Error('Email not found');
      
      expect(ErrorHandlingService.sanitizeAuthError(userNotFoundError, 'password_reset'))
        .toBe('If the email exists, a password reset link has been sent');
      expect(ErrorHandlingService.sanitizeAuthError(emailNotFoundError, 'password_reset'))
        .toBe('If the email exists, a password reset link has been sent');
    });

    it('should preserve token-specific errors for password reset', () => {
      const invalidTokenError = new Error('Invalid token');
      const expiredTokenError = new Error('Token has expired');
      
      expect(ErrorHandlingService.sanitizeAuthError(invalidTokenError, 'password_reset'))
        .toBe('Invalid token');
      expect(ErrorHandlingService.sanitizeAuthError(expiredTokenError, 'password_reset'))
        .toBe('Token has expired');
    });

    it('should sanitize token refresh errors', () => {
      const invalidTokenError = new Error('Invalid refresh token');
      const expiredTokenError = new Error('Token expired');
      
      expect(ErrorHandlingService.sanitizeAuthError(invalidTokenError, 'token_refresh'))
        .toBe('Session expired. Please log in again.');
      expect(ErrorHandlingService.sanitizeAuthError(expiredTokenError, 'token_refresh'))
        .toBe('Session expired. Please log in again.');
    });
  });

  describe('validateInput', () => {
    it('should validate email format', () => {
      const validEmail = ErrorHandlingService.validateInput('test@example.com', 'email');
      const invalidEmail = ErrorHandlingService.validateInput('invalid-email', 'email');
      const longEmail = ErrorHandlingService.validateInput('a'.repeat(250) + '@example.com', 'email');

      expect(validEmail.isValid).toBe(true);
      expect(validEmail.sanitized).toBe('test@example.com');
      
      expect(invalidEmail.isValid).toBe(false);
      expect(invalidEmail.error).toBe('Invalid email format');
      
      expect(longEmail.isValid).toBe(false);
      expect(longEmail.error).toBe('Invalid email format');
    });

    it('should validate password length', () => {
      const validPassword = ErrorHandlingService.validateInput('password123', 'password');
      const shortPassword = ErrorHandlingService.validateInput('short', 'password');
      const longPassword = ErrorHandlingService.validateInput('a'.repeat(130), 'password');

      expect(validPassword.isValid).toBe(true);
      expect(validPassword.sanitized).toBe('password123');
      
      expect(shortPassword.isValid).toBe(false);
      expect(shortPassword.error).toBe('Password must be between 8 and 128 characters');
      
      expect(longPassword.isValid).toBe(false);
      expect(longPassword.error).toBe('Password must be between 8 and 128 characters');
    });

    it('should validate name format', () => {
      const validName = ErrorHandlingService.validateInput('John Doe', 'name');
      const emptyName = ErrorHandlingService.validateInput('', 'name');
      const longName = ErrorHandlingService.validateInput('a'.repeat(101), 'name');
      const maliciousName = ErrorHandlingService.validateInput('<script>alert("xss")</script>', 'name');

      expect(validName.isValid).toBe(true);
      expect(validName.sanitized).toBe('John Doe');
      
      expect(emptyName.isValid).toBe(false);
      expect(emptyName.error).toBe('Name must be between 1 and 100 characters');
      
      expect(longName.isValid).toBe(false);
      expect(longName.error).toBe('Name must be between 1 and 100 characters');
      
      expect(maliciousName.isValid).toBe(false);
      expect(maliciousName.error).toBe('Name contains invalid characters');
    });

    it('should remove control characters', () => {
      const inputWithControlChars = 'test\x00\x01\x1Fstring';
      const result = ErrorHandlingService.validateInput(inputWithControlChars, 'general');

      expect(result.isValid).toBe(true);
      expect(result.sanitized).toBe('teststring');
    });

    it('should validate non-string input', () => {
      const numberInput = ErrorHandlingService.validateInput(123 as any, 'email');
      const objectInput = ErrorHandlingService.validateInput({} as any, 'password');

      expect(numberInput.isValid).toBe(false);
      expect(numberInput.error).toBe('Input must be a string');
      
      expect(objectInput.isValid).toBe(false);
      expect(objectInput.error).toBe('Input must be a string');
    });
  });

  describe('handleDatabaseError', () => {
    it('should handle unique violation errors', () => {
      const error = { code: '23505', message: 'duplicate key value violates unique constraint' };
      const response = ErrorHandlingService.handleDatabaseError(error, 'test-context');

      expect(response.error).toBe('A record with this information already exists');
      expect(response.code).toBe('DUPLICATE_RECORD');
    });

    it('should handle foreign key violation errors', () => {
      const error = { code: '23503', message: 'foreign key constraint violation' };
      const response = ErrorHandlingService.handleDatabaseError(error, 'test-context');

      expect(response.error).toBe('Invalid reference to related data');
      expect(response.code).toBe('INVALID_REFERENCE');
    });

    it('should handle not null violation errors', () => {
      const error = { code: '23502', message: 'null value in column violates not-null constraint' };
      const response = ErrorHandlingService.handleDatabaseError(error, 'test-context');

      expect(response.error).toBe('Required information is missing');
      expect(response.code).toBe('MISSING_REQUIRED_FIELD');
    });

    it('should handle undefined table errors', () => {
      const error = { code: '42P01', message: 'relation "nonexistent_table" does not exist' };
      const response = ErrorHandlingService.handleDatabaseError(error, 'test-context');

      expect(response.error).toBe('System configuration error');
      expect(response.code).toBe('SYSTEM_ERROR');
    });

    it('should handle unknown database errors', () => {
      const error = { code: 'UNKNOWN', message: 'unknown database error' };
      const response = ErrorHandlingService.handleDatabaseError(error, 'test-context');

      expect(response.error).toBe('An error occurred while processing your request');
      expect(response.code).toBe('DATABASE_ERROR');
    });
  });

  describe('isSecurityRelevantError', () => {
    it('should identify security-relevant errors', () => {
      const authError = new Error('Invalid credentials');
      const tokenError = new Error('Token expired');
      const rateLimitError = new Error('Too many attempts');

      expect(ErrorHandlingService.isSecurityRelevantError(authError, 'auth')).toBe(true);
      expect(ErrorHandlingService.isSecurityRelevantError(tokenError, 'general')).toBe(true);
      expect(ErrorHandlingService.isSecurityRelevantError(rateLimitError, 'general')).toBe(true);
    });

    it('should not identify non-security errors', () => {
      const generalError = new Error('General application error');
      const validationError = new Error('Field is required');

      expect(ErrorHandlingService.isSecurityRelevantError(generalError, 'general')).toBe(false);
      expect(ErrorHandlingService.isSecurityRelevantError(validationError, 'general')).toBe(false);
    });
  });
});