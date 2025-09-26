import { DatabaseService } from '../../services/database/DatabaseService';
import { DatabaseConfigManager } from '../../services/database/config';

describe('DatabaseService Integration - Supabase Only', () => {
  beforeEach(() => {
    // Reset service state
    DatabaseService.reset();
    
    // Clear environment variables
    delete process.env.SUPABASE_DB_URL;
    delete process.env.DATABASE_URL;
    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    delete process.env.DB_NAME;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_SSL;
  });

  afterEach(async () => {
    try {
      await DatabaseService.close();
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Supabase Configuration', () => {
    beforeEach(() => {
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres';
    });

    afterEach(() => {
      delete process.env.SUPABASE_DB_URL;
    });

    it('should initialize with PostgreSQL adapter for Supabase', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }

      await DatabaseService.initialize({ skipMigrations: true });

      expect(DatabaseService.getDatabaseType()).toBe('postgresql');

      // Test basic query
      const result = await DatabaseService.query('SELECT 1 as test');
      expect(result.rows[0].test).toBe(1);
    });

    it('should provide configuration summary', () => {
      const summary = DatabaseService.getConfigSummary();
      expect(summary).toHaveProperty('type', 'postgresql');
      expect(summary).toHaveProperty('config');
      expect((summary as any).config.ssl).toBe(true); // Supabase always uses SSL
    });

    it('should validate Supabase configuration', async () => {
      const validation = DatabaseService.validateConfiguration();

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should provide Supabase setup instructions', () => {
      const instructions = DatabaseService.getSetupInstructions();

      expect(instructions).toContain('PostgreSQL');
      expect(instructions).toContain('Supabase');
      expect(instructions).toContain('SUPABASE_DB_URL');
    });

    it('should perform health check', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }

      await DatabaseService.initialize({ skipMigrations: true });

      const health = await DatabaseService.healthCheck();

      expect(health.status).toBe('healthy');
      expect(health.type).toBe('postgresql');
      expect(health.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('Configuration Validation', () => {
    it('should detect invalid PostgreSQL configuration', () => {
      process.env.DB_HOST = '';
      delete process.env.DB_NAME;
      delete process.env.DB_USER;
      delete process.env.DB_PASSWORD;
      delete process.env.SUPABASE_DB_URL;
      delete process.env.DATABASE_URL;

      const validation = DatabaseService.validateConfiguration();

      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);

      delete process.env.DB_HOST;
    });

    it('should provide helpful error messages for missing configuration', async () => {
      delete process.env.DB_HOST;
      delete process.env.DB_NAME;
      delete process.env.DB_USER;
      delete process.env.DB_PASSWORD;
      delete process.env.SUPABASE_DB_URL;
      delete process.env.DATABASE_URL;

      try {
        await DatabaseService.initialize();
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Database configuration invalid');
      }
    });

    it('should validate Supabase connection string format', () => {
      process.env.SUPABASE_DB_URL = 'invalid-connection-string';

      const validation = DatabaseService.validateConfiguration();

      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(error => error.includes('Invalid'))).toBe(true);

      delete process.env.SUPABASE_DB_URL;
    });
  });

  describe('PostgreSQL-only Configuration', () => {
    it('should use PostgreSQL in all environments', () => {
      process.env.NODE_ENV = 'development';
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres';

      const config = DatabaseConfigManager.getConfig();
      expect(config.type).toBe('postgresql');

      delete process.env.NODE_ENV;
      delete process.env.SUPABASE_DB_URL;
    });

    it('should use PostgreSQL in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres';

      const config = DatabaseConfigManager.getConfig();
      expect(config.type).toBe('postgresql');

      delete process.env.NODE_ENV;
      delete process.env.SUPABASE_DB_URL;
    });

    it('should handle individual PostgreSQL environment variables', () => {
      process.env.DB_HOST = 'localhost';
      process.env.DB_NAME = 'test';
      process.env.DB_USER = 'test';
      process.env.DB_PASSWORD = 'test';

      const config = DatabaseConfigManager.getConfig();
      expect(config.type).toBe('postgresql');

      delete process.env.DB_HOST;
      delete process.env.DB_NAME;
      delete process.env.DB_USER;
      delete process.env.DB_PASSWORD;
    });
  });

  describe('API Compatibility', () => {
    beforeEach(() => {
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres';
    });

    afterEach(() => {
      delete process.env.SUPABASE_DB_URL;
    });

    it('should maintain the same API interface', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }

      await DatabaseService.initialize({ skipMigrations: true });

      // Test that all methods exist and work
      expect(typeof DatabaseService.query).toBe('function');
      expect(typeof DatabaseService.getClient).toBe('function');
      expect(typeof DatabaseService.close).toBe('function');
      expect(typeof DatabaseService.initialize).toBe('function');

      // Test basic query functionality
      const result = await DatabaseService.query('SELECT 1 as test');
      expect(result.rows[0].test).toBe(1);

      // Test client acquisition
      const client = await DatabaseService.getClient();
      expect(client).toBeDefined();

      if ('release' in client && typeof client.release === 'function') {
        client.release();
      }
    });

    it('should handle PostgreSQL native features', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }

      await DatabaseService.initialize({ skipMigrations: true });

      // Test PostgreSQL-specific query
      const result = await DatabaseService.query('SELECT NOW() as current_time, version() as pg_version');
      expect(result.rows[0].current_time).toBeDefined();
      expect(result.rows[0].pg_version).toContain('PostgreSQL');
    });
  });
});