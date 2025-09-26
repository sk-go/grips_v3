import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { DatabaseService } from './database';
import { RedisService } from './redis';
import { logger } from '../utils/logger';
import { EmailNotificationService } from './email/emailNotificationService';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  emailVerified?: boolean;
  keycloakId?: string;
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

interface CreateUserRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: 'agent' | 'admin';
}

interface UserProfileUpdate {
  firstName?: string;
  lastName?: string;
  email?: string;
}

interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
  strength: 'weak' | 'fair' | 'good' | 'strong';
  score: number; // 0-100
}

interface LoginAttempt {
  email: string;
  timestamp: Date;
  success: boolean;
  ipAddress?: string;
}

class AuthService {
  private static readonly JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-in-production';
  private static readonly JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'fallback-refresh-secret';
  private static readonly JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
  private static readonly JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
  
  // Rate limiting constants
  private static readonly MAX_LOGIN_ATTEMPTS = 5;
  private static readonly LOGIN_ATTEMPT_WINDOW = 15 * 60; // 15 minutes in seconds
  private static readonly LOCKOUT_DURATION = 30 * 60; // 30 minutes in seconds
  
  // Password validation constants
  private static readonly MIN_PASSWORD_LENGTH = 8;
  private static readonly MAX_PASSWORD_LENGTH = 128;

  private static emailService = new EmailNotificationService();

  static async hashPassword(password: string): Promise<string> {
    const saltRounds = 12;
    return bcrypt.hash(password, saltRounds);
  }

  static async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Validates password strength and format
   */
  static validatePassword(password: string): PasswordValidationResult {
    const errors: string[] = [];
    let score = 0;

    // Length validation
    if (password.length < this.MIN_PASSWORD_LENGTH) {
      errors.push(`Password must be at least ${this.MIN_PASSWORD_LENGTH} characters long`);
    } else if (password.length >= this.MIN_PASSWORD_LENGTH) {
      score += 20;
    }

    if (password.length > this.MAX_PASSWORD_LENGTH) {
      errors.push(`Password must not exceed ${this.MAX_PASSWORD_LENGTH} characters`);
    }

    // Character type requirements
    const hasLowercase = /[a-z]/.test(password);
    const hasUppercase = /[A-Z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChars = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

    if (!hasLowercase) {
      errors.push('Password must contain at least one lowercase letter');
    } else {
      score += 15;
    }

    if (!hasUppercase) {
      errors.push('Password must contain at least one uppercase letter');
    } else {
      score += 15;
    }

    if (!hasNumbers) {
      errors.push('Password must contain at least one number');
    } else {
      score += 15;
    }

    if (!hasSpecialChars) {
      errors.push('Password must contain at least one special character');
    } else {
      score += 15;
    }

    // Additional strength checks
    if (password.length >= 12) {
      score += 10;
    }

    // Check for common patterns (reduce score)
    const commonPatterns = [
      /(.)\1{2,}/, // Repeated characters
      /123456|654321|abcdef|qwerty/i, // Sequential patterns
      /password|admin|user|login/i // Common words
    ];

    for (const pattern of commonPatterns) {
      if (pattern.test(password)) {
        score -= 20;
        break;
      }
    }

    // Ensure score is within bounds
    score = Math.max(0, Math.min(100, score));

    // Determine strength level
    let strength: 'weak' | 'fair' | 'good' | 'strong';
    if (score < 40) {
      strength = 'weak';
    } else if (score < 60) {
      strength = 'fair';
    } else if (score < 80) {
      strength = 'good';
    } else {
      strength = 'strong';
    }

    return {
      isValid: errors.length === 0,
      errors,
      strength,
      score
    };
  }

  /**
   * Validates email format
   */
  static validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 254;
  }

  /**
   * Checks if user is rate limited for login attempts
   */
  static async checkRateLimit(email: string, ipAddress?: string): Promise<{ isLimited: boolean; remainingAttempts?: number; lockoutTime?: number }> {
    const identifier = ipAddress ? `${email}:${ipAddress}` : email;
    const attemptKey = `login_attempts:${identifier}`;
    const lockoutKey = `login_lockout:${identifier}`;

    // Check if currently locked out
    const lockoutTime = await RedisService.get(lockoutKey);
    if (lockoutTime) {
      return {
        isLimited: true,
        lockoutTime: parseInt(lockoutTime)
      };
    }

    // Get current attempt count
    const attempts = await RedisService.get(attemptKey);
    const attemptCount = attempts ? parseInt(attempts) : 0;

    if (attemptCount >= this.MAX_LOGIN_ATTEMPTS) {
      // Set lockout
      await RedisService.set(lockoutKey, Date.now().toString(), this.LOCKOUT_DURATION);
      await RedisService.del(attemptKey);
      
      logger.warn('User locked out due to too many failed attempts', { 
        email, 
        ipAddress, 
        attemptCount 
      });

      return {
        isLimited: true,
        lockoutTime: Date.now() + (this.LOCKOUT_DURATION * 1000)
      };
    }

    return {
      isLimited: false,
      remainingAttempts: this.MAX_LOGIN_ATTEMPTS - attemptCount
    };
  }

  /**
   * Records a login attempt
   */
  static async recordLoginAttempt(email: string, success: boolean, ipAddress?: string): Promise<void> {
    const identifier = ipAddress ? `${email}:${ipAddress}` : email;
    const attemptKey = `login_attempts:${identifier}`;

    if (success) {
      // Clear attempts on successful login
      await RedisService.del(attemptKey);
      await RedisService.del(`login_lockout:${identifier}`);
    } else {
      // Increment failed attempts
      const attempts = await RedisService.get(attemptKey);
      const attemptCount = attempts ? parseInt(attempts) + 1 : 1;
      
      await RedisService.set(attemptKey, attemptCount.toString(), this.LOGIN_ATTEMPT_WINDOW);
      
      logger.warn('Failed login attempt recorded', { 
        email, 
        ipAddress, 
        attemptCount 
      });
    }
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

  static async createUser(userData: CreateUserRequest): Promise<User> {
    const { email, password, firstName, lastName, role = 'agent' } = userData;

    // Validate email format
    if (!this.validateEmail(email)) {
      throw new Error('Invalid email format');
    }

    // Validate password strength
    const passwordValidation = this.validatePassword(password);
    if (!passwordValidation.isValid) {
      throw new Error(`Password validation failed: ${passwordValidation.errors.join(', ')}`);
    }

    // Check if user already exists
    const existingUser = await DatabaseService.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      throw new Error('User with this email already exists');
    }

    const passwordHash = await this.hashPassword(password);
    
    const result = await DatabaseService.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, email_verified)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, first_name, last_name, role, is_active, email_verified, created_at`,
      [email, passwordHash, firstName, lastName, role, false]
    );

    const user = result.rows[0];
    logger.info('User created', { 
      userId: user.id, 
      email: user.email, 
      passwordStrength: passwordValidation.strength 
    });

    return {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      isActive: user.is_active,
      emailVerified: user.email_verified
    };
  }

  static async authenticateUser(email: string, password: string, ipAddress?: string): Promise<AuthTokens> {
    // Validate email format
    if (!this.validateEmail(email)) {
      throw new Error('Invalid email format');
    }

    // Check rate limiting
    const rateLimitCheck = await this.checkRateLimit(email, ipAddress);
    if (rateLimitCheck.isLimited) {
      const lockoutTime = rateLimitCheck.lockoutTime;
      const remainingTime = lockoutTime ? Math.ceil((lockoutTime - Date.now()) / 1000 / 60) : 0;
      throw new Error(`Too many failed attempts. Account locked for ${remainingTime} minutes.`);
    }

    const result = await DatabaseService.query(
      'SELECT id, email, password_hash, first_name, last_name, role, is_active, email_verified, keycloak_id FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      await this.recordLoginAttempt(email, false, ipAddress);
      logger.warn('Authentication failed - user not found', { email, ipAddress });
      throw new Error('Invalid credentials');
    }

    const user = result.rows[0];

    if (!user.is_active) {
      await this.recordLoginAttempt(email, false, ipAddress);
      logger.warn('Authentication failed - user inactive', { email, ipAddress });
      throw new Error('Account is inactive');
    }

    // Check if user has a password (for users migrated from Keycloak)
    if (!user.password_hash) {
      await this.recordLoginAttempt(email, false, ipAddress);
      logger.warn('Authentication failed - no password set', { email, ipAddress });
      throw new Error('Password not set. Please reset your password.');
    }

    const isValidPassword = await this.comparePassword(password, user.password_hash);
    if (!isValidPassword) {
      await this.recordLoginAttempt(email, false, ipAddress);
      logger.warn('Authentication failed - invalid password', { email, ipAddress });
      throw new Error('Invalid credentials');
    }

    // Record successful login
    await this.recordLoginAttempt(email, true, ipAddress);

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

    logger.info('User authenticated successfully', { 
      userId: user.id, 
      email: user.email,
      ipAddress 
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        isActive: user.is_active,
        emailVerified: user.email_verified,
        keycloakId: user.keycloak_id
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

  static async changePassword(userId: string, oldPassword: string, newPassword: string, ipAddress?: string): Promise<void> {
    // Get current user with email and name for notifications
    const result = await DatabaseService.query(
      'SELECT password_hash, email, first_name FROM users WHERE id = $1 AND is_active = true',
      [userId]
    );

    if (result.rows.length === 0) {
      throw new Error('User not found or inactive');
    }

    const user = result.rows[0];

    // Verify old password
    const isValidOldPassword = await this.comparePassword(oldPassword, user.password_hash);
    if (!isValidOldPassword) {
      logger.warn('Password change failed - invalid old password', { userId });
      throw new Error('Current password is incorrect');
    }

    // Validate new password
    const passwordValidation = this.validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      throw new Error(`New password validation failed: ${passwordValidation.errors.join(', ')}`);
    }

    // Check if new password is different from old password
    const isSamePassword = await this.comparePassword(newPassword, user.password_hash);
    if (isSamePassword) {
      throw new Error('New password must be different from current password');
    }

    // Hash and update password
    const newPasswordHash = await this.hashPassword(newPassword);
    const changeTime = new Date();
    
    await DatabaseService.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newPasswordHash, userId]
    );

    // Revoke all existing refresh tokens for security
    await this.revokeAllRefreshTokens(userId);

    logger.info('Password changed successfully', { 
      userId, 
      email: user.email,
      passwordStrength: passwordValidation.strength,
      ipAddress
    });

    // Send password change notification email
    try {
      await this.emailService.sendPasswordChangeNotification({
        email: user.email,
        firstName: user.first_name,
        changeTime,
        ipAddress
      });
    } catch (emailError) {
      logger.warn('Failed to send password change notification', { 
        userId, 
        email: user.email, 
        error: emailError 
      });
      // Don't fail the password change if notification fails
    }
  }

  static async updateUserProfile(userId: string, updates: UserProfileUpdate): Promise<User> {
    const updateFields: string[] = [];
    const updateValues: any[] = [];
    let paramIndex = 1;

    if (updates.firstName !== undefined) {
      updateFields.push(`first_name = $${paramIndex++}`);
      updateValues.push(updates.firstName);
    }

    if (updates.lastName !== undefined) {
      updateFields.push(`last_name = $${paramIndex++}`);
      updateValues.push(updates.lastName);
    }

    if (updates.email !== undefined) {
      if (!this.validateEmail(updates.email)) {
        throw new Error('Invalid email format');
      }
      
      // Check if email is already taken
      const existingUser = await DatabaseService.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [updates.email, userId]
      );

      if (existingUser.rows.length > 0) {
        throw new Error('Email is already taken');
      }

      updateFields.push(`email = $${paramIndex++}`);
      updateValues.push(updates.email);
    }

    if (updateFields.length === 0) {
      throw new Error('No valid fields to update');
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(userId);

    const query = `
      UPDATE users 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, email, first_name, last_name, role, is_active, email_verified, keycloak_id
    `;

    const result = await DatabaseService.query(query, updateValues);

    if (result.rows.length === 0) {
      throw new Error('User not found');
    }

    const user = result.rows[0];
    logger.info('User profile updated', { userId, updatedFields: Object.keys(updates) });

    return {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      isActive: user.is_active,
      emailVerified: user.email_verified,
      keycloakId: user.keycloak_id
    };
  }

  static async revokeAllRefreshTokens(userId: string): Promise<void> {
    const refreshTokenKey = `refresh_token:${userId}`;
    await RedisService.del(refreshTokenKey);
    logger.info('All refresh tokens revoked', { userId });
  }

  static async getUserById(userId: string): Promise<User | null> {
    const result = await DatabaseService.query(
      'SELECT id, email, first_name, last_name, role, is_active, email_verified, keycloak_id FROM users WHERE id = $1',
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
      isActive: user.is_active,
      emailVerified: user.email_verified,
      keycloakId: user.keycloak_id
    };
  }
}

export { 
  AuthService, 
  User, 
  TokenPayload, 
  AuthTokens, 
  CreateUserRequest, 
  UserProfileUpdate, 
  PasswordValidationResult,
  LoginAttempt
};