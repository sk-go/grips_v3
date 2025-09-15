#!/usr/bin/env node

/**
 * Database health check script
 * Provides comprehensive database status and health information
 */

import { DatabaseService } from '../services/database/DatabaseService';
import { getDatabaseConfig } from '../services/database/config';
import { logger } from '../utils/logger';
import * as fs from 'fs';

interface HealthCheckOptions {
  verbose?: boolean;
  json?: boolean;
  help?: boolean;
}

interface HealthCheckResult {
  status: 'healthy' | 'warning' | 'error';
  database: {
    type: string;
    connected: boolean;
    version?: string;
    size?: string;
  };
  migrations: {
    applied: number;
    pending: number;
    latest?: string;
  };
  tables: {
    count: number;
    details?: Array<{
      name: string;
      rows: number;
      size?: string;
    }>;
  };
  performance: {
    connectionTime: number;
    queryTime: number;
  };
  issues: string[];
  recommendations: string[];
}

/**
 * Parse command line arguments
 */
function parseArgs(): HealthCheckOptions {
  const args = process.argv.slice(2);
  const options: HealthCheckOptions = {};

  for (const arg of args) {
    switch (arg) {
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--json':
      case '-j':
        options.json = true;
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
Database Health Check Tool

Usage: npm run db:health [options]

Options:
  -v, --verbose   Show detailed information about tables and performance
  -j, --json      Output results in JSON format
  -h, --help      Show this help message

Examples:
  npm run db:health              # Basic health check
  npm run db:health --verbose    # Detailed health check
  npm run db:health --json       # JSON output for automation

Exit Codes:
  0 - Database is healthy
  1 - Database has warnings or errors
  2 - Cannot connect to database

Environment Variables:
  DATABASE_TYPE     Database type: 'sqlite' or 'postgresql'
  SQLITE_FILENAME   SQLite database file path
  DB_HOST          PostgreSQL host
  DB_NAME          PostgreSQL database name
  DB_USER          PostgreSQL username
  DB_PASSWORD      PostgreSQL password
`);
}

/**
 * Check database connectivity and basic info
 */
async function checkDatabaseConnection(dbService: DatabaseService): Promise<{
  connected: boolean;
  connectionTime: number;
  version?: string;
  size?: string;
}> {
  const startTime = Date.now();
  
  try {
    const client = await dbService.getClient();
    const connectionTime = Date.now() - startTime;
    
    try {
      // Test basic query
      await client.query('SELECT 1');
      
      // Get database version
      const config = getDatabaseConfig();
      let version: string | undefined;
      let size: string | undefined;
      
      if (config.type === 'sqlite') {
        const versionResult = await client.query('SELECT sqlite_version() as version');
        version = `SQLite ${versionResult.rows[0].version}`;
        
        // Get database file size
        const sqliteFile = config.sqlite?.filename;
        if (sqliteFile && sqliteFile !== ':memory:' && fs.existsSync(sqliteFile)) {
          const stats = fs.statSync(sqliteFile);
          size = `${(stats.size / 1024 / 1024).toFixed(2)} MB`;
        }
      } else {
        const versionResult = await client.query('SELECT version()');
        version = versionResult.rows[0].version.split(' ')[0] + ' ' + versionResult.rows[0].version.split(' ')[1];
        
        // Get database size
        const sizeResult = await client.query(`
          SELECT pg_size_pretty(pg_database_size(current_database())) as size
        `);
        size = sizeResult.rows[0].size;
      }
      
      return {
        connected: true,
        connectionTime,
        version,
        size
      };
      
    } finally {
      if (client.release) {
        client.release();
      }
    }
  } catch (error) {
    return {
      connected: false,
      connectionTime: Date.now() - startTime
    };
  }
}

/**
 * Check migration status
 */
async function checkMigrations(dbService: DatabaseService): Promise<{
  applied: number;
  pending: number;
  latest?: string;
}> {
  const client = await dbService.getClient();
  
  try {
    const config = getDatabaseConfig();
    
    // Check if migrations table exists
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
    
    const tableResult = await client.query(migrationTableQuery);
    if (tableResult.rows.length === 0) {
      return { applied: 0, pending: 0 };
    }
    
    // Get applied migrations
    const appliedResult = await client.query(`
      SELECT COUNT(*) as count, MAX(filename) as latest 
      FROM schema_migrations
    `);
    
    const applied = parseInt(appliedResult.rows[0].count, 10);
    const latest = appliedResult.rows[0].latest;
    
    // Count available migration files
    const migrationDir = './src/database/migrations';
    let totalMigrations = 0;
    
    if (fs.existsSync(migrationDir)) {
      const files = fs.readdirSync(migrationDir);
      totalMigrations = files.filter(f => f.endsWith('.sql')).length;
    }
    
    const pending = Math.max(0, totalMigrations - applied);
    
    return {
      applied,
      pending,
      latest
    };
    
  } finally {
    if (client.release) {
      client.release();
    }
  }
}

/**
 * Check table information
 */
async function checkTables(dbService: DatabaseService, verbose: boolean): Promise<{
  count: number;
  details?: Array<{
    name: string;
    rows: number;
    size?: string;
  }>;
}> {
  const client = await dbService.getClient();
  
  try {
    const config = getDatabaseConfig();
    
    // Get table list
    let tableQuery: string;
    if (config.type === 'sqlite') {
      tableQuery = `
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `;
    } else {
      tableQuery = `
        SELECT tablename as name FROM pg_tables 
        WHERE schemaname = 'public'
        ORDER BY tablename
      `;
    }
    
    const tablesResult = await client.query(tableQuery);
    const tables = tablesResult.rows;
    
    if (!verbose) {
      return { count: tables.length };
    }
    
    // Get detailed information for each table
    const details = [];
    
    for (const table of tables) {
      try {
        const countResult = await client.query(`SELECT COUNT(*) as count FROM ${table.name}`);
        const rowCount = parseInt(countResult.rows[0].count, 10);
        
        let size: string | undefined;
        if (config.type === 'postgresql') {
          const sizeResult = await client.query(`
            SELECT pg_size_pretty(pg_total_relation_size($1)) as size
          `, [table.name]);
          size = sizeResult.rows[0].size;
        }
        
        details.push({
          name: table.name,
          rows: rowCount,
          size
        });
      } catch (error) {
        // Skip tables that can't be queried
        details.push({
          name: table.name,
          rows: -1,
          size: 'Error'
        });
      }
    }
    
    return {
      count: tables.length,
      details
    };
    
  } finally {
    if (client.release) {
      client.release();
    }
  }
}

/**
 * Performance test
 */
async function checkPerformance(dbService: DatabaseService): Promise<{
  queryTime: number;
}> {
  const client = await dbService.getClient();
  
  try {
    const startTime = Date.now();
    
    // Run a simple performance test query
    await client.query('SELECT 1 as test');
    
    const queryTime = Date.now() - startTime;
    
    return { queryTime };
    
  } finally {
    if (client.release) {
      client.release();
    }
  }
}

/**
 * Analyze results and generate issues/recommendations
 */
function analyzeResults(result: HealthCheckResult): void {
  const { database, migrations, tables, performance } = result;
  
  // Check for issues
  if (!database.connected) {
    result.status = 'error';
    result.issues.push('Cannot connect to database');
    result.recommendations.push('Check database configuration and ensure database server is running');
  }
  
  if (migrations.pending > 0) {
    result.status = result.status === 'error' ? 'error' : 'warning';
    result.issues.push(`${migrations.pending} pending migrations`);
    result.recommendations.push('Run database migrations: npm run db:migrate');
  }
  
  if (tables.count === 0) {
    result.status = result.status === 'error' ? 'error' : 'warning';
    result.issues.push('No tables found in database');
    result.recommendations.push('Initialize database: npm run db:init');
  }
  
  if (performance.connectionTime > 5000) {
    result.status = result.status === 'error' ? 'error' : 'warning';
    result.issues.push('Slow database connection (>5s)');
    result.recommendations.push('Check network connectivity and database server performance');
  }
  
  if (performance.queryTime > 1000) {
    result.status = result.status === 'error' ? 'error' : 'warning';
    result.issues.push('Slow query performance (>1s)');
    result.recommendations.push('Consider database optimization or check server resources');
  }
  
  // Set status to healthy if no issues found
  if (result.issues.length === 0) {
    result.status = 'healthy';
  }
}

/**
 * Format and display results
 */
function displayResults(result: HealthCheckResult, options: HealthCheckOptions): void {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  
  // Console output
  const statusIcon = result.status === 'healthy' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
  console.log(`\n${statusIcon} Database Health Check - Status: ${result.status.toUpperCase()}\n`);
  
  // Database info
  console.log('📊 Database Information:');
  console.log(`   Type: ${result.database.type}`);
  console.log(`   Connected: ${result.database.connected ? '✅' : '❌'}`);
  if (result.database.version) {
    console.log(`   Version: ${result.database.version}`);
  }
  if (result.database.size) {
    console.log(`   Size: ${result.database.size}`);
  }
  
  // Migration info
  console.log('\n🔄 Migration Status:');
  console.log(`   Applied: ${result.migrations.applied}`);
  console.log(`   Pending: ${result.migrations.pending}`);
  if (result.migrations.latest) {
    console.log(`   Latest: ${result.migrations.latest}`);
  }
  
  // Table info
  console.log('\n📋 Tables:');
  console.log(`   Count: ${result.tables.count}`);
  
  if (options.verbose && result.tables.details) {
    console.log('\n   Table Details:');
    for (const table of result.tables.details) {
      const sizeInfo = table.size ? ` (${table.size})` : '';
      console.log(`     ${table.name}: ${table.rows} rows${sizeInfo}`);
    }
  }
  
  // Performance info
  console.log('\n⚡ Performance:');
  console.log(`   Connection Time: ${result.performance.connectionTime}ms`);
  console.log(`   Query Time: ${result.performance.queryTime}ms`);
  
  // Issues and recommendations
  if (result.issues.length > 0) {
    console.log('\n⚠️  Issues Found:');
    for (const issue of result.issues) {
      console.log(`   • ${issue}`);
    }
  }
  
  if (result.recommendations.length > 0) {
    console.log('\n💡 Recommendations:');
    for (const rec of result.recommendations) {
      console.log(`   • ${rec}`);
    }
  }
  
  if (result.status === 'healthy') {
    console.log('\n🎉 Database is healthy and ready for use!');
  }
}

/**
 * Main health check function
 */
async function main(): Promise<void> {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    return;
  }

  const result: HealthCheckResult = {
    status: 'healthy',
    database: {
      type: '',
      connected: false
    },
    migrations: {
      applied: 0,
      pending: 0
    },
    tables: {
      count: 0
    },
    performance: {
      connectionTime: 0,
      queryTime: 0
    },
    issues: [],
    recommendations: []
  };

  try {
    // Get database configuration
    const config = getDatabaseConfig();
    result.database.type = config.type;

    // Initialize database service
    const dbService = new DatabaseService();
    
    // Check database connection
    const connectionInfo = await checkDatabaseConnection(dbService);
    result.database = { ...result.database, ...connectionInfo };
    result.performance.connectionTime = connectionInfo.connectionTime;

    if (!connectionInfo.connected) {
      analyzeResults(result);
      displayResults(result, options);
      process.exit(2);
    }

    // Initialize database service properly
    await dbService.initialize();

    // Check migrations
    result.migrations = await checkMigrations(dbService);

    // Check tables
    result.tables = await checkTables(dbService, options.verbose || false);

    // Check performance
    const perfInfo = await checkPerformance(dbService);
    result.performance.queryTime = perfInfo.queryTime;

    // Close database connection
    await dbService.close();

    // Analyze results
    analyzeResults(result);

    // Display results
    displayResults(result, options);

    // Exit with appropriate code
    process.exit(result.status === 'error' ? 1 : 0);

  } catch (error) {
    logger.error('Health check failed', { error: (error as Error).message });
    
    result.status = 'error';
    result.issues.push(`Health check failed: ${(error as Error).message}`);
    
    displayResults(result, options);
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

export { main as databaseHealthCheck };