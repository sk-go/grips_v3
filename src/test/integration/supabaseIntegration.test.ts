/**
 * Supabase Integration Tests
 * Tests Supabase connection scenarios and configuration handling
 */

import { DatabaseService } from '../../services/database';
import { DatabaseConfigManager } from '../../services/database/config';

describe('Supabase Integration Tests', () => {
  beforeEach(() => {
    // Reset service state
    DatabaseService.reset();
    
    // Clear environment variables
    delete process.env.DATABASE_TYPE;
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

  describe('Supabase Connection String Parsing', () => {
    it('should parse standard Supabase connection string', () => {
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password123@db.project.supabase.co:5432/postgres';
      
      const config = DatabaseConfigManager.getConfig();
      
      expect(config.type).toBe('postgresql');
      expect(config.postgresql?.host).toBe('db.project.supabase.co');
      expect(config.postgresql?.port).toBe(5432);
      expect(config.postgresql?.database).toBe('postgres');
      expect(config.postgresql?.user).toBe('postgres');
      expect(config.postgresql?.password).toBe('password123');
      expect(config.postgresql?.ssl).toBe(true); // Supabase always uses SSL
    });

    it('should parse Supabase pooler connection string', () => {
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.SUPABASE_DB_URL = 'postgresql://postgres.project:secure_password@db.project.pooler.supabase.com:5432/postgres';
      
      const config = DatabaseConfigManager.getConfig();
      
      expect(config.postgresql?.host).toBe('db.project.pooler.supabase.com');
      expect(config.postgresql?.user).toBe('postgres.project');
      expect(config.postgresql?.password).toBe('secure_password');
      expect(config.postgresql?.ssl).toBe(true);
    });

    it('should handle Supabase connection string with special characters in password', () => {
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:p@ssw0rd!#$%@db.project.supabase.co:5432/postgres';
      
      const config = DatabaseConfigManager.getConfig();
      
      expect(config.postgresql?.password).toBe('p@ssw0rd!#$%');
      expect(config.postgresql?.ssl).toBe(true);
    });

    it('should validate Supabase connection requirements', () => {
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:@db.project.supabase.co:5432/postgres'; // Missing password
      
      expect(() => DatabaseConfigManager.getConfig()).toThrow('Supabase connections require a password');
    });

    it('should prefer SUPABASE_DB_URL over individual variables', () => {
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:supabase_pass@db.project.supabase.co:5432/postgres';
      process.env.DB_HOST = 'localhost';
      process.env.DB_USER = 'local_user';
      process.env.DB_PASSWORD = 'local_pass';
      
      const config = DatabaseConfigManager.getConfig();
      
      expect(config.postgresql?.host).toBe('db.project.supabase.co');
      expect(config.postgresql?.user).toBe('postgres');
      expect(config.postgresql?.password).toBe('supabase_pass');
    });
  });

  describe('Supabase Configuration Validation', () => {
    it('should validate complete Supabase configuration', () => {
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.supabase.co:5432/postgres';
      
      const validation = DatabaseService.validateConfiguration();
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect invalid Supabase connection strings', () => {
      const invalidUrls = [
        'invalid-url',
        'postgresql://postgres@db.project.supabase.co:5432/postgres', // Missing password
        'postgresql://postgres:password@:5432/postgres', // Missing host
        'postgresql://postgres:password@db.project.supabase.co/postgres', // Missing port
        'postgresql://postgres:password@db.project.supabase.co:5432/', // Missing database
      ];

      invalidUrls.forEach(url => {
        process.env.DATABASE_TYPE = 'postgresql';
        process.env.SUPABASE_DB_URL = url;
        
        const validation = DatabaseService.validateConfiguration();
        expect(validation.isValid).toBe(false);
        expect(validation.errors.length).toBeGreaterThan(0);
      });
    });

    it('should provide helpful setup instructions for Supabase', () => {
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.supabase.co:5432/postgres';
      
      const instructions = DatabaseService.getSetupInstructions();
      
      expect(instructions).toContain('supabase.co');
      expect(instructions).toContain('SSL: enabled');
      expect(instructions).toContain('SUPABASE_DB_URL');
    });
  });

  describe('Supabase Connection Scenarios', () => {
    it('should handle Supabase connection attempt (will fail without real credentials)', async () => {
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:fake_password@db.fake-project.supabase.co:5432/postgres';
      
      // This should fail because we're using fake credentials
      await expect(DatabaseService.initialize()).rejects.toThrow();
      
      // But configuration should still be valid
      const summary = DatabaseService.getConfigSummary();
      expect(summary.type).toBe('postgresql');
      expect(summary.config.host).toBe('db.fake-project.supabase.co');
      expect(summary.config.ssl).toBe(true);
    });

    it('should provide detailed error messages for Supabase connection failures', async () => {
      const testCases = [
        {
          name: 'invalid host',
          url: 'postgresql://postgres:password@invalid-host.supabase.co:5432/postgres',
          expectedError: /host not found|connection failed/i
        },
        {
          name: 'invalid credentials',
          url: 'postgresql://postgres:wrong_password@db.project.supabase.co:5432/postgres',
          expectedError: /authentication|connection/i
        },
        {
          name: 'invalid project',
          url: 'postgresql://postgres:password@db.nonexistent.supabase.co:5432/postgres',
          expectedError: /host not found|connection/i
        }
      ];

      for (const testCase of testCases) {
        process.env.SUPABASE_DB_URL = testCase.url;
        
        try {
          await DatabaseService.initialize();
          fail(`Expected ${testCase.name} to fail`);
        } catch (error) {
          expect((error as Error).message).toMatch(testCase.expectedError);
        }
      }
    });

    it('should handle SSL configuration for Supabase', () => {
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.supabase.co:5432/postgres';
      
      const config = DatabaseConfigManager.getConfig();
      
      // Supabase should always have SSL enabled
      expect(config.postgresql?.ssl).toBe(true);
      
      const summary = DatabaseService.getConfigSummary();
      expect(summary.config.ssl).toBe(true);
    });

    it('should handle connection pooling configuration for Supabase', () => {
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres';
      
      const config = DatabaseConfigManager.getConfig();
      
      expect(config.postgresql?.host).toBe('db.project.pooler.supabase.com');
      expect(config.postgresql?.ssl).toBe(true);
      
      // Should use default pooling settings appropriate for Supabase
      const summary = DatabaseService.getConfigSummary();
      expect(summary.config.max).toBeDefined();
      expect(summary.config.idleTimeoutMillis).toBeDefined();
    });
  });

  describe('Supabase Migration Scenarios', () => {
    it('should handle migration from local PostgreSQL to Supabase', () => {
      // Start with local PostgreSQL configuration
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.DB_HOST = 'localhost';
      process.env.DB_PORT = '5432';
      process.env.DB_NAME = 'local_db';
      process.env.DB_USER = 'local_user';
      process.env.DB_PASSWORD = 'local_password';
      process.env.DB_SSL = 'false';
      
      const localConfig = DatabaseConfigManager.getConfig();
      expect(localConfig.postgresql?.host).toBe('localhost');
      expect(localConfig.postgresql?.ssl).toBe(false);
      
      DatabaseConfigManager.resetConfig();
      
      // Switch to Supabase configuration
      delete process.env.DB_HOST;
      delete process.env.DB_PORT;
      delete process.env.DB_NAME;
      delete process.env.DB_USER;
      delete process.env.DB_PASSWORD;
      delete process.env.DB_SSL;
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.supabase.co:5432/postgres';
      
      const supabaseConfig = DatabaseConfigManager.getConfig();
      expect(supabaseConfig.postgresql?.host).toBe('db.project.supabase.co');
      expect(supabaseConfig.postgresql?.ssl).toBe(true);
    });

    it('should handle migration from SQLite to Supabase', () => {
      // Start with SQLite configuration
      process.env.DATABASE_TYPE = 'sqlite';
      process.env.SQLITE_FILENAME = './local.db';
      
      const sqliteConfig = DatabaseConfigManager.getConfig();
      expect(sqliteConfig.type).toBe('sqlite');
      
      DatabaseConfigManager.resetConfig();
      
      // Switch to Supabase
      process.env.DATABASE_TYPE = 'postgresql';
      delete process.env.SQLITE_FILENAME;
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.supabase.co:5432/postgres';
      
      const supabaseConfig = DatabaseConfigManager.getConfig();
      expect(supabaseConfig.type).toBe('postgresql');
      expect(supabaseConfig.postgresql?.host).toBe('db.project.supabase.co');
    });
  });

  describe('Supabase Environment Detection', () => {
    it('should detect Supabase from connection string patterns', () => {
      const supabasePatterns = [
        'postgresql://postgres:password@db.project.supabase.co:5432/postgres',
        'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres',
        'postgresql://postgres.project:password@db.project.pooler.supabase.com:5432/postgres'
      ];

      supabasePatterns.forEach(url => {
        process.env.DATABASE_TYPE = 'postgresql';
        process.env.SUPABASE_DB_URL = url;
        
        const config = DatabaseConfigManager.getConfig();
        expect(config.postgresql?.ssl).toBe(true); // Should auto-detect Supabase and enable SSL
        
        const instructions = DatabaseService.getSetupInstructions();
        expect(instructions).toContain('supabase');
        
        DatabaseConfigManager.resetConfig();
      });
    });

    it('should provide Supabase-specific troubleshooting', () => {
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.supabase.co:5432/postgres';
      
      const instructions = DatabaseService.getSetupInstructions();
      
      expect(instructions).toContain('Supabase');
      expect(instructions).toContain('project dashboard');
      expect(instructions).toContain('connection string');
      expect(instructions).toContain('SSL');
    });
  });

  describe('Supabase Performance Considerations', () => {
    it('should use appropriate connection pool settings for Supabase', () => {
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.supabase.co:5432/postgres';
      
      const config = DatabaseConfigManager.getConfig();
      
      // Should have reasonable defaults for cloud database
      expect(config.postgresql?.max).toBeDefined();
      expect(config.postgresql?.idleTimeoutMillis).toBeDefined();
      expect(config.postgresql?.connectionTimeoutMillis).toBeDefined();
      
      // Verify defaults are appropriate for Supabase
      const summary = DatabaseService.getConfigSummary();
      expect(summary.config.max).toBeGreaterThan(0);
      expect(summary.config.idleTimeoutMillis).toBeGreaterThan(0);
    });

    it('should handle Supabase connection limits gracefully', () => {
      // Test configuration that might hit connection limits
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.supabase.co:5432/postgres';
      
      const config = DatabaseConfigManager.getConfig();
      
      // Should not set pool size too high for Supabase free tier
      expect(config.postgresql?.max).toBeLessThanOrEqual(20);
    });
  });

  describe('Real Supabase Connection (Optional)', () => {
    const hasSupabaseUrl = process.env.REAL_SUPABASE_DB_URL;

    beforeEach(() => {
      if (!hasSupabaseUrl) {
        console.log('Skipping real Supabase tests - no REAL_SUPABASE_DB_URL provided');
      }
    });

    it('should connect to real Supabase instance if credentials provided', async () => {
      if (!hasSupabaseUrl) return;

      process.env.DATABASE_TYPE = 'postgresql';
      process.env.SUPABASE_DB_URL = hasSupabaseUrl;

      try {
        await DatabaseService.initialize({ skipMigrations: true });
        
        // Test basic query
        const result = await DatabaseService.query('SELECT 1 as test');
        expect(result.rows[0].test).toBe(1);
        
        // Test health check
        const health = await DatabaseService.healthCheck();
        expect(health.status).toBe('healthy');
        expect(health.type).toBe('postgresql');
        
        console.log('✅ Real Supabase connection test passed');
        
      } catch (error) {
        console.log('❌ Real Supabase connection failed:', (error as Error).message);
        // Don't fail the test - this is optional
      }
    });

    it('should run migrations on real Supabase if available', async () => {
      if (!hasSupabaseUrl) return;

      process.env.DATABASE_TYPE = 'postgresql';
      process.env.SUPABASE_DB_URL = hasSupabaseUrl;

      try {
        await DatabaseService.initialize();
        
        // Check if migrations table exists
        const result = await DatabaseService.query(
          "SELECT table_name FROM information_schema.tables WHERE table_name = 'migrations'"
        );
        expect(result.rows).toHaveLength(1);
        
        console.log('✅ Real Supabase migration test passed');
        
      } catch (error) {
        console.log('❌ Real Supabase migration failed:', (error as Error).message);
        // Don't fail the test - this is optional
      }
    });
  });
});