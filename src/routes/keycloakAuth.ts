import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { KeycloakAuthService } from '../services/keycloakAuth';
import { authRateLimiter } from '../middleware/rateLimiter';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();

// Validation schemas
const callbackSchema = Joi.object({
  code: Joi.string().required(),
  state: Joi.string().optional()
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().required()
});

// Get Keycloak login URL
router.get('/login-url', asyncHandler(async (req: Request, res: Response) => {
  const redirectUri = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/auth/callback`;
  const state = Math.random().toString(36).substring(2, 15);
  
  const authUrl = KeycloakAuthService.getAuthUrl(redirectUri, state);
  
  return res.json({
    authUrl,
    state
  });
}));

// Handle OAuth callback
router.post('/callback', authRateLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { error, value } = callbackSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      error: 'Validation failed',
      details: error.details.map(d => d.message)
    });
  }

  const { code } = value;
  const redirectUri = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/auth/callback`;

  try {
    const authResult = await KeycloakAuthService.exchangeCodeForTokens(code, redirectUri);
    
    logger.info('User authenticated via Keycloak callback', {
      userId: authResult.user.id,
      email: authResult.user.email
    });

    return res.json({
      message: 'Authentication successful',
      ...authResult
    });
  } catch (error: any) {
    logger.error('Keycloak callback failed', { error: error.message });
    return res.status(401).json({
      error: error.message
    });
  }
}));

// Refresh access token
router.post('/refresh', authRateLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { error, value } = refreshSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      error: 'Validation failed',
      details: error.details.map(d => d.message)
    });
  }

  const { refreshToken } = value;

  try {
    const authResult = await KeycloakAuthService.refreshTokens(refreshToken);
    
    return res.json({
      message: 'Tokens refreshed successfully',
      ...authResult
    });
  } catch (error: any) {
    return res.status(401).json({
      error: error.message
    });
  }
}));

// Logout user
router.post('/logout', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = req.body.refreshToken;
  
  if (refreshToken) {
    await KeycloakAuthService.logout(refreshToken);
  }
  
  logger.info('User logged out', { userId: req.user!.id });
  
  return res.json({
    message: 'Logout successful'
  });
}));

// Get current user profile
router.get('/me', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  return res.json({
    user: {
      id: req.user!.id,
      email: req.user!.email,
      role: req.user!.role,
      keycloakId: req.user!.keycloakId
    }
  });
}));

// Verify token endpoint
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

export { router as keycloakAuthRoutes };