import { DatabaseConfigManager } from '../../services/database/config';

describe('Supabase Configuration', () => {
  beforeEach(() => {
    DatabaseConfigManager.resetConfig();
    
    // Clear environment variables
    delete process.env.DATABASE_TYPE;
    delete process.env.NODE_ENV;
    delete process.env.SUPABASE_DB_URL;
    delete process.env.DATABASE_URL;
    delete process.env.DB_HOST;
    delete process.env.DB_NAME;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
  });

  afterEach(() => {
    DatabaseConfigManager.resetConfig();
  });

  describe('Supabase connection string parsing', () => {
    it('should parse Supabase connection string correctly', () => {
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres';
      
      const config = DatabaseConfigManager.getConfig();
      
      expect(config.type).toBe('postgresql');
      expect(config.postgresql?.host).toBe('db.project.pooler.supabase.com');
      expect(config.postgresql?.port).toBe(5432);
      expect(config.postgresql?.database).toBe('postgres');
      expect(config.postgresql?.user).toBe('postgres');
      expect(config.postgresql?.password).toBe('password');
      expect(config.postgresql?.ssl).toBe(true); // Supabase always uses SSL
    });

    it('should prefer SUPABASE_DB_URL over individual DB_* variables', () => {
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:supabase_pass@db.project.pooler.supabase.com:5432/postgres';
      process.env.DB_HOST = 'localhost';
      process.env.DB_USER = 'local_user';
      process.env.DB_PASSWORD = 'local_pass';
      
      const config = DatabaseConfigManager.getConfig();
      
      expect(config.postgresql?.host).toBe('db.project.pooler.supabase.com');
      expect(config.postgresql?.user).toBe('postgres');
      expect(config.postgresql?.password).toBe('supabase_pass');
    });

    it('should provide helpful setup instructions for Supabase', () => {
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres';
      
      const instructions = DatabaseConfigManager.getSetupInstructions();
      
      // The instructions should contain Supabase-specific content
      expect(instructions).toContain('supabase.com'); // At minimum, should show the hostname
      expect(instructions).toContain('SSL: enabled'); // Supabase should have SSL enabled
    });

    it('should validate Supabase connection requirements', () => {
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:@db.project.pooler.supabase.com:5432/postgres'; // Missing password
      
      const validation = DatabaseConfigManager.validateEnvironmentSetup();
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(error => error.includes('Supabase connections require a password'))).toBe(true);
    });
  });

  describe('fallback to individual variables', () => {
    it('should use individual DB_* variables when no Supabase URL provided', () => {
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.DB_HOST = 'localhost';
      process.env.DB_PORT = '5432';
      process.env.DB_NAME = 'test_db';
      process.env.DB_USER = 'test_user';
      process.env.DB_PASSWORD = 'test_password';
      process.env.DB_SSL = 'false'; // Explicitly disable SSL for this test
      
      const config = DatabaseConfigManager.getConfig();
      
      expect(config.postgresql?.host).toBe('localhost');
      expect(config.postgresql?.port).toBe(5432);
      expect(config.postgresql?.database).toBe('test_db');
      expect(config.postgresql?.user).toBe('test_user');
      expect(config.postgresql?.password).toBe('test_password');
      expect(config.postgresql?.ssl).toBe(false);
    });
  });
});