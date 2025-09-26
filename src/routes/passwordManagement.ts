import { Router, Request, Response } from 'express';
import { PasswordResetService } from '../services/passwordResetService';
import { AuthService } from '../services/auth';
import { authenticateToken } from '../middleware/auth';
import { ErrorHandlingService } from '../services/errorHandlingService';
import { RateLimitingService } from '../services/rateLimitingService.simple';
import { logger } from '../utils/logger';

const router = Router();

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    keycloakId?: string;
  };
}

/**
 * POST /api/auth/password/forgot
 * Initiate password reset process
 */
router.post('/forgot', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    // Validate input
    if (!email || typeof email !== 'string') {
      const errorResponse = ErrorHandlingService.createErrorResponse(
        'Email is required',
        'MISSING_EMAIL'
      );
      return res.status(400).json(errorResponse);
    }

    // Validate and sanitize email
    const emailValidation = ErrorHandlingService.validateInput(email, 'email');
    if (!emailValidation.isValid) {
      const errorResponse = ErrorHandlingService.createErrorResponse(
        emailValidation.error || 'Invalid email format',
        'INVALID_EMAIL'
      );
      return res.status(400).json(errorResponse);
    }

    // Check rate limit for password reset
    const rateLimitResult = await RateLimitingService.checkPasswordResetRateLimit(emailValidation.sanitized!, req.ip);
    if (!rateLimitResult.allowed) {
      await RateLimitingService.recordPasswordResetAttempt(emailValidation.sanitized!, req.ip);
      
      const errorResponse = ErrorHandlingService.createRateLimitErrorResponse(
        'Too many password reset attempts. Please try again later.',
        rateLimitResult.retryAfter || 3600,
        3,
        rateLimitResult.remaining,
        rateLimitResult.resetTime
      );
      return res.status(429).json(errorResponse);
    }

    // Get base URL for reset link
    const protocol = req.get('X-Forwarded-Proto') || req.protocol;
    const host = req.get('Host');
    const baseUrl = `${protocol}://${host}`;

    // Initiate password reset (this handles email sending internally)
    await PasswordResetService.initiatePasswordReset(emailValidation.sanitized!, baseUrl);

    // Record attempt (always successful to prevent enumeration)
    await RateLimitingService.recordPasswordResetAttempt(emailValidation.sanitized!, req.ip);

    // Always return success to prevent email enumeration
    ErrorHandlingService.logSecurityEvent('password_change', {
      email: emailValidation.sanitized!,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      action: 'reset_initiated'
    });

    return res.json({
      message: 'If the email exists, a password reset link has been sent'
    });

  } catch (error) {
    logger.error('Password reset initiation failed:', error);
    
    // Return generic success message to prevent information leakage
    return res.json({
      message: 'If the email exists, a password reset link has been sent'
    });
  }
});

/**
 * POST /api/auth/password/reset
 * Complete password reset with token
 */
router.post('/reset', async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;

    // Validate input
    if (!token || typeof token !== 'string') {
      const errorResponse = ErrorHandlingService.createErrorResponse(
        'Reset token is required',
        'MISSING_TOKEN'
      );
      return res.status(400).json(errorResponse);
    }

    if (!password || typeof password !== 'string') {
      const errorResponse = ErrorHandlingService.createErrorResponse(
        'New password is required',
        'MISSING_PASSWORD'
      );
      return res.status(400).json(errorResponse);
    }

    // Validate and sanitize password
    const passwordValidation = ErrorHandlingService.validateInput(password, 'password');
    if (!passwordValidation.isValid) {
      const errorResponse = ErrorHandlingService.createErrorResponse(
        passwordValidation.error || 'Invalid password format',
        'INVALID_PASSWORD'
      );
      return res.status(400).json(errorResponse);
    }

    // Complete password reset
    await PasswordResetService.completePasswordReset(token, passwordValidation.sanitized!, req.ip);

    ErrorHandlingService.logSecurityEvent('password_change', {
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      action: 'reset_completed'
    });

    return res.json({
      message: 'Password has been reset successfully'
    });

  } catch (error) {
    logger.error('Password reset completion failed:', error);
    
    const sanitizedMessage = ErrorHandlingService.sanitizeAuthError(
      error instanceof Error ? error : new Error('Password reset failed'),
      'password_reset'
    );
    
    const errorMessage = error instanceof Error ? error.message : 'Password reset failed';
    
    // Return specific error for password reset failures
    if (errorMessage.includes('Invalid or expired') || 
        errorMessage.includes('already been used') || 
        errorMessage.includes('has expired')) {
      const errorResponse = ErrorHandlingService.createErrorResponse(
        sanitizedMessage,
        'INVALID_TOKEN'
      );
      return res.status(400).json(errorResponse);
    }

    if (errorMessage.includes('Password validation failed')) {
      const errorResponse = ErrorHandlingService.createErrorResponse(
        sanitizedMessage,
        'PASSWORD_VALIDATION_FAILED'
      );
      return res.status(400).json(errorResponse);
    }

    const errorResponse = ErrorHandlingService.createErrorResponse(
      'An error occurred while resetting your password',
      'RESET_FAILED'
    );
    return res.status(500).json(errorResponse);
  }
});

/**
 * POST /api/auth/password/change
 * Change password for authenticated user
 */
router.post('/change', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user!.id;

    // Validate input
    if (!currentPassword || typeof currentPassword !== 'string') {
      return res.status(400).json({
        error: 'Current password is required'
      });
    }

    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({
        error: 'New password is required'
      });
    }

    // Change password
    await AuthService.changePassword(userId, currentPassword, newPassword, req.ip);

    logger.info('Password changed via authenticated request', { 
      userId,
      email: req.user!.email,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    return res.json({
      message: 'Password changed successfully'
    });

  } catch (error) {
    logger.error('Password change failed:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Password change failed';
    
    // Return specific errors for validation failures
    if (errorMessage.includes('Current password is incorrect')) {
      return res.status(400).json({
        error: 'Current password is incorrect'
      });
    }

    if (errorMessage.includes('Password validation failed') || 
        errorMessage.includes('must be different')) {
      return res.status(400).json({
        error: errorMessage
      });
    }

    if (errorMessage.includes('User not found')) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    return res.status(500).json({
      error: 'An error occurred while changing your password'
    });
  }
});

/**
 * GET /api/auth/password/validate
 * Validate password strength (for frontend feedback)
 */
router.post('/validate', async (req: Request, res: Response) => {
  try {
    const { password } = req.body;

    if (!password || typeof password !== 'string') {
      return res.status(400).json({
        error: 'Password is required'
      });
    }

    const validation = AuthService.validatePassword(password);

    return res.json({
      isValid: validation.isValid,
      strength: validation.strength,
      score: validation.score,
      errors: validation.errors
    });

  } catch (error) {
    logger.error('Password validation failed:', error);
    return res.status(500).json({
      error: 'Password validation failed'
    });
  }
});

/**
 * GET /api/auth/password/reset-token/:token/validate
 * Validate a password reset token (for frontend feedback)
 */
router.get('/reset-token/:token/validate', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({
        error: 'Token is required'
      });
    }

    // Validate the token
    const tokenValidation = await PasswordResetService.validateResetToken(token);

    return res.json({
      valid: true,
      email: tokenValidation.email
    });

  } catch (error) {
    logger.warn('Password reset token validation failed:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Invalid token';
    
    return res.status(400).json({
      valid: false,
      error: errorMessage
    });
  }
});

export default router;