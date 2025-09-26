import { Request, Response, NextFunction } from 'express';
import { 
  authenticateToken, 
  requireRole, 
  optionalAuth, 
  refreshTokenMiddleware,
  validateTokenStructure,
  authenticateWithRefresh
} from '../../middleware/auth';
import { AuthService } from '../../services/auth';
import { KeycloakAuthService } from '../../services/keycloakAuth';
import { DatabaseService } from '../../services/database';
import { logger } from '../../utils/logger';
import { QueryResult } from '../../types/database';

// Mock dependencies
jest.mock('../../services/auth');
jest.mock('../../services/keycloakAuth');
jest.mock('../../services/database');
jest.mock('../../utils/logger');

const mockAuthService = AuthService as jest.Mocked<typeof AuthService>;
const mockKeycloakAuthService = KeycloakAuthService as jest.Mocked<typeof KeycloakAuthService>;
const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('Enhanced Authentication Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {
      headers: {},
      path: '/test',
      ip: '127.0.0.1',
      get: jest.fn()
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis()
    };
    mockNext = jest.fn();

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('authenticateToken', () => {
    const mockUser = {
      id: 'user-123',
      email: 'test@example.com',
      first_name: 'John',
      last_name: 'Doe',
      role: 'agent',
      is_active: true,
      keycloak_id: null,
      email_verified: true
    };

    it('should authenticate with local JWT token successfully', async () => {
      const token = 'valid-local-token';
      mockRequest.headers = { authorization: `Bearer ${token}` };

      const mockPayload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'agent'
      };

      mockAuthService.verifyAccessToken.mockReturnValue(mockPayload);
      mockDatabaseService.query.mockResolvedValue({ rows: [mockUser], rowCount: 1 } as QueryResult);

      await authenticateToken(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockAuthService.verifyAccessToken).toHaveBeenCalledWith(token);
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        'SELECT id, email, first_name, last_name, role, is_active, keycloak_id, email_verified FROM users WHERE id = $1',
        ['user-123']
      );
      expect(mockRequest.user).toEqual({
        id: 'user-123',
        email: 'test@example.com',
        role: 'agent',
        keycloakId: null,
        firstName: 'John',
        lastName: 'Doe',
        isActive: true,
        authMethod: 'local'
      });
      expect(mockNext).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Local JWT authentication successful',
        expect.objectContaining({
          userId: 'user-123',
          email: 'test@example.com',
          role: 'agent'
        })
      );
    });

    it('should fallback to Keycloak authentication when local JWT fails', async () => {
      const token = 'keycloak-token';
      mockRequest.headers = { authorization: `Bearer ${token}` };

      const keycloakUser = { ...mockUser, keycloak_id: 'keycloak-123' };
      const mockKeycloakPayload = {
        sub: 'keycloak-123',
        email: 'test@example.com'
      };

      mockAuthService.verifyAccessToken.mockImplementation(() => {
        throw new Error('Invalid local token');
      });
      mockKeycloakAuthService.verifyToken.mockResolvedValue(mockKeycloakPayload);
      mockDatabaseService.query.mockResolvedValue({ rows: [keycloakUser], rowCount: 1 } as QueryResult);

      await authenticateToken(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockAuthService.verifyAccessToken).toHaveBeenCalledWith(token);
      expect(mockKeycloakAuthService.verifyToken).toHaveBeenCalledWith(token);
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        'SELECT id, email, first_name, last_name, role, is_active, keycloak_id, email_verified FROM users WHERE keycloak_id = $1',
        ['keycloak-123']
      );
      expect(mockRequest.user).toEqual({
        id: 'user-123',
        email: 'test@example.com',
        role: 'agent',
        keycloakId: 'keycloak-123',
        firstName: 'John',
        lastName: 'Doe',
        isActive: true,
        authMethod: 'keycloak'
      });
      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject request when no token is provided', async () => {
      mockRequest.headers = {};

      await authenticateToken(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Access token required',
        code: 'TOKEN_MISSING'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request when user account is inactive', async () => {
      const token = 'valid-token';
      mockRequest.headers = { authorization: `Bearer ${token}` };

      const inactiveUser = { ...mockUser, is_active: false };
      const mockPayload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'agent'
      };

      mockAuthService.verifyAccessToken.mockReturnValue(mockPayload);
      mockDatabaseService.query.mockResolvedValue({ rows: [inactiveUser], rowCount: 1 } as QueryResult);

      await authenticateToken(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'User account is inactive',
        code: 'ACCOUNT_INACTIVE'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request when token email does not match database email', async () => {
      const token = 'valid-token';
      mockRequest.headers = { authorization: `Bearer ${token}` };

      const mockPayload = {
        userId: 'user-123',
        email: 'different@example.com', // Different email
        role: 'agent'
      };

      mockAuthService.verifyAccessToken.mockReturnValue(mockPayload);
      mockDatabaseService.query.mockResolvedValue({ rows: [mockUser], rowCount: 1 } as QueryResult);

      await authenticateToken(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid token',
        code: 'TOKEN_INVALID'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request when both local and Keycloak authentication fail', async () => {
      const token = 'invalid-token';
      mockRequest.headers = { authorization: `Bearer ${token}` };

      mockAuthService.verifyAccessToken.mockImplementation(() => {
        throw new Error('Invalid local token');
      });
      mockKeycloakAuthService.verifyToken.mockRejectedValue(new Error('Invalid Keycloak token'));

      await authenticateToken(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid or expired token',
        code: 'TOKEN_INVALID'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('requireRole', () => {
    beforeEach(() => {
      mockRequest.user = {
        id: 'user-123',
        email: 'test@example.com',
        role: 'agent',
        authMethod: 'local'
      };
    });

    it('should allow access when user has required role', () => {
      const middleware = requireRole('agent');
      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should allow access when user has one of multiple required roles', () => {
      const middleware = requireRole(['admin', 'agent']);
      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should deny access when user does not have required role', () => {
      const middleware = requireRole('admin');
      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
        required: ['admin'],
        current: 'agent'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should deny access when user is not authenticated', () => {
      mockRequest.user = undefined;
      const middleware = requireRole('agent');
      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('optionalAuth', () => {
    const mockUser = {
      id: 'user-123',
      email: 'test@example.com',
      first_name: 'John',
      last_name: 'Doe',
      role: 'agent',
      is_active: true,
      keycloak_id: null,
      email_verified: true
    };

    it('should set user when valid local token is provided', async () => {
      const token = 'valid-local-token';
      mockRequest.headers = { authorization: `Bearer ${token}` };

      const mockPayload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'agent'
      };

      mockAuthService.verifyAccessToken.mockReturnValue(mockPayload);
      mockDatabaseService.query.mockResolvedValue({ rows: [mockUser], rowCount: 1 } as QueryResult);

      await optionalAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.user).toEqual({
        id: 'user-123',
        email: 'test@example.com',
        role: 'agent',
        keycloakId: null,
        firstName: 'John',
        lastName: 'Doe',
        isActive: true,
        authMethod: 'local'
      });
      expect(mockNext).toHaveBeenCalled();
    });

    it('should continue without setting user when no token is provided', async () => {
      mockRequest.headers = {};

      await optionalAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.user).toBeUndefined();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should continue without setting user when token is invalid', async () => {
      const token = 'invalid-token';
      mockRequest.headers = { authorization: `Bearer ${token}` };

      mockAuthService.verifyAccessToken.mockImplementation(() => {
        throw new Error('Invalid token');
      });
      mockKeycloakAuthService.verifyToken.mockRejectedValue(new Error('Invalid Keycloak token'));

      await optionalAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.user).toBeUndefined();
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('refreshTokenMiddleware', () => {
    it('should refresh tokens and set user when valid refresh token is provided', async () => {
      const refreshToken = 'valid-refresh-token';
      mockRequest.headers = { 'x-refresh-token': refreshToken };

      const mockTokens = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        user: {
          id: 'user-123',
          email: 'test@example.com',
          firstName: 'John',
          lastName: 'Doe',
          role: 'agent',
          isActive: true,
          keycloakId: undefined
        }
      };

      mockAuthService.refreshTokens.mockResolvedValue(mockTokens);

      await refreshTokenMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockAuthService.refreshTokens).toHaveBeenCalledWith(refreshToken);
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-New-Access-Token', 'new-access-token');
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-New-Refresh-Token', 'new-refresh-token');
      expect(mockRequest.user).toEqual({
        id: 'user-123',
        email: 'test@example.com',
        role: 'agent',
        keycloakId: undefined,
        firstName: 'John',
        lastName: 'Doe',
        isActive: true,
        authMethod: 'local'
      });
      expect(mockNext).toHaveBeenCalled();
    });

    it('should continue without refresh when no refresh token is provided', async () => {
      mockRequest.headers = {};

      await refreshTokenMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockAuthService.refreshTokens).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should continue when refresh token is invalid', async () => {
      const refreshToken = 'invalid-refresh-token';
      mockRequest.headers = { 'x-refresh-token': refreshToken };

      mockAuthService.refreshTokens.mockRejectedValue(new Error('Invalid refresh token'));

      await refreshTokenMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockAuthService.refreshTokens).toHaveBeenCalledWith(refreshToken);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('validateTokenStructure', () => {
    it('should continue when no token is provided', () => {
      mockRequest.headers = {};

      validateTokenStructure(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should continue when token has valid JWT structure', () => {
      // Valid JWT structure: header.payload.signature
      const validToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      mockRequest.headers = { authorization: `Bearer ${validToken}` };

      validateTokenStructure(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject token with invalid structure', () => {
      const invalidToken = 'invalid.token'; // Only 2 parts instead of 3
      mockRequest.headers = { authorization: `Bearer ${invalidToken}` };

      validateTokenStructure(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid token format',
        code: 'TOKEN_MALFORMED'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject token with malformed base64 encoding', () => {
      const malformedToken = 'invalid-base64.invalid-base64.signature';
      mockRequest.headers = { authorization: `Bearer ${malformedToken}` };

      validateTokenStructure(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid token format',
        code: 'TOKEN_MALFORMED'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('authenticateWithRefresh', () => {
    it('should be an array of middleware functions', () => {
      expect(Array.isArray(authenticateWithRefresh)).toBe(true);
      expect(authenticateWithRefresh).toHaveLength(3);
      expect(authenticateWithRefresh[0]).toBe(validateTokenStructure);
      expect(authenticateWithRefresh[1]).toBe(refreshTokenMiddleware);
      expect(authenticateWithRefresh[2]).toBe(authenticateToken);
    });
  });
});