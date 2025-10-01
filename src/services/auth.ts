import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { DatabaseService } from './database';
import { RedisService } from './redis';
import { logger } from '../utils/logger';
import { EmailNotificationService } from './email/emailNotificationService';
import { EmailVerificationService } from './emailVerificationService';
import { RateLimitingService } from './rateLimitingService';

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

interface RegistrationRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: 'agent' | 'admin';
  ipAddress?: string;
  userAgent?: string;
}

interface RegistrationResult {
  success: boolean;
  userId?: string;
  requiresVerification: boolean;
  requiresApproval: boolean;
  message: string;
  user?: User;
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
   * Enhanced password validation for registration with stricter requirements
   */
  static validateRegistrationPassword(password: string): PasswordValidationResult {
    const errors: string[] = [];
    let score = 0;

    // Enhanced length validation for registration
    if (password.length < this.MIN_PASSWORD_LENGTH) {
      errors.push(`Password must be at least ${this.MIN_PASSWORD_LENGTH} characters long`);
    } else if (password.length >= this.MIN_PASSWORD_LENGTH) {
      score += 20;
    }

    if (password.length > this.MAX_PASSWORD_LENGTH) {
      errors.push(`Password must not exceed ${this.MAX_PASSWORD_LENGTH} characters`);
    }

    // Stricter character type requirements for registration
    const hasLowercase = /[a-z]/.test(password);
    const hasUppercase = /[A-Z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChars = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

    if (!hasLowercase) {
      errors.push('Password must contain at least one lowercase letter (a-z)');
    } else {
      score += 15;
    }

    if (!hasUppercase) {
      errors.push('Password must contain at least one uppercase letter (A-Z)');
    } else {
      score += 15;
    }

    if (!hasNumbers) {
      errors.push('Password must contain at least one number (0-9)');
    } else {
      score += 15;
    }

    if (!hasSpecialChars) {
      errors.push('Password must contain at least one special character (!@#$%^&*()_+-=[]{}|;:,.<>?)');
    } else {
      score += 15;
    }

    // Additional strength requirements for registration
    if (password.length >= 12) {
      score += 10;
    } else if (password.length >= 10) {
      score += 5;
    }

    // Check for multiple character types
    const characterTypes = [hasLowercase, hasUppercase, hasNumbers, hasSpecialChars].filter(Boolean).length;
    if (characterTypes >= 4) {
      score += 10;
    }

    // Enhanced pattern checking for registration
    const weakPatterns = [
      { pattern: /(.)\1{2,}/, message: 'Password cannot contain repeated characters (e.g., aaa, 111)' },
      { pattern: /123456|654321|abcdef|qwerty|asdfgh|zxcvbn/i, message: 'Password cannot contain common sequences' },
      { pattern: /^password$|^admin$|^user$|^login$|^welcome$|^letmein$|^monkey$|^dragon$/i, message: 'Password cannot be a common word' },
      { pattern: /^[a-zA-Z]+$/, message: 'Password cannot contain only letters' },
      { pattern: /^[0-9]+$/, message: 'Password cannot contain only numbers' },
      { pattern: /(.{3,})\1/, message: 'Password cannot contain repeated patterns of 3+ characters' }
    ];

    for (const { pattern, message } of weakPatterns) {
      if (pattern.test(password)) {
        errors.push(message);
        score -= 15;
        break; // Only report first pattern match to avoid overwhelming user
      }
    }

    // Check for keyboard patterns
    const keyboardPatterns = [
      /qwertyuiop/i, /asdfghjkl/i, /zxcvbnm/i,
      /1234567890/i, /0987654321/i
    ];

    for (const pattern of keyboardPatterns) {
      if (pattern.test(password)) {
        errors.push('Password cannot contain keyboard patterns');
        score -= 10;
        break;
      }
    }

    // Ensure minimum score for registration
    const MIN_REGISTRATION_SCORE = 60;
    if (score < MIN_REGISTRATION_SCORE && errors.length === 0) {
      errors.push(`Password strength is too weak. Please create a stronger password.`);
    }

    // Ensure score is within bounds
    score = Math.max(0, Math.min(100, score));

    // Determine strength level with stricter thresholds for registration
    let strength: 'weak' | 'fair' | 'good' | 'strong';
    if (score < 50) {
      strength = 'weak';
    } else if (score < 70) {
      strength = 'fair';
    } else if (score < 85) {
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
   * Standard password validation for existing functionality
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
   * Enhanced email validation for registration with domain checking
   */
  static async validateRegistrationEmail(email: string): Promise<{ isValid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Basic format validation
    if (!this.validateEmail(email)) {
      errors.push('Invalid email format');
      return { isValid: false, errors };
    }

    // Check email domain restrictions
    try {
      const settings = await EmailVerificationService.getRegistrationSettings();
      if (settings?.allowedEmailDomains && settings.allowedEmailDomains.length > 0) {
        const emailDomain = email.split('@')[1]?.toLowerCase();
        if (!emailDomain) {
          errors.push('Invalid email domain');
          return { isValid: false, errors };
        }

        const isAllowedDomain = settings.allowedEmailDomains.some(domain =>
          emailDomain === domain.toLowerCase() ||
          emailDomain.endsWith('.' + domain.toLowerCase())
        );

        if (!isAllowedDomain) {
          errors.push(`Email domain '${emailDomain}' is not allowed. Allowed domains: ${settings.allowedEmailDomains.join(', ')}`);
        }
      }

      // Additional email security checks for registration
      const suspiciousDomains = [
        '10minutemail.com', 'guerrillamail.com', 'mailinator.com',
        'tempmail.org', 'throwaway.email', 'temp-mail.org'
      ];

      const emailDomain = email.split('@')[1]?.toLowerCase();
      if (emailDomain && suspiciousDomains.includes(emailDomain)) {
        errors.push('Temporary email addresses are not allowed for registration');
      }

      // Check for common typos in popular domains
      const commonDomainTypos: Record<string, string> = {
        'gmial.com': 'gmail.com',
        'gmai.com': 'gmail.com',
        'yahooo.com': 'yahoo.com',
        'hotmial.com': 'hotmail.com',
        'outlok.com': 'outlook.com'
      };

      if (emailDomain && commonDomainTypos[emailDomain]) {
        errors.push(`Did you mean ${email.replace(emailDomain, commonDomainTypos[emailDomain])}?`);
      }

    } catch (error) {
      logger.error('Error validating registration email', { email, error });
      // Don't fail validation due to settings error
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Validate names for registration with security checks
   */
  static validateRegistrationNames(firstName: string, lastName: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Basic validation
    if (!firstName?.trim()) {
      errors.push('First name is required');
    }

    if (!lastName?.trim()) {
      errors.push('Last name is required');
    }

    if (errors.length > 0) {
      return { isValid: false, errors };
    }

    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();

    // Length validation
    if (trimmedFirstName.length < 1 || trimmedFirstName.length > 50) {
      errors.push('First name must be between 1 and 50 characters');
    }

    if (trimmedLastName.length < 1 || trimmedLastName.length > 50) {
      errors.push('Last name must be between 1 and 50 characters');
    }

    // Character validation - allow letters, spaces, hyphens, apostrophes
    const namePattern = /^[a-zA-Z\s\-'\.]+$/;
    if (!namePattern.test(trimmedFirstName)) {
      errors.push('First name can only contain letters, spaces, hyphens, apostrophes, and periods');
    }

    if (!namePattern.test(trimmedLastName)) {
      errors.push('Last name can only contain letters, spaces, hyphens, apostrophes, and periods');
    }

    // Security checks - detect suspicious patterns
    const suspiciousPatterns = [
      /^(test|admin|user|guest|demo|sample)$/i,
      /^[0-9]+$/,
      /(.)\1{3,}/, // Repeated characters like aaaa
    ];

    const fullName = `${trimmedFirstName} ${trimmedLastName}`.toLowerCase();

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(trimmedFirstName) || pattern.test(trimmedLastName)) {
        errors.push('Please provide your real first and last name');
        break;
      }
    }

    // Check for common fake names (but allow John Doe for testing)
    const commonFakeNames = [
      'jane doe', 'test user', 'admin user',
      'first last', 'fname lname', 'asdf asdf'
    ];

    if (commonFakeNames.includes(fullName)) {
      errors.push('Please provide your real first and last name');
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Standard email format validation
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

  /**
   * Register a new user with email verification workflow
   * This is the main registration method that should be used for new user registrations
   */
  static async registerUser(registrationData: RegistrationRequest): Promise<RegistrationResult> {
    const { email, password, firstName, lastName, role = 'agent', ipAddress, userAgent } = registrationData;

    try {
      // Check registration rate limiting
      const rateLimitResult = await RateLimitingService.checkRateLimit(
        email.toLowerCase(),
        'register',
        ipAddress
      );

      if (!rateLimitResult.allowed) {
        const retryAfter = rateLimitResult.retryAfter || 3600; // Default 1 hour
        throw new Error(`Registration rate limit exceeded. Try again in ${Math.ceil(retryAfter / 60)} minutes.`);
      }

      // Record the registration attempt
      await RateLimitingService.recordAttempt(email.toLowerCase(), 'register', ipAddress);

      // Check for suspicious registration patterns
      const suspiciousCheck = await this.checkSuspiciousRegistration(email, ipAddress, userAgent);
      if (suspiciousCheck.isSuspicious) {
        // Log but don't block - just increase monitoring
        logger.warn('Suspicious registration pattern detected', {
          email: email.toLowerCase(),
          ipAddress,
          userAgent,
          reasons: suspiciousCheck.reasons
        });
      }

      // Enhanced email validation for registration
      const emailValidation = await this.validateRegistrationEmail(email);
      if (!emailValidation.isValid) {
        throw new Error(`Email validation failed: ${emailValidation.errors.join(', ')}`);
      }

      // Enhanced password validation for registration
      const passwordValidation = this.validateRegistrationPassword(password);
      if (!passwordValidation.isValid) {
        throw new Error(`Password validation failed: ${passwordValidation.errors.join(', ')}`);
      }

      // Enhanced name validation for registration
      const nameValidation = this.validateRegistrationNames(firstName, lastName);
      if (!nameValidation.isValid) {
        throw new Error(`Name validation failed: ${nameValidation.errors.join(', ')}`);
      }

      // Check if user already exists
      const existingUser = await DatabaseService.query(
        'SELECT id, email_verified FROM users WHERE email = $1',
        [email.toLowerCase()]
      );

      if (existingUser.rows.length > 0) {
        // Don't reveal if email exists for security, but log it
        logger.warn('Registration attempt with existing email', {
          email: email.toLowerCase(),
          ipAddress,
          userAgent
        });
        throw new Error('If this email is available, you will receive a verification email shortly.');
      }

      // Get registration settings for later use
      const registrationSettings = await EmailVerificationService.getRegistrationSettings();

      // Create user with email_verified = false
      const user = await this.createUser({
        email: email.toLowerCase(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        role
      });

      // Generate verification token
      const verificationToken = await EmailVerificationService.generateVerificationToken(user.id);

      // Send verification email
      const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/verify-email/${verificationToken}`;
      const expiryHours = registrationSettings?.verificationTokenExpiryHours || 24;
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + expiryHours);

      await this.emailService.sendVerificationEmail({
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        verificationToken,
        verificationUrl,
        expiresAt
      });

      // Log registration audit event
      await this.logRegistrationEvent({
        userId: user.id,
        eventType: 'registration',
        eventData: {
          email: user.email,
          role: user.role,
          passwordStrength: passwordValidation.strength
        },
        ipAddress,
        userAgent
      });

      logger.info('User registration completed', {
        userId: user.id,
        email: user.email,
        role: user.role,
        requiresApproval: registrationSettings?.requireAdminApproval || false,
        ipAddress
      });

      return {
        success: true,
        userId: user.id,
        requiresVerification: true,
        requiresApproval: registrationSettings?.requireAdminApproval || false,
        message: 'Registration successful. Please check your email for verification instructions.',
        user
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Registration failed';

      // Enhanced logging for failed registration attempt
      await this.logRegistrationEvent({
        eventType: 'registration_failed',
        eventData: {
          email: email.toLowerCase(),
          error: errorMessage,
          role,
          firstName: firstName?.substring(0, 20), // Truncated for privacy
          lastName: lastName?.substring(0, 20),
          failureReason: this.categorizeRegistrationFailure(errorMessage),
          attemptNumber: await this.getRegistrationAttemptCount(email.toLowerCase(), ipAddress)
        },
        ipAddress,
        userAgent
      });

      logger.error('User registration failed', {
        email: email.toLowerCase(),
        error: errorMessage,
        ipAddress,
        userAgent
      });

      throw new Error(errorMessage);
    }
  }

  /**
   * Create user - internal method used by registration and admin user creation
   * Modified to support email verification workflow
   */
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
      'SELECT id, email, first_name, last_name, role, is_active, email_verified FROM users WHERE id = $1',
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
        isActive: user.is_active,
        emailVerified: user.email_verified
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

  /**
   * Verify user's email using verification token
   */
  static async verifyEmail(token: string, ipAddress?: string): Promise<{ success: boolean; message: string; user?: User }> {
    try {
      // Validate the verification token
      const tokenValidation = await EmailVerificationService.validateVerificationToken(token);

      if (!tokenValidation.isValid) {
        if (tokenValidation.isExpired) {
          return {
            success: false,
            message: 'Verification link has expired. Please request a new verification email.'
          };
        }
        return {
          success: false,
          message: 'Invalid verification link. Please check your email for the correct link.'
        };
      }

      const userId = tokenValidation.userId!;

      // Mark email as verified
      await EmailVerificationService.markEmailAsVerified(userId, token);

      // Get updated user data
      const user = await this.getUserById(userId);
      if (!user) {
        throw new Error('User not found after verification');
      }

      // Enhanced verification audit logging
      await this.logRegistrationEvent({
        userId,
        eventType: 'verification',
        eventData: {
          email: user.email,
          verificationMethod: 'email_token',
          verificationTime: new Date().toISOString(),
          timeSinceRegistration: await this.getTimeSinceRegistration(userId)
        },
        ipAddress
      });

      logger.info('Email verification completed', {
        userId,
        email: user.email,
        ipAddress
      });

      return {
        success: true,
        message: 'Email verified successfully. You can now log in to your account.',
        user
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Email verification failed';

      // Log failed verification attempt
      await this.logRegistrationEvent({
        eventType: 'verification_failed',
        eventData: {
          token: token.substring(0, 8) + '...',
          error: errorMessage,
          failureReason: this.categorizeVerificationFailure(errorMessage)
        },
        ipAddress
      });

      logger.error('Email verification failed', {
        token: token.substring(0, 8) + '...',
        error: errorMessage,
        ipAddress
      });

      return {
        success: false,
        message: 'Email verification failed. Please try again or request a new verification email.'
      };
    }
  }

  /**
   * Resend verification email for a user
   */
  static async resendVerificationEmail(email: string, ipAddress?: string): Promise<{ success: boolean; message: string }> {
    try {
      // Check rate limiting for verification resend
      const rateLimitResult = await RateLimitingService.checkRateLimit(
        email.toLowerCase(),
        'passwordReset', // Reuse password reset rate limit for verification resend
        ipAddress
      );

      if (!rateLimitResult.allowed) {
        const retryAfter = rateLimitResult.retryAfter || 3600;
        return {
          success: false,
          message: `Too many verification requests. Please try again in ${Math.ceil(retryAfter / 60)} minutes.`
        };
      }

      // Record the resend attempt
      await RateLimitingService.recordAttempt(email.toLowerCase(), 'passwordReset', ipAddress);

      // Find user by email
      const userResult = await DatabaseService.query(
        'SELECT id, email, first_name, email_verified FROM users WHERE email = $1 AND is_active = true',
        [email.toLowerCase()]
      );

      if (userResult.rows.length === 0) {
        // Don't reveal if email exists for security
        return {
          success: true,
          message: 'If this email is registered and unverified, you will receive a verification email shortly.'
        };
      }

      const user = userResult.rows[0];

      // Check if email is already verified
      if (user.email_verified) {
        return {
          success: false,
          message: 'This email address is already verified.'
        };
      }

      // Invalidate existing tokens for this user
      await EmailVerificationService.invalidateUserTokens(user.id);

      // Generate new verification token
      const verificationToken = await EmailVerificationService.generateVerificationToken(user.id);

      // Send verification email
      const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/verify-email/${verificationToken}`;
      const verificationSettings = await EmailVerificationService.getRegistrationSettings();
      const expiryHours = verificationSettings?.verificationTokenExpiryHours || 24;
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + expiryHours);

      await this.emailService.sendVerificationEmail({
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name || '',
        verificationToken,
        verificationUrl,
        expiresAt
      });

      // Enhanced resend audit logging
      await this.logRegistrationEvent({
        userId: user.id,
        eventType: 'verification_resend',
        eventData: {
          email: user.email,
          resendReason: 'user_requested',
          previousTokensInvalidated: await EmailVerificationService.invalidateUserTokens(user.id),
          resendCount: await this.getVerificationResendCount(user.id)
        },
        ipAddress
      });

      logger.info('Verification email resent', {
        userId: user.id,
        email: user.email,
        ipAddress
      });

      return {
        success: true,
        message: 'Verification email sent. Please check your inbox and spam folder.'
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to resend verification email';

      logger.error('Failed to resend verification email', {
        email: email.toLowerCase(),
        error: errorMessage,
        ipAddress
      });

      return {
        success: false,
        message: 'Failed to send verification email. Please try again later.'
      };
    }
  }

  /**
   * Check for suspicious registration patterns
   */
  private static async checkSuspiciousRegistration(
    email: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ isSuspicious: boolean; reasons: string[] }> {
    const reasons: string[] = [];

    try {
      // Check for multiple registrations from same IP in short time
      if (ipAddress) {
        const recentRegistrations = await DatabaseService.query(
          `SELECT COUNT(*) as count FROM registration_audit_log 
           WHERE event_type = 'registration' 
           AND ip_address = $1 
           AND created_at > NOW() - INTERVAL '1 hour'`,
          [ipAddress]
        );

        const count = parseInt(recentRegistrations.rows[0]?.count || '0');
        if (count >= 3) {
          reasons.push(`Multiple registrations from IP: ${count} in last hour`);
        }
      }

      // Check for suspicious user agent patterns
      if (userAgent) {
        const suspiciousAgentPatterns = [
          /bot|crawler|spider|scraper/i,
          /curl|wget|python|java/i,
          /^$/,
          /.{0,10}$/ // Very short user agents
        ];

        for (const pattern of suspiciousAgentPatterns) {
          if (pattern.test(userAgent)) {
            reasons.push('Suspicious user agent pattern');
            break;
          }
        }
      }

      // Check for suspicious email patterns
      const emailLocalPart = email.split('@')[0];
      const suspiciousEmailPatterns = [
        /^[a-z]+[0-9]+$/, // Simple pattern like user123
        /^test|admin|demo/i,
        /[0-9]{5,}/, // Long sequences of numbers
        /(.)\1{3,}/ // Repeated characters
      ];

      for (const pattern of suspiciousEmailPatterns) {
        if (pattern.test(emailLocalPart)) {
          reasons.push('Suspicious email pattern');
          break;
        }
      }

      // Check registration timing patterns (too fast)
      const registrationStartTime = Date.now();
      // This would be set when user first loads registration page
      // For now, we'll skip this check as it requires frontend integration

    } catch (error) {
      logger.error('Error checking suspicious registration patterns', {
        email,
        ipAddress,
        error
      });
    }

    return {
      isSuspicious: reasons.length > 0,
      reasons
    };
  }

  /**
   * Enhanced registration audit logging with comprehensive tracking
   */
  private static async logRegistrationEvent(eventData: {
    userId?: string;
    eventType: string;
    eventData: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
    adminId?: string;
  }): Promise<void> {
    try {
      const { userId, eventType, eventData: data, ipAddress, userAgent, adminId } = eventData;

      // Enhance event data with additional context
      const enhancedEventData = {
        ...data,
        timestamp: new Date().toISOString(),
        sessionId: this.generateSessionId(ipAddress, userAgent),
        // Add geolocation info if IP is available (placeholder for future enhancement)
        ...(ipAddress && { ipInfo: await this.getIpInfo(ipAddress) })
      };

      await DatabaseService.query(
        `INSERT INTO registration_audit_log (user_id, event_type, event_data, ip_address, user_agent, admin_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          userId || null,
          eventType,
          JSON.stringify(enhancedEventData),
          ipAddress || null,
          userAgent || null,
          adminId || null
        ]
      );

      // Log to application logger with appropriate level based on event type
      const logLevel = this.getLogLevelForEvent(eventType);
      const logData = {
        userId,
        eventType,
        ipAddress,
        adminId,
        userAgent: userAgent ? userAgent.substring(0, 100) : undefined // Truncate long user agents
      };

      switch (logLevel) {
        case 'error':
          logger.error('Registration audit event', logData);
          break;
        case 'warn':
          logger.warn('Registration audit event', logData);
          break;
        case 'info':
          logger.info('Registration audit event', logData);
          break;
        default:
          logger.debug('Registration audit event', logData);
      }

      // Send alerts for critical events
      if (this.isCriticalEvent(eventType)) {
        await this.sendSecurityAlert(eventType, enhancedEventData, ipAddress);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to log registration audit event', {
        eventType: eventData.eventType,
        userId: eventData.userId,
        error: errorMessage,
        ipAddress: eventData.ipAddress
      });
      // Don't throw error to avoid breaking the main flow
    }
  }

  /**
   * Generate a session ID for tracking related events
   */
  private static generateSessionId(ipAddress?: string, userAgent?: string): string {
    const data = `${ipAddress || 'unknown'}-${userAgent || 'unknown'}-${Date.now()}`;
    return require('crypto').createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  /**
   * Get IP information (placeholder for future geolocation enhancement)
   */
  private static async getIpInfo(ipAddress: string): Promise<Record<string, any>> {
    // Placeholder for IP geolocation service integration
    // For now, just return basic info
    return {
      ip: ipAddress,
      isPrivate: this.isPrivateIP(ipAddress),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Check if IP address is private/internal
   */
  private static isPrivateIP(ip: string): boolean {
    const privateRanges = [
      /^10\./, /^172\.(1[6-9]|2[0-9]|3[01])\./, /^192\.168\./,
      /^127\./, /^169\.254\./, /^::1$/, /^fc00:/, /^fe80:/
    ];
    return privateRanges.some(range => range.test(ip));
  }

  /**
   * Determine log level based on event type
   */
  private static getLogLevelForEvent(eventType: string): 'error' | 'warn' | 'info' | 'debug' {
    const eventLevels: Record<string, 'error' | 'warn' | 'info' | 'debug'> = {
      'registration_failed': 'warn',
      'verification_failed': 'warn',
      'suspicious_activity': 'warn',
      'rate_limit_exceeded': 'warn',
      'registration': 'info',
      'verification': 'info',
      'verification_resend': 'info',
      'approval': 'info',
      'rejection': 'info'
    };
    return eventLevels[eventType] || 'debug';
  }

  /**
   * Check if event type is critical and requires immediate attention
   */
  private static isCriticalEvent(eventType: string): boolean {
    const criticalEvents = [
      'suspicious_activity',
      'rate_limit_exceeded',
      'multiple_failed_attempts',
      'security_violation'
    ];
    return criticalEvents.includes(eventType);
  }

  /**
   * Categorize registration failure for better analytics
   */
  private static categorizeRegistrationFailure(errorMessage: string): string {
    const categories = {
      'email_validation': /email.*format|email.*invalid|email.*domain/i,
      'password_validation': /password.*validation|password.*strength|password.*weak/i,
      'name_validation': /name.*required|name.*invalid|first name|last name/i,
      'rate_limit': /rate limit|too many/i,
      'duplicate_email': /already exists|duplicate/i,
      'domain_restriction': /domain.*not allowed|domain.*restricted/i,
      'suspicious_activity': /suspicious|security/i
    };

    for (const [category, pattern] of Object.entries(categories)) {
      if (pattern.test(errorMessage)) {
        return category;
      }
    }

    return 'unknown';
  }

  /**
   * Categorize verification failure for better analytics
   */
  private static categorizeVerificationFailure(errorMessage: string): string {
    const categories = {
      'token_expired': /expired|expir/i,
      'token_invalid': /invalid.*token|token.*invalid|not found/i,
      'token_used': /already.*used|used.*token/i,
      'user_not_found': /user.*not found|not found.*user/i,
      'database_error': /database|connection|query/i,
      'rate_limit': /rate limit|too many/i
    };

    for (const [category, pattern] of Object.entries(categories)) {
      if (pattern.test(errorMessage)) {
        return category;
      }
    }

    return 'unknown';
  }

  /**
   * Get registration attempt count for email/IP combination
   */
  private static async getRegistrationAttemptCount(email: string, ipAddress?: string): Promise<number> {
    try {
      let query = `
        SELECT COUNT(*) as count 
        FROM registration_audit_log 
        WHERE event_type IN ('registration_failed', 'registration')
        AND created_at > NOW() - INTERVAL '24 hours'
      `;
      const params: any[] = [];

      if (ipAddress) {
        query += ` AND (event_data->>'email' = $1 OR ip_address = $2)`;
        params.push(email, ipAddress);
      } else {
        query += ` AND event_data->>'email' = $1`;
        params.push(email);
      }

      const result = await DatabaseService.query(query, params);
      return parseInt(result.rows[0]?.count || '0');
    } catch (error) {
      logger.error('Failed to get registration attempt count', { email, ipAddress, error });
      return 0;
    }
  }

  /**
   * Get time elapsed since user registration
   */
  private static async getTimeSinceRegistration(userId: string): Promise<string> {
    try {
      const result = await DatabaseService.query(
        'SELECT created_at FROM users WHERE id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        return 'unknown';
      }

      const registrationTime = new Date(result.rows[0].created_at);
      const now = new Date();
      const diffMs = now.getTime() - registrationTime.getTime();
      const diffMinutes = Math.floor(diffMs / (1000 * 60));

      if (diffMinutes < 60) {
        return `${diffMinutes} minutes`;
      } else if (diffMinutes < 1440) {
        return `${Math.floor(diffMinutes / 60)} hours`;
      } else {
        return `${Math.floor(diffMinutes / 1440)} days`;
      }
    } catch (error) {
      logger.error('Failed to get time since registration', { userId, error });
      return 'unknown';
    }
  }

  /**
   * Get verification resend count for user
   */
  private static async getVerificationResendCount(userId: string): Promise<number> {
    try {
      const result = await DatabaseService.query(
        `SELECT COUNT(*) as count 
         FROM registration_audit_log 
         WHERE user_id = $1 
         AND event_type = 'verification_resend'
         AND created_at > NOW() - INTERVAL '24 hours'`,
        [userId]
      );

      return parseInt(result.rows[0]?.count || '0');
    } catch (error) {
      logger.error('Failed to get verification resend count', { userId, error });
      return 0;
    }
  }

  /**
   * Send security alerts for critical events (placeholder)
   */
  private static async sendSecurityAlert(
    eventType: string,
    eventData: Record<string, any>,
    ipAddress?: string
  ): Promise<void> {
    try {
      // Placeholder for security alert system
      // This could integrate with email notifications, Slack, PagerDuty, etc.
      logger.warn('Security alert triggered', {
        eventType,
        ipAddress,
        timestamp: new Date().toISOString(),
        eventData: JSON.stringify(eventData)
      });

      // Future: Send email to security team
      // Future: Send Slack notification
      // Future: Create incident in monitoring system

    } catch (error) {
      logger.error('Failed to send security alert', { eventType, error });
    }
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

  static async getUserByEmail(email: string): Promise<User | null> {
    const result = await DatabaseService.query(
      'SELECT id, email, first_name, last_name, role, is_active, email_verified, keycloak_id FROM users WHERE email = $1',
      [email.toLowerCase()]
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
  LoginAttempt,
  RegistrationRequest,
  RegistrationResult
};