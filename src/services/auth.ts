import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { DatabaseService } from './database';
import { RedisService } from './redis';
import { logger } from '../utils/logger';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
}

interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  id?: string; // For compatibility with middleware
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: User;
}

class AuthService {
  private static readonly JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-in-production';
  private static readonly JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'fallback-refresh-secret';
  private static readonly JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
  private static readonly JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

  static async hashPassword(password: string): Promise<string> {
    const saltRounds = 12;
    return bcrypt.hash(password, saltRounds);
  }

  static async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  static generateAccessToken(payload: TokenPayload): string {
    return jwt.sign(payload, this.JWT_SECRET, {
      expiresIn: this.JWT_EXPIRES_IN,
      issuer: 'relationship-care-platform',
      audience: 'rcp-users'
    });
  }

  static generateRefreshToken(payload: TokenPayload): string {
    return jwt.sign(payload, this.JWT_REFRESH_SECRET, {
      expiresIn: this.JWT_REFRESH_EXPIRES_IN,
      issuer: 'relationship-care-platform',
      audience: 'rcp-users'
    });
  }

  static verifyAccessToken(token: string): TokenPayload {
    try {
      return jwt.verify(token, this.JWT_SECRET, {
        issuer: 'relationship-care-platform',
        audience: 'rcp-users'
      }) as TokenPayload;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.warn('Invalid access token', { error: errorMessage });
      throw new Error('Invalid or expired token');
    }
  }

  static verifyRefreshToken(token: string): TokenPayload {
    try {
      return jwt.verify(token, this.JWT_REFRESH_SECRET, {
        issuer: 'relationship-care-platform',
        audience: 'rcp-users'
      }) as TokenPayload;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.warn('Invalid refresh token', { error: errorMessage });
      throw new Error('Invalid or expired refresh token');
    }
  }

  static async createUser(email: string, password: string, firstName: string, lastName: string, role: string = 'agent'): Promise<User> {
    const passwordHash = await this.hashPassword(password);
    
    const result = await DatabaseService.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, first_name, last_name, role, is_active, created_at`,
      [email, passwordHash, firstName, lastName, role]
    );

    const user = result.rows[0];
    logger.info('User created', { userId: user.id, email: user.email });

    return {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      isActive: user.is_active
    };
  }

  static async authenticateUser(email: string, password: string): Promise<AuthTokens> {
    const result = await DatabaseService.query(
      'SELECT id, email, password_hash, first_name, last_name, role, is_active FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      logger.warn('Authentication failed - user not found', { email });
      throw new Error('Invalid credentials');
    }

    const user = result.rows[0];

    if (!user.is_active) {
      logger.warn('Authentication failed - user inactive', { email });
      throw new Error('Account is inactive');
    }

    const isValidPassword = await this.comparePassword(password, user.password_hash);
    if (!isValidPassword) {
      logger.warn('Authentication failed - invalid password', { email });
      throw new Error('Invalid credentials');
    }

    const tokenPayload: TokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role
    };

    const accessToken = this.generateAccessToken(tokenPayload);
    const refreshToken = this.generateRefreshToken(tokenPayload);

    // Store refresh token in Redis with expiration
    const refreshTokenKey = `refresh_token:${user.id}`;
    await RedisService.set(refreshTokenKey, refreshToken, 7 * 24 * 60 * 60); // 7 days

    logger.info('User authenticated successfully', { userId: user.id, email: user.email });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        isActive: user.is_active
      }
    };
  }

  static async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    const payload = this.verifyRefreshToken(refreshToken);
    
    // Check if refresh token exists in Redis
    const refreshTokenKey = `refresh_token:${payload.userId}`;
    const storedToken = await RedisService.get(refreshTokenKey);
    
    if (!storedToken || storedToken !== refreshToken) {
      logger.warn('Invalid refresh token - not found in store', { userId: payload.userId });
      throw new Error('Invalid refresh token');
    }

    // Get current user data
    const result = await DatabaseService.query(
      'SELECT id, email, first_name, last_name, role, is_active FROM users WHERE id = $1',
      [payload.userId]
    );

    if (result.rows.length === 0 || !result.rows[0].is_active) {
      logger.warn('Refresh failed - user not found or inactive', { userId: payload.userId });
      throw new Error('User not found or inactive');
    }

    const user = result.rows[0];
    const newTokenPayload: TokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role
    };

    const newAccessToken = this.generateAccessToken(newTokenPayload);
    const newRefreshToken = this.generateRefreshToken(newTokenPayload);

    // Update refresh token in Redis
    await RedisService.set(refreshTokenKey, newRefreshToken, 7 * 24 * 60 * 60);

    logger.info('Tokens refreshed successfully', { userId: user.id });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        isActive: user.is_active
      }
    };
  }

  static async logout(userId: string): Promise<void> {
    const refreshTokenKey = `refresh_token:${userId}`;
    await RedisService.del(refreshTokenKey);
    logger.info('User logged out', { userId });
  }

  static async getUserById(userId: string): Promise<User | null> {
    const result = await DatabaseService.query(
      'SELECT id, email, first_name, last_name, role, is_active FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const user = result.rows[0];
    return {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      isActive: user.is_active
    };
  }
}

export { AuthService, User, TokenPayload, AuthTokens };