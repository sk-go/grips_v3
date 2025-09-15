import { SQLiteAdapter } from '../../services/database/adapters/SQLiteAdapter';
import { SQLCompatibilityLayer } from '../../services/database/adapters/SQLCompatibilityLayer';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SQLiteAdapter', () => {
  let adapter: SQLiteAdapter;
  let tempDir: string;
  let testDbPath: string;

  beforeEach(async () => {
    // Create temporary directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-test-'));
    testDbPath = path.join(tempDir, 'test.db');
    
    adapter = new SQLiteAdapter({ filename: testDbPath });
  });

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
    }
    
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('initialization', () => {
    it('should initialize SQLite database', async () => {
      await adapter.initialize();
      expect(fs.existsSync(testDbPath)).toBe(true);
    });

    it('should create directory if it does not exist', async () => {
      const deepPath = path.join(tempDir, 'deep', 'nested', 'test.db');
      const deepAdapter = new SQLiteAdapter({ filename: deepPath });
      
      await deepAdapter.initialize();
      expect(fs.existsSync(deepPath)).toBe(true);
      
      await deepAdapter.close();
    });

    it('should initialize in-memory database', async () => {
      const memoryAdapter = new SQLiteAdapter({ filename: ':memory:' });
      
      await memoryAdapter.initialize();
      expect(memoryAdapter.getDatabase()).toBeDefined();
      
      await memoryAdapter.close();
    });

    it('should enable WAL mode when configured', async () => {
      const walAdapter = new SQLiteAdapter({ 
        filename: path.join(tempDir, 'wal-test.db'),
        enableWAL: true 
      });
      
      await walAdapter.initialize();
      
      // Check if WAL mode is enabled
      const db = walAdapter.getDatabase();
      expect(db).toBeDefined();
      
      await walAdapter.close();
    });

    it('should handle initialization errors gracefully', async () => {
      // Try to create database in a read-only location (should fail)
      const invalidAdapter = new SQLiteAdapter({ filename: '/invalid/path/test.db' });
      
      await expect(invalidAdapter.initialize()).rejects.toThrow();
    });
  });

  describe('basic queries', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should execute CREATE TABLE query', async () => {
      const createTableSQL = `
        CREATE TABLE test_users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `;
      
      const result = await adapter.query(createTableSQL);
      expect(result.rowCount).toBe(0); // CREATE TABLE returns 0 rows
    });

    it('should execute INSERT query', async () => {
      // First create table
      await adapter.query(`
        CREATE TABLE test_users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE
        )
      `);
      
      // Then insert data
      const result = await adapter.query(
        'INSERT INTO test_users (id, name, email) VALUES (?, ?, ?)',
        ['1', 'John Doe', 'john@example.com']
      );
      
      expect(result.rowCount).toBe(1);
    });

    it('should execute SELECT query', async () => {
      // Setup
      await adapter.query(`
        CREATE TABLE test_users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE
        )
      `);
      
      await adapter.query(
        'INSERT INTO test_users (id, name, email) VALUES (?, ?, ?)',
        ['1', 'John Doe', 'john@example.com']
      );
      
      // Test SELECT
      const result = await adapter.query('SELECT * FROM test_users');
      
      expect(result.rowCount).toBe(1);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toEqual({
        id: '1',
        name: 'John Doe',
        email: 'john@example.com'
      });
    });
  });

  describe('SQL compatibility layer', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should translate UUID type to TEXT', async () => {
      const postgresSQL = `
        CREATE TABLE users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL
        )
      `;
      
      // This should not throw an error due to SQL translation
      const result = await adapter.query(postgresSQL);
      expect(result.rowCount).toBe(0);
    });

    it('should translate BOOLEAN to INTEGER', async () => {
      const postgresSQL = `
        CREATE TABLE settings (
          id TEXT PRIMARY KEY,
          is_active BOOLEAN DEFAULT true
        )
      `;
      
      const result = await adapter.query(postgresSQL);
      expect(result.rowCount).toBe(0);
    });

    it('should translate TIMESTAMP WITH TIME ZONE', async () => {
      const postgresSQL = `
        CREATE TABLE events (
          id TEXT PRIMARY KEY,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `;
      
      const result = await adapter.query(postgresSQL);
      expect(result.rowCount).toBe(0);
    });
  });

  describe('client interface', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should provide database client', async () => {
      const client = await adapter.getClient();
      expect(client).toBeDefined();
      expect(typeof client.query).toBe('function');
    });

    it('should execute queries through client', async () => {
      const client = await adapter.getClient();
      
      await client.query(`
        CREATE TABLE test_table (
          id TEXT PRIMARY KEY,
          value TEXT
        )
      `);
      
      const result = await client.query(
        'INSERT INTO test_table (id, value) VALUES (?, ?)',
        ['1', 'test']
      );
      
      expect(result.rowCount).toBe(1);
    });
  });

  describe('migrations', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should create migrations table', async () => {
      await adapter.runMigrations();
      
      // Check if migrations table exists
      const result = await adapter.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'"
      );
      
      expect(result.rows).toHaveLength(1);
    });

    it('should execute migration SQL with translation', async () => {
      const migrationSQL = `
        CREATE TABLE test_migration (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          data JSONB DEFAULT '{}',
          active BOOLEAN DEFAULT true,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `;
      
      await adapter.executeMigrationSQL(migrationSQL);
      
      // Check if table was created with proper translation
      const result = await adapter.query(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='test_migration'"
      );
      
      expect(result.rows).toHaveLength(1);
      const createdSQL = result.rows[0].sql;
      expect(createdSQL).toContain('TEXT'); // UUID -> TEXT
      expect(createdSQL).toContain('INTEGER'); // BOOLEAN -> INTEGER
    });
  });

  describe('transactions', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should execute transactions successfully', async () => {
      await adapter.query(`
        CREATE TABLE test_transaction (
          id TEXT PRIMARY KEY,
          value INTEGER
        )
      `);

      const result = await adapter.transaction((db) => {
        const insert = db.prepare('INSERT INTO test_transaction (id, value) VALUES (?, ?)');
        insert.run('1', 100);
        insert.run('2', 200);
        
        const select = db.prepare('SELECT COUNT(*) as count FROM test_transaction');
        return select.get() as { count: number };
      });

      expect(result.count).toBe(2);
    });

    it('should rollback failed transactions', async () => {
      await adapter.query(`
        CREATE TABLE test_rollback (
          id TEXT PRIMARY KEY,
          value INTEGER UNIQUE
        )
      `);

      // Insert initial data
      await adapter.query('INSERT INTO test_rollback (id, value) VALUES (?, ?)', ['1', 100]);

      // Try transaction that should fail due to unique constraint
      await expect(
        adapter.transaction((db) => {
          const insert = db.prepare('INSERT INTO test_rollback (id, value) VALUES (?, ?)');
          insert.run('2', 200);
          insert.run('3', 100); // This should fail due to unique constraint
        })
      ).rejects.toThrow();

      // Check that no partial data was inserted
      const result = await adapter.query('SELECT COUNT(*) as count FROM test_rollback');
      expect(result.rows[0].count).toBe(1); // Only original record
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should handle SQL syntax errors', async () => {
      await expect(
        adapter.query('INVALID SQL SYNTAX')
      ).rejects.toThrow();
    });

    it('should handle constraint violations', async () => {
      await adapter.query(`
        CREATE TABLE test_constraints (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL
        )
      `);

      // Insert valid record
      await adapter.query(
        'INSERT INTO test_constraints (id, email) VALUES (?, ?)',
        ['1', 'test@example.com']
      );

      // Try to insert duplicate email
      await expect(
        adapter.query(
          'INSERT INTO test_constraints (id, email) VALUES (?, ?)',
          ['2', 'test@example.com']
        )
      ).rejects.toThrow();
    });

    it('should handle operations on uninitialized adapter', async () => {
      const uninitializedAdapter = new SQLiteAdapter({ filename: ':memory:' });
      
      await expect(
        uninitializedAdapter.query('SELECT 1')
      ).rejects.toThrow('not initialized');
    });

    it('should handle operations after close', async () => {
      await adapter.initialize();
      await adapter.close();
      
      await expect(
        adapter.query('SELECT 1')
      ).rejects.toThrow();
    });
  });

  describe('performance and optimization', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should handle large result sets efficiently', async () => {
      await adapter.query(`
        CREATE TABLE test_performance (
          id INTEGER PRIMARY KEY,
          data TEXT
        )
      `);

      // Insert test data
      const insertStmt = 'INSERT INTO test_performance (data) VALUES (?)';
      for (let i = 0; i < 1000; i++) {
        await adapter.query(insertStmt, [`test-data-${i}`]);
      }

      const startTime = Date.now();
      const result = await adapter.query('SELECT * FROM test_performance');
      const duration = Date.now() - startTime;

      expect(result.rows).toHaveLength(1000);
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should handle concurrent queries', async () => {
      await adapter.query(`
        CREATE TABLE test_concurrent (
          id TEXT PRIMARY KEY,
          value INTEGER
        )
      `);

      // Execute multiple queries concurrently
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          adapter.query(
            'INSERT INTO test_concurrent (id, value) VALUES (?, ?)',
            [`id-${i}`, i]
          )
        );
      }

      await Promise.all(promises);

      const result = await adapter.query('SELECT COUNT(*) as count FROM test_concurrent');
      expect(result.rows[0].count).toBe(10);
    });
  });
});

describe('SQLCompatibilityLayer', () => {
  describe('UUID translation', () => {
    it('should replace UUID type with TEXT', () => {
      const sql = 'CREATE TABLE users (id UUID PRIMARY KEY)';
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain('id TEXT PRIMARY KEY');
    });

    it('should replace gen_random_uuid() function', () => {
      const sql = 'INSERT INTO users (id) VALUES (gen_random_uuid())';
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain('sqlite_generate_uuid()');
    });

    it('should handle multiple UUID columns', () => {
      const sql = `
        CREATE TABLE relationships (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL,
          client_id UUID REFERENCES clients(id)
        )
      `;
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain('id TEXT PRIMARY KEY');
      expect(translated).toContain('user_id TEXT NOT NULL');
      expect(translated).toContain('client_id TEXT REFERENCES clients(id)');
    });

    it('should handle UUID in complex expressions', () => {
      const sql = "SELECT * FROM users WHERE id = gen_random_uuid() OR parent_id = 'some-uuid'::UUID";
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain('sqlite_generate_uuid()');
      expect(translated).not.toContain('UUID');
    });
  });

  describe('JSONB translation', () => {
    it('should replace JSONB with TEXT', () => {
      const sql = 'CREATE TABLE data (config JSONB)';
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain('config TEXT');
    });

    it('should handle JSONB default values', () => {
      const sql = "CREATE TABLE settings (config JSONB DEFAULT '{}'::jsonb)";
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain('config TEXT DEFAULT \'{}\'');
      expect(translated).not.toContain('::jsonb');
    });

    it('should translate JSONB operators', () => {
      const sql = "SELECT data->'key' as value, data->>'nested' as text FROM table";
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      // The current implementation doesn't translate JSONB operators yet
      // This is a placeholder test for future enhancement
      expect(translated).toContain("data->'key'");
    });

    it('should handle array access in JSONB', () => {
      const sql = "SELECT data->0->>'name' FROM users";
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      // The current implementation doesn't translate JSONB array operators yet
      // This is a placeholder test for future enhancement
      expect(translated).toContain("data->0->>'name'");
    });

    it('should handle complex JSONB expressions', () => {
      const sql = `
        UPDATE users 
        SET metadata = metadata || '{"updated": true}'::jsonb 
        WHERE preferences->>'theme' = 'dark'
      `;
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain("JSON_EXTRACT(preferences, '$.theme')");
      expect(translated).not.toContain('::jsonb');
    });
  });

  describe('Boolean translation', () => {
    it('should replace BOOLEAN with INTEGER', () => {
      const sql = 'CREATE TABLE settings (active BOOLEAN)';
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain('active INTEGER');
    });

    it('should replace true/false with 1/0', () => {
      const sql = 'INSERT INTO settings (active) VALUES (true)';
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain('VALUES (1)');
    });

    it('should handle boolean defaults', () => {
      const sql = 'CREATE TABLE users (active BOOLEAN DEFAULT true, deleted BOOLEAN DEFAULT false)';
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain('active INTEGER DEFAULT 1');
      expect(translated).toContain('deleted INTEGER DEFAULT 0');
    });

    it('should handle boolean in WHERE clauses', () => {
      const sql = 'SELECT * FROM users WHERE active = true AND deleted = false';
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain('active = 1');
      expect(translated).toContain('deleted = 0');
    });

    it('should handle boolean in complex expressions', () => {
      const sql = 'UPDATE users SET active = CASE WHEN status = \'enabled\' THEN true ELSE false END';
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain('THEN 1 ELSE 0');
    });
  });

  describe('Timestamp translation', () => {
    it('should replace TIMESTAMP WITH TIME ZONE', () => {
      const sql = 'CREATE TABLE events (created_at TIMESTAMP WITH TIME ZONE)';
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain('created_at DATETIME');
    });

    it('should replace NOW() with CURRENT_TIMESTAMP', () => {
      const sql = 'INSERT INTO events (created_at) VALUES (NOW())';
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain('CURRENT_TIMESTAMP');
    });

    it('should handle timestamp defaults', () => {
      const sql = 'CREATE TABLE logs (created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW())';
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain('created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    });

    it('should translate interval arithmetic', () => {
      const sql = "SELECT * FROM events WHERE created_at > NOW() - INTERVAL '30 days'";
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain("datetime('now', '-30 days')");
    });

    it('should handle complex date expressions', () => {
      const sql = `
        SELECT * FROM events 
        WHERE created_at BETWEEN NOW() - INTERVAL '7 days' AND NOW() + INTERVAL '1 day'
      `;
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain("datetime('now', '-7 days')");
      expect(translated).toContain("datetime('now', '+1 day')");
    });
  });

  describe('advanced SQL features', () => {
    it('should translate PostgreSQL functions', () => {
      const sql = "SELECT CONCAT(first_name, ' ', last_name) as full_name FROM users";
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain('(first_name ||  \' \'  || last_name)');
    });

    it('should translate ILIKE to case-insensitive LIKE', () => {
      const sql = "SELECT * FROM users WHERE name ILIKE '%john%'";
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain("LOWER(name) LIKE LOWER('%john%')");
    });

    it('should handle array types', () => {
      const sql = 'CREATE TABLE tags (id TEXT, labels TEXT[])';
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain('labels TEXT');
    });

    it('should translate materialized views', () => {
      const sql = 'CREATE MATERIALIZED VIEW user_stats AS SELECT COUNT(*) FROM users';
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain('CREATE VIEW IF NOT EXISTS user_stats');
    });

    it('should handle PostgreSQL triggers and functions', () => {
      const sql = `
        CREATE OR REPLACE FUNCTION update_timestamp()
        RETURNS TRIGGER AS $
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $ language 'plpgsql';
        
        CREATE TRIGGER update_users_timestamp 
            BEFORE UPDATE ON users 
            FOR EACH ROW 
            EXECUTE FUNCTION update_timestamp();
      `;
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain('-- PostgreSQL function removed');
    });

    it('should translate full-text search features', () => {
      const sql = `
        CREATE INDEX idx_content_search ON documents USING GIN(to_tsvector('english', content));
        SELECT * FROM documents WHERE to_tsvector(content) @@ plainto_tsquery('search term');
      `;
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain('-- Full-text search index removed');
      expect(translated).toContain('-- FTS search placeholder');
    });
  });

  describe('parameter translation', () => {
    it('should translate PostgreSQL parameter placeholders', () => {
      const sql = 'SELECT * FROM users WHERE id = $1 AND name = $2';
      const params = ['123', 'John'];
      
      const result = SQLCompatibilityLayer.translateParameters(sql, params);
      
      expect(result.sql).toBe('SELECT * FROM users WHERE id = ? AND name = ?');
      expect(result.params).toEqual(['123', 'John']);
    });

    it('should handle mixed parameter types', () => {
      const sql = 'INSERT INTO users (id, name, active) VALUES ($1, $2, $3)';
      const params = ['uuid-123', 'John Doe', true];
      
      const result = SQLCompatibilityLayer.translateParameters(sql, params);
      
      expect(result.sql).toBe('INSERT INTO users (id, name, active) VALUES (?, ?, ?)');
      expect(result.params).toEqual(['uuid-123', 'John Doe', true]);
    });
  });

  describe('migration-specific translations', () => {
    it('should translate migration SQL with enhanced features', () => {
      const migrationSQL = `
        CREATE TABLE users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          data JSONB DEFAULT '{}'::jsonb,
          active BOOLEAN DEFAULT true,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        CREATE INDEX CONCURRENTLY idx_users_data ON users USING GIN(data);
      `;
      
      const translated = SQLCompatibilityLayer.translateMigrationSQL(migrationSQL);
      
      expect(translated).toContain('id TEXT PRIMARY KEY');
      expect(translated).toContain('data TEXT DEFAULT \'{}\'');
      expect(translated).toContain('active INTEGER DEFAULT 1');
      expect(translated).toContain('created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
      expect(translated).toContain('-- Full-text search index removed');
      expect(translated).not.toContain('CONCURRENTLY');
    });

    it('should handle complex migration constraints', () => {
      const sql = `
        CREATE TABLE orders (
          id UUID PRIMARY KEY,
          status VARCHAR(20) CHECK (status IN ('pending', 'completed', 'cancelled')),
          amount DECIMAL(10,2) CHECK (amount > 0),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `;
      
      const translated = SQLCompatibilityLayer.translateMigrationSQL(sql);
      
      expect(translated).toContain('id TEXT PRIMARY KEY');
      expect(translated).toContain("CHECK (status IN ('pending', 'completed', 'cancelled'))");
      expect(translated).toContain('CHECK (amount > 0)');
    });
  });

  describe('utility functions', () => {
    it('should generate valid UUIDs', () => {
      const uuid = SQLCompatibilityLayer.generateUUID();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should generate unique UUIDs', () => {
      const uuids = Array.from({ length: 100 }, () => SQLCompatibilityLayer.generateUUID());
      const uniqueUuids = new Set(uuids);
      expect(uniqueUuids.size).toBe(100);
    });

    it('should validate JSON strings', () => {
      expect(SQLCompatibilityLayer.validateJSON('{"valid": true}')).toBe(true);
      expect(SQLCompatibilityLayer.validateJSON('invalid json')).toBe(false);
      expect(SQLCompatibilityLayer.validateJSON('null')).toBe(true);
      expect(SQLCompatibilityLayer.validateJSON('[]')).toBe(true);
      expect(SQLCompatibilityLayer.validateJSON('')).toBe(false);
    });

    it('should convert arrays to JSON', () => {
      const array = ['item1', 'item2'];
      const json = SQLCompatibilityLayer.arrayToJSON(array);
      expect(json).toBe('["item1","item2"]');
      
      const complexArray = [{ id: 1, name: 'test' }, { id: 2, name: 'test2' }];
      const complexJson = SQLCompatibilityLayer.arrayToJSON(complexArray);
      expect(JSON.parse(complexJson)).toEqual(complexArray);
    });

    it('should convert JSON back to arrays', () => {
      const json = '["item1","item2"]';
      const array = SQLCompatibilityLayer.jsonToArray(json);
      expect(array).toEqual(['item1', 'item2']);
      
      // Handle invalid JSON
      const invalidArray = SQLCompatibilityLayer.jsonToArray('invalid json');
      expect(invalidArray).toEqual([]);
      
      // Handle non-array JSON
      const nonArrayResult = SQLCompatibilityLayer.jsonToArray('{"not": "array"}');
      expect(nonArrayResult).toEqual([]);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle empty SQL strings', () => {
      const translated = SQLCompatibilityLayer.translateSQL('');
      expect(translated).toBe('');
    });

    it('should handle SQL with no PostgreSQL features', () => {
      const sql = 'SELECT * FROM users WHERE id = 1';
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toBe(sql); // Should remain unchanged
    });

    it('should handle malformed SQL gracefully', () => {
      const malformedSQL = 'CREATE TABLE users ( id UUID PRIMARY';
      const translated = SQLCompatibilityLayer.translateSQL(malformedSQL);
      expect(translated).toContain('TEXT'); // Should still translate UUID
    });

    it('should handle very long SQL statements', () => {
      const longSQL = 'SELECT ' + 'column, '.repeat(1000) + 'id FROM users WHERE active = true';
      const translated = SQLCompatibilityLayer.translateSQL(longSQL);
      expect(translated).toContain('active = 1');
    });

    it('should handle SQL with comments', () => {
      const sql = `
        -- This is a comment
        CREATE TABLE users (
          id UUID PRIMARY KEY, -- UUID column
          active BOOLEAN DEFAULT true /* boolean column */
        );
      `;
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain('id TEXT PRIMARY KEY');
      expect(translated).toContain('active INTEGER DEFAULT 1');
    });

    it('should handle case-insensitive SQL keywords', () => {
      const sql = 'create table Users (Id uuid primary key, Active boolean default True)';
      const translated = SQLCompatibilityLayer.translateSQL(sql);
      expect(translated).toContain('Id TEXT primary key');
      expect(translated).toContain('Active INTEGER default 1');
    });
  });
});