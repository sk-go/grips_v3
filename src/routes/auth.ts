import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { AuthService } from '../services/auth';
import { authRateLimiter } from '../middleware/rateLimiter';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { ErrorHandlingService } from '../services/errorHandlingService';
import { RateLimitingService } from '../services/rateLimitingService';
import { RegistrationRateLimitingService } from '../services/registrationRateLimitingService';
import { DatabaseService } from '../services/database';
import { CaptchaService } from '../services/security/captchaService';
import { SecurityMonitoringService } from '../services/security/securityMonitoringService';
import { logger } from '../utils/logger';
import passwordManagementRoutes from './passwordManagement';

const router = Router();

// Mount password management routes
router.use('/password', passwordManagementRoutes);

// Validation schemas
const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  firstName: Joi.string().min(1).max(100).required(),
  lastName: Joi.string().min(1).max(100).required(),
  role: Joi.string().valid('agent', 'admin').default('agent'),
  // CAPTCHA fields
  captchaToken: Joi.string().optional(),
  // Accessibility fallback fields
  accessibilityChallenge: Joi.object({
    id: Joi.string().required(),
    answer: Joi.string().required()
  }).optional()
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().required()
});

// Register new user with email verification
router.post('/register', authRateLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { error, value } = registerSchema.validate(req.body);
  if (error) {
    const validationErrors = error.details.map(d => ({
      field: d.path.join('.'),
      message: d.message,
      value: d.context?.value
    }));
    
    const errorResponse = ErrorHandlingService.createValidationErrorResponse(
      'Validation failed',
      validationErrors
    );
    return res.status(400).json(errorResponse);
  }

  const { email, password, firstName, lastName, role, captchaToken, accessibilityChallenge } = value;

  try {
    // Verify CAPTCHA if enabled
    if (CaptchaService.isEnabled()) {
      let captchaVerified = false;
      let captchaError = '';

      if (captchaToken) {
        // Verify standard CAPTCHA token
        const captchaResult = await CaptchaService.verifyCaptcha(
          captchaToken, 
          req.ip, 
          'registration'
        );
        
        if (captchaResult.success) {
          captchaVerified = true;
        } else {
          captchaError = CaptchaService.getErrorMessage(captchaResult.errorCodes || []);
        }
      } else if (accessibilityChallenge) {
        // Verify accessibility fallback challenge
        // Note: In a real implementation, you'd store the correct answer securely
        // For now, we'll use a simple verification method
        const storedAnswer = await getCachedChallengeAnswer(accessibilityChallenge.id);
        if (storedAnswer && CaptchaService.verifyAccessibilityFallback(
          accessibilityChallenge.answer, 
          storedAnswer
        )) {
          captchaVerified = true;
          // Clean up the cached challenge
          await removeCachedChallenge(accessibilityChallenge.id);
        } else {
          captchaError = 'Incorrect answer to accessibility challenge. Please try again.';
        }
      } else {
        captchaError = 'CAPTCHA verification required. Please complete the security challenge.';
      }

      if (!captchaVerified) {
        ErrorHandlingService.logSecurityEvent('captcha_verification_failed', {
          email: email.toLowerCase(),
          ipAddress: req.ip || 'unknown',
          userAgent: req.get('User-Agent'),
          error: captchaError,
          hasCaptchaToken: !!captchaToken,
          hasAccessibilityChallenge: !!accessibilityChallenge
        });

        const errorResponse = ErrorHandlingService.createErrorResponse(
          captchaError,
          'CAPTCHA_VERIFICATION_FAILED'
        );
        return res.status(400).json(errorResponse);
      }

      // Log successful CAPTCHA verification
      ErrorHandlingService.logSecurityEvent('captcha_verification_success', {
        email: email.toLowerCase(),
        ipAddress: req.ip || 'unknown',
        userAgent: req.get('User-Agent'),
        method: captchaToken ? 'standard' : 'accessibility'
      });
    }

    // Analyze registration pattern for suspicious activity
    const securityAnalysis = await SecurityMonitoringService.analyzeRegistrationPattern(
      req.ip || 'unknown',
      email.toLowerCase(),
      req.get('User-Agent')
    );

    if (securityAnalysis.suspicious) {
      ErrorHandlingService.logSecurityEvent('registration_failure', {
        email: email.toLowerCase(),
        ipAddress: req.ip || 'unknown',
        userAgent: req.get('User-Agent'),
        error: 'Suspicious registration pattern detected',
        securityScore: securityAnalysis.score,
        securityReasons: securityAnalysis.reasons
      });

      // For high-risk registrations, we might want to block them entirely
      if (securityAnalysis.score >= 80) {
        const errorResponse = ErrorHandlingService.createErrorResponse(
          'Registration temporarily unavailable. Please try again later or contact support.',
          'SECURITY_BLOCK'
        );
        return res.status(403).json(errorResponse);
      }

      // For medium-risk registrations, we might require additional verification
      if (securityAnalysis.score >= 60) {
        logger.warn('Medium-risk registration detected, proceeding with additional monitoring', {
          email: email.toLowerCase(),
          ipAddress: req.ip || 'unknown',
          score: securityAnalysis.score,
          reasons: securityAnalysis.reasons
        });
      }
    }
    // Check IP-based registration rate limiting
    const ipRateLimitResult = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(
      req.ip || 'unknown',
      req.get('User-Agent')
    );

    if (!ipRateLimitResult.allowed) {
      ErrorHandlingService.logSecurityEvent('rate_limit_exceeded', {
        email: email.toLowerCase(),
        ipAddress: req.ip || 'unknown',
        userAgent: req.get('User-Agent'),
        action: 'register_ip',
        attemptCount: ipRateLimitResult.totalHits,
        suspiciousActivity: ipRateLimitResult.suspiciousActivity
      });

      const errorResponse = ErrorHandlingService.createRateLimitErrorResponse(
        ipRateLimitResult.suspiciousActivity 
          ? 'Suspicious registration activity detected. Please try again later or contact support.'
          : 'Too many registration attempts from this location. Please try again later.',
        ipRateLimitResult.retryAfter || 7200, // 2 hours default
        5,
        ipRateLimitResult.remaining,
        ipRateLimitResult.resetTime
      );
      return res.status(429).json(errorResponse);
    }

    // Check email-based registration rate limiting
    const emailRateLimitResult = await RegistrationRateLimitingService.checkRegistrationRateLimitByEmail(
      email.toLowerCase(),
      req.ip || 'unknown'
    );

    if (!emailRateLimitResult.allowed) {
      ErrorHandlingService.logSecurityEvent('rate_limit_exceeded', {
        email: email.toLowerCase(),
        ipAddress: req.ip || 'unknown',
        userAgent: req.get('User-Agent'),
        action: 'register_email',
        attemptCount: emailRateLimitResult.totalHits
      });

      const errorResponse = ErrorHandlingService.createRateLimitErrorResponse(
        'Too many registration attempts with this email address. Please try again later.',
        emailRateLimitResult.retryAfter || 86400, // 24 hours default
        3,
        emailRateLimitResult.remaining,
        emailRateLimitResult.resetTime
      );
      return res.status(429).json(errorResponse);
    }

    // Apply progressive delay if needed
    if (ipRateLimitResult.progressiveDelay && ipRateLimitResult.progressiveDelay > 0) {
      logger.info('Applying progressive delay for registration attempt', {
        email: email.toLowerCase(),
        ipAddress: req.ip || 'unknown',
        delay: ipRateLimitResult.progressiveDelay
      });
      
      // In a real implementation, you might want to implement this delay
      // For now, we'll just log it and continue
    }

    // Validate and sanitize inputs
    const emailValidation = ErrorHandlingService.validateInput(email, 'email');
    const passwordValidation = ErrorHandlingService.validateInput(password, 'password');
    const firstNameValidation = ErrorHandlingService.validateInput(firstName, 'name');
    const lastNameValidation = ErrorHandlingService.validateInput(lastName, 'name');

    if (!emailValidation.isValid || !passwordValidation.isValid || 
        !firstNameValidation.isValid || !lastNameValidation.isValid) {
      const validationErrors = [
        ...(emailValidation.error ? [{ field: 'email', message: emailValidation.error }] : []),
        ...(passwordValidation.error ? [{ field: 'password', message: passwordValidation.error }] : []),
        ...(firstNameValidation.error ? [{ field: 'firstName', message: firstNameValidation.error }] : []),
        ...(lastNameValidation.error ? [{ field: 'lastName', message: lastNameValidation.error }] : [])
      ];
      
      const errorResponse = ErrorHandlingService.createValidationErrorResponse(
        'Input validation failed',
        validationErrors
      );
      return res.status(400).json(errorResponse);
    }

    // Use the enhanced registration method from AuthService
    const registrationResult = await AuthService.registerUser({
      email: emailValidation.sanitized!,
      password: passwordValidation.sanitized!,
      firstName: firstNameValidation.sanitized!,
      lastName: lastNameValidation.sanitized!,
      role,
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('User-Agent')
    });

    // Record successful registration attempt
    await RegistrationRateLimitingService.recordRegistrationAttempt(
      emailValidation.sanitized!,
      req.ip || 'unknown',
      true, // success
      req.get('User-Agent')
    );

    // Registration successful
    ErrorHandlingService.logSecurityEvent('registration_success', {
      userId: registrationResult.userId,
      email: emailValidation.sanitized!,
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('User-Agent'),
      requiresVerification: registrationResult.requiresVerification,
      requiresApproval: registrationResult.requiresApproval
    });

    return res.status(201).json({
      success: registrationResult.success,
      message: registrationResult.message,
      requiresVerification: registrationResult.requiresVerification,
      requiresApproval: registrationResult.requiresApproval,
      user: registrationResult.user ? {
        id: registrationResult.user.id,
        email: registrationResult.user.email,
        firstName: registrationResult.user.firstName,
        lastName: registrationResult.user.lastName,
        role: registrationResult.user.role,
        emailVerified: registrationResult.user.emailVerified
      } : undefined
    });
  } catch (error: any) {
    // Record failed registration attempt
    await RegistrationRateLimitingService.recordRegistrationAttempt(
      email.toLowerCase(),
      req.ip || 'unknown',
      false, // failure
      req.get('User-Agent')
    );

    // Registration failed
    ErrorHandlingService.logSecurityEvent('registration_failure', {
      email: email.toLowerCase(),
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('User-Agent'),
      error: error.message
    });

    if (error.message.includes('email already exists') || error.message.includes('available')) {
      const errorResponse = ErrorHandlingService.createErrorResponse(
        'If this email is available, you will receive a verification email shortly.',
        'EMAIL_PROCESSING'
      );
      return res.status(200).json(errorResponse); // Return 200 to prevent email enumeration
    }
    
    if (error.message.includes('rate limit')) {
      const errorResponse = ErrorHandlingService.createErrorResponse(
        error.message,
        'RATE_LIMIT_EXCEEDED'
      );
      return res.status(429).json(errorResponse);
    }

    if (error.message.includes('validation failed')) {
      const errorResponse = ErrorHandlingService.createErrorResponse(
        error.message,
        'VALIDATION_FAILED'
      );
      return res.status(400).json(errorResponse);
    }
    
    const sanitizedMessage = ErrorHandlingService.sanitizeAuthError(error, 'register');
    const errorResponse = ErrorHandlingService.createErrorResponse(sanitizedMessage, 'REGISTRATION_FAILED');
    return res.status(400).json(errorResponse);
  }
}));

// Verify email with token
router.get('/verify-email/:token', asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params;

  if (!token || typeof token !== 'string') {
    const errorResponse = ErrorHandlingService.createErrorResponse(
      'Invalid verification token',
      'INVALID_TOKEN'
    );
    return res.status(400).json(errorResponse);
  }

  try {
    // For verification attempts, we'll use a simple rate limit based on IP
    // since we don't know the email until we validate the token
    const rateLimitResult = await RateLimitingService.checkRateLimit(
      req.ip || 'unknown',
      'api', // Use general API rate limit for verification
      req.ip || 'unknown'
    );

    if (!rateLimitResult.allowed) {
      const errorResponse = ErrorHandlingService.createRateLimitErrorResponse(
        'Too many verification attempts. Please try again later.',
        rateLimitResult.retryAfter || 900,
        100,
        rateLimitResult.remaining,
        rateLimitResult.resetTime
      );
      return res.status(429).json(errorResponse);
    }

    // Validate the verification token
    const { EmailVerificationService } = await import('../services/emailVerificationService');
    const validationResult = await EmailVerificationService.validateVerificationToken(token);

    if (!validationResult.isValid) {
      ErrorHandlingService.logSecurityEvent('email_verification_failed', {
        token: token.substring(0, 8) + '...',
        ipAddress: req.ip || 'unknown',
        userAgent: req.get('User-Agent'),
        error: validationResult.error,
        isExpired: validationResult.isExpired
      });

      if (validationResult.isExpired) {
        const errorResponse = ErrorHandlingService.createErrorResponse(
          'Verification link has expired. Please request a new verification email.',
          'TOKEN_EXPIRED'
        );
        return res.status(410).json(errorResponse);
      }

      const errorResponse = ErrorHandlingService.createErrorResponse(
        validationResult.error || 'Invalid verification token',
        'INVALID_TOKEN'
      );
      return res.status(400).json(errorResponse);
    }

    // Mark email as verified
    await EmailVerificationService.markEmailAsVerified(validationResult.userId!, token);

    // Get updated user information
    const user = await AuthService.getUserById(validationResult.userId!);
    if (!user) {
      const errorResponse = ErrorHandlingService.createErrorResponse(
        'User not found',
        'USER_NOT_FOUND'
      );
      return res.status(404).json(errorResponse);
    }

    ErrorHandlingService.logSecurityEvent('email_verification_success', {
      userId: validationResult.userId!,
      email: user.email,
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('User-Agent')
    });

    return res.json({
      success: true,
      message: 'Email verified successfully. You can now log in to your account.',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        emailVerified: true
      }
    });
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Email verification failed', {
      token: token.substring(0, 8) + '...',
      error: errorMessage,
      ipAddress: req.ip || 'unknown'
    });

    const sanitizedMessage = ErrorHandlingService.sanitizeAuthError(error, 'email_verification');
    const errorResponse = ErrorHandlingService.createErrorResponse(sanitizedMessage, 'VERIFICATION_FAILED');
    return res.status(500).json(errorResponse);
  }
}));

// Resend verification email
router.post('/resend-verification', asyncHandler(async (req: Request, res: Response) => {
  const resendSchema = Joi.object({
    email: Joi.string().email().required()
  });

  const { error, value } = resendSchema.validate(req.body);
  if (error) {
    const validationErrors = error.details.map(d => ({
      field: d.path.join('.'),
      message: d.message,
      value: d.context?.value
    }));
    
    const errorResponse = ErrorHandlingService.createValidationErrorResponse(
      'Validation failed',
      validationErrors
    );
    return res.status(400).json(errorResponse);
  }

  const { email } = value;

  try {
    // Check rate limiting for resend verification
    const rateLimitResult = await RegistrationRateLimitingService.checkResendVerificationRateLimit(
      email.toLowerCase(),
      req.ip || 'unknown'
    );

    if (!rateLimitResult.allowed) {
      ErrorHandlingService.logSecurityEvent('rate_limit_exceeded', {
        email: email.toLowerCase(),
        ipAddress: req.ip || 'unknown',
        userAgent: req.get('User-Agent'),
        action: 'resend_verification',
        attemptCount: rateLimitResult.totalHits
      });

      const errorResponse = ErrorHandlingService.createRateLimitErrorResponse(
        'Too many verification email requests. Please try again later.',
        900, // 15 minutes
        3,
        rateLimitResult.remaining,
        rateLimitResult.resetTime
      );
      return res.status(429).json(errorResponse);
    }

    // Record the resend attempt
    await RegistrationRateLimitingService.recordResendVerificationAttempt(
      email.toLowerCase(), 
      req.ip || 'unknown'
    );

    // Validate and sanitize email
    const emailValidation = ErrorHandlingService.validateInput(email, 'email');
    if (!emailValidation.isValid) {
      const errorResponse = ErrorHandlingService.createValidationErrorResponse(
        'Input validation failed',
        [{ field: 'email', message: emailValidation.error || 'Invalid email' }]
      );
      return res.status(400).json(errorResponse);
    }

    // Check if user exists and needs verification
    const user = await AuthService.getUserByEmail(emailValidation.sanitized!);
    
    // Always return success to prevent email enumeration
    const successResponse = {
      success: true,
      message: 'If an account with this email exists and requires verification, a new verification email has been sent.'
    };

    if (!user) {
      // Log but don't reveal user doesn't exist
      logger.warn('Verification resend requested for non-existent user', {
        email: emailValidation.sanitized!,
        ipAddress: req.ip || 'unknown'
      });
      return res.json(successResponse);
    }

    if (user.emailVerified) {
      // Log but don't reveal email is already verified
      logger.info('Verification resend requested for already verified user', {
        userId: user.id,
        email: user.email,
        ipAddress: req.ip || 'unknown'
      });
      return res.json(successResponse);
    }

    // Generate new verification token and send email
    const { EmailVerificationService } = await import('../services/emailVerificationService');
    
    // Invalidate existing tokens first
    await EmailVerificationService.invalidateUserTokens(user.id);
    
    // Generate new token
    const verificationToken = await EmailVerificationService.generateVerificationToken(user.id);
    
    // Send verification email
    const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/verify-email/${verificationToken}`;
    const settings = await EmailVerificationService.getRegistrationSettings();
    const expiryHours = settings?.verificationTokenExpiryHours || 24;
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + expiryHours);

    const { EmailNotificationService } = await import('../services/email/emailNotificationService');
    const emailService = new EmailNotificationService();
    
    await emailService.sendVerificationEmail({
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      verificationToken,
      verificationUrl,
      expiresAt
    });

    ErrorHandlingService.logSecurityEvent('verification_resend_success', {
      userId: user.id,
      email: user.email,
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('User-Agent')
    });

    return res.json(successResponse);
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Resend verification failed', {
      email: email.toLowerCase(),
      error: errorMessage,
      ipAddress: req.ip || 'unknown'
    });

    // Always return success to prevent information disclosure
    return res.json({
      success: true,
      message: 'If an account with this email exists and requires verification, a new verification email has been sent.'
    });
  }
}));

// Login user
router.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const { error, value } = loginSchema.validate(req.body);
  if (error) {
    const validationErrors = error.details.map(d => ({
      field: d.path.join('.'),
      message: d.message,
      value: d.context?.value
    }));
    
    const errorResponse = ErrorHandlingService.createValidationErrorResponse(
      'Validation failed',
      validationErrors
    );
    return res.status(400).json(errorResponse);
  }

  const { email, password } = value;

  // Validate and sanitize inputs
  const emailValidation = ErrorHandlingService.validateInput(email, 'email');
  const passwordValidation = ErrorHandlingService.validateInput(password, 'password');

  if (!emailValidation.isValid || !passwordValidation.isValid) {
    const validationErrors = [
      ...(emailValidation.error ? [{ field: 'email', message: emailValidation.error }] : []),
      ...(passwordValidation.error ? [{ field: 'password', message: passwordValidation.error }] : [])
    ];
    
    const errorResponse = ErrorHandlingService.createValidationErrorResponse(
      'Input validation failed',
      validationErrors
    );
    return res.status(400).json(errorResponse);
  }

  // Check login rate limit
  const rateLimitResult = await RateLimitingService.checkRateLimit(
    emailValidation.sanitized!,
    'login',
    req.ip || 'unknown'
  );
  if (!rateLimitResult.allowed) {
    ErrorHandlingService.logSecurityEvent('rate_limit_exceeded', {
      email: emailValidation.sanitized!,
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('User-Agent'),
      attemptCount: rateLimitResult.totalHits
    });

    const errorResponse = ErrorHandlingService.createRateLimitErrorResponse(
      'Too many login attempts. Please try again later.',
      rateLimitResult.retryAfter || 900,
      5,
      rateLimitResult.remaining,
      rateLimitResult.resetTime
    );
    return res.status(429).json(errorResponse);
  }

  try {
    const authResult = await AuthService.authenticateUser(
      emailValidation.sanitized!, 
      passwordValidation.sanitized!, 
      req.ip || 'unknown'
    );
    
    // Record successful login
    await RateLimitingService.recordAttempt(emailValidation.sanitized!, 'login', req.ip || 'unknown');
    
    ErrorHandlingService.logSecurityEvent('login_success', {
      userId: authResult.user.id,
      email: authResult.user.email,
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('User-Agent')
    });
    
    return res.json({
      message: 'Login successful',
      ...authResult
    });
  } catch (error: any) {
    // Record failed login attempt
    await RateLimitingService.recordAttempt(emailValidation.sanitized!, 'login', req.ip || 'unknown');
    
    ErrorHandlingService.logSecurityEvent('login_failure', {
      email: emailValidation.sanitized!,
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('User-Agent'),
      error: error.message
    });
    
    const sanitizedMessage = ErrorHandlingService.sanitizeAuthError(error, 'login');
    const errorResponse = ErrorHandlingService.createErrorResponse(sanitizedMessage, 'LOGIN_FAILED');
    return res.status(401).json(errorResponse);
  }
}));

// Refresh access token
router.post('/refresh', asyncHandler(async (req: Request, res: Response) => {
  const { error, value } = refreshSchema.validate(req.body);
  if (error) {
    const validationErrors = error.details.map(d => ({
      field: d.path.join('.'),
      message: d.message,
      value: d.context?.value
    }));
    
    const errorResponse = ErrorHandlingService.createValidationErrorResponse(
      'Validation failed',
      validationErrors
    );
    return res.status(400).json(errorResponse);
  }

  const { refreshToken } = value;

  // Check rate limit for token refresh
  const identifier = req.ip || 'unknown'; // Use IP for refresh token rate limiting
  const rateLimitResult = await RateLimitingService.checkRateLimit(identifier, 'tokenRefresh', req.ip || 'unknown');
  if (!rateLimitResult.allowed) {
    await RateLimitingService.recordAttempt(identifier, 'tokenRefresh', req.ip || 'unknown');
    
    const errorResponse = ErrorHandlingService.createRateLimitErrorResponse(
      'Too many token refresh attempts. Please try again later.',
      rateLimitResult.retryAfter || 300,
      10,
      rateLimitResult.remaining,
      rateLimitResult.resetTime
    );
    return res.status(429).json(errorResponse);
  }

  try {
    const authResult = await AuthService.refreshTokens(refreshToken);
    
    // Record successful refresh
    await RateLimitingService.recordAttempt(identifier, 'tokenRefresh', req.ip || 'unknown');
    
    ErrorHandlingService.logSecurityEvent('token_refresh', {
      userId: authResult.user.id,
      email: authResult.user.email,
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('User-Agent')
    });
    
    return res.json({
      message: 'Tokens refreshed successfully',
      ...authResult
    });
  } catch (error: any) {
    // Record failed refresh attempt
    await RateLimitingService.recordAttempt(identifier, 'tokenRefresh', req.ip || 'unknown');
    
    const sanitizedMessage = ErrorHandlingService.sanitizeAuthError(error, 'token_refresh');
    const errorResponse = ErrorHandlingService.createErrorResponse(sanitizedMessage, 'TOKEN_REFRESH_FAILED');
    return res.status(401).json(errorResponse);
  }
}));

// Logout user
router.post('/logout', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  await AuthService.logout(req.user!.id);
  
  return res.json({
    message: 'Logout successful'
  });
}));

// Get current user profile
router.get('/me', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const user = await AuthService.getUserById(req.user!.id);
  
  if (!user) {
    return res.status(404).json({
      error: 'User not found'
    });
  }

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isActive: user.isActive
    }
  });
}));

// Get registration status for current user
router.get('/registration-status', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const user = await AuthService.getUserById(req.user!.id);
    
    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    // Get registration settings to determine if approval is required
    const { EmailVerificationService } = await import('../services/emailVerificationService');
    const settings = await EmailVerificationService.getRegistrationSettings();

    // Check if user has pending verification token
    const pendingToken = await EmailVerificationService.getVerificationTokenByUserId(user.id);
    const hasUnexpiredToken = pendingToken && new Date() < pendingToken.expiresAt;

    const status = {
      userId: user.id,
      email: user.email,
      emailVerified: user.emailVerified || false,
      isActive: user.isActive,
      role: user.role,
      registrationComplete: user.emailVerified && user.isActive,
      requiresEmailVerification: !user.emailVerified,
      requiresAdminApproval: settings?.requireAdminApproval && user.isActive === false,
      canResendVerification: !user.emailVerified && !hasUnexpiredToken,
      verificationTokenExpired: !user.emailVerified && pendingToken && new Date() >= pendingToken.expiresAt
    };

    return res.json({
      success: true,
      status
    });
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to get registration status', {
      userId: req.user!.id,
      error: errorMessage
    });

    const errorResponse = ErrorHandlingService.createErrorResponse(
      'Failed to retrieve registration status',
      'STATUS_RETRIEVAL_FAILED'
    );
    return res.status(500).json(errorResponse);
  }
}));

// Admin endpoint: Get pending registrations (admin only)
router.get('/admin/pending-registrations', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  // Check if user is admin
  if (req.user!.role !== 'admin') {
    const errorResponse = ErrorHandlingService.createErrorResponse(
      'Access denied. Admin privileges required.',
      'INSUFFICIENT_PRIVILEGES'
    );
    return res.status(403).json(errorResponse);
  }

  try {
    // Get registration settings to check if approval is required
    const { EmailVerificationService } = await import('../services/emailVerificationService');
    const settings = await EmailVerificationService.getRegistrationSettings();

    if (!settings?.requireAdminApproval) {
      return res.json({
        success: true,
        message: 'Admin approval is not currently required for registrations',
        pendingRegistrations: []
      });
    }

    // Get users who are email verified but not active (pending approval)
    const result = await DatabaseService.query(`
      SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.created_at,
             u.email_verified, u.is_active
      FROM users u
      WHERE u.email_verified = true 
        AND u.is_active = false
      ORDER BY u.created_at ASC
    `);

    const pendingRegistrations = result.rows.map(row => ({
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      role: row.role,
      createdAt: row.created_at,
      emailVerified: row.email_verified,
      isActive: row.is_active
    }));

    return res.json({
      success: true,
      pendingRegistrations,
      count: pendingRegistrations.length
    });
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to get pending registrations', {
      adminId: req.user!.id,
      error: errorMessage
    });

    const errorResponse = ErrorHandlingService.createErrorResponse(
      'Failed to retrieve pending registrations',
      'PENDING_REGISTRATIONS_FAILED'
    );
    return res.status(500).json(errorResponse);
  }
}));

// Admin endpoint: Get registration statistics (admin only)
router.get('/admin/registration-statistics', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  // Check if user is admin
  if (req.user!.role !== 'admin') {
    const errorResponse = ErrorHandlingService.createErrorResponse(
      'Access denied. Admin privileges required.',
      'INSUFFICIENT_PRIVILEGES'
    );
    return res.status(403).json(errorResponse);
  }

  try {
    const timeWindowMs = parseInt(req.query.timeWindow as string) || (24 * 60 * 60 * 1000); // Default 24 hours
    const statistics = await RegistrationRateLimitingService.getRegistrationStatistics(timeWindowMs);

    return res.json({
      success: true,
      statistics,
      timeWindowHours: timeWindowMs / (60 * 60 * 1000)
    });
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to get registration statistics', {
      adminId: req.user!.id,
      error: errorMessage
    });

    const errorResponse = ErrorHandlingService.createErrorResponse(
      'Failed to retrieve registration statistics',
      'STATISTICS_RETRIEVAL_FAILED'
    );
    return res.status(500).json(errorResponse);
  }
}));

// Admin endpoint: Approve registration (admin only)
router.post('/admin/approve-registration/:userId', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  // Check if user is admin
  if (req.user!.role !== 'admin') {
    const errorResponse = ErrorHandlingService.createErrorResponse(
      'Access denied. Admin privileges required.',
      'INSUFFICIENT_PRIVILEGES'
    );
    return res.status(403).json(errorResponse);
  }

  const { userId } = req.params;

  if (!userId) {
    const errorResponse = ErrorHandlingService.createErrorResponse(
      'User ID is required',
      'MISSING_USER_ID'
    );
    return res.status(400).json(errorResponse);
  }

  try {
    // Get the user to approve
    const user = await AuthService.getUserById(userId);
    if (!user) {
      const errorResponse = ErrorHandlingService.createErrorResponse(
        'User not found',
        'USER_NOT_FOUND'
      );
      return res.status(404).json(errorResponse);
    }

    if (user.isActive) {
      return res.json({
        success: true,
        message: 'User is already active',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isActive: user.isActive
        }
      });
    }

    if (!user.emailVerified) {
      const errorResponse = ErrorHandlingService.createErrorResponse(
        'Cannot approve user with unverified email',
        'EMAIL_NOT_VERIFIED'
      );
      return res.status(400).json(errorResponse);
    }

    // Activate the user
    await DatabaseService.query(
      'UPDATE users SET is_active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [userId]
    );

    // Log the approval event
    await DatabaseService.query(`
      INSERT INTO registration_audit_log (user_id, event_type, event_data, admin_id, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      userId,
      'approval',
      JSON.stringify({
        approvedBy: req.user!.id,
        approvedAt: new Date().toISOString(),
        userEmail: user.email,
        userRole: user.role
      }),
      req.user!.id,
      req.ip || 'unknown',
      req.get('User-Agent')
    ]);

    ErrorHandlingService.logSecurityEvent('registration_approved', {
      userId: userId,
      adminId: req.user!.id,
      userEmail: user.email,
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('User-Agent')
    });

    // Send approval notification email
    try {
      const { EmailNotificationService } = await import('../services/email/emailNotificationService');
      const emailService = new EmailNotificationService();
      
      await emailService.sendRegistrationApprovalEmail({
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        loginUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`
      });
    } catch (emailError) {
      // Log email error but don't fail the approval
      logger.warn('Failed to send approval notification email', {
        userId: userId,
        email: user.email,
        error: emailError
      });
    }

    return res.json({
      success: true,
      message: 'User registration approved successfully',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isActive: true,
        emailVerified: user.emailVerified
      }
    });
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to approve registration', {
      userId,
      adminId: req.user!.id,
      error: errorMessage
    });

    const errorResponse = ErrorHandlingService.createErrorResponse(
      'Failed to approve registration',
      'APPROVAL_FAILED'
    );
    return res.status(500).json(errorResponse);
  }
}));

// Admin endpoint: Reject registration (admin only)
router.post('/admin/reject-registration/:userId', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  // Check if user is admin
  if (req.user!.role !== 'admin') {
    const errorResponse = ErrorHandlingService.createErrorResponse(
      'Access denied. Admin privileges required.',
      'INSUFFICIENT_PRIVILEGES'
    );
    return res.status(403).json(errorResponse);
  }

  const { userId } = req.params;
  const rejectionSchema = Joi.object({
    reason: Joi.string().min(1).max(500).required()
  });

  const { error, value } = rejectionSchema.validate(req.body);
  if (error) {
    const validationErrors = error.details.map(d => ({
      field: d.path.join('.'),
      message: d.message,
      value: d.context?.value
    }));
    
    const errorResponse = ErrorHandlingService.createValidationErrorResponse(
      'Validation failed',
      validationErrors
    );
    return res.status(400).json(errorResponse);
  }

  const { reason } = value;

  if (!userId) {
    const errorResponse = ErrorHandlingService.createErrorResponse(
      'User ID is required',
      'MISSING_USER_ID'
    );
    return res.status(400).json(errorResponse);
  }

  try {
    // Get the user to reject
    const user = await AuthService.getUserById(userId);
    if (!user) {
      const errorResponse = ErrorHandlingService.createErrorResponse(
        'User not found',
        'USER_NOT_FOUND'
      );
      return res.status(404).json(errorResponse);
    }

    // Log the rejection event before deleting user
    await DatabaseService.query(`
      INSERT INTO registration_audit_log (user_id, event_type, event_data, admin_id, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      userId,
      'rejection',
      JSON.stringify({
        rejectedBy: req.user!.id,
        rejectedAt: new Date().toISOString(),
        reason: reason,
        userEmail: user.email,
        userRole: user.role
      }),
      req.user!.id,
      req.ip || 'unknown',
      req.get('User-Agent')
    ]);

    // Send rejection notification email
    try {
      const { EmailNotificationService } = await import('../services/email/emailNotificationService');
      const emailService = new EmailNotificationService();
      
      await emailService.sendRegistrationRejectionEmail({
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        reason: reason,
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com'
      });
    } catch (emailError) {
      // Log email error but continue with rejection
      logger.warn('Failed to send rejection notification email', {
        userId: userId,
        email: user.email,
        error: emailError
      });
    }

    // Delete the user account (cascade will handle related records)
    await DatabaseService.query('DELETE FROM users WHERE id = $1', [userId]);

    ErrorHandlingService.logSecurityEvent('registration_rejected', {
      userId: userId,
      adminId: req.user!.id,
      userEmail: user.email,
      reason: reason,
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('User-Agent')
    });

    return res.json({
      success: true,
      message: 'User registration rejected and account removed',
      rejectedUser: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        reason: reason
      }
    });
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to reject registration', {
      userId,
      adminId: req.user!.id,
      error: errorMessage
    });

    const errorResponse = ErrorHandlingService.createErrorResponse(
      'Failed to reject registration',
      'REJECTION_FAILED'
    );
    return res.status(500).json(errorResponse);
  }
}));

// Verify token endpoint (useful for frontend token validation)
router.get('/verify', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  return res.json({
    valid: true,
    user: {
      id: req.user!.id,
      email: req.user!.email,
      role: req.user!.role
    }
  });
}));

// Get CAPTCHA configuration endpoint
router.get('/captcha-config', asyncHandler(async (req: Request, res: Response) => {
  const config = CaptchaService.getConfig();
  return res.json({
    success: true,
    config: {
      enabled: config.enabled,
      provider: config.provider,
      siteKey: config.siteKey,
      version: config.version,
      action: config.action
    }
  });
}));

// Generate accessibility fallback challenge
router.post('/accessibility-challenge', asyncHandler(async (req: Request, res: Response) => {
  if (!CaptchaService.isEnabled()) {
    return res.status(404).json({
      success: false,
      message: 'CAPTCHA is not enabled'
    });
  }

  const challenge = CaptchaService.generateAccessibilityFallback();
  
  // Cache the answer for later verification (expires in 10 minutes)
  await cacheChallengeAnswer(challenge.id, challenge.answer, 600);
  
  return res.json({
    success: true,
    challenge: {
      id: challenge.id,
      question: challenge.challenge
    }
  });
}));

// Helper functions for accessibility challenge caching
async function cacheChallengeAnswer(id: string, answer: string, ttlSeconds: number): Promise<void> {
  try {
    const { RedisService } = await import('../services/redis');
    const redis = RedisService.getClient();
    await redis.setEx(`accessibility_challenge:${id}`, ttlSeconds, answer);
  } catch (error) {
    logger.error('Failed to cache accessibility challenge answer', { id, error });
  }
}

async function getCachedChallengeAnswer(id: string): Promise<string | null> {
  try {
    const { RedisService } = await import('../services/redis');
    const redis = RedisService.getClient();
    return await redis.get(`accessibility_challenge:${id}`);
  } catch (error) {
    logger.error('Failed to get cached accessibility challenge answer', { id, error });
    return null;
  }
}

async function removeCachedChallenge(id: string): Promise<void> {
  try {
    const { RedisService } = await import('../services/redis');
    const redis = RedisService.getClient();
    await redis.del(`accessibility_challenge:${id}`);
  } catch (error) {
    logger.error('Failed to remove cached accessibility challenge', { id, error });
  }
}

export { router as authRoutes };