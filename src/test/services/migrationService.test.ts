import { MigrationService } from '../../services/migrationService';
import type { MigrationResult, ValidationResult, CreateUserData } from '../../services/migrationService';
import { DatabaseService } from '../../services/database';
import bcrypt from 'bcryptjs';

// Mock dependencies
jest.mock('../../services/database');
jest.mock('bcryptjs');
jest.mock('../../utils/logger');

const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;
const mockBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

// Helper function to create mock query result
const mockQueryResult = (rows: any[] = [], rowCount: number = rows.length) => ({
  rows,
  rowCount,
  command: 'SELECT',
  oid: 0,
  fields: []
});

describe('MigrationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBcrypt.hash.mockResolvedValue('hashed_password');
  });

  describe('createDefaultAdminUser', () => {
    it('should create default admin user when none exists', async () => {
      // Mock no existing admin
      mockDatabaseService.query
        .mockResolvedValueOnce(mockQueryResult([])) // No admin exists
        .mockResolvedValueOnce(mockQueryResult([])) // Email not taken
        .mockResolvedValueOnce(mockQueryResult([{ id: 'new-user-id' }])); // Insert successful

      const result = await MigrationService.createDefaultAdminUser();

      expect(result.success).toBe(true);
      expect(result.usersCreated).toBe(1);
      expect(result.message).toContain('Default admin user created');
      expect(mockDatabaseService.query).toHaveBeenCalledTimes(3);
    });

    it('should skip creation when admin already exists', async () => {
      // Mock existing admin
      mockDatabaseService.query.mockResolvedValueOnce(
        mockQueryResult([{ id: 'existing-admin-id' }])
      );

      const result = await MigrationService.createDefaultAdminUser();

      expect(result.success).toBe(true);
      expect(result.usersCreated).toBe(0);
      expect(result.message).toContain('Admin user already exists');
      expect(mockDatabaseService.query).toHaveBeenCalledTimes(1);
    });

    it('should fail when default email is already taken', async () => {
      mockDatabaseService.query
        .mockResolvedValueOnce(mockQueryResult([])) // No admin exists
        .mockResolvedValueOnce(mockQueryResult([{ id: 'existing-user' }])); // Email taken

      const result = await MigrationService.createDefaultAdminUser();

      expect(result.success).toBe(false);
      expect(result.usersCreated).toBe(0);
      expect(result.errors).toContain('Email admin@localhost is already taken');
    });

    it('should handle database errors gracefully', async () => {
      mockDatabaseService.query.mockRejectedValueOnce(new Error('Database error'));

      const result = await MigrationService.createDefaultAdminUser();

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Failed to create default admin user: Database error');
    });
  });

  describe('createAdminUser', () => {
    const validUserData: CreateUserData = {
      email: 'test@example.com',
      password: 'password123',
      firstName: 'Test',
      lastName: 'User',
      role: 'admin'
    };

    it('should create admin user with valid data', async () => {
      mockDatabaseService.query
        .mockResolvedValueOnce(mockQueryResult([])) // Email not taken
        .mockResolvedValueOnce(mockQueryResult([{ id: 'new-user-id' }])); // Insert successful

      const result = await MigrationService.createAdminUser(validUserData);

      expect(result.success).toBe(true);
      expect(result.usersCreated).toBe(1);
      expect(result.message).toContain('User created successfully');
    });

    it('should validate email format', async () => {
      const invalidUserData = { ...validUserData, email: 'invalid-email' };

      const result = await MigrationService.createAdminUser(invalidUserData);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Invalid email format');
    });

    it('should validate password length', async () => {
      const invalidUserData = { ...validUserData, password: '123' };

      const result = await MigrationService.createAdminUser(invalidUserData);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters long');
    });

    it('should fail when email already exists', async () => {
      mockDatabaseService.query.mockResolvedValueOnce(
        mockQueryResult([{ id: 'existing-user' }])
      );

      const result = await MigrationService.createAdminUser(validUserData);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Email test@example.com is already taken');
    });
  });

  describe('migrateFromKeycloak', () => {
    it('should return success message indicating Keycloak is no longer supported', async () => {
      const result = await MigrationService.migrateFromKeycloak();

      expect(result.success).toBe(true);
      expect(result.usersMigrated).toBe(0);
      expect(result.message).toContain('Keycloak migration is no longer supported');
    });




  });

  describe('validateMigration', () => {
    it('should validate successful migration', async () => {
      mockDatabaseService.query
        .mockResolvedValueOnce(mockQueryResult([{ count: '5' }])) // Total users
        .mockResolvedValueOnce(mockQueryResult([{ count: '1' }])) // Admin users
        .mockResolvedValueOnce(mockQueryResult([{ count: '5' }])) // Users with passwords
        .mockResolvedValueOnce(mockQueryResult([{ count: '2' }])) // Users with Keycloak
        .mockResolvedValueOnce(mockQueryResult([{ count: '0' }])) // Users without auth
        .mockResolvedValueOnce(mockQueryResult([])); // Password reset table check

      const result = await MigrationService.validateMigration();

      expect(result.isValid).toBe(true);
      expect(result.adminUserExists).toBe(true);
      expect(result.totalUsers).toBe(5);
      expect(result.usersWithPasswords).toBe(5);
      expect(result.usersWithKeycloakId).toBe(2);
      expect(result.issues).toHaveLength(0);
    });

    it('should detect missing admin user', async () => {
      mockDatabaseService.query
        .mockResolvedValueOnce(mockQueryResult([{ count: '5' }])) // Total users
        .mockResolvedValueOnce(mockQueryResult([{ count: '0' }])) // No admin users
        .mockResolvedValueOnce(mockQueryResult([{ count: '5' }])) // Users with passwords
        .mockResolvedValueOnce(mockQueryResult([{ count: '2' }])) // Users with Keycloak
        .mockResolvedValueOnce(mockQueryResult([{ count: '0' }])) // Users without auth
        .mockResolvedValueOnce(mockQueryResult([])); // Password reset table check

      const result = await MigrationService.validateMigration();

      expect(result.isValid).toBe(false);
      expect(result.adminUserExists).toBe(false);
      expect(result.issues).toContain('No admin user found in the system');
    });

    it('should detect users without authentication method', async () => {
      mockDatabaseService.query
        .mockResolvedValueOnce(mockQueryResult([{ count: '5' }])) // Total users
        .mockResolvedValueOnce(mockQueryResult([{ count: '1' }])) // Admin users
        .mockResolvedValueOnce(mockQueryResult([{ count: '3' }])) // Users with passwords
        .mockResolvedValueOnce(mockQueryResult([{ count: '2' }])) // Users with Keycloak
        .mockResolvedValueOnce(mockQueryResult([{ count: '2' }])) // Users without auth
        .mockResolvedValueOnce(mockQueryResult([])); // Password reset table check

      const result = await MigrationService.validateMigration();

      expect(result.isValid).toBe(false);
      expect(result.issues).toContain('2 users have no authentication method (no Keycloak ID or password)');
    });

    it('should detect missing password reset table', async () => {
      mockDatabaseService.query
        .mockResolvedValueOnce(mockQueryResult([{ count: '5' }])) // Total users
        .mockResolvedValueOnce(mockQueryResult([{ count: '1' }])) // Admin users
        .mockResolvedValueOnce(mockQueryResult([{ count: '5' }])) // Users with passwords
        .mockResolvedValueOnce(mockQueryResult([{ count: '2' }])) // Users with Keycloak
        .mockResolvedValueOnce(mockQueryResult([{ count: '0' }])) // Users without auth
        .mockRejectedValueOnce(new Error('Table does not exist')); // Password reset table missing

      const result = await MigrationService.validateMigration();

      expect(result.isValid).toBe(false);
      expect(result.issues).toContain('Password reset tokens table is missing or inaccessible');
    });
  });

  describe('runCompleteMigration', () => {
    it('should run complete migration successfully', async () => {
      // Mock successful admin creation
      mockDatabaseService.query
        .mockResolvedValueOnce(mockQueryResult([])) // No admin exists
        .mockResolvedValueOnce(mockQueryResult([])) // Email not taken
        .mockResolvedValueOnce(mockQueryResult([{ id: 'admin-id' }])) // Admin created
        // Mock no Keycloak users
        .mockResolvedValueOnce(mockQueryResult([])) // No Keycloak users
        // Mock successful validation
        .mockResolvedValueOnce(mockQueryResult([{ count: '1' }])) // Total users
        .mockResolvedValueOnce(mockQueryResult([{ count: '1' }])) // Admin users
        .mockResolvedValueOnce(mockQueryResult([{ count: '1' }])) // Users with passwords
        .mockResolvedValueOnce(mockQueryResult([{ count: '0' }])) // Users with Keycloak
        .mockResolvedValueOnce(mockQueryResult([{ count: '0' }])) // Users without auth
        .mockResolvedValueOnce(mockQueryResult([])); // Password reset table check

      const result = await MigrationService.runCompleteMigration();

      expect(result.success).toBe(true);
      expect(result.usersCreated).toBe(1);
      expect(result.usersMigrated).toBe(0);
      expect(result.message).toContain('Migration completed successfully');
    });

    it('should handle validation failures', async () => {
      // Mock successful operations but failed validation
      mockDatabaseService.query
        .mockResolvedValueOnce(mockQueryResult([{ id: 'admin' }])) // Admin exists
        .mockResolvedValueOnce(mockQueryResult([])) // No Keycloak users
        // Mock failed validation
        .mockResolvedValueOnce(mockQueryResult([{ count: '0' }])) // No total users
        .mockResolvedValueOnce(mockQueryResult([{ count: '0' }])) // No admin users
        .mockResolvedValueOnce(mockQueryResult([{ count: '0' }])) // No users with passwords
        .mockResolvedValueOnce(mockQueryResult([{ count: '0' }])) // No users with Keycloak
        .mockResolvedValueOnce(mockQueryResult([{ count: '0' }])) // No users without auth
        .mockResolvedValueOnce(mockQueryResult([])); // Password reset table check

      const result = await MigrationService.runCompleteMigration();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Migration completed but validation failed');
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('should cleanup expired tokens successfully', async () => {
      mockDatabaseService.query.mockResolvedValueOnce(
        mockQueryResult([{ cleanup_expired_password_reset_tokens: 5 }])
      );

      const result = await MigrationService.cleanupExpiredTokens();

      expect(result).toBe(5);
      expect(mockDatabaseService.query).toHaveBeenCalledWith('SELECT cleanup_expired_password_reset_tokens()');
    });

    it('should handle cleanup errors gracefully', async () => {
      mockDatabaseService.query.mockRejectedValueOnce(new Error('Cleanup failed'));

      const result = await MigrationService.cleanupExpiredTokens();

      expect(result).toBe(0);
    });
  });
});