import bcrypt from 'bcryptjs';
import { DatabaseService } from './database';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export interface MigrationResult {
  success: boolean;
  message: string;
  usersCreated: number;
  usersMigrated: number;
  errors: string[];
}

export interface ValidationResult {
  isValid: boolean;
  adminUserExists: boolean;
  totalUsers: number;
  usersWithPasswords: number;
  issues: string[];
}

export interface CreateUserData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'agent' | 'admin';
}

export class MigrationService {
  private static readonly DEFAULT_ADMIN_EMAIL = 'admin@localhost';
  private static readonly DEFAULT_ADMIN_PASSWORD = 'admin123!';
  private static readonly SALT_ROUNDS = 12;

  /**
   * Create a default admin user if none exists
   */
  static async createDefaultAdminUser(): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: false,
      message: '',
      usersCreated: 0,
      usersMigrated: 0,
      errors: []
    };

    try {
      logger.info('Starting default admin user creation...');

      // Check if any admin user already exists
      const existingAdmin = await DatabaseService.query(
        'SELECT id FROM users WHERE role = $1 AND is_active = true LIMIT 1',
        ['admin']
      );

      if (existingAdmin.rows.length > 0) {
        result.success = true;   
     result.message = 'Admin user already exists, skipping creation';
        logger.info('Admin user already exists, skipping creation');
        return result;
      }

      // Check if default admin email is already taken
      const existingUser = await DatabaseService.query(
        'SELECT id FROM users WHERE email = $1',
        [this.DEFAULT_ADMIN_EMAIL]
      );

      if (existingUser.rows.length > 0) {
        result.errors.push(`Email ${this.DEFAULT_ADMIN_EMAIL} is already taken`);
        result.message = 'Cannot create default admin user - email already exists';
        logger.error(`Cannot create default admin user - email ${this.DEFAULT_ADMIN_EMAIL} already exists`);
        return result;
      }

      // Create default admin user
      const hashedPassword = await bcrypt.hash(this.DEFAULT_ADMIN_PASSWORD, this.SALT_ROUNDS);
      const userId = uuidv4();

      await DatabaseService.query(
        `INSERT INTO users (id, email, first_name, last_name, role, password_hash, email_verified, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userId,
          this.DEFAULT_ADMIN_EMAIL,
          'System',
          'Administrator',
          'admin',
          hashedPassword,
          true,
          true
        ]
      );

      result.success = true;
      result.usersCreated = 1;
      result.message = `Default admin user created with email: ${this.DEFAULT_ADMIN_EMAIL}`;
      
      logger.info(`Default admin user created successfully with ID: ${userId}`);
      logger.warn(`Default admin credentials - Email: ${this.DEFAULT_ADMIN_EMAIL}, Password: ${this.DEFAULT_ADMIN_PASSWORD}`);
      logger.warn('Please change the default admin password immediately after first login');

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Failed to create default admin user: ${errorMessage}`);
      result.message = 'Failed to create default admin user';
      logger.error('Failed to create default admin user:', error);
      return result;
    }
  }  /*
*
   * Create a custom admin user with provided credentials
   */
  static async createAdminUser(userData: CreateUserData): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: false,
      message: '',
      usersCreated: 0,
      usersMigrated: 0,
      errors: []
    };

    try {
      logger.info(`Creating admin user with email: ${userData.email}`);

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(userData.email)) {
        result.errors.push('Invalid email format');
        result.message = 'Invalid email format';
        return result;
      }

      // Validate password strength
      if (userData.password.length < 8) {
        result.errors.push('Password must be at least 8 characters long');
        result.message = 'Password validation failed';
        return result;
      }

      // Check if email is already taken
      const existingUser = await DatabaseService.query(
        'SELECT id FROM users WHERE email = $1',
        [userData.email]
      );

      if (existingUser.rows.length > 0) {
        result.errors.push(`Email ${userData.email} is already taken`);
        result.message = 'Email already exists';
        return result;
      }

      // Create user
      const hashedPassword = await bcrypt.hash(userData.password, this.SALT_ROUNDS);
      const userId = uuidv4();

      await DatabaseService.query(
        `INSERT INTO users (id, email, first_name, last_name, role, password_hash, email_verified, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userId,
          userData.email,
          userData.firstName,
          userData.lastName,
          userData.role,
          hashedPassword,
          true,
          true
        ]
      );

      result.success = true;
      result.usersCreated = 1;
      result.message = `User created successfully with email: ${userData.email}`;
      
      logger.info(`User created successfully with ID: ${userId}`);
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Failed to create user: ${errorMessage}`);
      result.message = 'Failed to create user';
      logger.error('Failed to create user:', error);
      return result;
    }
  }  /**

   * Legacy method - Keycloak migration no longer supported
   * @deprecated Keycloak has been removed from the system
   */
  static async migrateFromKeycloak(): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: false,
      message: '',
      usersCreated: 0,
      usersMigrated: 0,
      errors: []
    };

    // Keycloak has been removed from the system
    result.success = true;
    result.message = 'Keycloak migration is no longer supported - system now uses direct authentication';
    logger.info('Keycloak migration skipped - system now uses direct authentication');
    return result;
  }

  /**
   * Validate the migration results and system state
   */
  static async validateMigration(): Promise<ValidationResult> {
    const result: ValidationResult = {
      isValid: true,
      adminUserExists: false,
      totalUsers: 0,
      usersWithPasswords: 0,
      issues: []
    };

    try {
      logger.info('Starting migration validation...');

      // Check total users
      const totalUsersResult = await DatabaseService.query(
        'SELECT COUNT(*) as count FROM users WHERE is_active = true'
      );
      result.totalUsers = parseInt(totalUsersResult.rows[0].count);

      // Check admin user exists
      const adminUserResult = await DatabaseService.query(
        'SELECT COUNT(*) as count FROM users WHERE role = $1 AND is_active = true',
        ['admin']
      );
      result.adminUserExists = parseInt(adminUserResult.rows[0].count) > 0;

      // Check users with passwords
      const usersWithPasswordsResult = await DatabaseService.query(
        'SELECT COUNT(*) as count FROM users WHERE password_hash IS NOT NULL AND is_active = true'
      );
      result.usersWithPasswords = parseInt(usersWithPasswordsResult.rows[0].count);

      // Validation checks
      if (!result.adminUserExists) {
        result.issues.push('No admin user found in the system');
        result.isValid = false;
      }

      if (result.totalUsers === 0) {
        result.issues.push('No active users found in the system');
        result.isValid = false;
      }

      if (result.usersWithPasswords === 0) {
        result.issues.push('No users have password hashes - local authentication not possible');
        result.isValid = false;
      }      // C
// check for users without any authentication method
      const usersWithoutAuthResult = await DatabaseService.query(
        'SELECT COUNT(*) as count FROM users WHERE password_hash IS NULL AND is_active = true'
      );
      const usersWithoutAuth = parseInt(usersWithoutAuthResult.rows[0].count);

      if (usersWithoutAuth > 0) {
        result.issues.push(`${usersWithoutAuth} users have no password hash - cannot authenticate locally`);
        result.isValid = false;
      }

      // Check password reset tokens table exists
      try {
        await DatabaseService.query('SELECT 1 FROM password_reset_tokens LIMIT 1');
      } catch (error) {
        result.issues.push('Password reset tokens table is missing or inaccessible');
        result.isValid = false;
      }

      logger.info('Migration validation completed:', {
        isValid: result.isValid,
        totalUsers: result.totalUsers,
        adminUserExists: result.adminUserExists,
        usersWithPasswords: result.usersWithPasswords,
        issuesCount: result.issues.length
      });

      if (result.issues.length > 0) {
        logger.warn('Migration validation issues found:', result.issues);
      }

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.issues.push(`Validation failed: ${errorMessage}`);
      result.isValid = false;
      logger.error('Migration validation failed:', error);
      return result;
    }
  }

  /**
   * Run complete migration process
   */
  static async runCompleteMigration(): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: false,
      message: '',
      usersCreated: 0,
      usersMigrated: 0,
      errors: []
    };

    try {
      logger.info('Starting complete migration process...');

      // Step 1: Create default admin user
      const adminResult = await this.createDefaultAdminUser();
      result.usersCreated += adminResult.usersCreated;
      result.errors.push(...adminResult.errors);

      // Step 2: Keycloak migration (deprecated - no longer needed)
      logger.info('Skipping Keycloak migration - system now uses direct authentication');

      // Step 3: Validate migration
      const validation = await this.validateMigration();
      
      if (!validation.isValid) {
        result.errors.push(...validation.issues);
        result.success = false;
        result.message = 'Migration completed but validation failed';
      } else {
        result.success = true;
        result.message = `Migration completed successfully. Created ${result.usersCreated} users, migrated ${result.usersMigrated} users.`;
      }

      logger.info('Complete migration process finished:', {
        success: result.success,
        usersCreated: result.usersCreated,
        usersMigrated: result.usersMigrated,
        errorsCount: result.errors.length
      });

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Complete migration failed: ${errorMessage}`);
      result.message = 'Complete migration process failed';
      logger.error('Complete migration process failed:', error);
      return result;
    }
  }  /**

   * Clean up expired password reset tokens
   */
  static async cleanupExpiredTokens(): Promise<number> {
    try {
      const result = await DatabaseService.query('SELECT cleanup_expired_password_reset_tokens()');
      const deletedCount = result.rows[0].cleanup_expired_password_reset_tokens;
      logger.info(`Cleaned up ${deletedCount} expired password reset tokens`);
      return deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup expired password reset tokens:', error);
      return 0;
    }
  }
}