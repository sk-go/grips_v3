import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth';
import { DatabaseService } from '../services/database';
import { ErrorHandlingService } from '../services/errorHandlingService';
import { logger } from '../utils/logger';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
        keycloakId?: string; // Legacy field for backward compatibility
        firstName?: string;
        lastName?: string;
        isActive?: boolean;
        emailVerified?: boolean;
        authMethod?: 'local'; // Only local auth is supported now
      };
    }
  }
}

export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      const errorResponse = ErrorHandlingService.createErrorResponse(
        'Access token required',
        'TOKEN_MISSING'
      );
      res.status(401).json(errorResponse);
      return;
    }

    let user: any = null;
    let authMethod: 'local' | null = null;

    // Try local JWT authentication first (prioritized)
    try {
      const payload = AuthService.verifyAccessToken(token);
      
      // Validate payload structure for local tokens
      if (!payload.userId || !payload.email || !payload.role) {
        throw new Error('Invalid local token payload structure');
      }
      
      // Get user from local database using userId from JWT
      const result = await DatabaseService.query(
        'SELECT id, email, first_name, last_name, role, is_active, keycloak_id, email_verified FROM users WHERE id = $1',
        [payload.userId]
      );

      if (result.rows.length > 0) {
        user = result.rows[0];
        
        // Check if user is active
        if (!user.is_active) {
          ErrorHandlingService.logSecurityEvent('login_failure', {
            userId: user.id,
            email: user.email,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            reason: 'account_inactive'
          });
          
          const errorResponse = ErrorHandlingService.createErrorResponse(
            'Account is not active. Please contact support.',
            'ACCOUNT_INACTIVE'
          );
          res.status(401).json(errorResponse);
          return;
        }

        // Verify token email matches database email for security
        if (payload.email !== user.email) {
          ErrorHandlingService.logSecurityEvent('login_failure', {
            userId: user.id,
            email: user.email,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            reason: 'token_email_mismatch'
          });
          
          const errorResponse = ErrorHandlingService.createErrorResponse(
            'Invalid token',
            'TOKEN_INVALID'
          );
          res.status(401).json(errorResponse);
          return;
        }

        authMethod = 'local';
        req.user = {
          id: user.id,
          email: user.email,
          role: user.role,
          keycloakId: user.keycloak_id,
          firstName: user.first_name,
          lastName: user.last_name,
          isActive: user.is_active,
          emailVerified: user.email_verified,
          authMethod
        };

        logger.debug('Local JWT authentication successful', {
          userId: user.id,
          email: user.email,
          role: user.role,
          path: req.path
        });

        next();
        return;
      } else {
        throw new Error('User not found in database');
      }
    } catch (localAuthError) {
      // Local JWT verification failed
      const errorMessage = localAuthError instanceof Error ? localAuthError.message : 'Unknown error';
      logger.warn('Authentication failed - local JWT verification failed', {
        error: errorMessage,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      res.status(401).json({ 
        error: 'Invalid or expired token',
        code: 'TOKEN_INVALID'
      });
      return;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Authentication middleware error', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      path: req.path,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
};

export const requireRole = (roles: string | string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ 
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
      return;
    }

    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    
    if (!allowedRoles.includes(req.user.role)) {
      logger.warn('Authorization failed - insufficient role', {
        userId: req.user.id,
        userRole: req.user.role,
        requiredRoles: allowedRoles,
        authMethod: req.user.authMethod,
        path: req.path,
        ip: req.ip
      });
      res.status(403).json({ 
        error: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
        required: allowedRoles,
        current: req.user.role
      });
      return;
    }

    logger.debug('Role authorization successful', {
      userId: req.user.id,
      userRole: req.user.role,
      requiredRoles: allowedRoles,
      authMethod: req.user.authMethod,
      path: req.path
    });

    next();
  };
};

// Optional authentication - sets user if token is valid but doesn't require it
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      let authMethod: 'local' | null = null;

      // Try local JWT authentication first (prioritized)
      try {
        const payload = AuthService.verifyAccessToken(token);
        
        // Validate payload structure
        if (payload.userId && payload.email && payload.role) {
          const result = await DatabaseService.query(
            'SELECT id, email, first_name, last_name, role, is_active, keycloak_id, email_verified FROM users WHERE id = $1',
            [payload.userId]
          );

          if (result.rows.length > 0 && result.rows[0].is_active) {
            const user = result.rows[0];
            
            // Verify token email matches database email
            if (payload.email === user.email) {
              authMethod = 'local';
              req.user = {
                id: user.id,
                email: user.email,
                role: user.role,
                keycloakId: user.keycloak_id,
                firstName: user.first_name,
                lastName: user.last_name,
                isActive: user.is_active,
                emailVerified: user.email_verified,
                authMethod
              };

              logger.debug('Optional local JWT authentication successful', {
                userId: user.id,
                email: user.email,
                path: req.path
              });
            }
          }
        }
      } catch (localAuthError) {
        // Silently ignore auth errors for optional auth
        logger.debug('Optional auth failed for local JWT', {
          localError: localAuthError instanceof Error ? localAuthError.message : 'Unknown error',
          path: req.path
        });
      }
    }
  } catch (error) {
    // Silently ignore auth errors for optional auth
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.debug('Optional auth middleware error', { 
      error: errorMessage,
      path: req.path
    });
  }
  
  next();
};

/**
 * Middleware to handle token refresh for expired access tokens
 * This middleware attempts to refresh tokens automatically if a refresh token is provided
 */
export const refreshTokenMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const refreshToken = req.headers['x-refresh-token'] as string;
    
    if (!refreshToken) {
      // No refresh token provided, continue with normal auth flow
      next();
      return;
    }

    try {
      // Attempt to refresh tokens using local auth service
      const tokens = await AuthService.refreshTokens(refreshToken);
      
      // Set new tokens in response headers for client to update
      res.setHeader('X-New-Access-Token', tokens.accessToken);
      res.setHeader('X-New-Refresh-Token', tokens.refreshToken);
      
      // Set user in request for this request
      req.user = {
        id: tokens.user.id,
        email: tokens.user.email,
        role: tokens.user.role,
        keycloakId: tokens.user.keycloakId,
        firstName: tokens.user.firstName,
        lastName: tokens.user.lastName,
        isActive: tokens.user.isActive,
        emailVerified: tokens.user.emailVerified,
        authMethod: 'local'
      };

      logger.info('Token refresh successful', {
        userId: tokens.user.id,
        email: tokens.user.email,
        path: req.path
      });

      next();
    } catch (refreshError) {
      // Token refresh failed, continue with normal auth flow
      const errorMessage = refreshError instanceof Error ? refreshError.message : 'Unknown error';
      logger.debug('Token refresh failed, continuing with normal auth', {
        error: errorMessage,
        path: req.path
      });
      next();
    }
  } catch (error) {
    // Error in refresh middleware, continue with normal auth flow
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.debug('Refresh token middleware error', {
      error: errorMessage,
      path: req.path
    });
    next();
  }
};

/**
 * Middleware to validate JWT token structure and claims
 * This ensures tokens have the expected format and required claims
 */
export const validateTokenStructure = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      next();
      return;
    }

    // Basic JWT structure validation (header.payload.signature)
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      logger.warn('Invalid JWT structure - incorrect number of parts', {
        parts: tokenParts.length,
        path: req.path,
        ip: req.ip
      });
      res.status(401).json({
        error: 'Invalid token format',
        code: 'TOKEN_MALFORMED'
      });
      return;
    }

    // Validate base64 encoding of parts
    try {
      JSON.parse(Buffer.from(tokenParts[0], 'base64').toString());
      JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
    } catch (parseError) {
      logger.warn('Invalid JWT structure - malformed base64 encoding', {
        error: parseError instanceof Error ? parseError.message : 'Unknown error',
        path: req.path,
        ip: req.ip
      });
      res.status(401).json({
        error: 'Invalid token format',
        code: 'TOKEN_MALFORMED'
      });
      return;
    }

    next();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Token structure validation error', {
      error: errorMessage,
      path: req.path,
      ip: req.ip
    });
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
};

/**
 * Middleware to require email verification
 * This middleware checks if the authenticated user has verified their email
 */
export const requireEmailVerification = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({ 
      error: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
    return;
  }

  if (!req.user.emailVerified) {
    logger.warn('Access denied - email not verified', {
      userId: req.user.id,
      email: req.user.email,
      path: req.path,
      ip: req.ip
    });
    
    res.status(403).json({ 
      error: 'Email verification required. Please check your email and verify your account.',
      code: 'EMAIL_VERIFICATION_REQUIRED',
      requiresVerification: true,
      email: req.user.email
    });
    return;
  }

  logger.debug('Email verification check passed', {
    userId: req.user.id,
    email: req.user.email,
    path: req.path
  });

  next();
};

/**
 * Middleware that gracefully handles unverified users
 * This middleware allows access but adds a flag indicating verification status
 */
export const checkEmailVerification = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (req.user && !req.user.emailVerified) {
    logger.debug('User accessing with unverified email', {
      userId: req.user.id,
      email: req.user.email,
      path: req.path
    });
    
    // Add verification status to response headers for client awareness
    res.setHeader('X-Email-Verification-Required', 'true');
  }

  next();
};

/**
 * Combined authentication middleware that includes token structure validation and refresh
 */
export const authenticateWithRefresh = [
  validateTokenStructure,
  refreshTokenMiddleware,
  authenticateToken
];

/**
 * Combined authentication middleware that requires email verification
 */
export const authenticateWithEmailVerification = [
  authenticateToken,
  requireEmailVerification
];

/**
 * Combined authentication middleware with refresh and email verification
 */
export const authenticateWithRefreshAndEmailVerification = [
  validateTokenStructure,
  refreshTokenMiddleware,
  authenticateToken,
  requireEmailVerification
];

// Alias for backward compatibility
export const authMiddleware = authenticateToken;