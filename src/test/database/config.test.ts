import { DatabaseConfigManager } from '../../services/database/config';

describe('DatabaseConfigManager - Supabase Only', () => {
  beforeEach(() => {
    // Reset configuration before each test
    DatabaseConfigManager.resetConfig();
    
    // Clear environment variables
    delete process.env.NODE_ENV;
    delete process.env.SUPABASE_DB_URL;
    delete process.env.DATABASE_URL;
    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    delete process.env.DB_NAME;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_SSL;
    delete process.env.DB_POOL_MAX;
    delete process.env.DB_IDLE_TIMEOUT;
    delete process.env.DB_CONNECTION_TIMEOUT;
  });

  afterEach(() => {
    DatabaseConfigManager.resetConfig();
  });

  describe('Supabase connection string parsing', () => {
    it('should parse valid Supabase connection string', () => {
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres';
      
      const config = DatabaseConfigManager.getConfig();
      expect(config.type).toBe('postgresql');
      expect(config.postgresql?.host).toBe('db.project.pooler.supabase.com');
      expect(config.postgresql?.port).toBe(5432);
      expect(config.postgresql?.database).toBe('postgres');
      expect(config.postgresql?.user).toBe('postgres');
      expect(config.postgresql?.password).toBe('password');
      expect(config.postgresql?.ssl).toBe(true);
    });

    it('should use DATABASE_URL as fallback', () => {
      process.env.DATABASE_URL = 'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres';
      
      const config = DatabaseConfigManager.getConfig();
      expect(config.type).toBe('postgresql');
      expect(config.postgresql?.host).toBe('db.project.pooler.supabase.com');
    });

    it('should handle connection string with query parameters', () => {
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres?sslmode=require';
      
      const config = DatabaseConfigManager.getConfig();
      expect(config.postgresql?.ssl).toBe(true);
    });

    it('should throw error for invalid connection string', () => {
      process.env.SUPABASE_DB_URL = 'invalid-connection-string';
      
      expect(() => {
        DatabaseConfigManager.getConfig();
      }).toThrow('Invalid Supabase connection string');
    });
  });

  describe('PostgreSQL fallback configuration', () => {
    it('should use default PostgreSQL configuration when no connection string provided', () => {
      const config = DatabaseConfigManager.getConfig();
      expect(config.type).toBe('postgresql');
      expect(config.postgresql?.host).toBe('localhost');
      expect(config.postgresql?.port).toBe(5432);
      expect(config.postgresql?.database).toBe('relationship_care');
      expect(config.postgresql?.user).toBe('postgres');
      expect(config.postgresql?.ssl).toBe(true); // Default to true for Supabase compatibility
    });

    it('should use custom PostgreSQL configuration from environment variables', () => {
      process.env.DB_HOST = 'custom-host';
      process.env.DB_PORT = '5433';
      process.env.DB_NAME = 'custom_db';
      process.env.DB_USER = 'custom_user';
      process.env.DB_PASSWORD = 'custom_password';
      process.env.DB_SSL = 'false';
      
      const config = DatabaseConfigManager.getConfig();
      expect(config.postgresql?.host).toBe('custom-host');
      expect(config.postgresql?.port).toBe(5433);
      expect(config.postgresql?.database).toBe('custom_db');
      expect(config.postgresql?.user).toBe('custom_user');
      expect(config.postgresql?.password).toBe('custom_password');
      expect(config.postgresql?.ssl).toBe(false);
    });

    it('should handle pool configuration from environment', () => {
      process.env.DB_POOL_MAX = '50';
      process.env.DB_IDLE_TIMEOUT = '60000';
      process.env.DB_CONNECTION_TIMEOUT = '15000';
      
      const config = DatabaseConfigManager.getConfig();
      expect(config.postgresql?.max).toBe(50);
      expect(config.postgresql?.idleTimeoutMillis).toBe(60000);
      expect(config.postgresql?.connectionTimeoutMillis).toBe(15000);
    });
  });

  describe('validation', () => {
    it('should detect missing PostgreSQL configuration when using individual variables', () => {
      // Clear connection string variables to force individual variable validation
      delete process.env.SUPABASE_DB_URL;
      delete process.env.DATABASE_URL;
      process.env.DB_HOST = '   '; // whitespace only
      process.env.DB_NAME = '   ';
      process.env.DB_USER = '   ';
      process.env.DB_PASSWORD = '   ';
      
      const validation = DatabaseConfigManager.validateEnvironmentSetup();
      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors.some(error => error.includes('DB_HOST'))).toBe(true);
    });

    it('should validate Supabase-specific requirements', () => {
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:@db.project.pooler.supabase.com:5432/postgres'; // Empty password
      
      expect(() => {
        DatabaseConfigManager.getConfig();
      }).toThrow('Supabase connections require a password');
    });

    it('should handle invalid PostgreSQL port numbers', () => {
      process.env.DB_PORT = 'invalid';
      
      const config = DatabaseConfigManager.getConfig();
      expect(config.postgresql?.port).toBeNaN(); // parseInt('invalid') returns NaN
    });

    it('should validate port range', () => {
      process.env.DB_PORT = '99999'; // Invalid port
      
      expect(() => {
        DatabaseConfigManager.getConfig();
      }).toThrow('PostgreSQL port must be a valid integer between 1 and 65535');
    });

    it('should auto-enable SSL for Supabase connections', () => {
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres';
      process.env.DB_SSL = 'false'; // Try to disable SSL
      
      const config = DatabaseConfigManager.getConfig();
      expect(config.postgresql?.ssl).toBe(true); // Should be auto-corrected to true
    });

    it('should warn about non-Supabase connection strings', () => {
      // Mock the logger warn method instead of console.log
      const loggerWarnSpy = jest.spyOn(require('../../utils/logger').logger, 'warn').mockImplementation();
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@localhost:5432/postgres';
      
      DatabaseConfigManager.getConfig();
      
      // Should log a warning about non-Supabase URL
      expect(loggerWarnSpy).toHaveBeenCalledWith('Connection string does not appear to be from Supabase, but will attempt to parse');
      loggerWarnSpy.mockRestore();
    });
  });

  describe('setup instructions', () => {
    it('should provide PostgreSQL setup instructions', () => {
      const instructions = DatabaseConfigManager.getSetupInstructions();
      expect(instructions).toContain('PostgreSQL Configuration');
      expect(instructions).toContain('Common Issues');
    });

    it('should provide Supabase-specific instructions when using Supabase', () => {
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres';
      
      const instructions = DatabaseConfigManager.getSetupInstructions();
      expect(instructions).toContain('Supabase Setup');
      expect(instructions).toContain('project dashboard');
    });

    it('should include troubleshooting information', () => {
      const instructions = DatabaseConfigManager.getSetupInstructions();
      expect(instructions).toContain('Common Issues');
      expect(instructions).toContain('Authentication failed');
      expect(instructions).toContain('Connection timeout');
    });

    it('should provide environment-specific guidance', () => {
      process.env.NODE_ENV = 'development';
      
      const instructions = DatabaseConfigManager.getSetupInstructions();
      expect(instructions).toContain('development');
    });

    it('should handle configuration errors gracefully in setup instructions', () => {
      // Force an error by providing invalid connection string
      process.env.SUPABASE_DB_URL = 'invalid';
      
      const instructions = DatabaseConfigManager.getSetupInstructions();
      expect(instructions).toContain('Database Configuration Error');
      expect(instructions).toContain('Supabase Setup Instructions');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle concurrent configuration access', () => {
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres';
      
      // Simulate concurrent access
      const configs = Array.from({ length: 10 }, () => 
        DatabaseConfigManager.getConfig()
      );
      
      configs.forEach(config => {
        expect(config.type).toBe('postgresql');
      });
    });

    it('should handle configuration reset properly', () => {
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres';
      
      const config1 = DatabaseConfigManager.getConfig();
      expect(config1.type).toBe('postgresql');
      expect(config1.postgresql?.host).toBe('db.project.pooler.supabase.com');
      
      DatabaseConfigManager.resetConfig();
      process.env.DB_HOST = 'localhost';
      process.env.DB_NAME = 'test';
      process.env.DB_USER = 'test';
      process.env.DB_PASSWORD = 'test';
      delete process.env.SUPABASE_DB_URL;
      
      const config2 = DatabaseConfigManager.getConfig();
      expect(config2.type).toBe('postgresql');
      expect(config2.postgresql?.host).toBe('localhost');
    });

    it('should provide detailed error messages for configuration issues', () => {
      delete process.env.DB_HOST;
      delete process.env.DB_NAME;
      delete process.env.DB_USER;
      delete process.env.DB_PASSWORD;
      delete process.env.SUPABASE_DB_URL;
      delete process.env.DATABASE_URL;
      
      const validation = DatabaseConfigManager.validateEnvironmentSetup();
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(error => error.includes('DB_HOST'))).toBe(true);
      expect(validation.errors.some(error => error.includes('DB_NAME'))).toBe(true);
    });

    it('should handle special characters in configuration values', () => {
      process.env.DB_HOST = 'localhost';
      process.env.DB_NAME = 'test-db_name.123';
      process.env.DB_USER = 'user@domain.com';
      process.env.DB_PASSWORD = 'p@ssw0rd!#$%';
      
      const config = DatabaseConfigManager.getConfig();
      expect(config.postgresql?.database).toBe('test-db_name.123');
      expect(config.postgresql?.user).toBe('user@domain.com');
      expect(config.postgresql?.password).toBe('p@ssw0rd!#$%');
    });

    it('should handle configuration caching correctly', () => {
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres';
      
      const config1 = DatabaseConfigManager.getConfig();
      const config2 = DatabaseConfigManager.getConfig();
      
      // Should return the same cached instance
      expect(config1).toBe(config2);
    });

    it('should provide configuration summary for debugging', () => {
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres';
      process.env.NODE_ENV = 'development';
      
      const summary = DatabaseConfigManager.getConfigSummary();
      expect(summary).toHaveProperty('type', 'postgresql');
      expect(summary).toHaveProperty('environment', 'development');
      expect(summary).toHaveProperty('validation');
      expect(summary).toHaveProperty('config');
    });
  });
});