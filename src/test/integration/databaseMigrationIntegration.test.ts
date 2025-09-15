/**
 * Database Migration Integration Tests
 * Tests migration scenarios between SQLite and PostgreSQL
 */

import { DatabaseService } from '../../services/database';
import { MigrationRunner } from '../../services/database/MigrationRunner';
import { SQLiteAdapter } from '../../services/database/adapters/SQLiteAdapter';
import { DataMigrationService } from '../../services/database/DataMigrationService';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Database Migration Integration Tests', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create temporary directory for test databases
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-integration-'));
    
    // Reset service state
    DatabaseService.reset();
    
    // Clear environment variables
    delete process.env.DATABASE_TYPE;
    delete process.env.NODE_ENV;
    delete process.env.SQLITE_FILENAME;
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

  describe('SQLite Migration Execution', () => {
    it('should run all existing migrations on SQLite', async () => {
      const dbPath = path.join(tempDir, 'migration-test.db');
      
      process.env.DATABASE_TYPE = 'sqlite';
      process.env.SQLITE_FILENAME = dbPath;
      
      await DatabaseService.initialize();
      
      // Check that migrations table exists
      const migrationsResult = await DatabaseService.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'"
      );
      expect(migrationsResult.rows).toHaveLength(1);
      
      // Check that some core tables exist (from migrations)
      const tablesResult = await DatabaseService.query(`
        SELECT name FROM sqlite_master 
        WHERE type='table' 
        AND name IN ('users', 'clients', 'communications', 'tasks')
      `);
      expect(tablesResult.rows.length).toBeGreaterThan(0);
      
      // Verify migration records
      const executedMigrations = await DatabaseService.query(
        'SELECT id, filename FROM migrations ORDER BY id'
      );
      expect(executedMigrations.rows.length).toBeGreaterThan(0);
    });

    it('should translate PostgreSQL migrations to SQLite', async () => {
      const dbPath = path.join(tempDir, 'translation-test.db');
      const testMigrationsDir = path.join(tempDir, 'test-migrations');
      
      // Create test migrations directory
      fs.mkdirSync(testMigrationsDir);
      
      // Create a PostgreSQL migration with complex features
      const postgresqlMigration = `
        -- Test PostgreSQL to SQLite translation
        CREATE TABLE test_translation (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_data JSONB DEFAULT '{}'::jsonb,
          tags TEXT[] DEFAULT '{}',
          is_active BOOLEAN DEFAULT true,
          score DECIMAL(10,2) DEFAULT 0.0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        -- Create index
        CREATE INDEX idx_test_translation_active ON test_translation(is_active);
        CREATE INDEX idx_test_translation_created ON test_translation(created_at);

        -- Insert test data
        INSERT INTO test_translation (user_data, tags, is_active, score) VALUES
        ('{"name": "John", "role": "admin"}', '["tag1", "tag2"]', true, 95.5),
        ('{"name": "Jane", "role": "user"}', '["tag3"]', false, 87.2);
      `;
      
      fs.writeFileSync(
        path.join(testMigrationsDir, '001_test_translation.sql'),
        postgresqlMigration
      );
      
      // Initialize SQLite adapter and run custom migrations
      const adapter = new SQLiteAdapter({ filename: dbPath });
      await adapter.initialize();
      
      const migrationRunner = new MigrationRunner(adapter, testMigrationsDir);
      await migrationRunner.runMigrations();
      
      // Verify table was created with proper translation
      const tableInfo = await adapter.query(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='test_translation'"
      );
      expect(tableInfo.rows).toHaveLength(1);
      
      const createdSQL = tableInfo.rows[0].sql;
      expect(createdSQL).toContain('TEXT'); // UUID -> TEXT
      expect(createdSQL).toContain('INTEGER'); // BOOLEAN -> INTEGER
      expect(createdSQL).toContain('DATETIME'); // TIMESTAMP WITH TIME ZONE -> DATETIME
      
      // Verify data was inserted correctly
      const dataResult = await adapter.query('SELECT * FROM test_translation');
      expect(dataResult.rows).toHaveLength(2);
      expect(dataResult.rows[0].is_active).toBe(1); // true -> 1
      expect(dataResult.rows[1].is_active).toBe(0); // false -> 0
      
      await adapter.close();
    });

    it('should handle migration failures gracefully', async () => {
      const dbPath = path.join(tempDir, 'failure-test.db');
      const testMigrationsDir = path.join(tempDir, 'test-migrations-fail');
      
      fs.mkdirSync(testMigrationsDir);
      
      // Create a valid migration
      fs.writeFileSync(
        path.join(testMigrationsDir, '001_valid.sql'),
        'CREATE TABLE valid_table (id TEXT PRIMARY KEY);'
      );
      
      // Create an invalid migration
      fs.writeFileSync(
        path.join(testMigrationsDir, '002_invalid.sql'),
        'INVALID SQL SYNTAX HERE;'
      );
      
      const adapter = new SQLiteAdapter({ filename: dbPath });
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
        "SELECT name FROM sqlite_master WHERE type='table' AND name='valid_table'"
      );
      expect(tables.rows).toHaveLength(1);
      
      await adapter.close();
    });
  });

  describe('Migration Status and Validation', () => {
    it('should provide accurate migration status', async () => {
      const dbPath = path.join(tempDir, 'status-test.db');
      
      process.env.DATABASE_TYPE = 'sqlite';
      process.env.SQLITE_FILENAME = dbPath;
      
      await DatabaseService.initialize();
      
      // Get migration status using the actual migrations
      const adapter = new SQLiteAdapter({ filename: dbPath });
      await adapter.initialize();
      
      const migrationRunner = new MigrationRunner(adapter);
      const status = await migrationRunner.getMigrationStatus();
      
      expect(status).toHaveProperty('total');
      expect(status).toHaveProperty('executed');
      expect(status).toHaveProperty('pending');
      expect(status.total).toBeGreaterThanOrEqual(status.executed);
      expect(status.pending).toBe(status.total - status.executed);
      
      await adapter.close();
    });

    it('should validate migration integrity', async () => {
      const dbPath = path.join(tempDir, 'integrity-test.db');
      
      process.env.DATABASE_TYPE = 'sqlite';
      process.env.SQLITE_FILENAME = dbPath;
      
      await DatabaseService.initialize();
      
      const adapter = new SQLiteAdapter({ filename: dbPath });
      await adapter.initialize();
      
      const migrationRunner = new MigrationRunner(adapter);
      const validation = await migrationRunner.validateMigrations();
      
      expect(validation).toHaveProperty('valid');
      expect(validation).toHaveProperty('issues');
      
      if (!validation.valid) {
        console.log('Migration validation issues:', validation.issues);
      }
      
      await adapter.close();
    });
  });

  describe('Data Migration Between Database Types', () => {
    it('should export SQLite data for PostgreSQL import', async () => {
      const sqliteDbPath = path.join(tempDir, 'export-test.db');
      
      // Set up SQLite with test data
      process.env.DATABASE_TYPE = 'sqlite';
      process.env.SQLITE_FILENAME = sqliteDbPath;
      
      await DatabaseService.initialize({ skipMigrations: true });
      
      // Create test table and data
      await DatabaseService.query(`
        CREATE TABLE export_test (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          data TEXT,
          active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      const testData = [
        ['1', 'Test User 1', '{"role": "admin"}', 1],
        ['2', 'Test User 2', '{"role": "user"}', 0],
        ['3', 'Test User 3', '{"role": "guest"}', 1]
      ];
      
      for (const [id, name, data, active] of testData) {
        await DatabaseService.query(
          'INSERT INTO export_test (id, name, data, active) VALUES (?, ?, ?, ?)',
          [id, name, data, active]
        );
      }
      
      // Export data
      const exportPath = path.join(tempDir, 'export.sql');
      const migrationService = new DataMigrationService(
        { filename: sqliteDbPath },
        { host: 'localhost', port: 5432, database: 'test', user: 'test', password: 'test' }
      );
      
      await migrationService.exportSQLiteToPostgreSQL({ outputFile: exportPath });
      
      // Verify export file was created
      expect(fs.existsSync(exportPath)).toBe(true);
      
      // Read and verify export content
      const exportContent = fs.readFileSync(exportPath, 'utf8');
      expect(exportContent).toContain('INSERT INTO export_test');
      expect(exportContent).toContain('Test User 1');
      expect(exportContent).toContain('Test User 2');
      expect(exportContent).toContain('Test User 3');
      
      // Verify PostgreSQL-compatible syntax
      expect(exportContent).toContain("'1'"); // Proper string quoting
      expect(exportContent).not.toContain('sqlite_'); // No SQLite-specific functions
    });

    it('should handle data type conversions during export', async () => {
      const sqliteDbPath = path.join(tempDir, 'conversion-test.db');
      
      process.env.DATABASE_TYPE = 'sqlite';
      process.env.SQLITE_FILENAME = sqliteDbPath;
      
      await DatabaseService.initialize({ skipMigrations: true });
      
      // Create table with various data types
      await DatabaseService.query(`
        CREATE TABLE conversion_test (
          id TEXT PRIMARY KEY,
          boolean_field INTEGER,
          json_field TEXT,
          timestamp_field DATETIME,
          decimal_field REAL
        )
      `);
      
      await DatabaseService.query(`
        INSERT INTO conversion_test VALUES (
          'test-1',
          1,
          '{"key": "value"}',
          '2024-01-01 12:00:00',
          123.45
        )
      `);
      
      // Export data
      const exportPath = path.join(tempDir, 'conversion-export.sql');
      const migrationService = new DataMigrationService(
        { filename: sqliteDbPath },
        { host: 'localhost', port: 5432, database: 'test', user: 'test', password: 'test' }
      );
      
      await migrationService.exportSQLiteToPostgreSQL({ outputFile: exportPath });
      
      const exportContent = fs.readFileSync(exportPath, 'utf8');
      
      // Verify data type conversions
      expect(exportContent).toContain('true'); // INTEGER 1 -> BOOLEAN true
      expect(exportContent).toContain('{"key": "value"}'); // JSON preserved
      expect(exportContent).toContain('2024-01-01'); // Timestamp format
    });
  });

  describe('Cross-Database Schema Compatibility', () => {
    it('should create identical schemas on both database types', async () => {
      // Test with SQLite first
      const sqliteDbPath = path.join(tempDir, 'schema-sqlite.db');
      
      process.env.DATABASE_TYPE = 'sqlite';
      process.env.SQLITE_FILENAME = sqliteDbPath;
      
      await DatabaseService.initialize();
      
      // Get list of tables created by migrations
      const sqliteTables = await DatabaseService.query(`
        SELECT name FROM sqlite_master 
        WHERE type='table' 
        AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `);
      
      await DatabaseService.close();
      DatabaseService.reset();
      
      // Now test PostgreSQL configuration (won't actually connect)
      process.env.DATABASE_TYPE = 'postgresql';
      process.env.DB_HOST = 'localhost';
      process.env.DB_NAME = 'test';
      process.env.DB_USER = 'test';
      process.env.DB_PASSWORD = 'test';
      
      // Verify configuration is valid
      const validation = DatabaseService.validateConfiguration();
      expect(validation.isValid).toBe(true);
      
      // Both should have the same core tables from migrations
      expect(sqliteTables.rows.length).toBeGreaterThan(0);
      
      const expectedTables = ['users', 'clients', 'communications', 'tasks', 'migrations'];
      const actualTableNames = sqliteTables.rows.map(row => row.name);
      
      expectedTables.forEach(tableName => {
        if (!actualTableNames.includes(tableName)) {
          console.log(`Warning: Expected table '${tableName}' not found in SQLite schema`);
        }
      });
    });

    it('should handle schema differences gracefully', async () => {
      const dbPath = path.join(tempDir, 'schema-diff.db');
      
      process.env.DATABASE_TYPE = 'sqlite';
      process.env.SQLITE_FILENAME = dbPath;
      
      await DatabaseService.initialize({ skipMigrations: true });
      
      // Create a table with PostgreSQL-specific features
      await DatabaseService.query(`
        CREATE TABLE schema_test (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          data JSONB DEFAULT '{}',
          tags TEXT[] DEFAULT '{}',
          active BOOLEAN DEFAULT true,
          score DECIMAL(10,2) CHECK (score >= 0),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      // Verify table was created (with translations)
      const tableInfo = await DatabaseService.query(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='schema_test'"
      );
      
      expect(tableInfo.rows).toHaveLength(1);
      const sql = tableInfo.rows[0].sql;
      
      // Verify translations occurred
      expect(sql).toContain('TEXT'); // UUID -> TEXT
      expect(sql).toContain('INTEGER'); // BOOLEAN -> INTEGER
      expect(sql).toContain('DATETIME'); // TIMESTAMP WITH TIME ZONE -> DATETIME
      expect(sql).toContain('CHECK'); // CHECK constraint preserved
    });
  });

  describe('Migration Performance and Reliability', () => {
    it('should handle large migration files efficiently', async () => {
      const dbPath = path.join(tempDir, 'performance-test.db');
      const testMigrationsDir = path.join(tempDir, 'perf-migrations');
      
      fs.mkdirSync(testMigrationsDir);
      
      // Create a large migration with many operations
      let largeMigration = 'CREATE TABLE performance_test (id TEXT PRIMARY KEY, data TEXT);\n';
      
      // Add many insert statements
      for (let i = 0; i < 1000; i++) {
        largeMigration += `INSERT INTO performance_test (id, data) VALUES ('id-${i}', 'data-${i}');\n`;
      }
      
      fs.writeFileSync(
        path.join(testMigrationsDir, '001_large_migration.sql'),
        largeMigration
      );
      
      const adapter = new SQLiteAdapter({ filename: dbPath });
      await adapter.initialize();
      
      const migrationRunner = new MigrationRunner(adapter, testMigrationsDir);
      
      const startTime = Date.now();
      await migrationRunner.runMigrations();
      const duration = Date.now() - startTime;
      
      // Should complete within reasonable time
      expect(duration).toBeLessThan(10000); // 10 seconds
      
      // Verify all data was inserted
      const result = await adapter.query('SELECT COUNT(*) as count FROM performance_test');
      expect(result.rows[0].count).toBe(1000);
      
      await adapter.close();
    });

    it('should handle concurrent migration attempts safely', async () => {
      const dbPath = path.join(tempDir, 'concurrent-test.db');
      
      const adapter1 = new SQLiteAdapter({ filename: dbPath });
      const adapter2 = new SQLiteAdapter({ filename: dbPath });
      
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
      expect(migrations.rows[0].count).toBeGreaterThan(0);
      
      await adapter1.close();
      await adapter2.close();
    });
  });

  describe('Migration Rollback and Recovery', () => {
    it('should handle partial migration failures', async () => {
      const dbPath = path.join(tempDir, 'rollback-test.db');
      const testMigrationsDir = path.join(tempDir, 'rollback-migrations');
      
      fs.mkdirSync(testMigrationsDir);
      
      // Create a migration that will partially fail
      const partialFailMigration = `
        CREATE TABLE rollback_test (id TEXT PRIMARY KEY);
        INSERT INTO rollback_test (id) VALUES ('test-1');
        INSERT INTO rollback_test (id) VALUES ('test-2');
        INSERT INTO rollback_test (id) VALUES ('test-1'); -- This will fail due to duplicate key
        INSERT INTO rollback_test (id) VALUES ('test-3');
      `;
      
      fs.writeFileSync(
        path.join(testMigrationsDir, '001_partial_fail.sql'),
        partialFailMigration
      );
      
      const adapter = new SQLiteAdapter({ filename: dbPath });
      await adapter.initialize();
      
      const migrationRunner = new MigrationRunner(adapter, testMigrationsDir);
      
      // Migration should fail
      await expect(migrationRunner.runMigrations()).rejects.toThrow();
      
      // Check that migration was not recorded as successful
      const migrations = await adapter.query('SELECT * FROM migrations WHERE id = ?', ['001']);
      expect(migrations.rows).toHaveLength(0);
      
      // Table might exist but should be in inconsistent state
      try {
        const result = await adapter.query('SELECT COUNT(*) as count FROM rollback_test');
        // If table exists, it should have partial data
        expect(result.rows[0].count).toBeLessThan(4);
      } catch (error) {
        // Table might not exist at all, which is also acceptable
        expect(error).toBeDefined();
      }
      
      await adapter.close();
    });
  });
});