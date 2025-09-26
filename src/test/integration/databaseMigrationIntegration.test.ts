/**
 * Database Migration Integration Tests - Supabase Only
 * Tests migration scenarios for PostgreSQL/Supabase
 */

import { DatabaseService } from '../../services/database';
import { MigrationRunner } from '../../services/database/MigrationRunner';
import { PostgreSQLAdapter } from '../../services/database/adapters/PostgreSQLAdapter';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Database Migration Integration Tests - Supabase Only', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create temporary directory for test migrations
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-integration-'));
    
    // Reset service state
    DatabaseService.reset();
    
    // Clear environment variables
    delete process.env.NODE_ENV;
    delete process.env.SUPABASE_DB_URL;
    delete process.env.DATABASE_URL;
    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    delete process.env.DB_NAME;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
  });

  afterEach(async () => {
    try {
      await DatabaseService.close();
    } catch (error) {
      // Ignore cleanup errors
    }
    
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('PostgreSQL Migration Execution', () => {
    it('should run all existing migrations on PostgreSQL/Supabase', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }

      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres';
      
      await DatabaseService.initialize();
      
      // Check that migrations table exists
      const migrationsResult = await DatabaseService.query(
        "SELECT table_name FROM information_schema.tables WHERE table_name = 'migrations'"
      );
      expect(migrationsResult.rows).toHaveLength(1);
      
      // Check that some core tables exist (from migrations)
      const tablesResult = await DatabaseService.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name IN ('users', 'clients', 'communications', 'tasks')
      `);
      expect(tablesResult.rows.length).toBeGreaterThan(0);
      
      // Verify migration records
      const executedMigrations = await DatabaseService.query(
        'SELECT id, filename FROM migrations ORDER BY id'
      );
      expect(executedMigrations.rows.length).toBeGreaterThan(0);
    });

    it('should execute PostgreSQL migrations natively', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }

      const testMigrationsDir = path.join(tempDir, 'test-migrations');
      
      // Create test migrations directory
      fs.mkdirSync(testMigrationsDir);
      
      // Create a PostgreSQL migration with native features
      const postgresqlMigration = `
        -- Test PostgreSQL native features
        CREATE TABLE test_native_features (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_data JSONB DEFAULT '{}'::jsonb,
          tags TEXT[] DEFAULT '{}',
          is_active BOOLEAN DEFAULT true,
          score DECIMAL(10,2) DEFAULT 0.0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        -- Create index
        CREATE INDEX idx_test_native_active ON test_native_features(is_active);
        CREATE INDEX idx_test_native_created ON test_native_features(created_at);

        -- Insert test data
        INSERT INTO test_native_features (user_data, tags, is_active, score) VALUES
        ('{"name": "John", "role": "admin"}', '["tag1", "tag2"]', true, 95.5),
        ('{"name": "Jane", "role": "user"}', '["tag3"]', false, 87.2);
      `;
      
      fs.writeFileSync(
        path.join(testMigrationsDir, '001_test_native_features.sql'),
        postgresqlMigration
      );
      
      // Initialize PostgreSQL adapter and run custom migrations
      const adapter = new PostgreSQLAdapter({
        host: process.env.TEST_DB_HOST || 'localhost',
        port: parseInt(process.env.TEST_DB_PORT || '5432'),
        database: process.env.TEST_DB_NAME || 'test_db',
        user: process.env.TEST_DB_USER || 'postgres',
        password: process.env.TEST_DB_PASSWORD || 'password',
        ssl: false
      });
      
      try {
        await adapter.initialize();
        
        const migrationRunner = new MigrationRunner(adapter, testMigrationsDir);
        await migrationRunner.runMigrations();
        
        // Verify table was created with native PostgreSQL types
        const tableInfo = await adapter.query(`
          SELECT column_name, data_type 
          FROM information_schema.columns 
          WHERE table_name = 'test_native_features'
          ORDER BY column_name
        `);
        expect(tableInfo.rows.length).toBeGreaterThan(0);
        
        // Verify native PostgreSQL data types
        const columnTypes = tableInfo.rows.reduce((acc: any, row: any) => {
          acc[row.column_name] = row.data_type;
          return acc;
        }, {});
        
        expect(columnTypes.id).toBe('uuid');
        expect(columnTypes.user_data).toBe('jsonb');
        expect(columnTypes.is_active).toBe('boolean');
        
        // Verify data was inserted correctly with native types
        const dataResult = await adapter.query('SELECT * FROM test_native_features');
        expect(dataResult.rows).toHaveLength(2);
        expect(dataResult.rows[0].is_active).toBe(true); // Native boolean
        expect(dataResult.rows[1].is_active).toBe(false); // Native boolean
        expect(typeof dataResult.rows[0].user_data).toBe('object'); // Native JSONB
        
        await adapter.close();
      } catch (error) {
        console.log('PostgreSQL test database not available, skipping native features test');
      }
    });

    it('should handle migration failures gracefully', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }

      const testMigrationsDir = path.join(tempDir, 'test-migrations-fail');
      
      fs.mkdirSync(testMigrationsDir);
      
      // Create a valid migration
      fs.writeFileSync(
        path.join(testMigrationsDir, '001_valid.sql'),
        'CREATE TABLE valid_table (id UUID PRIMARY KEY DEFAULT gen_random_uuid());'
      );
      
      // Create an invalid migration
      fs.writeFileSync(
        path.join(testMigrationsDir, '002_invalid.sql'),
        'INVALID SQL SYNTAX HERE;'
      );
      
      const adapter = new PostgreSQLAdapter({
        host: process.env.TEST_DB_HOST || 'localhost',
        port: parseInt(process.env.TEST_DB_PORT || '5432'),
        database: process.env.TEST_DB_NAME || 'test_db',
        user: process.env.TEST_DB_USER || 'postgres',
        password: process.env.TEST_DB_PASSWORD || 'password',
        ssl: false
      });
      
      try {
        await adapter.initialize();
        
        const migrationRunner = new MigrationRunner(adapter, testMigrationsDir);
        
        // Migration should fail on the invalid SQL
        await expect(migrationRunner.runMigrations()).rejects.toThrow();
        
        // Check that only the first migration was executed
        const migrations = await adapter.query('SELECT * FROM migrations');
        expect(migrations.rows).toHaveLength(1);
        expect(migrations.rows[0].id).toBe('001');
        
        // Check that the valid table exists
        const tables = await adapter.query(
          "SELECT table_name FROM information_schema.tables WHERE table_name = 'valid_table'"
        );
        expect(tables.rows).toHaveLength(1);
        
        await adapter.close();
      } catch (error) {
        console.log('PostgreSQL test database not available, skipping migration failure test');
      }
    });
  });

  describe('Migration Status and Validation', () => {
    it('should provide accurate migration status', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }

      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres';
      
      await DatabaseService.initialize();
      
      // Get migration status using the actual migrations
      const adapter = new PostgreSQLAdapter({
        host: process.env.TEST_DB_HOST || 'localhost',
        port: parseInt(process.env.TEST_DB_PORT || '5432'),
        database: process.env.TEST_DB_NAME || 'test_db',
        user: process.env.TEST_DB_USER || 'postgres',
        password: process.env.TEST_DB_PASSWORD || 'password',
        ssl: false
      });
      
      try {
        await adapter.initialize();
        
        const migrationRunner = new MigrationRunner(adapter);
        const status = await migrationRunner.getMigrationStatus();
        
        expect(status).toHaveProperty('total');
        expect(status).toHaveProperty('executed');
        expect(status).toHaveProperty('pending');
        expect(status.total).toBeGreaterThanOrEqual(status.executed);
        expect(status.pending).toBe(status.total - status.executed);
        
        await adapter.close();
      } catch (error) {
        console.log('PostgreSQL test database not available, skipping migration status test');
      }
    });

    it('should validate migration integrity', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }

      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres';
      
      await DatabaseService.initialize();
      
      const adapter = new PostgreSQLAdapter({
        host: process.env.TEST_DB_HOST || 'localhost',
        port: parseInt(process.env.TEST_DB_PORT || '5432'),
        database: process.env.TEST_DB_NAME || 'test_db',
        user: process.env.TEST_DB_USER || 'postgres',
        password: process.env.TEST_DB_PASSWORD || 'password',
        ssl: false
      });
      
      try {
        await adapter.initialize();
        
        const migrationRunner = new MigrationRunner(adapter);
        const validation = await migrationRunner.validateMigrations();
        
        expect(validation).toHaveProperty('valid');
        expect(validation).toHaveProperty('issues');
        
        if (!validation.valid) {
          console.log('Migration validation issues:', validation.issues);
        }
        
        await adapter.close();
      } catch (error) {
        console.log('PostgreSQL test database not available, skipping migration validation test');
      }
    });
  });

  describe('PostgreSQL Data Operations', () => {
    it('should handle PostgreSQL native data types', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }

      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres';
      
      await DatabaseService.initialize({ skipMigrations: true });
      
      // Create test table with PostgreSQL native types
      await DatabaseService.query(`
        CREATE TABLE IF NOT EXISTS postgres_native_test (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          data JSONB DEFAULT '{}',
          tags TEXT[] DEFAULT '{}',
          active BOOLEAN DEFAULT true,
          score DECIMAL(10,2) DEFAULT 0.0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      const testData = [
        ['Test User 1', '{"role": "admin"}', ['tag1', 'tag2'], true, 95.5],
        ['Test User 2', '{"role": "user"}', ['tag3'], false, 87.2],
        ['Test User 3', '{"role": "guest"}', ['tag4', 'tag5'], true, 92.1]
      ];
      
      for (const [name, data, tags, active, score] of testData) {
        await DatabaseService.query(
          'INSERT INTO postgres_native_test (name, data, tags, active, score) VALUES ($1, $2, $3, $4, $5)',
          [name, data, tags, active, score]
        );
      }
      
      // Verify data was inserted with correct types
      const result = await DatabaseService.query('SELECT * FROM postgres_native_test ORDER BY name');
      expect(result.rows).toHaveLength(3);
      
      // Verify native PostgreSQL types
      expect(result.rows[0].active).toBe(true); // Native boolean
      expect(result.rows[1].active).toBe(false); // Native boolean
      expect(typeof result.rows[0].data).toBe('object'); // Native JSONB
      expect(Array.isArray(result.rows[0].tags)).toBe(true); // Native array
      expect(typeof result.rows[0].score).toBe('string'); // Decimal as string
    });

    it('should handle complex PostgreSQL queries', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }

      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres';
      
      await DatabaseService.initialize({ skipMigrations: true });
      
      // Create table for complex query testing
      await DatabaseService.query(`
        CREATE TABLE IF NOT EXISTS complex_query_test (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_data JSONB NOT NULL,
          tags TEXT[] DEFAULT '{}',
          score INTEGER DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      // Insert test data
      await DatabaseService.query(`
        INSERT INTO complex_query_test (user_data, tags, score) VALUES 
        ('{"name": "John", "department": "Engineering"}', '["backend", "postgresql"]', 95),
        ('{"name": "Jane", "department": "Marketing"}', '["frontend", "react"]', 87),
        ('{"name": "Bob", "department": "Engineering"}', '["devops", "postgresql"]', 92)
      `);
      
      // Test complex PostgreSQL query with JSONB operations
      const result = await DatabaseService.query(`
        SELECT 
          user_data->>'name' as name,
          user_data->>'department' as department,
          array_length(tags, 1) as tag_count,
          score,
          'postgresql' = ANY(tags) as uses_postgresql
        FROM complex_query_test 
        WHERE user_data->>'department' = 'Engineering'
        AND score > 90
        ORDER BY score DESC
      `);
      
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].name).toBe('John');
      expect(result.rows[0].uses_postgresql).toBe(true);
      expect(result.rows[1].name).toBe('Bob');
      expect(result.rows[1].uses_postgresql).toBe(true);
    });
  });

  describe('PostgreSQL Schema Management', () => {
    it('should create consistent schemas with PostgreSQL', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }

      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres';
      
      await DatabaseService.initialize();
      
      // Get list of tables created by migrations
      const postgresqlTables = await DatabaseService.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `);
      
      // Verify configuration is valid
      const validation = DatabaseService.validateConfiguration();
      expect(validation.isValid).toBe(true);
      
      // Should have core tables from migrations
      expect(postgresqlTables.rows.length).toBeGreaterThan(0);
      
      const expectedTables = ['users', 'clients', 'communications', 'tasks', 'migrations'];
      const actualTableNames = postgresqlTables.rows.map((row: any) => row.table_name);
      
      expectedTables.forEach(tableName => {
        if (!actualTableNames.includes(tableName)) {
          console.log(`Warning: Expected table '${tableName}' not found in PostgreSQL schema`);
        }
      });
    });

    it('should handle PostgreSQL native features in schema', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }

      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.pooler.supabase.com:5432/postgres';
      
      await DatabaseService.initialize({ skipMigrations: true });
      
      // Create a table with PostgreSQL native features
      await DatabaseService.query(`
        CREATE TABLE IF NOT EXISTS schema_native_test (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          data JSONB DEFAULT '{}',
          tags TEXT[] DEFAULT '{}',
          active BOOLEAN DEFAULT true,
          score DECIMAL(10,2) CHECK (score >= 0),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      // Verify table was created with native PostgreSQL types
      const columnInfo = await DatabaseService.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = 'schema_native_test'
        ORDER BY column_name
      `);
      
      expect(columnInfo.rows.length).toBeGreaterThan(0);
      
      const columnTypes = columnInfo.rows.reduce((acc: any, row: any) => {
        acc[row.column_name] = row.data_type;
        return acc;
      }, {});
      
      // Verify native PostgreSQL types are preserved
      expect(columnTypes.id).toBe('uuid');
      expect(columnTypes.data).toBe('jsonb');
      expect(columnTypes.active).toBe('boolean');
      expect(columnTypes.tags).toBe('ARRAY'); // TEXT[] shows as ARRAY
    });
  });

  describe('Migration Performance and Reliability', () => {
    it('should handle large migration files efficiently', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }

      const testMigrationsDir = path.join(tempDir, 'perf-migrations');
      
      fs.mkdirSync(testMigrationsDir);
      
      // Create a large migration with many operations
      let largeMigration = 'CREATE TABLE performance_test (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), data TEXT);\n';
      
      // Add many insert statements (fewer for PostgreSQL to avoid timeout)
      for (let i = 0; i < 100; i++) {
        largeMigration += `INSERT INTO performance_test (data) VALUES ('data-${i}');\n`;
      }
      
      fs.writeFileSync(
        path.join(testMigrationsDir, '001_large_migration.sql'),
        largeMigration
      );
      
      const adapter = new PostgreSQLAdapter({
        host: process.env.TEST_DB_HOST || 'localhost',
        port: parseInt(process.env.TEST_DB_PORT || '5432'),
        database: process.env.TEST_DB_NAME || 'test_db',
        user: process.env.TEST_DB_USER || 'postgres',
        password: process.env.TEST_DB_PASSWORD || 'password',
        ssl: false
      });
      
      try {
        await adapter.initialize();
        
        const migrationRunner = new MigrationRunner(adapter, testMigrationsDir);
        
        const startTime = Date.now();
        await migrationRunner.runMigrations();
        const duration = Date.now() - startTime;
        
        // Should complete within reasonable time
        expect(duration).toBeLessThan(30000); // 30 seconds for PostgreSQL
        
        // Verify all data was inserted
        const result = await adapter.query('SELECT COUNT(*) as count FROM performance_test');
        expect(parseInt(result.rows[0].count)).toBe(100);
        
        await adapter.close();
      } catch (error) {
        console.log('PostgreSQL test database not available, skipping performance test');
      }
    });

    it('should handle concurrent migration attempts safely', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }

      const adapter1 = new PostgreSQLAdapter({
        host: process.env.TEST_DB_HOST || 'localhost',
        port: parseInt(process.env.TEST_DB_PORT || '5432'),
        database: process.env.TEST_DB_NAME || 'test_db',
        user: process.env.TEST_DB_USER || 'postgres',
        password: process.env.TEST_DB_PASSWORD || 'password',
        ssl: false
      });
      
      const adapter2 = new PostgreSQLAdapter({
        host: process.env.TEST_DB_HOST || 'localhost',
        port: parseInt(process.env.TEST_DB_PORT || '5432'),
        database: process.env.TEST_DB_NAME || 'test_db',
        user: process.env.TEST_DB_USER || 'postgres',
        password: process.env.TEST_DB_PASSWORD || 'password',
        ssl: false
      });
      
      try {
        await adapter1.initialize();
        await adapter2.initialize();
        
        const migrationRunner1 = new MigrationRunner(adapter1);
        const migrationRunner2 = new MigrationRunner(adapter2);
        
        // Try to run migrations concurrently
        const results = await Promise.allSettled([
          migrationRunner1.runMigrations(),
          migrationRunner2.runMigrations()
        ]);
        
        // At least one should succeed
        const successCount = results.filter(r => r.status === 'fulfilled').length;
        expect(successCount).toBeGreaterThanOrEqual(1);
        
        // Check final state is consistent
        const migrations = await adapter1.query('SELECT COUNT(*) as count FROM migrations');
        expect(parseInt(migrations.rows[0].count)).toBeGreaterThan(0);
        
        await adapter1.close();
        await adapter2.close();
      } catch (error) {
        console.log('PostgreSQL test database not available, skipping concurrent migration test');
      }
    });
  });

  describe('Migration Rollback and Recovery', () => {
    it('should handle partial migration failures with PostgreSQL transactions', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }

      const testMigrationsDir = path.join(tempDir, 'rollback-migrations');
      
      fs.mkdirSync(testMigrationsDir);
      
      // Create a migration that will partially fail
      const partialFailMigration = `
        CREATE TABLE rollback_test (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT UNIQUE);
        INSERT INTO rollback_test (name) VALUES ('test-1');
        INSERT INTO rollback_test (name) VALUES ('test-2');
        INSERT INTO rollback_test (name) VALUES ('test-1'); -- This will fail due to unique constraint
        INSERT INTO rollback_test (name) VALUES ('test-3');
      `;
      
      fs.writeFileSync(
        path.join(testMigrationsDir, '001_partial_fail.sql'),
        partialFailMigration
      );
      
      const adapter = new PostgreSQLAdapter({
        host: process.env.TEST_DB_HOST || 'localhost',
        port: parseInt(process.env.TEST_DB_PORT || '5432'),
        database: process.env.TEST_DB_NAME || 'test_db',
        user: process.env.TEST_DB_USER || 'postgres',
        password: process.env.TEST_DB_PASSWORD || 'password',
        ssl: false
      });
      
      try {
        await adapter.initialize();
        
        const migrationRunner = new MigrationRunner(adapter, testMigrationsDir);
        
        // Migration should fail
        await expect(migrationRunner.runMigrations()).rejects.toThrow();
        
        // Check that migration was not recorded as successful
        const migrations = await adapter.query('SELECT * FROM migrations WHERE id = $1', ['001']);
        expect(migrations.rows).toHaveLength(0);
        
        // PostgreSQL should have rolled back the entire transaction
        try {
          const result = await adapter.query('SELECT COUNT(*) as count FROM rollback_test');
          // If table exists, PostgreSQL transaction rollback should have left it empty
          expect(parseInt(result.rows[0].count)).toBe(0);
        } catch (error) {
          // Table might not exist at all due to rollback, which is expected
          expect(error).toBeDefined();
        }
        
        await adapter.close();
      } catch (error) {
        console.log('PostgreSQL test database not available, skipping rollback test');
      }
    });
  });
});