import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { TLSSocket } from 'tls';
import { sensitiveDataService } from '../services/security/sensitiveDataService';
import { logger } from '../utils/logger';

/**
 * Security middleware for HTTPS enforcement and secure headers
 */
export const securityHeaders = helmet({
  // Force HTTPS
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "ws:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  
  // Other security headers
  crossOriginEmbedderPolicy: false, // Allow WebSocket connections
  crossOriginResourcePolicy: { policy: "cross-origin" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
});

/**
 * Middleware to enforce HTTPS in production
 */
export const enforceHTTPS = (req: Request, res: Response, next: NextFunction): void => {
  if (process.env.NODE_ENV === 'production') {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
      return;
    }
  }
  next();
};

/**
 * Middleware to scan request data for sensitive information
 */
export const sensitiveDataScanner = (req: Request, res: Response, next: NextFunction): void => {
  try {
    // Skip scanning for certain routes (like file uploads)
    const skipRoutes = ['/api/health', '/api/auth/login', '/api/documents/upload'];
    if (skipRoutes.some(route => req.path.startsWith(route))) {
      return next();
    }

    // Scan request body for sensitive data
    if (req.body && typeof req.body === 'object') {
      const bodyText = JSON.stringify(req.body);
      const classification = sensitiveDataService.classifyText(bodyText);
      
      if (classification.hasSensitiveData) {
        // Log sensitive data detection (with redacted content)
        logger.warn('Sensitive data detected in request', {
          path: req.path,
          method: req.method,
          riskLevel: classification.riskLevel,
          patterns: classification.matches.map(m => m.pattern),
          userId: (req as any).user?.id,
          redactedBody: classification.redactedText
        });

        // Add warning header for high-risk data
        if (classification.riskLevel === 'high') {
          res.setHeader('X-Sensitive-Data-Warning', 'High-risk sensitive data detected');
        }

        // Store classification for downstream use
        (req as any).sensitiveDataClassification = classification;
      }
    }

    next();
  } catch (error) {
    logger.error('Error in sensitive data scanner:', error);
    next(); // Continue processing even if scanner fails
  }
};

/**
 * Middleware to validate TLS version and cipher suites
 */
export const validateTLS = (req: Request, res: Response, next: NextFunction): void => {
  if (process.env.NODE_ENV === 'production') {
    const tlsSocket = req.socket as TLSSocket;
    const tlsVersion = tlsSocket.encrypted ? tlsSocket.getProtocol() : null;
    
    if (!tlsVersion || !tlsVersion.startsWith('TLSv1.3')) {
      logger.warn('Non-TLS 1.3 connection detected', {
        tlsVersion,
        remoteAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      // In strict mode, reject non-TLS 1.3 connections
      if (process.env.STRICT_TLS === 'true') {
        res.status(426).json({ 
          error: 'TLS 1.3 required',
          message: 'This service requires TLS 1.3 or higher'
        });
        return;
      }
    }
  }
  
  next();
};

/**
 * Middleware to add security audit logging
 */
export const securityAuditLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();
  
  // Log security-relevant requests
  const securityPaths = ['/api/auth', '/api/admin', '/api/documents', '/api/crm'];
  const isSecurityRelevant = securityPaths.some(path => req.path.startsWith(path));
  
  if (isSecurityRelevant) {
    logger.info('Security audit log', {
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: (req as any).user?.id,
      timestamp: new Date().toISOString(),
      sessionId: (req as any).sessionID || 'no-session'
    });
  }

  // Override res.json to log response data
  const originalJson = res.json;
  res.json = function(body: any) {
    const responseTime = Date.now() - startTime;
    
    if (isSecurityRelevant) {
      logger.info('Security audit response', {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        responseTime,
        userId: (req as any).user?.id,
        hasError: res.statusCode >= 400
      });
    }
    
    return originalJson.call(this, body);
  };

  next();
};

/**
 * Rate limiting for sensitive endpoints
 */
export const sensitiveEndpointRateLimit = (maxRequests: number = 10, windowMs: number = 60000) => {
  const requests = new Map<string, { count: number; resetTime: number }>();
  
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.ip}:${(req as any).user?.id || 'anonymous'}`;
    const now = Date.now();
    
    // Clean up expired entries
    for (const [k, v] of requests.entries()) {
      if (now > v.resetTime) {
        requests.delete(k);
      }
    }
    
    const userRequests = requests.get(key);
    
    if (!userRequests) {
      requests.set(key, { count: 1, resetTime: now + windowMs });
      next();
      return;
    }
    
    if (userRequests.count >= maxRequests) {
      logger.warn('Rate limit exceeded for sensitive endpoint', {
        ip: req.ip,
        userId: (req as any).user?.id,
        path: req.path,
        count: userRequests.count
      });
      
      res.status(429).json({
        error: 'Rate limit exceeded',
        message: 'Too many requests to sensitive endpoint',
        retryAfter: Math.ceil((userRequests.resetTime - now) / 1000)
      });
      return;
    }
    
    userRequests.count++;
    next();
  };
};

/**
 * Middleware to detect and prevent potential security breaches
 */
export const breachDetection = (req: Request, res: Response, next: NextFunction): void => {
  const suspiciousPatterns = [
    /(?:union|select|insert|delete|drop|create|alter)\s+/gi, // SQL injection
    /<script[^>]*>.*?<\/script>/gi, // XSS
    /javascript:/gi, // JavaScript protocol
    /data:text\/html/gi, // Data URI XSS
    /\.\.\//g, // Path traversal
    /__proto__|constructor|prototype/gi // Prototype pollution
  ];

  const requestData = JSON.stringify({
    body: req.body,
    query: req.query,
    params: req.params
  });

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(requestData)) {
      logger.error('Potential security breach detected', {
        pattern: pattern.source,
        path: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        userId: (req as any).user?.id,
        suspiciousData: sensitiveDataService.sanitizeForLogging(requestData)
      });

      // In production, block suspicious requests
      if (process.env.NODE_ENV === 'production') {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Suspicious activity detected'
        });
        return;
      }
    }
  }

  next();
};