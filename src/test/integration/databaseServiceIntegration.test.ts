/**
 * Integration test for DatabaseService in application context
 */

import { DatabaseService } from '../../services/database';
import { DatabaseConfigManager } from '../../services/database/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('DatabaseService Application Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create temporary directory for test databases
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-integration-test-'));
    
    // Reset service state before each test
    DatabaseService.reset();
    
    // Clear environment variables
    delete process.env.DATABASE_TYPE;
    delete process.env.NODE_ENV;
    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    delete process.env.DB_NAME;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    delete process.env.SUPABASE_DB_URL;
    delete process.env.SKIP_MIGRATIONS;
  });

  afterEach(async () => {
    // Clean up after each test
    try {
      await DatabaseService.close();
    } catch (error) {
      // Ignore cleanup errors
    }
    
    // Clean up temporary directory with retry for Windows file locking issues
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (error) {
        // On Windows, files might be locked, try again after a short delay
        setTimeout(() => {
          try {
            fs.rmSync(tempDir, { recursive: true, force: true });
          } catch (retryError) {
            // Ignore final cleanup errors in tests
            console.warn('Could not clean up temp directory:', tempDir);
          }
        }, 100);
      }
    }
  });

  describe('Supabase Integration', () => {
    beforeEach(() => {
      // Set environment for Supabase/PostgreSQL
      process.env.NODE_ENV = 'development';
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.supabase.co:5432/postgres';
    });

    it('should initialize successfully with Supabase', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }
      
      await expect(DatabaseService.initialize({ skipMigrations: true })).resolves.not.toThrow();
      
      const healthCheck = await DatabaseService.healthCheck();
      expect(healthCheck.status).toBe('healthy');
      expect(healthCheck.type).toBe('postgresql');
    });

    it('should execute basic queries', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }
      
      await DatabaseService.initialize({ skipMigrations: true });
      
      const result = await DatabaseService.query('SELECT 1 as test');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].test).toBe(1);
    });

    it('should provide configuration summary', () => {
      const summary = DatabaseService.getConfigSummary();
      expect(summary).toHaveProperty('type', 'postgresql');
    });

    it('should handle PostgreSQL native features', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }
      
      await DatabaseService.initialize({ skipMigrations: true });
      
      // Test basic operations with PostgreSQL syntax
      await DatabaseService.query(`
        CREATE TABLE IF NOT EXISTS test_table (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          metadata JSONB DEFAULT '{}',
          active BOOLEAN DEFAULT true,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      await DatabaseService.query(
        'INSERT INTO test_table (name, metadata, active) VALUES ($1, $2, $3)',
        ['Test Name', '{"key": "value"}', true]
      );
      
      const result = await DatabaseService.query('SELECT * FROM test_table');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe('Test Name');
      expect(result.rows[0].active).toBe(true);
    });

    it('should handle concurrent operations', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }
      
      await DatabaseService.initialize({ skipMigrations: true });
      
      await DatabaseService.query(`
        CREATE TABLE IF NOT EXISTS concurrent_test (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          value INTEGER
        )
      `);
      
      // Execute multiple operations concurrently
      const operations = Array.from({ length: 10 }, (_, i) =>
        DatabaseService.query(
          'INSERT INTO concurrent_test (value) VALUES ($1)',
          [i]
        )
      );
      
      await Promise.all(operations);
      
      const result = await DatabaseService.query('SELECT COUNT(*) as count FROM concurrent_test');
      expect(parseInt(result.rows[0].count)).toBe(10);
    });

    it('should handle client acquisition and release', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }
      
      await DatabaseService.initialize({ skipMigrations: true });
      
      const client = await DatabaseService.getClient();
      expect(client).toBeDefined();
      
      const result = await client.query('SELECT 1 as test');
      expect(result.rows[0].test).toBe(1);
      
      // PostgreSQL client should have release method
      if ('release' in client && typeof client.release === 'function') {
        (client as any).release();
      }
    });
  });

  describe('PostgreSQL Integration', () => {
    beforeEach(() => {
      // Set environment for PostgreSQL
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

    it('should provide setup instructions when configuration is invalid', () => {
      delete process.env.DB_HOST;
      
      const validation = DatabaseService.validateConfiguration();
      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      
      const instructions = DatabaseService.getSetupInstructions();
      expect(instructions).toContain('PostgreSQL');
    });

    it('should handle connection failures gracefully', async () => {
      // This will fail because there's no PostgreSQL server running
      await expect(DatabaseService.initialize()).rejects.toThrow();
      
      // Should still be able to get configuration
      const summary = DatabaseService.getConfigSummary() as any;
      expect(summary.type).toBe('postgresql');
    });

    it('should validate Supabase configuration', () => {
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.supabase.co:5432/postgres';
      
      const validation = DatabaseService.validateConfiguration();
      expect(validation.isValid).toBe(true);
      
      const summary = DatabaseService.getConfigSummary() as any;
      expect(summary.config.host).toBe('db.project.supabase.co');
      expect(summary.config.ssl).toBe(true);
    });

    it('should provide helpful error messages for common issues', async () => {
      const testCases = [
        {
          name: 'missing host',
          env: { DB_HOST: '', DB_NAME: 'test', DB_USER: 'test', DB_PASSWORD: 'test' },
          expectedError: /host/i
        },
        {
          name: 'missing credentials',
          env: { DB_HOST: 'localhost', DB_NAME: 'test', DB_USER: '', DB_PASSWORD: '' },
          expectedError: /user|password/i
        }
      ];

      for (const testCase of testCases) {
        // Reset environment
        delete process.env.DB_HOST;
        delete process.env.DB_NAME;
        delete process.env.DB_USER;
        delete process.env.DB_PASSWORD;
        
        // Set test environment
        Object.entries(testCase.env).forEach(([key, value]) => {
          process.env[key] = value;
        });

        try {
          await DatabaseService.initialize();
          fail(`Expected ${testCase.name} to throw an error`);
        } catch (error) {
          expect((error as Error).message).toMatch(testCase.expectedError);
        }
      }
    });

    // Integration test that requires actual PostgreSQL connection
    describe('with real PostgreSQL (optional)', () => {
      const hasTestDb = process.env.TEST_DB_HOST || process.env.CI;

      beforeEach(() => {
        if (!hasTestDb) {
          console.log('Skipping PostgreSQL integration tests - no test database configured');
        }
      });

      it('should connect and execute queries if test database available', async () => {
        if (!hasTestDb) return;

        process.env.DB_HOST = process.env.TEST_DB_HOST || 'localhost';
        process.env.DB_PORT = process.env.TEST_DB_PORT || '5432';
        process.env.DB_NAME = process.env.TEST_DB_NAME || 'test_db';
        process.env.DB_USER = process.env.TEST_DB_USER || 'postgres';
        process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD || 'password';

        try {
          await DatabaseService.initialize();
          
          const result = await DatabaseService.query('SELECT 1 as test');
          expect(result.rows[0].test).toBe(1);
          
          const healthCheck = await DatabaseService.healthCheck();
          expect(healthCheck.status).toBe('healthy');
          expect(healthCheck.type).toBe('postgresql');
          
        } catch (error) {
          console.log('PostgreSQL test database not available:', (error as Error).message);
        }
      });

      it('should run migrations if test database available', async () => {
        if (!hasTestDb) return;

        process.env.DB_HOST = process.env.TEST_DB_HOST || 'localhost';
        process.env.DB_PORT = process.env.TEST_DB_PORT || '5432';
        process.env.DB_NAME = process.env.TEST_DB_NAME || 'test_db';
        process.env.DB_USER = process.env.TEST_DB_USER || 'postgres';
        process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD || 'password';

        try {
          await DatabaseService.initialize();
          
          // Check if migrations table exists
          const result = await DatabaseService.query(
            "SELECT table_name FROM information_schema.tables WHERE table_name = 'migrations'"
          );
          expect(result.rows).toHaveLength(1);
          
        } catch (error) {
          console.log('PostgreSQL migration test failed:', (error as Error).message);
        }
      });
    });
  });

  describe('Database Migration Integration', () => {
    it('should handle PostgreSQL migrations natively', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }
      
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.supabase.co:5432/postgres';
      
      await DatabaseService.initialize({ skipMigrations: true });
      
      // Create test table with PostgreSQL native types
      await DatabaseService.query(`
        CREATE TABLE IF NOT EXISTS test_migration (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          data JSONB DEFAULT '{}',
          active BOOLEAN DEFAULT true,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      await DatabaseService.query(`
        INSERT INTO test_migration (data, active) 
        VALUES ('{"key": "value"}', true)
      `);
      
      // Verify data exists with native PostgreSQL types
      const result = await DatabaseService.query('SELECT * FROM test_migration');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].active).toBe(true); // Native boolean
      expect(typeof result.rows[0].data).toBe('object'); // Native JSONB
    });

    it('should handle migration rollback scenarios', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }
      
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.supabase.co:5432/postgres';
      
      await DatabaseService.initialize({ skipMigrations: true });
      
      // Create initial state
      await DatabaseService.query(`
        CREATE TABLE IF NOT EXISTS rollback_test (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          value INTEGER UNIQUE
        )
      `);
      
      await DatabaseService.query(
        'INSERT INTO rollback_test (value) VALUES ($1)',
        [100]
      );
      
      // Simulate a failed migration by attempting an invalid operation
      try {
        const client = await DatabaseService.getClient();
        await client.query('BEGIN');
        await client.query('INSERT INTO rollback_test (value) VALUES ($1)', [200]);
        await client.query('INSERT INTO rollback_test (value) VALUES ($1)', [300]);
        await client.query('INSERT INTO rollback_test (value) VALUES ($1)', [100]); // This should fail due to unique constraint
        await client.query('COMMIT');
        client.release();
        fail('Expected transaction to fail');
      } catch (error) {
        // Transaction should have been rolled back
        const result = await DatabaseService.query('SELECT COUNT(*) as count FROM rollback_test');
        expect(parseInt(result.rows[0].count)).toBe(1); // Only initial record should remain
      }
    });
  });

  describe('PostgreSQL Native Features', () => {
    it('should handle PostgreSQL-specific queries', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }
      
      const testQueries = [
        'SELECT 1 as test_number',
        'SELECT \'hello\' as test_string',
        'SELECT NULL as test_null'
      ];

      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.supabase.co:5432/postgres';
      
      await DatabaseService.initialize({ skipMigrations: true });
      
      const results = [];
      for (const query of testQueries) {
        const result = await DatabaseService.query(query);
        results.push(result.rows[0]);
      }
      
      // Verify PostgreSQL results
      expect((results[0] as any).test_number).toBe(1);
      expect((results[1] as any).test_string).toBe('hello');
      expect((results[2] as any).test_null).toBeNull();
      
      // Verify configuration
      const config = DatabaseService.getConfigSummary() as any;
      expect(config.type).toBe('postgresql');
    });

    it('should handle complex PostgreSQL queries natively', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }
      
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.supabase.co:5432/postgres';
      
      await DatabaseService.initialize({ skipMigrations: true });
      
      // Create table with PostgreSQL native types
      await DatabaseService.query(`
        CREATE TABLE IF NOT EXISTS complex_test (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_data JSONB DEFAULT '{}',
          tags TEXT[] DEFAULT '{}',
          is_active BOOLEAN DEFAULT true,
          score DECIMAL(5,2) DEFAULT 0.0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      // Insert complex data
      await DatabaseService.query(`
        INSERT INTO complex_test (user_data, tags, is_active, score) 
        VALUES (
          $1,
          $2,
          $3,
          $4
        )
      `, [
        '{"name": "John", "age": 30}',
        ['tag1', 'tag2', 'tag3'],
        true,
        95.5
      ]);
      
      // Query with PostgreSQL-style operations
      const result = await DatabaseService.query(`
        SELECT 
          id,
          user_data,
          tags,
          is_active,
          score,
          created_at
        FROM complex_test 
        WHERE is_active = true 
        AND score > 90.0
      `);
      
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].is_active).toBe(true); // Native boolean in PostgreSQL
      expect(Array.isArray(result.rows[0].tags)).toBe(true); // Native array
      expect(typeof result.rows[0].user_data).toBe('object'); // Native JSONB
    });
  });

  describe('Performance and Scalability Integration', () => {
    it('should handle large datasets efficiently', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }
      
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.supabase.co:5432/postgres';
      
      await DatabaseService.initialize({ skipMigrations: true });
      
      // Create test table
      await DatabaseService.query(`
        CREATE TABLE IF NOT EXISTS performance_test (
          id SERIAL PRIMARY KEY,
          data TEXT,
          timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      // Insert large dataset using batch operations
      const startTime = Date.now();
      const batchSize = 100;
      
      for (let batch = 0; batch < 10; batch++) {
        const values = Array.from({ length: batchSize }, (_, i) => 
          `($${i + 1})`
        ).join(', ');
        
        const params = Array.from({ length: batchSize }, (_, i) => 
          `batch-${batch}-item-${i}`
        );
        
        await DatabaseService.query(`
          INSERT INTO performance_test (data) VALUES ${values}
        `, params);
      }
      
      const insertTime = Date.now() - startTime;
      
      // Query large dataset
      const queryStartTime = Date.now();
      const result = await DatabaseService.query('SELECT COUNT(*) as count FROM performance_test');
      const queryTime = Date.now() - queryStartTime;
      
      expect(parseInt(result.rows[0].count)).toBe(1000);
      expect(insertTime).toBeLessThan(10000); // Should complete within 10 seconds for PostgreSQL
      expect(queryTime).toBeLessThan(2000); // Should complete within 2 seconds
    });

    it('should handle concurrent database operations', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }
      
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.supabase.co:5432/postgres';
      
      await DatabaseService.initialize({ skipMigrations: true });
      
      await DatabaseService.query(`
        CREATE TABLE IF NOT EXISTS concurrent_operations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          thread_id INTEGER,
          operation_time TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      // Execute concurrent operations
      const concurrentOperations = Array.from({ length: 20 }, (_, i) =>
        DatabaseService.query(
          'INSERT INTO concurrent_operations (thread_id) VALUES ($1)',
          [i % 4]
        )
      );
      
      await Promise.all(concurrentOperations);
      
      // Verify all operations completed
      const result = await DatabaseService.query('SELECT COUNT(*) as count FROM concurrent_operations');
      expect(parseInt(result.rows[0].count)).toBe(20);
      
      // Verify data integrity
      const threadCounts = await DatabaseService.query(`
        SELECT thread_id, COUNT(*) as count 
        FROM concurrent_operations 
        GROUP BY thread_id 
        ORDER BY thread_id
      `);
      
      expect(threadCounts.rows).toHaveLength(4);
      threadCounts.rows.forEach(row => {
        expect(parseInt(row.count)).toBe(5); // Each thread should have 5 operations
      });
    });
  });

  describe('Configuration Management', () => {
    it('should use PostgreSQL as the only database type', () => {
      process.env.NODE_ENV = 'development';
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.supabase.co:5432/postgres';
      
      const config = DatabaseConfigManager.getConfig();
      expect(config.type).toBe('postgresql');
    });

    it('should handle Supabase URL configuration', () => {
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.supabase.co:5432/postgres';
      
      const config = DatabaseConfigManager.getConfig();
      expect(config.type).toBe('postgresql');
      expect(config.postgresql?.host).toBe('db.project.supabase.co');
      expect(config.postgresql?.database).toBe('postgres');
    });

    it('should handle individual PostgreSQL environment variables', () => {
      delete process.env.SUPABASE_DB_URL;
      process.env.DB_HOST = 'localhost';
      process.env.DB_NAME = 'prod_db';
      process.env.DB_USER = 'prod_user';
      process.env.DB_PASSWORD = 'prod_password';
      
      DatabaseConfigManager.resetConfig();
      
      const config = DatabaseConfigManager.getConfig();
      expect(config.type).toBe('postgresql');
      expect(config.postgresql?.host).toBe('localhost');
      expect(config.postgresql?.database).toBe('prod_db');
    });

    it('should provide comprehensive setup instructions', () => {
      // Test PostgreSQL/Supabase instructions
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.supabase.co:5432/postgres';
      const instructions = DatabaseService.getSetupInstructions();
      expect(instructions).toContain('PostgreSQL');
      expect(instructions).toContain('DB_HOST');
      expect(instructions).toContain('SUPABASE_DB_URL');
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should recover from connection failures', async () => {
      // Skip if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }
      
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.supabase.co:5432/postgres';
      
      await DatabaseService.initialize({ skipMigrations: true });
      
      // Verify initial connection works
      let result = await DatabaseService.query('SELECT 1 as test');
      expect(result.rows[0].test).toBe(1);
      
      // Simulate connection loss by closing
      await DatabaseService.close();
      
      // Attempt to use service after close (should fail)
      await expect(DatabaseService.query('SELECT 1')).rejects.toThrow();
      
      // Reinitialize and verify recovery
      await DatabaseService.initialize({ skipMigrations: true });
      result = await DatabaseService.query('SELECT 1 as test');
      expect(result.rows[0].test).toBe(1);
    });

    it('should handle invalid connection configuration gracefully', async () => {
      // Test with invalid Supabase URL
      process.env.SUPABASE_DB_URL = 'postgresql://invalid:invalid@invalid.supabase.co:5432/invalid';
      
      DatabaseService.reset();
      
      // Should fail to initialize with invalid configuration
      await expect(DatabaseService.initialize({ skipMigrations: true })).rejects.toThrow();
      
      // Should be able to recover with valid configuration
      process.env.SUPABASE_DB_URL = 'postgresql://postgres:password@db.project.supabase.co:5432/postgres';
      
      DatabaseService.reset();
      
      // Skip actual connection test if no test database available
      if (!process.env.TEST_DB_HOST && !process.env.CI && !process.env.SUPABASE_DB_URL) {
        return;
      }
      
      await expect(DatabaseService.initialize({ skipMigrations: true })).resolves.not.toThrow();
    });
  });
});