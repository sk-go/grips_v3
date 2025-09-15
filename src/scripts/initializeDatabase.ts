#!/usr/bin/env node

/**
 * Database initialization script
 * Sets up the database, runs migrations, and optionally seeds with sample data
 */

import { DatabaseService } from '../services/database/DatabaseService';
import { getDatabaseConfig } from '../services/database/config';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

interface InitOptions {
  seed?: boolean;
  reset?: boolean;
  force?: boolean;
  help?: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): InitOptions {
  const args = process.argv.slice(2);
  const options: InitOptions = {};

  for (const arg of args) {
    switch (arg) {
      case '--seed':
      case '-s':
        options.seed = true;
        break;
      case '--reset':
      case '-r':
        options.reset = true;
        break;
      case '--force':
      case '-f':
        options.force = true;
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
Database Initialization Tool

Usage: npm run db:init [options]

Options:
  -s, --seed      Seed database with sample data after initialization
  -r, --reset     Reset database (drop all tables) before initialization
  -f, --force     Force reset without confirmation prompt
  -h, --help      Show this help message

Examples:
  npm run db:init                    # Initialize database and run migrations
  npm run db:init --seed             # Initialize and seed with sample data
  npm run db:init --reset --force    # Reset and reinitialize database
  npm run db:init --reset --seed     # Reset, initialize, and seed

Environment Variables:
  DATABASE_TYPE     Database type: 'sqlite' or 'postgresql' (default: auto-detect)
  SQLITE_FILENAME   SQLite database file path (default: ./data/development.db)
  DB_HOST          PostgreSQL host
  DB_NAME          PostgreSQL database name
  DB_USER          PostgreSQL username
  DB_PASSWORD      PostgreSQL password

Notes:
  - For SQLite: Database file will be created automatically if it doesn't exist
  - For PostgreSQL: Database must exist before running this script
  - Use --reset with caution as it will delete all existing data
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
 * Reset database (drop all tables)
 */
async function resetDatabase(dbService: DatabaseService): Promise<void> {
  logger.info('Resetting database...');

  const config = getDatabaseConfig();
  
  if (config.type === 'sqlite') {
    // For SQLite, we can delete the file or drop all tables
    const sqliteFile = config.sqlite?.filename;
    if (sqliteFile && sqliteFile !== ':memory:' && fs.existsSync(sqliteFile)) {
      fs.unlinkSync(sqliteFile);
      logger.info(`Deleted SQLite database file: ${sqliteFile}`);
    }
  } else {
    // For PostgreSQL, drop all tables
    const client = await dbService.getClient();
    try {
      // Get all table names
      const result = await client.query(`
        SELECT tablename FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename != 'schema_migrations'
      `);

      // Drop all tables
      for (const row of result.rows) {
        await client.query(`DROP TABLE IF EXISTS ${row.tablename} CASCADE`);
        logger.info(`Dropped table: ${row.tablename}`);
      }

      // Also drop the migrations table to start fresh
      await client.query('DROP TABLE IF EXISTS schema_migrations CASCADE');
      logger.info('Dropped schema_migrations table');

    } finally {
      if (client.release) {
        client.release();
      }
    }
  }

  logger.info('Database reset completed');
}

/**
 * Seed database with sample data
 */
async function seedDatabase(dbService: DatabaseService): Promise<void> {
  logger.info('Seeding database with sample data...');

  const client = await dbService.getClient();
  
  try {
    await client.query('BEGIN');

    // Insert sample user
    await client.query(`
      INSERT INTO users (keycloak_id, email, first_name, last_name, role) 
      VALUES ('sample-keycloak-id', 'agent@example.com', 'John', 'Doe', 'agent')
      ON CONFLICT (email) DO NOTHING
    `);

    // Insert sample clients
    await client.query(`
      INSERT INTO clients (crm_id, crm_system, name, email, phone, relationship_score) 
      VALUES 
        ('client-001', 'zoho', 'Alice Johnson', 'alice@example.com', '+1-555-0101', 85),
        ('client-002', 'zoho', 'Bob Smith', 'bob@example.com', '+1-555-0102', 72),
        ('client-003', 'salesforce', 'Carol Williams', 'carol@example.com', '+1-555-0103', 91)
      ON CONFLICT (crm_system, crm_id) DO NOTHING
    `);

    // Get client IDs for relationships
    const clientsResult = await client.query('SELECT id, name FROM clients LIMIT 3');
    const clients = clientsResult.rows;

    if (clients.length >= 2) {
      // Insert sample family members
      await client.query(`
        INSERT INTO family_members (client_id, name, relationship, age) 
        VALUES 
          ($1, 'Sarah Johnson', 'spouse', 42),
          ($1, 'Tommy Johnson', 'child', 12),
          ($2, 'Mary Smith', 'spouse', 38)
        ON CONFLICT DO NOTHING
      `, [clients[0].id, clients[1].id]);

      // Insert sample important dates
      await client.query(`
        INSERT INTO important_dates (client_id, type, date_value, description) 
        VALUES 
          ($1, 'birthday', '1980-05-15', 'Alice birthday'),
          ($1, 'anniversary', '2005-06-20', 'Wedding anniversary'),
          ($2, 'policy_renewal', '2024-12-01', 'Auto insurance renewal')
        ON CONFLICT DO NOTHING
      `, [clients[0].id, clients[1].id]);

      // Insert sample preferences
      await client.query(`
        INSERT INTO client_preferences (client_id, category, preferences) 
        VALUES 
          ($1, 'hobbies', '["golf", "reading", "cooking"]'),
          ($1, 'communication_preferences', '{"preferred_time": "morning", "preferred_method": "email"}'),
          ($2, 'interests', '["sports", "travel", "photography"]')
        ON CONFLICT (client_id, category) DO NOTHING
      `, [clients[0].id, clients[1].id]);
    }

    await client.query('COMMIT');
    logger.info('Sample data seeded successfully');

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Failed to seed database', { error: (error as Error).message });
    throw error;
  } finally {
    if (client.release) {
      client.release();
    }
  }
}

/**
 * Check database health and connectivity
 */
async function checkDatabaseHealth(dbService: DatabaseService): Promise<void> {
  logger.info('Checking database health...');

  const client = await dbService.getClient();
  
  try {
    // Test basic connectivity
    const result = await client.query('SELECT 1 as test');
    if (result.rows[0].test !== 1) {
      throw new Error('Database connectivity test failed');
    }

    // Check if migrations table exists
    const config = getDatabaseConfig();
    let migrationTableQuery: string;
    
    if (config.type === 'sqlite') {
      migrationTableQuery = `
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='schema_migrations'
      `;
    } else {
      migrationTableQuery = `
        SELECT tablename FROM pg_tables 
        WHERE tablename = 'schema_migrations'
      `;
    }

    const migrationResult = await client.query(migrationTableQuery);
    const hasMigrations = migrationResult.rows.length > 0;

    // Get table count
    let tableCountQuery: string;
    if (config.type === 'sqlite') {
      tableCountQuery = `
        SELECT COUNT(*) as count FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
      `;
    } else {
      tableCountQuery = `
        SELECT COUNT(*) as count FROM pg_tables 
        WHERE schemaname = 'public'
      `;
    }

    const tableResult = await client.query(tableCountQuery);
    const tableCount = tableResult.rows[0].count;

    logger.info('Database health check completed', {
      connected: true,
      hasMigrations,
      tableCount: parseInt(tableCount, 10),
      databaseType: config.type
    });

  } finally {
    if (client.release) {
      client.release();
    }
  }
}

/**
 * Main initialization function
 */
async function main(): Promise<void> {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    return;
  }

  try {
    logger.info('Starting database initialization...');

    // Get database configuration
    const config = getDatabaseConfig();
    logger.info('Database configuration loaded', { 
      type: config.type,
      sqlite: config.sqlite ? { filename: config.sqlite.filename } : null,
      postgresql: config.postgresql ? { 
        host: config.postgresql.host, 
        database: config.postgresql.database 
      } : null
    });

    // Initialize database service
    const dbService = new DatabaseService();
    await dbService.initialize();

    // Handle reset option
    if (options.reset) {
      if (!options.force) {
        const confirmed = await promptConfirmation(
          '⚠️  This will delete all existing data. Are you sure?'
        );
        if (!confirmed) {
          console.log('Operation cancelled.');
          return;
        }
      }
      
      await resetDatabase(dbService);
      
      // Reinitialize after reset
      await dbService.close();
      await dbService.initialize();
    }

    // Run migrations
    logger.info('Running database migrations...');
    await dbService.runMigrations();
    logger.info('Migrations completed successfully');

    // Seed database if requested
    if (options.seed) {
      await seedDatabase(dbService);
    }

    // Check database health
    await checkDatabaseHealth(dbService);

    // Close database connection
    await dbService.close();

    console.log('\n✅ Database initialization completed successfully!');
    
    if (options.seed) {
      console.log('📊 Sample data has been seeded');
    }
    
    console.log('\nDatabase is ready for use.');
    console.log(`Database type: ${config.type}`);
    
    if (config.type === 'sqlite') {
      console.log(`SQLite file: ${config.sqlite?.filename}`);
    } else {
      console.log(`PostgreSQL: ${config.postgresql?.host}:${config.postgresql?.port}/${config.postgresql?.database}`);
    }

  } catch (error) {
    logger.error('Database initialization failed', { error: (error as Error).message });
    console.error(`\n❌ Initialization failed: ${(error as Error).message}`);
    
    if ((error as Error).message.includes('ENOENT')) {
      console.error('\nTip: Check your database file path and permissions.');
    } else if ((error as Error).message.includes('connection')) {
      console.error('\nTip: Verify your database connection settings.');
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

export { main as initializeDatabase };