import { DatabaseService } from '../../services/database/DatabaseService';
import { MigrationRunner } from '../../services/database/MigrationRunner';
import { PostgreSQLAdapter } from '../../services/database/adapters/PostgreSQLAdapter';
import { DatabaseConfigManager } from '../../services/database/config';
import { isSupabaseTestAvailable, setupSupabaseTestEnvironment, cleanupSupabaseTestEnvironment } from '../setup/supabaseTestSetup';
import fs from 'fs';
import path from 'path';

describe('Migration PostgreSQL Compatibility', () => {
  let adapter: PostgreSQLAdapter;
  let migrationRunner: MigrationRunner;

  beforeAll(async () => {
    // Skip tests if no Supabase test environment is available
    if (!isSupabaseTestAvailable()) {
      console.log('Skipping migration compatibility tests - no Supabase test environment configured');
      return;
    }

    // Setup test environment
    setupSupabaseTestEnvironment();
    
    // For local testing, disable SSL to avoid connection issues
    if (!process.env.CI && !process.env.SUPABASE_DB_URL) {
      process.env.DB_SSL = 'false';
    }
    
    // Ensure we're using PostgreSQL configuration
    const config = DatabaseConfigManager.getConfig();
    expect(config.type).toBe('postgresql');
    
    adapter = new PostgreSQLAdapter(config.postgresql!);
    await adapter.initialize();
    migrationRunner = new MigrationRunner(adapter);
  });

  afterAll(async () => {
    if (adapter) {
      await adapter.close();
    }
    cleanupSupabaseTestEnvironment();
  });

  beforeEach(async () => {
    // Skip if no test environment
    if (!isSupabaseTestAvailable() || !adapter) {
      return;
    }
    
    // Clean up database before each test
    await adapter.query('DROP SCHEMA public CASCADE');
    await adapter.query('CREATE SCHEMA public');
    await adapter.query('GRANT ALL ON SCHEMA public TO postgres');
    await adapter.query('GRANT ALL ON SCHEMA public TO public');
  });

  describe('Individual Migration Files', () => {
    const migrationDir = path.join(__dirname, '../../database/migrations');
    const migrationFiles = fs.readdirSync(migrationDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    test.each(migrationFiles)('Migration %s should execute without errors', async (migrationFile) => {
      if (!isSupabaseTestAvailable() || !adapter) {
        console.log(`Skipping migration test for ${migrationFile} - no test environment`);
        return;
      }

      const migrationPath = path.join(migrationDir, migrationFile);
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

      // Execute the migration SQL directly
      await expect(async () => {
        const statements = migrationSQL
          .split(';')
          .map(stmt => stmt.trim())
          .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

        for (const statement of statements) {
          if (statement.trim()) {
            await adapter.query(statement);
          }
        }
      }).not.toThrow();
    });
  });

  describe('Migration Runner Integration', () => {
    test('should run all migrations successfully', async () => {
      if (!isSupabaseTestAvailable() || !adapter) {
        console.log('Skipping migration runner test - no test environment');
        return;
      }
      await expect(migrationRunner.runMigrations()).resolves.not.toThrow();
    });

    test('should create all expected tables', async () => {
      await migrationRunner.runMigrations();

      const result = await adapter.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `);

      const expectedTables = [
        'auto_tag_rules',
        'clients',
        'client_preferences',
        'client_relationships',
        'conversation_summaries',
        'document_activities',
        'document_templates',
        'email_accounts',
        'email_messages',
        'email_sync_logs',
        'family_members',
        'generated_documents',
        'important_dates',
        'meeting_briefs',
        'migrations',
        'office_hours',
        'password_reset_tokens',
        'phone_calls',
        'sms_messages',
        'template_approvals',
        'users'
      ];

      const actualTables = result.rows.map(row => row.table_name);
      
      for (const expectedTable of expectedTables) {
        expect(actualTables).toContain(expectedTable);
      }
    });

    test('should create all expected views', async () => {
      await migrationRunner.runMigrations();

      const result = await adapter.query(`
        SELECT table_name 
        FROM information_schema.views 
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);

      const expectedViews = [
        'communication_stats',
        'recent_document_activities',
        'unified_communications'
      ];

      const actualViews = result.rows.map(row => row.table_name);
      
      for (const expectedView of expectedViews) {
        expect(actualViews).toContain(expectedView);
      }
    });

    test('should create all expected functions', async () => {
      await migrationRunner.runMigrations();

      const result = await adapter.query(`
        SELECT routine_name 
        FROM information_schema.routines 
        WHERE routine_schema = 'public' 
        AND routine_type = 'FUNCTION'
        ORDER BY routine_name
      `);

      const expectedFunctions = [
        'apply_auto_tags',
        'cleanup_expired_password_reset_tokens',
        'get_communication_timeline',
        'invalidate_user_reset_tokens',
        'refresh_communication_stats',
        'update_auto_tag_rules_updated_at',
        'update_clients_updated_at',
        'update_document_template_updated_at',
        'update_email_accounts_updated_at',
        'update_email_messages_updated_at',
        'update_office_hours_updated_at',
        'update_phone_calls_updated_at',
        'update_sms_messages_updated_at',
        'update_updated_at_column'
      ];

      const actualFunctions = result.rows.map(row => row.routine_name);
      
      for (const expectedFunction of expectedFunctions) {
        expect(actualFunctions).toContain(expectedFunction);
      }
    });

    test('should create all expected triggers', async () => {
      await migrationRunner.runMigrations();

      const result = await adapter.query(`
        SELECT trigger_name 
        FROM information_schema.triggers 
        WHERE trigger_schema = 'public'
        ORDER BY trigger_name
      `);

      const expectedTriggers = [
        'invalidate_reset_tokens_on_password_change',
        'trigger_clients_updated_at',
        'trigger_client_preferences_updated_at',
        'trigger_client_relationships_updated_at',
        'trigger_family_members_updated_at',
        'trigger_important_dates_updated_at',
        'trigger_meeting_briefs_updated_at',
        'trigger_update_auto_tag_rules_updated_at',
        'trigger_update_email_accounts_updated_at',
        'trigger_update_email_messages_updated_at',
        'trigger_update_office_hours_updated_at',
        'trigger_update_phone_calls_updated_at',
        'trigger_update_sms_messages_updated_at',
        'update_document_templates_updated_at',
        'update_users_updated_at'
      ];

      const actualTriggers = result.rows.map(row => row.trigger_name);
      
      for (const expectedTrigger of expectedTriggers) {
        expect(actualTriggers).toContain(expectedTrigger);
      }
    });
  });

  describe('PostgreSQL-Specific Features', () => {
    beforeEach(async () => {
      await migrationRunner.runMigrations();
    });

    test('should support UUID generation', async () => {
      const result = await adapter.query('SELECT gen_random_uuid() as uuid');
      expect(result.rows[0].uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    test('should support JSONB operations', async () => {
      await adapter.query(`
        INSERT INTO clients (crm_id, crm_system, name, email) 
        VALUES ('test-123', 'zoho', 'Test Client', 'test@example.com')
      `);

      await adapter.query(`
        INSERT INTO client_preferences (client_id, category, preferences) 
        VALUES (
          (SELECT id FROM clients WHERE crm_id = 'test-123'), 
          'hobbies', 
          '{"sports": ["tennis", "golf"], "music": ["jazz", "classical"]}'::jsonb
        )
      `);

      const result = await adapter.query(`
        SELECT preferences->'sports' as sports 
        FROM client_preferences 
        WHERE category = 'hobbies'
      `);

      expect(result.rows[0].sports).toEqual(['tennis', 'golf']);
    });

    test('should support full-text search', async () => {
      await adapter.query(`
        INSERT INTO users (keycloak_id, email, first_name, last_name) 
        VALUES ('test-user', 'test@example.com', 'Test', 'User')
      `);

      await adapter.query(`
        INSERT INTO email_accounts (user_id, email, provider, imap_config, smtp_config) 
        VALUES (
          (SELECT id FROM users WHERE keycloak_id = 'test-user'),
          'test@example.com',
          'gmail',
          '{"host": "imap.gmail.com"}'::jsonb,
          '{"host": "smtp.gmail.com"}'::jsonb
        )
      `);

      await adapter.query(`
        INSERT INTO email_messages (
          id, account_id, message_id, uid, folder, 
          from_addresses, to_addresses, subject, body_text, date
        ) VALUES (
          'msg-1',
          (SELECT id FROM email_accounts WHERE email = 'test@example.com'),
          'message-123',
          1,
          'INBOX',
          '[{"address": "sender@example.com"}]'::jsonb,
          '[{"address": "test@example.com"}]'::jsonb,
          'Important insurance policy update',
          'This is about your life insurance policy renewal',
          NOW()
        )
      `);

      const result = await adapter.query(`
        SELECT subject 
        FROM email_messages 
        WHERE to_tsvector('english', subject || ' ' || body_text) @@ plainto_tsquery('english', 'insurance policy')
      `);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].subject).toBe('Important insurance policy update');
    });

    test('should support array operations', async () => {
      await adapter.query(`
        INSERT INTO users (keycloak_id, email, first_name, last_name) 
        VALUES ('test-user', 'test@example.com', 'Test', 'User')
      `);

      await adapter.query(`
        INSERT INTO clients (crm_id, crm_system, name, email) 
        VALUES ('test-123', 'zoho', 'Test Client', 'test@example.com')
      `);

      await adapter.query(`
        INSERT INTO conversation_summaries (client_id, summary, key_topics, action_items) 
        VALUES (
          (SELECT id FROM clients WHERE crm_id = 'test-123'),
          'Discussed policy renewal and coverage options',
          ARRAY['policy renewal', 'coverage options', 'premium changes'],
          ARRAY['send renewal documents', 'schedule follow-up call']
        )
      `);

      const result = await adapter.query(`
        SELECT key_topics, action_items 
        FROM conversation_summaries 
        WHERE 'policy renewal' = ANY(key_topics)
      `);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].key_topics).toContain('policy renewal');
      expect(result.rows[0].action_items).toContain('send renewal documents');
    });

    test('should support timestamp with timezone operations', async () => {
      const result = await adapter.query(`
        SELECT 
          NOW() as current_time,
          NOW() AT TIME ZONE 'UTC' as utc_time,
          NOW() + INTERVAL '1 day' as tomorrow
      `);

      expect(result.rows[0].current_time).toBeDefined();
      expect(result.rows[0].utc_time).toBeDefined();
      expect(result.rows[0].tomorrow).toBeDefined();
    });

    test('should support materialized views', async () => {
      // Insert some test data
      await adapter.query(`
        INSERT INTO users (keycloak_id, email, first_name, last_name) 
        VALUES ('test-user', 'test@example.com', 'Test', 'User')
      `);

      await adapter.query(`
        INSERT INTO email_accounts (user_id, email, provider, imap_config, smtp_config) 
        VALUES (
          (SELECT id FROM users WHERE keycloak_id = 'test-user'),
          'test@example.com',
          'gmail',
          '{"host": "imap.gmail.com"}'::jsonb,
          '{"host": "smtp.gmail.com"}'::jsonb
        )
      `);

      await adapter.query(`
        INSERT INTO email_messages (
          id, account_id, message_id, uid, folder, 
          from_addresses, to_addresses, subject, body_text, date
        ) VALUES (
          'msg-1',
          (SELECT id FROM email_accounts WHERE email = 'test@example.com'),
          'message-123',
          1,
          'INBOX',
          '[{"address": "sender@example.com"}]'::jsonb,
          '[{"address": "test@example.com"}]'::jsonb,
          'Test message',
          'Test body',
          NOW()
        )
      `);

      // Refresh the materialized view
      await adapter.query('REFRESH MATERIALIZED VIEW communication_stats');

      const result = await adapter.query('SELECT * FROM communication_stats LIMIT 1');
      expect(result.rows).toBeDefined();
    });
  });

  describe('Data Integrity and Constraints', () => {
    beforeEach(async () => {
      await migrationRunner.runMigrations();
    });

    test('should enforce foreign key constraints', async () => {
      await expect(async () => {
        await adapter.query(`
          INSERT INTO family_members (client_id, name, relationship) 
          VALUES ('00000000-0000-0000-0000-000000000000', 'Test Member', 'spouse')
        `);
      }).rejects.toThrow();
    });

    test('should enforce check constraints', async () => {
      await adapter.query(`
        INSERT INTO users (keycloak_id, email, first_name, last_name) 
        VALUES ('test-user', 'test@example.com', 'Test', 'User')
      `);

      await expect(async () => {
        await adapter.query(`
          INSERT INTO clients (crm_id, crm_system, name, email, relationship_score) 
          VALUES ('test-123', 'invalid_system', 'Test Client', 'test@example.com', 150)
        `);
      }).rejects.toThrow();
    });

    test('should enforce unique constraints', async () => {
      await adapter.query(`
        INSERT INTO users (keycloak_id, email, first_name, last_name) 
        VALUES ('test-user-1', 'test@example.com', 'Test', 'User')
      `);

      await expect(async () => {
        await adapter.query(`
          INSERT INTO users (keycloak_id, email, first_name, last_name) 
          VALUES ('test-user-2', 'test@example.com', 'Test', 'User')
        `);
      }).rejects.toThrow();
    });
  });

  describe('Migration Rollback Safety', () => {
    test('should handle migration failures gracefully', async () => {
      // This test ensures that if a migration fails, it doesn't leave the database in an inconsistent state
      const invalidSQL = 'CREATE TABLE invalid_syntax (';
      
      await expect(async () => {
        await adapter.query(invalidSQL);
      }).rejects.toThrow();

      // Database should still be functional
      const result = await adapter.query('SELECT 1 as test');
      expect(result.rows[0].test).toBe(1);
    });
  });
});