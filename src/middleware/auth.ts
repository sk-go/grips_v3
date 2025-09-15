import { Request, Response, NextFunction } from 'express';
import { KeycloakAuthService } from '../services/keycloakAuth';
import { DatabaseService } from '../services/database';
import { logger } from '../utils/logger';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
        keycloakId: string;
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
      res.status(401).json({ error: 'Access token required' });
      return;
    }

    // Verify Keycloak token
    const payload = await KeycloakAuthService.verifyToken(token);
    
    // Get user from local database
    const result = await DatabaseService.query(
      'SELECT id, email, first_name, last_name, role, is_active, keycloak_id FROM users WHERE keycloak_id = $1',
      [payload.sub]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    const user = result.rows[0];
    if (!user.is_active) {
      res.status(401).json({ error: 'User account is inactive' });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      keycloakId: user.keycloak_id
    };
    
    next();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.warn('Authentication failed', {
      error: errorMessage,
      path: req.path,
      ip: req.ip
    });
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const requireRole = (roles: string | string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    
    if (!allowedRoles.includes(req.user.role)) {
      logger.warn('Authorization failed - insufficient role', {
        userId: req.user.id,
        userRole: req.user.role,
        requiredRoles: allowedRoles,
        path: req.path
      });
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

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
      const payload = await KeycloakAuthService.verifyToken(token);
      
      const result = await DatabaseService.query(
        'SELECT id, email, first_name, last_name, role, is_active, keycloak_id FROM users WHERE keycloak_id = $1',
        [payload.sub]
      );

      if (result.rows.length > 0 && result.rows[0].is_active) {
        const user = result.rows[0];
        req.user = {
          id: user.id,
          email: user.email,
          role: user.role,
          keycloakId: user.keycloak_id
        };
      }
    }
  } catch (error) {
    // Silently ignore auth errors for optional auth
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.debug('Optional auth failed', { error: errorMessage });
  }
  
  next();
};

// Alias for backward compatibility
export const authMiddleware = authenticateToken;