import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { AuthService } from '../services/auth';
import { authRateLimiter } from '../middleware/rateLimiter';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();

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
    return res.status(400).json({
      error: 'Validation failed',
      details: error.details.map(d => d.message)
    });
  }

  const { email, password, firstName, lastName, role } = value;

  try {
    const user = await AuthService.createUser(email, password, firstName, lastName, role);
    
    logger.info('User registered successfully', {
      userId: user.id,
      email: user.email,
      role: user.role
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
    if (error.code === '23505') { // Unique violation
      return res.status(409).json({
        error: 'User with this email already exists'
      });
    }
    throw error;
  }
}));

// Login user
router.post('/login', authRateLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { error, value } = loginSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      error: 'Validation failed',
      details: error.details.map(d => d.message)
    });
  }

  const { email, password } = value;

  try {
    const authResult = await AuthService.authenticateUser(email, password);
    
    return res.json({
      message: 'Login successful',
      ...authResult
    });
  } catch (error: any) {
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
    const authResult = await AuthService.refreshTokens(refreshToken);
    
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