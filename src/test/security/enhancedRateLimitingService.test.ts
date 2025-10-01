import { Request, Response, NextFunction } from 'express';
import { EnhancedRateLimitingService } from '../../services/security/enhancedRateLimitingService';
import { SecurityMonitoringService } from '../../services/security/securityMonitoringService';
import { RedisService } from '../../services/redis';

// Mock dependencies
jest.mock('../../services/security/securityMonitoringService');
jest.mock('../../services/redis');
jest.mock('../../utils/logger');

describe('EnhancedRateLimitingService', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let mockRedisClient: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockRequest = {
      ip: '192.168.1.100',
      path: '/api/test',
      method: 'GET',
      get: jest.fn().mockReturnValue('Mozilla/5.0'),
      body: {}
    };
    
    mockResponse = {
      set: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    
    mockNext = jest.fn();
    
    mockRedisClient = {
      zAdd: jest.fn(),
      zRemRangeByScore: jest.fn(),
      expire: jest.fn(),
      zCard: jest.fn(),
      del: jest.fn(),
      get: jest.fn()
    };
    
    (RedisService.getClient as jest.Mock).mockReturnValue(mockRedisClient);
  });

  describe('createRateLimit', () => {
    it('should allow requests within rate limit', async () => {
      (SecurityMonitoringService.checkRateLimit as jest.Mock).mockResolvedValue({
        allowed: true,
        remaining: 5,
        resetTime: Date.now() + 60000,
        abusive: false
      });

      const middleware = EnhancedRateLimitingService.createRateLimit({
        max: 10,
        windowMs: 60000
      });

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should block requests exceeding rate limit', async () => {
      (SecurityMonitoringService.checkRateLimit as jest.Mock).mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetTime: Date.now() + 60000,
        abusive: false
      });

      const middleware = EnhancedRateLimitingService.createRateLimit({
        max: 10,
        windowMs: 60000
      });

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(429);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Too Many Requests',
        message: 'Too many requests from this IP, please try again later.',
        retryAfter: expect.any(Number)
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should detect abusive behavior and trigger breach detection', async () => {
      (SecurityMonitoringService.checkRateLimit as jest.Mock).mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetTime: Date.now() + 60000,
        abusive: true
      });
      (SecurityMonitoringService.detectBreach as jest.Mock).mockResolvedValue({
        breachDetected: true,
        lockdownTriggered: false
      });

      const middleware = EnhancedRateLimitingService.createRateLimit({
        max: 10,
        windowMs: 60000
      });

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(SecurityMonitoringService.detectBreach).toHaveBeenCalledWith(
        'suspicious_api_calls',
        expect.objectContaining({
          ipAddress: '192.168.1.100',
          path: '/api/test',
          method: 'GET'
        })
      );
    });

    it('should set rate limit headers when enabled', async () => {
      (SecurityMonitoringService.checkRateLimit as jest.Mock).mockResolvedValue({
        allowed: true,
        remaining: 5,
        resetTime: Date.now() + 60000,
        abusive: false
      });

      const middleware = EnhancedRateLimitingService.createRateLimit({
        max: 10,
        windowMs: 60000,
        standardHeaders: true
      });

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.set).toHaveBeenCalledWith({
        'RateLimit-Limit': '10',
        'RateLimit-Remaining': '5',
        'RateLimit-Reset': expect.any(String)
      });
    });

    it('should use custom key generator when provided', async () => {
      (SecurityMonitoringService.checkRateLimit as jest.Mock).mockResolvedValue({
        allowed: true,
        remaining: 5,
        resetTime: Date.now() + 60000,
        abusive: false
      });

      const customKeyGenerator = jest.fn().mockReturnValue('custom-key');
      const middleware = EnhancedRateLimitingService.createRateLimit({
        keyGenerator: customKeyGenerator
      });

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(customKeyGenerator).toHaveBeenCalledWith(mockRequest);
      expect(SecurityMonitoringService.checkRateLimit).toHaveBeenCalledWith(
        'custom-key',
        expect.any(Number),
        expect.any(Number),
        expect.any(Object)
      );
    });

    it('should skip rate limiting when skip function returns true', async () => {
      const skipFunction = jest.fn().mockReturnValue(true);
      const middleware = EnhancedRateLimitingService.createRateLimit({
        skip: skipFunction
      });

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(skipFunction).toHaveBeenCalledWith(mockRequest);
      expect(SecurityMonitoringService.checkRateLimit).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('createAdaptiveRateLimit', () => {
    it('should adjust rate limits based on trust score', async () => {
      // Mock trust score calculation
      mockRedisClient.get.mockResolvedValue('0'); // No violations
      (SecurityMonitoringService.checkIPReputation as jest.Mock).mockResolvedValue(0);
      (SecurityMonitoringService.checkRateLimit as jest.Mock).mockResolvedValue({
        allowed: true,
        remaining: 10,
        resetTime: Date.now() + 60000,
        abusive: false
      });

      const middleware = EnhancedRateLimitingService.createAdaptiveRateLimit({
        max: 100
      });

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('createAIRateLimit', () => {
    it('should apply AI-specific rate limiting and input sanitization', async () => {
      mockRequest.body = { message: 'Hello AI' };
      (SecurityMonitoringService.checkRateLimit as jest.Mock).mockResolvedValue({
        allowed: true,
        remaining: 25,
        resetTime: Date.now() + 60000,
        abusive: false
      });
      (SecurityMonitoringService.sanitizeAIInput as jest.Mock).mockReturnValue({
        sanitized: 'Hello AI',
        flagged: false,
        reasons: []
      });

      const middleware = EnhancedRateLimitingService.createAIRateLimit();

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(SecurityMonitoringService.sanitizeAIInput).toHaveBeenCalledWith('Hello AI');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should sanitize flagged AI input', async () => {
      mockRequest.body = { message: 'SELECT * FROM users' };
      (SecurityMonitoringService.checkRateLimit as jest.Mock).mockResolvedValue({
        allowed: true,
        remaining: 25,
        resetTime: Date.now() + 60000,
        abusive: false
      });
      (SecurityMonitoringService.sanitizeAIInput as jest.Mock).mockReturnValue({
        sanitized: '[SANITIZED]',
        flagged: true,
        reasons: ['SQL injection attempt']
      });

      const middleware = EnhancedRateLimitingService.createAIRateLimit();

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.body.message).toBe('[SANITIZED]');
      expect((mockRequest as any).sanitizationResult).toBeDefined();
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('getRateLimitStatus', () => {
    it('should return current rate limit status', async () => {
      mockRedisClient.zCard.mockResolvedValue(5);

      const status = await EnhancedRateLimitingService.getRateLimitStatus('test-key', 60000, 10);

      expect(status).toEqual({
        limit: 10,
        current: 5,
        remaining: 5,
        resetTime: expect.any(Date)
      });
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedisClient.zCard.mockRejectedValue(new Error('Redis error'));

      const status = await EnhancedRateLimitingService.getRateLimitStatus('test-key', 60000, 10);

      expect(status).toEqual({
        limit: 10,
        current: 0,
        remaining: 10,
        resetTime: expect.any(Date)
      });
    });
  });

  describe('resetRateLimit', () => {
    it('should reset rate limit for a key', async () => {
      mockRedisClient.del.mockResolvedValue(1);

      const result = await EnhancedRateLimitingService.resetRateLimit('test-key');

      expect(result).toBe(true);
      expect(mockRedisClient.del).toHaveBeenCalledWith('rate_limit:test-key');
    });

    it('should handle Redis errors when resetting', async () => {
      mockRedisClient.del.mockRejectedValue(new Error('Redis error'));

      const result = await EnhancedRateLimitingService.resetRateLimit('test-key');

      expect(result).toBe(false);
    });
  });

  describe('createIPBlockMiddleware', () => {
    it('should block requests from blocked IPs', async () => {
      (SecurityMonitoringService.isIPBlocked as jest.Mock).mockResolvedValue(true);

      const middleware = EnhancedRateLimitingService.createIPBlockMiddleware();

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Access Denied',
        message: 'Your IP address has been temporarily blocked due to security concerns.'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should allow requests from non-blocked IPs', async () => {
      (SecurityMonitoringService.isIPBlocked as jest.Mock).mockResolvedValue(false);

      const middleware = EnhancedRateLimitingService.createIPBlockMiddleware();

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should continue on error to avoid blocking legitimate requests', async () => {
      (SecurityMonitoringService.isIPBlocked as jest.Mock).mockRejectedValue(new Error('Service error'));

      const middleware = EnhancedRateLimitingService.createIPBlockMiddleware();

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should continue processing on rate limiting errors', async () => {
      (SecurityMonitoringService.checkRateLimit as jest.Mock).mockRejectedValue(new Error('Service error'));

      const middleware = EnhancedRateLimitingService.createRateLimit();

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });
});