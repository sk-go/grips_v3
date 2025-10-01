import { Request, Response, NextFunction } from 'express';

// Extend Express Request interface
declare module 'express-serve-static-core' {
  interface Request {
    sessionID?: string;
    session?: {
      mfaVerified?: boolean;
      [key: string]: any;
    };
  }
}
import { RBACService, MFAService, AuditLoggingService, SensitiveDataService } from '../services/compliance';
import { logger } from '../utils/logger';

// Extend Request interface to include compliance context
declare global {
  namespace Express {
    interface Request {
      compliance?: {
        userId?: string;
        sessionId?: string;
        chainId?: string;
        requiresMFA?: boolean;
        permissions?: string[];
      };
    }
  }
}

/**
 * Middleware to check RBAC permissions
 */
export function requirePermission(resource: string, action: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      const sessionId = req.sessionID;

      if (!userId) {
        res.status(401).json({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
        return;
      }

      // Check permission
      const hasPermission = await RBACService.hasPermission(
        userId,
        resource,
        action,
        sessionId
      );

      if (!hasPermission) {
        await AuditLoggingService.logAction({
          userId,
          sessionId,
          actionType: 'access_denied',
          resourceType: 'rbac',
          details: {
            resource,
            action,
            endpoint: req.path,
            method: req.method
          },
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          riskLevel: 'medium'
        });

        res.status(403).json({
          error: 'Insufficient permissions',
          code: 'PERMISSION_DENIED',
          required: { resource, action }
        });
        return;
      }

      // Add compliance context to request
      req.compliance = {
        userId,
        sessionId,
        permissions: [`${resource}:${action}`]
      };

      next();
    } catch (error) {
      logger.error('RBAC middleware error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        resource,
        action,
        userId: req.user?.id
      });

      res.status(500).json({
        error: 'Permission check failed',
        code: 'RBAC_ERROR'
      });
    }
  };
}

/**
 * Middleware to enforce MFA requirement
 */
export function requireMFA() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      const sessionId = req.sessionID;

      if (!userId) {
        res.status(401).json({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
        return;
      }

      // Check if MFA is required for this user
      const mfaRequired = await MFAService.isMFARequired(userId);
      
      if (!mfaRequired) {
        // MFA not enabled, proceed
        next();
        return;
      }

      // Check if MFA has been verified in this session
      const mfaVerified = req.session?.mfaVerified;
      
      if (!mfaVerified) {
        await AuditLoggingService.logAction({
          userId,
          sessionId,
          actionType: 'mfa_required',
          resourceType: 'authentication',
          details: {
            endpoint: req.path,
            method: req.method
          },
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          riskLevel: 'medium'
        });

        res.status(403).json({
          error: 'MFA verification required',
          code: 'MFA_REQUIRED'
        });
        return;
      }

      // Add MFA context to request
      if (req.compliance) {
        req.compliance.requiresMFA = true;
      } else {
        req.compliance = {
          userId,
          sessionId,
          requiresMFA: true
        };
      }

      next();
    } catch (error) {
      logger.error('MFA middleware error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.user?.id
      });

      res.status(500).json({
        error: 'MFA check failed',
        code: 'MFA_ERROR'
      });
    }
  };
}

/**
 * Middleware to scan request/response for sensitive data
 */
export function scanSensitiveData() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      const sessionId = req.sessionID;
      const chainId = req.headers['x-chain-id'] as string;

      // Scan request body for sensitive data
      if (req.body && typeof req.body === 'object') {
        const requestContent = JSON.stringify(req.body);
        const scanResult = await SensitiveDataService.shouldHaltChain(
          requestContent,
          userId,
          sessionId,
          chainId
        );

        if (scanResult.shouldHalt) {
          await AuditLoggingService.logAction({
            userId,
            sessionId,
            actionType: 'request_blocked_sensitive_data',
            resourceType: 'compliance',
            details: {
              endpoint: req.path,
              method: req.method,
              reason: scanResult.reason,
              chainId
            },
            chainId,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            riskLevel: 'high'
          });

          res.status(400).json({
            error: 'Request contains sensitive data',
            code: 'SENSITIVE_DATA_DETECTED',
            reason: scanResult.reason
          });
          return;
        }

        // Add scan results to compliance context
        if (req.compliance) {
          req.compliance.chainId = chainId;
        } else {
          req.compliance = {
            userId,
            sessionId,
            chainId
          };
        }
      }

      // Intercept response to scan outgoing data
      const originalSend = res.send;
      res.send = function(data: any) {
        // Scan response data asynchronously (don't block response)
        if (data && typeof data === 'string') {
          SensitiveDataService.scanContent(data, userId, sessionId, chainId)
            .catch(error => {
              logger.error('Failed to scan response data', {
                error: error instanceof Error ? error.message : 'Unknown error',
                userId,
                sessionId,
                chainId
              });
            });
        }

        return originalSend.call(this, data);
      };

      next();
    } catch (error) {
      logger.error('Sensitive data scanning middleware error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.user?.id
      });

      // Don't block request on scanning error, just log it
      next();
    }
  };
}

/**
 * Middleware to log all API actions for audit trail
 */
export function auditLogger() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const userId = req.user?.id;
    const sessionId = req.sessionID;
    const chainId = req.headers['x-chain-id'] as string;

    // Log request start
    const requestId = await AuditLoggingService.logAction({
      userId,
      sessionId,
      actionType: 'api_request',
      resourceType: 'api',
      resourceId: req.path,
      details: {
        method: req.method,
        endpoint: req.path,
        query: req.query,
        hasBody: !!req.body,
        chainId
      },
      chainId,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      riskLevel: 'low'
    });

    // Intercept response to log completion
    const originalSend = res.send;
    res.send = function(data: any) {
      const duration = Date.now() - startTime;
      
      // Log response asynchronously
      AuditLoggingService.logAction({
        userId,
        sessionId,
        actionType: 'api_response',
        resourceType: 'api',
        resourceId: req.path,
        details: {
          method: req.method,
          endpoint: req.path,
          statusCode: res.statusCode,
          duration,
          requestId,
          chainId
        },
        chainId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        riskLevel: res.statusCode >= 400 ? 'medium' : 'low'
      }).catch(error => {
        logger.error('Failed to log API response', {
          error: error instanceof Error ? error.message : 'Unknown error',
          requestId,
          userId,
          sessionId
        });
      });

      return originalSend.call(this, data);
    };

    next();
  };
}

/**
 * Middleware to validate compliance for agentic workflows
 */
export function validateAgenticCompliance() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      const sessionId = req.sessionID;
      const chainId = req.headers['x-chain-id'] as string;

      if (!chainId) {
        // Not an agentic workflow, proceed normally
        next();
        return;
      }

      // Enhanced logging for agentic workflows
      await AuditLoggingService.logAction({
        userId,
        sessionId,
        actionType: 'agentic_workflow_start',
        resourceType: 'agentic',
        details: {
          endpoint: req.path,
          method: req.method,
          chainId
        },
        chainId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        riskLevel: 'medium'
      });

      // Add agentic context
      if (req.compliance) {
        req.compliance.chainId = chainId;
      } else {
        req.compliance = {
          userId,
          sessionId,
          chainId
        };
      }

      next();
    } catch (error) {
      logger.error('Agentic compliance middleware error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.user?.id,
        chainId: req.headers['x-chain-id']
      });

      res.status(500).json({
        error: 'Agentic compliance validation failed',
        code: 'AGENTIC_COMPLIANCE_ERROR'
      });
    }
  };
}