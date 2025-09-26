#!/usr/bin/env node

/**
 * Database reset script
 * Safely resets the database and optionally reinitializes with fresh data
 */

import { DatabaseService } from '../services/database/DatabaseService';
import { logger } from '../utils/logger';
import { initializeDatabase } from './initializeDatabase';
import * as fs from 'fs';

interface ResetOptions {
  force?: boolean;
  seed?: boolean;
  backup?: boolean;
  help?: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): ResetOptions {
  const args = process.argv.slice(2);
  const options: ResetOptions = {};

  for (const arg of args) {
    switch (arg) {
      case '--force':
      case '-f':
        options.force = true;
        break;
      case '--seed':
      case '-s':
        options.seed = true;
        break;
      case '--backup':
      case '-b':
        options.backup = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }

  return options;
}

/**
 * Display help information
 */
function showHelp(): void {
  console.log(`
Database Reset Tool

Usage: npm run db:reset [options]

Options:
  -f, --force     Skip confirmation prompt and force reset
  -s, --seed      Reinitialize with sample data after reset
  -b, --backup    Create backup before reset (PostgreSQL only)
  -h, --help      Show this help message

Examples:
  npm run db:reset                    # Reset with confirmation
  npm run db:reset --force            # Reset without confirmation
  npm run db:reset --force --seed     # Reset and seed with sample data
  npm run db:reset --backup --force   # Backup and reset

Environment Variables:
  SUPABASE_DB_URL   Supabase database connection URL
  DB_HOST          PostgreSQL host (alternative to SUPABASE_DB_URL)
  DB_NAME          PostgreSQL database name
  DB_USER          PostgreSQL username
  DB_PASSWORD      PostgreSQL password

⚠️  WARNING: This operation will permanently delete all data in your database!
   Always backup important data before running this command.

Notes:
  - Drops all tables and data in PostgreSQL/Supabase
  - Use --backup option to create a backup before reset
  - Use --seed option to populate with sample data after reset
`);
}

/**
 * Prompt for user confirmation
 */
async function promptConfirmation(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    readline.question(`${message} (y/N): `, (answer: string) => {
      readline.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Create database backup (PostgreSQL only)
 */
async function createBackup(): Promise<string | null> {
  const configSummary = DatabaseService.getConfigSummary() as any;
  
  if (!configSummary.postgresql) {
    logger.warn('Backup requires PostgreSQL configuration');
    return null;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = `./data/backup_${configSummary.postgresql.database}_${timestamp}.sql`;
  
  try {
    logger.info('Creating database backup...', { backupFile });
    
    // Ensure backup directory exists
    const backupDir = './data';
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // Use pg_dump to create backup
    const { spawn } = require('child_process');
    
    const pgDumpArgs = [
      '-h', configSummary.postgresql.host,
      '-p', configSummary.postgresql.port.toString(),
      '-U', configSummary.postgresql.user,
      '-d', configSummary.postgresql.database,
      '--no-password',
      '--verbose',
      '--clean',
      '--if-exists',
      '--create',
      '-f', backupFile
    ];

    return new Promise((resolve, reject) => {
      const pgDump = spawn('pg_dump', pgDumpArgs, {
        env: {
          ...process.env,
          PGPASSWORD: configSummary.postgresql.password
        }
      });

      pgDump.on('close', (code) => {
        if (code === 0) {
          logger.info('Backup created successfully', { backupFile });
          resolve(backupFile);
        } else {
          logger.error('Backup failed', { code });
          reject(new Error(`pg_dump failed with code ${code}`));
        }
      });

      pgDump.on('error', (error) => {
        logger.error('Backup process error', { error: error.message });
        reject(error);
      });
    });

  } catch (error) {
    logger.error('Failed to create backup', { error: (error as Error).message });
    throw error;
  }
}



/**
 * Reset PostgreSQL database
 */
async function resetPostgreSQLDatabase(): Promise<void> {
  logger.info('Resetting PostgreSQL database...');

  const client = await DatabaseService.getClient();
  
  try {
    // Disable foreign key checks temporarily
    await client.query('SET session_replication_role = replica');

    // Get all table names (excluding system tables)
    const tablesResult = await client.query(`
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);

    const tables = tablesResult.rows.map(row => row.tablename);
    
    if (tables.length === 0) {
      logger.info('No tables found to drop');
      return;
    }

    logger.info(`Dropping ${tables.length} tables...`, { tables });

    // Drop all tables with CASCADE to handle dependencies
    for (const tableName of tables) {
      await client.query(`DROP TABLE IF EXISTS ${tableName} CASCADE`);
      logger.debug(`Dropped table: ${tableName}`);
    }

    // Drop all views
    const viewsResult = await client.query(`
      SELECT viewname FROM pg_views 
      WHERE schemaname = 'public'
    `);

    for (const view of viewsResult.rows) {
      await client.query(`DROP VIEW IF EXISTS ${view.viewname} CASCADE`);
      logger.debug(`Dropped view: ${view.viewname}`);
    }

    // Drop all materialized views
    const matViewsResult = await client.query(`
      SELECT matviewname FROM pg_matviews 
      WHERE schemaname = 'public'
    `);

    for (const matView of matViewsResult.rows) {
      await client.query(`DROP MATERIALIZED VIEW IF EXISTS ${matView.matviewname} CASCADE`);
      logger.debug(`Dropped materialized view: ${matView.matviewname}`);
    }

    // Drop all functions
    const functionsResult = await client.query(`
      SELECT proname, pg_get_function_identity_arguments(oid) as args
      FROM pg_proc 
      WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    `);

    for (const func of functionsResult.rows) {
      await client.query(`DROP FUNCTION IF EXISTS ${func.proname}(${func.args}) CASCADE`);
      logger.debug(`Dropped function: ${func.proname}`);
    }

    // Drop all sequences
    const sequencesResult = await client.query(`
      SELECT sequencename FROM pg_sequences 
      WHERE schemaname = 'public'
    `);

    for (const seq of sequencesResult.rows) {
      await client.query(`DROP SEQUENCE IF EXISTS ${seq.sequencename} CASCADE`);
      logger.debug(`Dropped sequence: ${seq.sequencename}`);
    }

    // Re-enable foreign key checks
    await client.query('SET session_replication_role = DEFAULT');

    logger.info('PostgreSQL database reset completed');

  } finally {
    if (client.release) {
      client.release();
    }
  }
}

/**
 * Main reset function
 */
async function main(): Promise<void> {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    return;
  }

  try {
    logger.info('Starting database reset...', { 
      type: 'postgresql',
      backup: options.backup,
      seed: options.seed 
    });

    // Initialize database service to get config
    await DatabaseService.initialize();
    const configSummary = DatabaseService.getConfigSummary() as any;

    // Confirmation prompt (unless forced)
    if (!options.force) {
      console.log('\n⚠️  WARNING: This will permanently delete all data in your database!');
      console.log('Database type: postgresql');
      if (configSummary.postgresql) {
        console.log(`PostgreSQL: ${configSummary.postgresql.host}:${configSummary.postgresql.port}/${configSummary.postgresql.database}`);
      }
      
      const confirmed = await promptConfirmation('\nAre you sure you want to proceed?');
      if (!confirmed) {
        console.log('Operation cancelled.');
        await DatabaseService.close();
        return;
      }
    }

    // Create backup if requested
    let backupFile: string | null = null;
    if (options.backup) {
      backupFile = await createBackup();
      if (backupFile) {
        console.log(`✅ Backup created: ${backupFile}`);
      }
    }

    // Perform PostgreSQL reset
    try {
      await resetPostgreSQLDatabase();
    } finally {
      await DatabaseService.close();
    }

    console.log('\n✅ Database reset completed successfully!');

    // Reinitialize if requested
    if (options.seed) {
      console.log('\n🔄 Reinitializing database with sample data...');
      
      // Use the initialize script with seed option
      process.argv = ['node', 'initializeDatabase.ts', '--seed'];
      await initializeDatabase();
    }

    console.log('\n🎉 Database is ready for use!');
    
    if (backupFile) {
      console.log(`💾 Backup available at: ${backupFile}`);
    }

  } catch (error) {
    logger.error('Database reset failed', { error: (error as Error).message });
    console.error(`\n❌ Reset failed: ${(error as Error).message}`);
    
    if ((error as Error).message.includes('pg_dump')) {
      console.error('\nTip: Make sure pg_dump is installed and accessible in your PATH');
      console.error('Install PostgreSQL client tools or use --no-backup option');
    }
    
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', { promise, reason });
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', { error: error.message });
  process.exit(1);
});

// Run the script
if (require.main === module) {
  main();
}

export { main as resetDatabase };