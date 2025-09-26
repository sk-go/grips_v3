import { MigrationRunner } from '../../services/database/MigrationRunner';
import { PostgreSQLAdapter } from '../../services/database/adapters/PostgreSQLAdapter';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('MigrationRunner with PostgreSQL', () => {
  let tempDir: string;
  let testMigrationsDir: string;
  let postgresAdapter: PostgreSQLAdapter;
  
  beforeAll(() => {
    // Only run PostgreSQL tests if we have a test database configured
    const hasPostgresConfig = process.env.TEST_DB_HOST || process.env.CI || process.env.SUPABASE_DB_URL;
    if (!hasPostgresConfig) {
      console.log('Skipping PostgreSQL migration tests - no test database configured');
    }
  });
  
  beforeEach(async () => {
    // Skip if no PostgreSQL test environment
    if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
      return;
    }

    // Create temporary directory for test migrations
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-test-'));
    testMigrationsDir = path.join(tempDir, 'migrations');
    fs.mkdirSync(testMigrationsDir);
    
    // Initialize PostgreSQL adapter
    postgresAdapter = new PostgreSQLAdapter({
      host: process.env.TEST_DB_HOST || 'localhost',
      port: parseInt(process.env.TEST_DB_PORT || '5432'),
      database: process.env.TEST_DB_NAME || 'test_db',
      user: process.env.TEST_DB_USER || 'postgres',
      password: process.env.TEST_DB_PASSWORD || 'password',
      ssl: false
    });
    
    try {
      await postgresAdapter.initialize();
    } catch (error) {
      console.log('PostgreSQL not available for testing, skipping...');
      return;
    }
  });

  afterEach(async () => {
    // Clean up
    if (postgresAdapter) {
      await postgresAdapter.close();
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Basic Migration Functionality', () => {
    it('should create migrations table', async () => {
      if (!postgresAdapter) return; // Skip if no PostgreSQL available
      
      const runner = new MigrationRunner(postgresAdapter, testMigrationsDir);
      
      // Create a simple test migration
      const migrationContent = `
        CREATE TABLE IF NOT EXISTS test_table (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL
        );
      `;
      fs.writeFileSync(path.join(testMigrationsDir, '001_test_table.sql'), migrationContent);
      
      await runner.runMigrations();
      
      // Check if migrations table exists
      const result = await postgresAdapter.query(
        "SELECT table_name FROM information_schema.tables WHERE table_name = 'migrations'"
      );
      expect(result.rows).toHaveLength(1);
    });

    it('should execute pending migrations', async () => {
      if (!postgresAdapter) return; // Skip if no PostgreSQL available
      
      const runner = new MigrationRunner(postgresAdapter, testMigrationsDir);
      
      // Create test migrations
      const migration1 = `
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email VARCHAR(255) UNIQUE NOT NULL
        );
      `;
      const migration2 = `
        CREATE TABLE IF NOT EXISTS posts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id),
          title TEXT NOT NULL
        );
      `;
      
      fs.writeFileSync(path.join(testMigrationsDir, '001_users.sql'), migration1);
      fs.writeFileSync(path.join(testMigrationsDir, '002_posts.sql'), migration2);
      
      await runner.runMigrations();
      
      // Check if both tables exist
      const tablesResult = await postgresAdapter.query(
        "SELECT table_name FROM information_schema.tables WHERE table_name IN ('users', 'posts')"
      );
      expect(tablesResult.rows).toHaveLength(2);
      
      // Check migration records
      const migrationsResult = await postgresAdapter.query(
        'SELECT id, filename FROM migrations ORDER BY id'
      );
      expect(migrationsResult.rows).toHaveLength(2);
      expect(migrationsResult.rows[0].id).toBe('001');
      expect(migrationsResult.rows[1].id).toBe('002');
    });

    it('should not re-run executed migrations', async () => {
      if (!postgresAdapter) return; // Skip if no PostgreSQL available
      
      const runner = new MigrationRunner(postgresAdapter, testMigrationsDir);
      
      const migrationContent = `
        CREATE TABLE IF NOT EXISTS test_counter (
          id SERIAL PRIMARY KEY,
          count INTEGER DEFAULT 0
        );
        INSERT INTO test_counter (count) VALUES (1);
      `;
      fs.writeFileSync(path.join(testMigrationsDir, '001_counter.sql'), migrationContent);
      
      // Run migrations twice
      await runner.runMigrations();
      await runner.runMigrations();
      
      // Should only have one record (migration didn't run twice)
      const result = await postgresAdapter.query('SELECT COUNT(*) as count FROM test_counter');
      expect(result.rows[0].count).toBe('1'); // PostgreSQL returns string for COUNT
    });
  });

  describe('PostgreSQL Native Features', () => {
    it('should handle UUID types and functions natively', async () => {
      if (!postgresAdapter) return; // Skip if no PostgreSQL available
      
      const runner = new MigrationRunner(postgresAdapter, testMigrationsDir);
      
      const postgresqlMigration = `
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email VARCHAR(255) UNIQUE NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `;
      
      fs.writeFileSync(path.join(testMigrationsDir, '001_users_uuid.sql'), postgresqlMigration);
      
      await runner.runMigrations();
      
      // Check if table was created successfully
      const result = await postgresAdapter.query(
        "SELECT table_name FROM information_schema.tables WHERE table_name = 'users'"
      );
      expect(result.rows).toHaveLength(1);
      
      // Verify UUID column type
      const columnResult = await postgresAdapter.query(
        "SELECT data_type FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'id'"
      );
      expect(columnResult.rows[0].data_type).toBe('uuid');
    });

    it('should handle JSONB natively', async () => {
      if (!postgresAdapter) return; // Skip if no PostgreSQL available
      
      const runner = new MigrationRunner(postgresAdapter, testMigrationsDir);
      
      const postgresqlMigration = `
        CREATE TABLE IF NOT EXISTS settings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          config JSONB NOT NULL,
          metadata JSONB DEFAULT '{}'::jsonb
        );
      `;
      
      fs.writeFileSync(path.join(testMigrationsDir, '001_jsonb_test.sql'), postgresqlMigration);
      
      await runner.runMigrations();
      
      // Check if table was created
      const result = await postgresAdapter.query(
        "SELECT table_name FROM information_schema.tables WHERE table_name = 'settings'"
      );
      expect(result.rows).toHaveLength(1);
      
      // Verify JSONB column type
      const columnResult = await postgresAdapter.query(
        "SELECT data_type FROM information_schema.columns WHERE table_name = 'settings' AND column_name = 'config'"
      );
      expect(columnResult.rows[0].data_type).toBe('jsonb');
    });

    it('should handle boolean types natively', async () => {
      if (!postgresAdapter) return; // Skip if no PostgreSQL available
      
      const runner = new MigrationRunner(postgresAdapter, testMigrationsDir);
      
      const postgresqlMigration = `
        CREATE TABLE IF NOT EXISTS flags (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          is_active BOOLEAN DEFAULT true,
          is_deleted BOOLEAN DEFAULT false
        );
      `;
      
      fs.writeFileSync(path.join(testMigrationsDir, '001_boolean_test.sql'), postgresqlMigration);
      
      await runner.runMigrations();
      
      // Check if table was created
      const result = await postgresAdapter.query(
        "SELECT table_name FROM information_schema.tables WHERE table_name = 'flags'"
      );
      expect(result.rows).toHaveLength(1);
      
      // Verify boolean column type
      const columnResult = await postgresAdapter.query(
        "SELECT data_type FROM information_schema.columns WHERE table_name = 'flags' AND column_name = 'is_active'"
      );
      expect(columnResult.rows[0].data_type).toBe('boolean');
    });

    it('should handle PostgreSQL triggers and functions natively', async () => {
      if (!postgresAdapter) return; // Skip if no PostgreSQL available
      
      const runner = new MigrationRunner(postgresAdapter, testMigrationsDir);
      
      const postgresqlMigration = `
        CREATE TABLE IF NOT EXISTS test_table (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ language 'plpgsql';

        CREATE TRIGGER update_test_table_updated_at 
            BEFORE UPDATE ON test_table 
            FOR EACH ROW 
            EXECUTE FUNCTION update_updated_at_column();
      `;
      
      fs.writeFileSync(path.join(testMigrationsDir, '001_trigger_test.sql'), postgresqlMigration);
      
      await runner.runMigrations();
      
      // Check if table was created
      const result = await postgresAdapter.query(
        "SELECT table_name FROM information_schema.tables WHERE table_name = 'test_table'"
      );
      expect(result.rows).toHaveLength(1);
      
      // Check if trigger was created
      const triggerResult = await postgresAdapter.query(
        "SELECT trigger_name FROM information_schema.triggers WHERE trigger_name = 'update_test_table_updated_at'"
      );
      expect(triggerResult.rows).toHaveLength(1);
    });
  });

  describe('Migration Status and Validation', () => {
    it('should provide migration status', async () => {
      if (!postgresAdapter) return; // Skip if no PostgreSQL available
      
      const runner = new MigrationRunner(postgresAdapter, testMigrationsDir);
      
      // Create test migrations
      fs.writeFileSync(path.join(testMigrationsDir, '001_first.sql'), 'CREATE TABLE first (id UUID PRIMARY KEY DEFAULT gen_random_uuid());');
      fs.writeFileSync(path.join(testMigrationsDir, '002_second.sql'), 'CREATE TABLE second (id UUID PRIMARY KEY DEFAULT gen_random_uuid());');
      
      // Get status before running migrations
      const statusBefore = await runner.getMigrationStatus();
      expect(statusBefore.total).toBe(2);
      expect(statusBefore.executed).toBe(0);
      expect(statusBefore.pending).toBe(2);
      
      // Run first migration manually by running all
      await runner.runMigrations();
      
      // Get status after
      const statusAfter = await runner.getMigrationStatus();
      expect(statusAfter.total).toBe(2);
      expect(statusAfter.executed).toBe(2);
      expect(statusAfter.pending).toBe(0);
    });

    it('should validate migration integrity', async () => {
      if (!postgresAdapter) return; // Skip if no PostgreSQL available
      
      const runner = new MigrationRunner(postgresAdapter, testMigrationsDir);
      
      // Create sequential migrations
      fs.writeFileSync(path.join(testMigrationsDir, '001_first.sql'), 'CREATE TABLE first (id UUID PRIMARY KEY DEFAULT gen_random_uuid());');
      fs.writeFileSync(path.join(testMigrationsDir, '002_second.sql'), 'CREATE TABLE second (id UUID PRIMARY KEY DEFAULT gen_random_uuid());');
      
      await runner.runMigrations();
      
      const validation = await runner.validateMigrations();
      expect(validation.valid).toBe(true);
      expect(validation.issues).toHaveLength(0);
    });

    it('should detect modified migrations', async () => {
      if (!postgresAdapter) return; // Skip if no PostgreSQL available
      
      const runner = new MigrationRunner(postgresAdapter, testMigrationsDir);
      
      const migrationPath = path.join(testMigrationsDir, '001_test.sql');
      fs.writeFileSync(migrationPath, 'CREATE TABLE test (id UUID PRIMARY KEY DEFAULT gen_random_uuid());');
      
      await runner.runMigrations();
      
      // Modify the migration file
      fs.writeFileSync(migrationPath, 'CREATE TABLE test (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT);');
      
      const validation = await runner.validateMigrations();
      expect(validation.valid).toBe(false);
      expect(validation.issues.some(issue => issue.includes('modified'))).toBe(true);
    });
  });

  describe('Real Migration Files', () => {
    it('should handle test migrations with PostgreSQL syntax', async () => {
      if (!postgresAdapter) return; // Skip if no PostgreSQL available
      
      const testMigrationsDir = path.join(__dirname, '../../database/migrations-test');
      const runner = new MigrationRunner(postgresAdapter, testMigrationsDir);
      
      // This will use the test migrations directory with PostgreSQL syntax
      await expect(runner.runMigrations()).resolves.not.toThrow();
      
      // Check that some core tables exist
      const tablesResult = await postgresAdapter.query(
        "SELECT table_name FROM information_schema.tables WHERE table_name IN ('users', 'clients', 'communications', 'migrations')"
      );
      expect(tablesResult.rows.length).toBeGreaterThanOrEqual(3);
    });

    it('should run production migrations on PostgreSQL', async () => {
      if (!postgresAdapter) return; // Skip if no PostgreSQL available

      const runner = new MigrationRunner(postgresAdapter);
      
      // Should not throw errors
      await expect(runner.runMigrations()).resolves.not.toThrow();
      
      // Check that migrations table exists
      const result = await postgresAdapter.query(
        "SELECT table_name FROM information_schema.tables WHERE table_name = 'migrations'"
      );
      expect(result.rows).toHaveLength(1);
    });
  });
});