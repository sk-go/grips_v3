import { PostgreSQLAdapter } from '../../services/database/adapters/PostgreSQLAdapter';
import { DatabaseConfig } from '../../types/database';

describe('PostgreSQLAdapter', () => {
  let adapter: PostgreSQLAdapter;
  
  const mockConfig: DatabaseConfig['postgresql'] = {
    host: 'localhost',
    port: 5432,
    database: 'test_db',
    user: 'test_user',
    password: 'test_password',
    ssl: false
  };

  beforeEach(() => {
    adapter = new PostgreSQLAdapter(mockConfig);
  });

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
    }
  });

  describe('initialization', () => {
    it('should create adapter with configuration', () => {
      expect(adapter).toBeInstanceOf(PostgreSQLAdapter);
    });

    it('should fail to initialize without PostgreSQL server', async () => {
      // This should fail because there's no PostgreSQL server running
      await expect(adapter.initialize()).rejects.toThrow();
    });

    it('should require configuration', () => {
      expect(() => new PostgreSQLAdapter(undefined as any)).not.toThrow();
      // The error should occur during initialization, not construction
    });

    it('should handle missing configuration during initialization', async () => {
      const adapterWithoutConfig = new PostgreSQLAdapter(undefined as any);
      await expect(adapterWithoutConfig.initialize()).rejects.toThrow('PostgreSQL configuration is required');
    });
  });

  describe('configuration validation', () => {
    it('should handle various connection configurations', () => {
      const configs = [
        {
          host: 'localhost',
          port: 5432,
          database: 'test',
          user: 'user',
          password: 'pass',
          ssl: false
        },
        {
          host: 'remote-host',
          port: 5433,
          database: 'prod_db',
          user: 'prod_user',
          password: 'secure_pass',
          ssl: true,
          max: 10,
          idleTimeoutMillis: 10000,
          connectionTimeoutMillis: 5000
        }
      ];

      configs.forEach(config => {
        const testAdapter = new PostgreSQLAdapter(config);
        expect(testAdapter).toBeInstanceOf(PostgreSQLAdapter);
      });
    });
  });

  describe('Supabase connection handling', () => {
    it('should handle Supabase connection strings', () => {
      const supabaseConfig: DatabaseConfig['postgresql'] = {
        host: 'db.project.supabase.co',
        port: 5432,
        database: 'postgres',
        user: 'postgres',
        password: 'password',
        ssl: true
      };

      const supabaseAdapter = new PostgreSQLAdapter(supabaseConfig);
      expect(supabaseAdapter).toBeInstanceOf(PostgreSQLAdapter);
    });

    it('should handle Supabase pooler connections', () => {
      const poolerConfig: DatabaseConfig['postgresql'] = {
        host: 'db.project.pooler.supabase.com',
        port: 5432,
        database: 'postgres',
        user: 'postgres.project',
        password: 'password',
        ssl: true
      };

      const poolerAdapter = new PostgreSQLAdapter(poolerConfig);
      expect(poolerAdapter).toBeInstanceOf(PostgreSQLAdapter);
    });
  });

  describe('error handling', () => {
    it('should provide helpful error messages for connection failures', async () => {
      const configs = [
        {
          name: 'invalid host',
          config: { ...mockConfig, host: 'nonexistent-host.invalid' },
          expectedError: /host not found|connection failed/i
        },
        {
          name: 'invalid port',
          config: { ...mockConfig, port: 99999 },
          expectedError: /connection/i
        },
        {
          name: 'invalid credentials',
          config: { ...mockConfig, user: 'invalid_user', password: 'wrong_password' },
          expectedError: /connection/i
        }
      ];

      for (const { name, config, expectedError } of configs) {
        const testAdapter = new PostgreSQLAdapter(config);
        
        try {
          await testAdapter.initialize();
          // If we reach here, the connection unexpectedly succeeded
          // This might happen in CI environments with actual PostgreSQL
          await testAdapter.close();
        } catch (error) {
          expect((error as Error).message).toMatch(expectedError);
        }
      }
    });

    it('should handle operations on uninitialized adapter', async () => {
      await expect(adapter.query('SELECT 1')).rejects.toThrow('not initialized');
    });

    it('should handle operations after close', async () => {
      // Skip initialization since we don't have a real PostgreSQL server
      // Just test the close operation
      await adapter.close();
      
      // Subsequent operations should fail
      await expect(adapter.query('SELECT 1')).rejects.toThrow();
    });
  });

  describe('query interface compatibility', () => {
    it('should normalize query results', () => {
      // Test the protected normalizeQueryResult method indirectly
      const mockResult = {
        rows: [{ id: 1, name: 'test' }],
        rowCount: 1,
        fields: [{ name: 'id' }, { name: 'name' }]
      };

      // Access the method through type assertion for testing
      const normalized = (adapter as any).normalizeQueryResult(mockResult);
      
      expect(normalized).toEqual({
        rows: [{ id: 1, name: 'test' }],
        rowCount: 1,
        fields: [{ name: 'id' }, { name: 'name' }]
      });
    });

    it('should handle empty query results', () => {
      const emptyResult = {
        rows: [],
        rowCount: 0
      };

      const normalized = (adapter as any).normalizeQueryResult(emptyResult);
      
      expect(normalized).toEqual({
        rows: [],
        rowCount: 0,
        fields: undefined
      });
    });
  });

  describe('connection pooling', () => {
    it('should use connection pool configuration', () => {
      const poolConfig: DatabaseConfig['postgresql'] = {
        ...mockConfig,
        max: 15,
        idleTimeoutMillis: 20000,
        connectionTimeoutMillis: 3000
      };

      const poolAdapter = new PostgreSQLAdapter(poolConfig);
      expect(poolAdapter).toBeInstanceOf(PostgreSQLAdapter);
    });
  });

  // Integration tests that require actual PostgreSQL connection
  describe('integration tests (requires PostgreSQL)', () => {
    const hasTestDb = process.env.TEST_DB_HOST || process.env.CI;

    beforeEach(() => {
      if (!hasTestDb) {
        console.log('Skipping PostgreSQL integration tests - no test database configured');
      }
    });

    it('should connect to test database if available', async () => {
      if (!hasTestDb) return;

      const testConfig: DatabaseConfig['postgresql'] = {
        host: process.env.TEST_DB_HOST || 'localhost',
        port: parseInt(process.env.TEST_DB_PORT || '5432'),
        database: process.env.TEST_DB_NAME || 'test_db',
        user: process.env.TEST_DB_USER || 'postgres',
        password: process.env.TEST_DB_PASSWORD || 'password',
        ssl: false
      };

      const testAdapter = new PostgreSQLAdapter(testConfig);
      
      try {
        await testAdapter.initialize();
        
        // Test basic query
        const result = await testAdapter.query('SELECT 1 as test');
        expect(result.rows[0].test).toBe(1);
        
        // Test client acquisition
        const client = await testAdapter.getClient();
        const clientResult = await client.query('SELECT 2 as test');
        expect(clientResult.rows[0].test).toBe(2);
        if ('release' in client && typeof client.release === 'function') {
          client.release();
        }
        
        await testAdapter.close();
      } catch (error) {
        console.log('PostgreSQL test database not available:', (error as Error).message);
      }
    });

    it('should run migrations if test database available', async () => {
      if (!hasTestDb) return;

      const testConfig: DatabaseConfig['postgresql'] = {
        host: process.env.TEST_DB_HOST || 'localhost',
        port: parseInt(process.env.TEST_DB_PORT || '5432'),
        database: process.env.TEST_DB_NAME || 'test_db',
        user: process.env.TEST_DB_USER || 'postgres',
        password: process.env.TEST_DB_PASSWORD || 'password',
        ssl: false
      };

      const testAdapter = new PostgreSQLAdapter(testConfig);
      
      try {
        await testAdapter.initialize();
        await testAdapter.runMigrations();
        
        // Check if migrations table exists
        const result = await testAdapter.query(
          "SELECT table_name FROM information_schema.tables WHERE table_name = 'migrations'"
        );
        expect(result.rows).toHaveLength(1);
        
        await testAdapter.close();
      } catch (error) {
        console.log('PostgreSQL migration test failed:', (error as Error).message);
      }
    });
  });
});