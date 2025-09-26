#!/usr/bin/env node

/**
 * Migration Verification Script
 * 
 * This script verifies that all database migrations are compatible with PostgreSQL
 * and can be executed successfully against a Supabase database.
 * 
 * Usage:
 *   npm run verify-migrations
 *   or
 *   npx ts-node src/scripts/verifyMigrations.ts
 */

import { DatabaseConfigManager } from '../services/database/config';
import { PostgreSQLAdapter } from '../services/database/adapters/PostgreSQLAdapter';
import { MigrationRunner } from '../services/database/MigrationRunner';
import fs from 'fs';
import path from 'path';

interface MigrationVerificationResult {
  success: boolean;
  migrationFile: string;
  error?: string;
  executionTime?: number;
}

interface VerificationSummary {
  totalMigrations: number;
  successfulMigrations: number;
  failedMigrations: number;
  results: MigrationVerificationResult[];
  totalExecutionTime: number;
}

class MigrationVerifier {
  private adapter: PostgreSQLAdapter | null = null;
  private migrationRunner: MigrationRunner | null = null;

  async initialize(): Promise<void> {
    console.log('🔧 Initializing database connection...');
    
    const config = DatabaseConfigManager.getConfig();
    
    if (config.type !== 'postgresql') {
      throw new Error('This verification script requires PostgreSQL configuration');
    }

    this.adapter = new PostgreSQLAdapter(config.postgresql!);
    await this.adapter.initialize();
    this.migrationRunner = new MigrationRunner(this.adapter);
    
    console.log('✅ Database connection established');
  }

  async cleanup(): Promise<void> {
    if (this.adapter) {
      await this.adapter.close();
      console.log('🔌 Database connection closed');
    }
  }

  async verifyIndividualMigrations(): Promise<MigrationVerificationResult[]> {
    console.log('\n📋 Verifying individual migration files...');
    
    const migrationDir = path.join(__dirname, '../database/migrations');
    const migrationFiles = fs.readdirSync(migrationDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    const results: MigrationVerificationResult[] = [];

    for (const migrationFile of migrationFiles) {
      console.log(`  📄 Testing ${migrationFile}...`);
      
      const startTime = Date.now();
      
      try {
        // Clean database before each migration test
        await this.cleanDatabase();
        
        // Read and execute migration
        const migrationPath = path.join(migrationDir, migrationFile);
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        
        await this.executeMigrationSQL(migrationSQL);
        
        const executionTime = Date.now() - startTime;
        
        results.push({
          success: true,
          migrationFile,
          executionTime
        });
        
        console.log(`    ✅ Success (${executionTime}ms)`);
        
      } catch (error) {
        const executionTime = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        results.push({
          success: false,
          migrationFile,
          error: errorMessage,
          executionTime
        });
        
        console.log(`    ❌ Failed: ${errorMessage}`);
      }
    }

    return results;
  }

  async verifyMigrationRunner(): Promise<boolean> {
    console.log('\n🏃 Verifying migration runner...');
    
    try {
      // Clean database
      await this.cleanDatabase();
      
      // Run all migrations through the migration runner
      await this.migrationRunner!.runMigrations();
      
      console.log('  ✅ Migration runner executed successfully');
      return true;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`  ❌ Migration runner failed: ${errorMessage}`);
      return false;
    }
  }

  async verifySchemaCreation(): Promise<boolean> {
    console.log('\n🏗️  Verifying schema creation...');
    
    try {
      // Check that all expected tables exist
      const result = await this.adapter!.query(`
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
      const missingTables = expectedTables.filter(table => !actualTables.includes(table));
      
      if (missingTables.length > 0) {
        console.log(`  ❌ Missing tables: ${missingTables.join(', ')}`);
        return false;
      }
      
      console.log(`  ✅ All ${expectedTables.length} expected tables created`);
      
      // Check views
      const viewResult = await this.adapter!.query(`
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

      const actualViews = viewResult.rows.map(row => row.table_name);
      const missingViews = expectedViews.filter(view => !actualViews.includes(view));
      
      if (missingViews.length > 0) {
        console.log(`  ❌ Missing views: ${missingViews.join(', ')}`);
        return false;
      }
      
      console.log(`  ✅ All ${expectedViews.length} expected views created`);
      return true;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`  ❌ Schema verification failed: ${errorMessage}`);
      return false;
    }
  }

  async verifyPostgreSQLFeatures(): Promise<boolean> {
    console.log('\n🐘 Verifying PostgreSQL-specific features...');
    
    try {
      // Test UUID generation
      const uuidResult = await this.adapter!.query('SELECT gen_random_uuid() as uuid');
      console.log('  ✅ UUID generation works');
      
      // Test JSONB operations
      await this.adapter!.query(`
        INSERT INTO clients (crm_id, crm_system, name, email) 
        VALUES ('test-123', 'zoho', 'Test Client', 'test@example.com')
      `);

      await this.adapter!.query(`
        INSERT INTO client_preferences (client_id, category, preferences) 
        VALUES (
          (SELECT id FROM clients WHERE crm_id = 'test-123'), 
          'hobbies', 
          '{"sports": ["tennis", "golf"], "music": ["jazz", "classical"]}'::jsonb
        )
      `);

      const jsonbResult = await this.adapter!.query(`
        SELECT preferences->'sports' as sports 
        FROM client_preferences 
        WHERE category = 'hobbies'
      `);
      
      if (JSON.stringify(jsonbResult.rows[0].sports) === JSON.stringify(['tennis', 'golf'])) {
        console.log('  ✅ JSONB operations work');
      } else {
        console.log('  ❌ JSONB operations failed');
        return false;
      }
      
      // Test array operations
      await this.adapter!.query(`
        INSERT INTO conversation_summaries (client_id, summary, key_topics, action_items) 
        VALUES (
          (SELECT id FROM clients WHERE crm_id = 'test-123'),
          'Test summary',
          ARRAY['topic1', 'topic2'],
          ARRAY['action1', 'action2']
        )
      `);

      const arrayResult = await this.adapter!.query(`
        SELECT key_topics 
        FROM conversation_summaries 
        WHERE 'topic1' = ANY(key_topics)
      `);
      
      if (arrayResult.rows.length > 0) {
        console.log('  ✅ Array operations work');
      } else {
        console.log('  ❌ Array operations failed');
        return false;
      }
      
      // Test timestamp with timezone
      const timestampResult = await this.adapter!.query(`
        SELECT NOW() as current_time, NOW() AT TIME ZONE 'UTC' as utc_time
      `);
      
      if (timestampResult.rows[0].current_time && timestampResult.rows[0].utc_time) {
        console.log('  ✅ Timestamp with timezone works');
      } else {
        console.log('  ❌ Timestamp with timezone failed');
        return false;
      }
      
      return true;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`  ❌ PostgreSQL features test failed: ${errorMessage}`);
      return false;
    }
  }

  private async cleanDatabase(): Promise<void> {
    await this.adapter!.query('DROP SCHEMA public CASCADE');
    await this.adapter!.query('CREATE SCHEMA public');
    await this.adapter!.query('GRANT ALL ON SCHEMA public TO postgres');
    await this.adapter!.query('GRANT ALL ON SCHEMA public TO public');
  }

  private async executeMigrationSQL(migrationSQL: string): Promise<void> {
    const statements = migrationSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    for (const statement of statements) {
      if (statement.trim()) {
        await this.adapter!.query(statement);
      }
    }
  }
}

async function main(): Promise<void> {
  const verifier = new MigrationVerifier();
  const startTime = Date.now();
  
  try {
    console.log('🚀 Starting PostgreSQL migration verification...\n');
    
    await verifier.initialize();
    
    // Verify individual migrations
    const migrationResults = await verifier.verifyIndividualMigrations();
    
    // Verify migration runner
    const migrationRunnerSuccess = await verifier.verifyMigrationRunner();
    
    // Verify schema creation
    const schemaSuccess = await verifier.verifySchemaCreation();
    
    // Verify PostgreSQL features
    const featuresSuccess = await verifier.verifyPostgreSQLFeatures();
    
    const totalTime = Date.now() - startTime;
    
    // Generate summary
    const summary: VerificationSummary = {
      totalMigrations: migrationResults.length,
      successfulMigrations: migrationResults.filter(r => r.success).length,
      failedMigrations: migrationResults.filter(r => !r.success).length,
      results: migrationResults,
      totalExecutionTime: totalTime
    };
    
    // Print summary
    console.log('\n📊 VERIFICATION SUMMARY');
    console.log('========================');
    console.log(`Total migrations: ${summary.totalMigrations}`);
    console.log(`Successful: ${summary.successfulMigrations}`);
    console.log(`Failed: ${summary.failedMigrations}`);
    console.log(`Migration runner: ${migrationRunnerSuccess ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Schema creation: ${schemaSuccess ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`PostgreSQL features: ${featuresSuccess ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Total execution time: ${totalTime}ms`);
    
    if (summary.failedMigrations > 0) {
      console.log('\n❌ FAILED MIGRATIONS:');
      summary.results
        .filter(r => !r.success)
        .forEach(r => {
          console.log(`  - ${r.migrationFile}: ${r.error}`);
        });
    }
    
    const allTestsPassed = summary.failedMigrations === 0 && 
                          migrationRunnerSuccess && 
                          schemaSuccess && 
                          featuresSuccess;
    
    if (allTestsPassed) {
      console.log('\n🎉 ALL VERIFICATIONS PASSED! Migrations are PostgreSQL-compatible.');
      process.exit(0);
    } else {
      console.log('\n💥 SOME VERIFICATIONS FAILED! Please check the errors above.');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n💥 Verification failed with error:', error);
    process.exit(1);
  } finally {
    await verifier.cleanup();
  }
}

// Run the verification if this script is executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { MigrationVerifier, MigrationVerificationResult, VerificationSummary };