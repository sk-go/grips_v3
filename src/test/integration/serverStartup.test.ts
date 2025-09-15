/**
 * Server startup integration test
 */

import { DatabaseService } from '../../services/database';

describe('Server Startup Integration', () => {
  beforeEach(() => {
    // Reset service state before each test
    DatabaseService.reset();
  });

  afterEach(async () => {
    // Clean up after each test
    try {
      await DatabaseService.close();
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('SQLite Development Setup', () => {
    beforeEach(() => {
      // Set environment for SQLite development
      process.env.NODE_ENV = 'development';
      process.env.DATABASE_TYPE = 'sqlite';
      process.env.SQLITE_FILENAME = './data/test.db';
    });

    it('should initialize database service successfully', async () => {
      await expect(DatabaseService.initialize({ skipMigrations: true })).resolves.not.toThrow();
      
      // Verify database type detection
      expect(DatabaseService.getDatabaseType()).toBe('sqlite');
      
      // Verify health check
      const health = await DatabaseService.healthCheck();
      expect(health.status).toBe('healthy');
      expect(health.type).toBe('sqlite');
    });

    it('should provide correct configuration summary', () => {
      const summary = DatabaseService.getConfigSummary();
      expect(summary).toMatchObject({
        type: 'sqlite',
        environment: 'development'
      });
    });
  });

  describe('PostgreSQL Production Setup', () => {
    beforeEach(() => {
      // Set environment for PostgreSQL production
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.DB_HOST = 'localhost';
      process.env.DB_PORT = '5432';
      process.env.DB_NAME = 'test_db';
      process.env.DB_USER = 'test_user';
      process.env.DB_PASSWORD = 'test_password';
    });

    it('should validate PostgreSQL configuration', () => {
      const validation = DatabaseService.validateConfiguration();
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should provide correct configuration summary', () => {
      const summary = DatabaseService.getConfigSummary();
      expect(summary).toMatchObject({
        type: 'postgresql',
        environment: 'production'
      });
    });
  });

  describe('Environment-based Configuration', () => {
    it('should default to SQLite in development', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.DATABASE_TYPE;
      
      const summary = DatabaseService.getConfigSummary();
      expect(summary).toMatchObject({
        type: 'sqlite',
        environment: 'development'
      });
    });

    it('should default to PostgreSQL in production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.DATABASE_TYPE;
      // Set required PostgreSQL env vars
      process.env.DB_HOST = 'localhost';
      process.env.DB_NAME = 'test_db';
      process.env.DB_USER = 'test_user';
      process.env.DB_PASSWORD = 'test_password';
      
      const summary = DatabaseService.getConfigSummary();
      expect(summary).toMatchObject({
        type: 'postgresql',
        environment: 'production'
      });
    });
  });
});