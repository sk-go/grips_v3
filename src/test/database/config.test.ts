import { DatabaseConfigManager } from '../../services/database/config';

describe('DatabaseConfigManager', () => {
  beforeEach(() => {
    // Reset configuration before each test
    DatabaseConfigManager.resetConfig();
    
    // Clear environment variables
    delete process.env.DATABASE_TYPE;
    delete process.env.NODE_ENV;
    delete process.env.SQLITE_FILENAME;
    delete process.env.SQLITE_WAL;
    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    delete process.env.DB_NAME;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_SSL;
  });

  afterEach(() => {
    DatabaseConfigManager.resetConfig();
  });

  describe('determineDatabaseType', () => {
    it('should use explicit DATABASE_TYPE when set', () => {
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.NODE_ENV = 'development';
      
      const config = DatabaseConfigManager.getConfig();
      expect(config.type).toBe('postgresql');
    });

    it('should default to sqlite for development environment', () => {
      process.env.NODE_ENV = 'development';
      
      const config = DatabaseConfigManager.getConfig();
      expect(config.type).toBe('sqlite');
    });

    it('should default to postgresql for production environment', () => {
      process.env.NODE_ENV = 'production';
      
      const config = DatabaseConfigManager.getConfig();
      expect(config.type).toBe('postgresql');
    });

    it('should default to sqlite when NODE_ENV is not set', () => {
      const config = DatabaseConfigManager.getConfig();
      expect(config.type).toBe('sqlite');
    });
  });

  describe('SQLite configuration', () => {
    beforeEach(() => {
      process.env.DATABASE_TYPE = 'sqlite';
    });

    it('should use default SQLite filename in development', () => {
      process.env.NODE_ENV = 'development';
      const config = DatabaseConfigManager.getConfig();
      expect(config.sqlite?.filename).toBe('./data/development.db');
    });

    it('should use custom SQLite filename from environment', () => {
      process.env.SQLITE_FILENAME = './custom/path.db';
      
      const config = DatabaseConfigManager.getConfig();
      expect(config.sqlite?.filename).toBe('./custom/path.db');
    });

    it('should handle WAL mode configuration', () => {
      process.env.SQLITE_WAL = 'true';
      
      const config = DatabaseConfigManager.getConfig();
      expect(config.sqlite?.enableWAL).toBe(true);
    });
  });

  describe('PostgreSQL configuration', () => {
    beforeEach(() => {
      process.env.DATABASE_TYPE = 'postgresql';
    });

    it('should use empty defaults for PostgreSQL configuration', () => {
      const config = DatabaseConfigManager.getConfig();
      expect(config.postgresql?.host).toBe('');
      expect(config.postgresql?.port).toBe(5432);
      expect(config.postgresql?.database).toBe('');
    });

    it('should use custom PostgreSQL configuration from environment', () => {
      process.env.DB_HOST = 'custom-host';
      process.env.DB_PORT = '5433';
      process.env.DB_NAME = 'custom_db';
      
      const config = DatabaseConfigManager.getConfig();
      expect(config.postgresql?.host).toBe('custom-host');
      expect(config.postgresql?.port).toBe(5433);
      expect(config.postgresql?.database).toBe('custom_db');
    });
  });

  describe('validation', () => {
    it('should throw error for invalid database type', () => {
      process.env.DATABASE_TYPE = 'invalid' as any;
      
      expect(() => {
        DatabaseConfigManager.getConfig();
      }).toThrow('Unsupported database type: invalid');
    });

    it('should detect missing PostgreSQL configuration', () => {
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.DB_HOST = '   '; // whitespace only
      process.env.DB_NAME = '   ';
      process.env.DB_USER = '   ';
      
      const validation = DatabaseConfigManager.validateEnvironmentSetup();
      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it('should validate SQLite filename requirements', () => {
      process.env.DATABASE_TYPE = 'sqlite';
      process.env.SQLITE_FILENAME = '';
      
      const validation = DatabaseConfigManager.validateEnvironmentSetup();
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('SQLite filename is required but not provided.');
    });

    it('should handle missing environment variables gracefully', () => {
      // Clear all database-related env vars
      delete process.env.DATABASE_TYPE;
      delete process.env.NODE_ENV;
      
      const config = DatabaseConfigManager.getConfig();
      expect(config.type).toBe('sqlite'); // Should default to SQLite
    });

    it('should handle invalid PostgreSQL port numbers', () => {
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.DB_HOST = 'localhost';
      process.env.DB_NAME = 'test';
      process.env.DB_USER = 'test';
      process.env.DB_PASSWORD = 'test';
      process.env.DB_PORT = 'invalid';
      
      const config = DatabaseConfigManager.getConfig();
      expect(config.postgresql?.port).toBeNaN(); // parseInt('invalid') returns NaN
    });

    it('should validate boolean environment variables', () => {
      process.env.DATABASE_TYPE = 'sqlite';
      process.env.SQLITE_WAL = 'invalid';
      
      const config = DatabaseConfigManager.getConfig();
      expect(config.sqlite?.enableWAL).toBe(false); // Should default to false for invalid values
    });
  });

  describe('setup instructions', () => {
    it('should provide SQLite setup instructions', () => {
      process.env.DATABASE_TYPE = 'sqlite';
      
      const instructions = DatabaseConfigManager.getSetupInstructions();
      expect(instructions).toContain('SQLite Configuration');
      expect(instructions).toContain('DATABASE_TYPE=postgresql');
    });

    it('should provide PostgreSQL setup instructions', () => {
      process.env.DATABASE_TYPE = 'postgresql';
      
      const instructions = DatabaseConfigManager.getSetupInstructions();
      expect(instructions).toContain('PostgreSQL Configuration');
      expect(instructions).toContain('DATABASE_TYPE=sqlite');
    });

    it('should include troubleshooting information', () => {
      process.env.DATABASE_TYPE = 'postgresql';
      
      const instructions = DatabaseConfigManager.getSetupInstructions();
      expect(instructions).toContain('Common Issues');
      expect(instructions).toContain('Authentication failed');
    });

    it('should provide environment-specific guidance', () => {
      process.env.NODE_ENV = 'development';
      process.env.DATABASE_TYPE = 'sqlite';
      
      const instructions = DatabaseConfigManager.getSetupInstructions();
      expect(instructions).toContain('development');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle concurrent configuration access', () => {
      process.env.DATABASE_TYPE = 'sqlite';
      
      // Simulate concurrent access
      const configs = Array.from({ length: 10 }, () => 
        DatabaseConfigManager.getConfig()
      );
      
      configs.forEach(config => {
        expect(config.type).toBe('sqlite');
      });
    });

    it('should handle configuration reset properly', () => {
      process.env.DATABASE_TYPE = 'sqlite';
      
      const config1 = DatabaseConfigManager.getConfig();
      expect(config1.type).toBe('sqlite');
      
      DatabaseConfigManager.resetConfig();
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.DB_HOST = 'localhost';
      process.env.DB_NAME = 'test';
      process.env.DB_USER = 'test';
      process.env.DB_PASSWORD = 'test';
      
      const config2 = DatabaseConfigManager.getConfig();
      expect(config2.type).toBe('postgresql');
    });

    it('should handle malformed environment variables', () => {
      process.env.DATABASE_TYPE = 'sqlite';
      process.env.SQLITE_FILENAME = '   ./test.db   '; // with whitespace
      
      const config = DatabaseConfigManager.getConfig();
      expect(config.sqlite?.filename).toBe('   ./test.db   '); // Current implementation doesn't trim
    });

    it('should provide detailed error messages for configuration issues', () => {
      process.env.DATABASE_TYPE = 'postgresql';
      delete process.env.DB_HOST;
      delete process.env.DB_NAME;
      delete process.env.DB_USER;
      delete process.env.DB_PASSWORD;
      delete process.env.SUPABASE_DB_URL;
      
      const validation = DatabaseConfigManager.validateEnvironmentSetup();
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(error => error.includes('DB_HOST'))).toBe(true);
      expect(validation.errors.some(error => error.includes('DB_NAME'))).toBe(true);
    });

    it('should handle special characters in configuration values', () => {
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.DB_HOST = 'localhost';
      process.env.DB_NAME = 'test-db_name.123';
      process.env.DB_USER = 'user@domain.com';
      process.env.DB_PASSWORD = 'p@ssw0rd!#$%';
      
      const config = DatabaseConfigManager.getConfig();
      expect(config.postgresql?.database).toBe('test-db_name.123');
      expect(config.postgresql?.user).toBe('user@domain.com');
      expect(config.postgresql?.password).toBe('p@ssw0rd!#$%');
    });

    it('should handle very long configuration values', () => {
      const longValue = 'a'.repeat(1000);
      
      process.env.DATABASE_TYPE = 'sqlite';
      process.env.SQLITE_FILENAME = longValue;
      
      const config = DatabaseConfigManager.getConfig();
      expect(config.sqlite?.filename).toBe(longValue);
    });
  });
});