import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { AuthService } from '../services/auth';
import { authRateLimiter } from '../middleware/rateLimiter';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { ErrorHandlingService } from '../services/errorHandlingService';
import { RateLimitingService } from '../services/rateLimitingService.simple';
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
  role: Joi.string().valid('agent', 'admin').default('agent')
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().required()
});

// Register new user
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

  const { email, password, firstName, lastName, role } = value;

  // For registration, we'll use a simple approach without complex rate limiting for now
  // This can be enhanced later if needed

  try {
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

    const user = await AuthService.createUser({ 
      email: emailValidation.sanitized!, 
      password: passwordValidation.sanitized!, 
      firstName: firstNameValidation.sanitized!, 
      lastName: lastNameValidation.sanitized!, 
      role 
    });
    
    // Registration successful
    
    ErrorHandlingService.logSecurityEvent('login_success', {
      userId: user.id,
      email: user.email,
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('User-Agent'),
      action: 'register'
    });

    return res.status(201).json({
      message: 'User created successfully',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      }
    });
  } catch (error: any) {
    // Registration failed
    
    if (error.code === '23505') { // Unique violation
      const errorResponse = ErrorHandlingService.createErrorResponse(
        'An account with this email already exists',
        'DUPLICATE_EMAIL'
      );
      return res.status(409).json(errorResponse);
    }
    
    const sanitizedMessage = ErrorHandlingService.sanitizeAuthError(error, 'register');
    const errorResponse = ErrorHandlingService.createErrorResponse(sanitizedMessage, 'REGISTRATION_FAILED');
    return res.status(400).json(errorResponse);
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
  const rateLimitResult = await RateLimitingService.checkLoginRateLimit(emailValidation.sanitized!, req.ip || 'unknown');
  if (!rateLimitResult.allowed) {
    ErrorHandlingService.logSecurityEvent('rate_limit_exceeded', {
      email: emailValidation.sanitized!,
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('User-Agent'),
      attemptCount: rateLimitResult.totalHits,
      lockoutTime: rateLimitResult.lockoutTime
    });

    const errorResponse = ErrorHandlingService.createRateLimitErrorResponse(
      rateLimitResult.isLockedOut 
        ? `Account temporarily locked due to too many failed attempts. Try again in ${Math.ceil((rateLimitResult.lockoutDuration || 0) / 60)} minutes.`
        : 'Too many login attempts. Please try again later.',
      rateLimitResult.retryAfter || rateLimitResult.lockoutDuration || 900,
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
    await RateLimitingService.recordLoginAttempt(emailValidation.sanitized!, true, req.ip || 'unknown');
    
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
    await RateLimitingService.recordLoginAttempt(emailValidation.sanitized!, false, req.ip || 'unknown');
    
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
  const clientIp = req.ip || 'unknown';
  const rateLimitResult = await RateLimitingService.checkTokenRefreshRateLimit(identifier, clientIp);
  if (!rateLimitResult.allowed) {
    await RateLimitingService.recordTokenRefreshAttempt(identifier, false, clientIp);
    
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
    await RateLimitingService.recordTokenRefreshAttempt(identifier, true, clientIp);
    
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
    await RateLimitingService.recordTokenRefreshAttempt(identifier, false, clientIp);
    
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

export { router as authRoutes };