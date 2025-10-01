import { Router, Request, Response } from 'express';
import { AuthService } from '../../services/auth';
import { authRateLimiter } from '../../middleware/rateLimiter';
import { authenticateToken } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/errorHandler';
import { ErrorHandlingService } from '../../services/errorHandlingService';
import { RateLimitingService } from '../../services/rateLimitingService';
import { loginSchema, refreshSchema } from './schemas';

const router = Router();

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

export default router;