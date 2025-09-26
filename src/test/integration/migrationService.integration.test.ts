import { DatabaseService } from '../../services/database';
import { MigrationService, CreateUserData } from '../../services/migrationService';
import bcrypt from 'bcryptjs';

describe('MigrationService Integration Tests', () => {
  beforeAll(async () => {
    await DatabaseService.initialize();
  });

  afterAll(async () => {
    // Clean up test data
    try {
      await DatabaseService.query('DELETE FROM password_reset_tokens WHERE 1=1');
      await DatabaseService.query('DELETE FROM users WHERE email LIKE $1', ['%test%']);
      await DatabaseService.query('DELETE FROM users WHERE email = $1', ['admin@localhost']);
    } catch (error) {
      console.warn('Cleanup failed:', error);
    }
  });

  beforeEach(async () => {
    // Clean up before each test
    try {
      await DatabaseService.query('DELETE FROM password_reset_tokens WHERE 1=1');
      await DatabaseService.query('DELETE FROM users WHERE email LIKE $1', ['%test%']);
      await DatabaseService.query('DELETE FROM users WHERE email = $1', ['admin@localhost']);
    } catch (error) {
      console.warn('Pre-test cleanup failed:', error);
    }
  });

  describe('createDefaultAdminUser', () => {
    it('should create default admin user in real database', async () => {
      const result = await MigrationService.createDefaultAdminUser();

      expect(result.success).toBe(true);
      expect(result.usersCreated).toBe(1);
      expect(result.message).toContain('Default admin user created');

      // Verify user was created in database
      const user = await DatabaseService.query(
        'SELECT * FROM users WHERE email = $1',
        ['admin@localhost']
      );

      expect(user.rows).toHaveLength(1);
      expect(user.rows[0].role).toBe('admin');
      expect(user.rows[0].is_active).toBe(true);
      expect(user.rows[0].email_verified).toBe(true);
      expect(user.rows[0].password_hash).toBeTruthy();

      // Verify password hash is valid
      const isValidPassword = await bcrypt.compare('admin123!', user.rows[0].password_hash);
      expect(isValidPassword).toBe(true);
    });

    it('should not create duplicate admin when one exists', async () => {
      // Create first admin
      const firstResult = await MigrationService.createDefaultAdminUser();
      expect(firstResult.success).toBe(true);
      expect(firstResult.usersCreated).toBe(1);

      // Try to create second admin
      const secondResult = await MigrationService.createDefaultAdminUser();
      expect(secondResult.success).toBe(true);
      expect(secondResult.usersCreated).toBe(0);
      expect(secondResult.message).toContain('Admin user already exists');

      // Verify only one admin exists
      const admins = await DatabaseService.query(
        'SELECT COUNT(*) as count FROM users WHERE role = $1',
        ['admin']
      );
      expect(parseInt(admins.rows[0].count)).toBe(1);
    });
  });

  describe('createAdminUser', () => {
    it('should create custom admin user with valid data', async () => {
      const userData: CreateUserData = {
        email: 'test.admin@example.com',
        password: 'securePassword123!',
        firstName: 'Test',
        lastName: 'Admin',
        role: 'admin'
      };

      const result = await MigrationService.createAdminUser(userData);

      expect(result.success).toBe(true);
      expect(result.usersCreated).toBe(1);

      // Verify user in database
      const user = await DatabaseService.query(
        'SELECT * FROM users WHERE email = $1',
        [userData.email]
      );

      expect(user.rows).toHaveLength(1);
      expect(user.rows[0].first_name).toBe(userData.firstName);
      expect(user.rows[0].last_name).toBe(userData.lastName);
      expect(user.rows[0].role).toBe(userData.role);

      // Verify password
      const isValidPassword = await bcrypt.compare(userData.password, user.rows[0].password_hash);
      expect(isValidPassword).toBe(true);
    });

    it('should reject duplicate email addresses', async () => {
      const userData: CreateUserData = {
        email: 'duplicate@example.com',
        password: 'password123!',
        firstName: 'First',
        lastName: 'User',
        role: 'admin'
      };

      // Create first user
      const firstResult = await MigrationService.createAdminUser(userData);
      expect(firstResult.success).toBe(true);

      // Try to create duplicate
      const secondResult = await MigrationService.createAdminUser(userData);
      expect(secondResult.success).toBe(false);
      expect(secondResult.errors).toContain('Email duplicate@example.com is already taken');
    });
  });

  describe('migrateFromKeycloak', () => {
    beforeEach(async () => {
      // Create test Keycloak users
      await DatabaseService.query(
        `INSERT INTO users (id, keycloak_id, email, first_name, last_name, role, is_active)
         VALUES 
         ('11111111-1111-1111-1111-111111111111', 'kc-user-1', 'keycloak1@example.com', 'Keycloak', 'User1', 'agent', true),
         ('22222222-2222-2222-2222-222222222222', 'kc-user-2', 'keycloak2@example.com', 'Keycloak', 'User2', 'agent', true)`
      );
    });

    it('should migrate Keycloak users to local authentication', async () => {
      const result = await MigrationService.migrateFromKeycloak();

      expect(result.success).toBe(true);
      expect(result.usersMigrated).toBe(2);
      expect(result.message).toContain('Migrated 2 users from Keycloak');

      // Verify users now have password hashes
      const users = await DatabaseService.query(
        'SELECT * FROM users WHERE keycloak_id IS NOT NULL AND password_hash IS NOT NULL'
      );

      expect(users.rows).toHaveLength(2);
      
      // Verify each user has a valid password hash
      for (const user of users.rows) {
        expect(user.password_hash).toBeTruthy();
        expect(user.password_hash.length).toBeGreaterThan(50); // bcrypt hashes are long
      }
    });

    it('should handle no Keycloak users gracefully', async () => {
      // Remove test Keycloak users
      await DatabaseService.query('DELETE FROM users WHERE keycloak_id IS NOT NULL');

      const result = await MigrationService.migrateFromKeycloak();

      expect(result.success).toBe(true);
      expect(result.usersMigrated).toBe(0);
      expect(result.message).toContain('No Keycloak users found to migrate');
    });
  });

  describe('validateMigration', () => {
    beforeEach(async () => {
      // Set up test data for validation
      await DatabaseService.query(
        `INSERT INTO users (id, email, first_name, last_name, role, password_hash, is_active)
         VALUES 
         ('33333333-3333-3333-3333-333333333333', 'admin.test@example.com', 'Admin', 'Test', 'admin', '$2a$12$hashedpassword', true),
         ('44444444-4444-4444-4444-444444444444', 'agent.test@example.com', 'Agent', 'Test', 'agent', '$2a$12$hashedpassword', true)`
      );
    });

    it('should validate successful migration state', async () => {
      const result = await MigrationService.validateMigration();

      expect(result.isValid).toBe(true);
      expect(result.adminUserExists).toBe(true);
      expect(result.totalUsers).toBeGreaterThanOrEqual(2);
      expect(result.usersWithPasswords).toBeGreaterThanOrEqual(2);
      expect(result.issues).toHaveLength(0);
    });

    it('should detect validation issues', async () => {
      // Remove admin user to create validation issue
      await DatabaseService.query('DELETE FROM users WHERE role = $1', ['admin']);

      const result = await MigrationService.validateMigration();

      expect(result.isValid).toBe(false);
      expect(result.adminUserExists).toBe(false);
      expect(result.issues).toContain('No admin user found in the system');
    });

    it('should validate password reset tokens table exists', async () => {
      const result = await MigrationService.validateMigration();

      expect(result.isValid).toBe(true);
      // The table should exist and be accessible (no error thrown)
    });
  });

  describe('runCompleteMigration', () => {
    it('should run complete migration process successfully', async () => {
      const result = await MigrationService.runCompleteMigration();

      expect(result.success).toBe(true);
      expect(result.usersCreated).toBeGreaterThanOrEqual(0);
      expect(result.usersMigrated).toBeGreaterThanOrEqual(0);

      // Verify at least one admin user exists
      const adminCount = await DatabaseService.query(
        'SELECT COUNT(*) as count FROM users WHERE role = $1 AND is_active = true',
        ['admin']
      );
      expect(parseInt(adminCount.rows[0].count)).toBeGreaterThanOrEqual(1);
    });
  });

  describe('cleanupExpiredTokens', () => {
    beforeEach(async () => {
      // Create test user for tokens
      await DatabaseService.query(
        `INSERT INTO users (id, email, first_name, last_name, role, password_hash, is_active)
         VALUES ('55555555-5555-5555-5555-555555555555', 'token.test@example.com', 'Token', 'Test', 'agent', '$2a$12$hashedpassword', true)`
      );

      // Create expired and valid tokens
      await DatabaseService.query(
        `INSERT INTO password_reset_tokens (user_id, token, expires_at)
         VALUES 
         ('55555555-5555-5555-5555-555555555555', 'expired-token', NOW() - INTERVAL '2 hours'),
         ('55555555-5555-5555-5555-555555555555', 'valid-token', NOW() + INTERVAL '1 hour')`
      );
    });

    it('should cleanup expired tokens only', async () => {
      const deletedCount = await MigrationService.cleanupExpiredTokens();

      expect(deletedCount).toBe(1);

      // Verify only valid token remains
      const remainingTokens = await DatabaseService.query(
        'SELECT COUNT(*) as count FROM password_reset_tokens'
      );
      expect(parseInt(remainingTokens.rows[0].count)).toBe(1);

      // Verify the remaining token is the valid one
      const validToken = await DatabaseService.query(
        'SELECT token FROM password_reset_tokens WHERE expires_at > NOW()'
      );
      expect(validToken.rows[0].token).toBe('valid-token');
    });
  });
});