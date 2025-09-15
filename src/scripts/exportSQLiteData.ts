#!/usr/bin/env node

/**
 * CLI script for exporting SQLite data to PostgreSQL format
 * Usage: npm run export-sqlite [options]
 */

import { DataMigrationService } from '../services/database/DataMigrationService';
import { getDatabaseConfig } from '../services/database/config';
import { logger } from '../utils/logger';
import * as path from 'path';

interface ExportOptions {
  output?: string;
  validate?: boolean;
  batchSize?: number;
  help?: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): ExportOptions {
  const args = process.argv.slice(2);
  const options: ExportOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--output':
      case '-o':
        options.output = args[++i];
        break;
      case '--no-validate':
        options.validate = false;
        break;
      case '--batch-size':
      case '-b':
        options.batchSize = parseInt(args[++i], 10);
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
SQLite to PostgreSQL Data Export Tool

Usage: npm run export-sqlite [options]

Options:
  -o, --output <file>     Output file path (default: ./data/sqlite_export.sql)
  --no-validate          Skip data integrity validation
  -b, --batch-size <n>   Number of rows to process per batch (default: 1000)
  -h, --help             Show this help message

Examples:
  npm run export-sqlite
  npm run export-sqlite --output ./exports/production_data.sql
  npm run export-sqlite --batch-size 500 --no-validate

Environment Variables:
  DATABASE_TYPE          Should be set to 'sqlite' for source database
  SQLITE_FILENAME        Path to SQLite database file
  DB_HOST               PostgreSQL host for validation (optional)
  DB_NAME               PostgreSQL database name for validation (optional)
  DB_USER               PostgreSQL username for validation (optional)
  DB_PASSWORD           PostgreSQL password for validation (optional)

Notes:
  - Ensure your SQLite database exists and is accessible
  - The export file will contain PostgreSQL-compatible SQL
  - Run the generated SQL file against your PostgreSQL database to import data
  - Always backup your PostgreSQL database before importing
`);
}

/**
 * Main export function
 */
async function main(): Promise<void> {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    return;
  }

  try {
    // Get database configuration
    const config = getDatabaseConfig();
    
    // Validate that we have SQLite configuration
    if (!config.sqlite) {
      throw new Error('SQLite configuration not found. Set DATABASE_TYPE=sqlite and SQLITE_FILENAME');
    }

    // Set up PostgreSQL config for validation (optional)
    let postgresConfig = config.postgresql;
    if (!postgresConfig && (process.env.DB_HOST || process.env.SUPABASE_DB_URL)) {
      // Create minimal PostgreSQL config for validation
      postgresConfig = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME || 'relationship_care',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        ssl: process.env.NODE_ENV === 'production'
      };
    }

    if (!postgresConfig) {
      logger.warn('PostgreSQL configuration not found. Skipping validation.');
      options.validate = false;
    }

    // Set default values
    const outputFile = options.output || './data/sqlite_export.sql';
    const validateIntegrity = options.validate !== false;
    const batchSize = options.batchSize || 1000;

    logger.info('Starting SQLite data export', {
      sqliteFile: config.sqlite.filename,
      outputFile,
      validateIntegrity,
      batchSize
    });

    // Create migration service
    const migrationService = new DataMigrationService(
      config.sqlite,
      postgresConfig!
    );

    // Perform export
    await migrationService.exportSQLiteToPostgreSQL({
      outputFile,
      validateIntegrity,
      batchSize
    });

    console.log(`\n✅ Export completed successfully!`);
    console.log(`📁 Output file: ${path.resolve(outputFile)}`);
    console.log(`\nNext steps:`);
    console.log(`1. Review the generated SQL file`);
    console.log(`2. Backup your PostgreSQL database`);
    console.log(`3. Run the SQL file against your PostgreSQL database:`);
    console.log(`   psql -h <host> -U <user> -d <database> -f ${outputFile}`);
    console.log(`4. Verify data integrity in PostgreSQL`);
    console.log(`5. Update your application configuration to use PostgreSQL`);

  } catch (error) {
    logger.error('Export failed', { error: (error as Error).message });
    console.error(`\n❌ Export failed: ${(error as Error).message}`);
    
    if ((error as Error).message.includes('ENOENT')) {
      console.error(`\nTip: Make sure your SQLite database file exists and is accessible.`);
    } else if ((error as Error).message.includes('configuration')) {
      console.error(`\nTip: Check your environment variables. Required: DATABASE_TYPE=sqlite, SQLITE_FILENAME`);
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

export { main as exportSQLiteData };