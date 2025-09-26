#!/usr/bin/env node

/**
 * Database Inspector Utility
 * 
 * Provides comprehensive database inspection capabilities for PostgreSQL/Supabase.
 * Useful for development, debugging, and monitoring.
 */

import { DatabaseService } from '../services/database';
import { logger } from '../utils/logger';

interface TableInfo {
  name: string;
  rows: number;
  size?: string;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    default?: string;
  }>;
  indexes: Array<{
    name: string;
    columns: string[];
    unique: boolean;
  }>;
}

interface DatabaseInspectionResult {
  type: string;
  version: string;
  size: string;
  tables: TableInfo[];
  migrations: {
    applied: number;
    latest?: string;
    pending: number;
  };
  performance: {
    connectionTime: number;
    queryTime: number;
  };
  configuration: any;
}

class DatabaseInspector {
  private static async getTableColumns(tableName: string): Promise<TableInfo['columns']> {
    const columns: TableInfo['columns'] = [];
    
    try {
      const result = await DatabaseService.query(`
        SELECT 
          column_name as name,
          data_type as type,
          is_nullable,
          column_default as default_value
        FROM information_schema.columns 
        WHERE table_name = $1 
        ORDER BY ordinal_position
      `, [tableName]);
      
      for (const row of result.rows) {
        columns.push({
          name: row.name,
          type: row.type,
          nullable: row.is_nullable === 'YES',
          default: row.default_value
        });
      }
    } catch (error) {
      logger.warn(`Failed to get columns for table ${tableName}`, { error });
    }
    
    return columns;
  }

  private static async getTableIndexes(tableName: string): Promise<TableInfo['indexes']> {
    const indexes: TableInfo['indexes'] = [];
    
    try {
      const result = await DatabaseService.query(`
        SELECT 
          i.indexname as name,
          i.indexdef as definition,
          ix.indisunique as unique
        FROM pg_indexes i
        JOIN pg_class c ON c.relname = i.indexname
        JOIN pg_index ix ON ix.indexrelid = c.oid
        WHERE i.tablename = $1
      `, [tableName]);
      
      for (const row of result.rows) {
        // Parse column names from index definition (simplified)
        const columns = row.definition.match(/\(([^)]+)\)/)?.[1]
          .split(',')
          .map((col: string) => col.trim()) || [];
        
        indexes.push({
          name: row.name,
          columns: columns,
          unique: row.unique
        });
      }
    } catch (error) {
      logger.warn(`Failed to get indexes for table ${tableName}`, { error });
    }
    
    return indexes;
  }

  private static async getTableSize(tableName: string): Promise<string | undefined> {
    try {
      const result = await DatabaseService.query(`
        SELECT pg_size_pretty(pg_total_relation_size($1)) as size
      `, [tableName]);
      return result.rows[0]?.size;
    } catch (error) {
      logger.warn(`Failed to get size for table ${tableName}`, { error });
      return undefined;
    }
  }

  static async inspect(): Promise<DatabaseInspectionResult> {
    const startTime = Date.now();
    
    try {
      // Initialize database service if not already done
      await DatabaseService.initialize({ skipMigrations: true });
      
      const connectionTime = Date.now() - startTime;
      const config = DatabaseService.getConfigSummary() as any;
      
      const result: DatabaseInspectionResult = {
        type: 'postgresql',
        version: '',
        size: '',
        tables: [],
        migrations: {
          applied: 0,
          pending: 0
        },
        performance: {
          connectionTime,
          queryTime: 0
        },
        configuration: config
      };

      // Get PostgreSQL database version and size
      const queryStart = Date.now();
      const versionResult = await DatabaseService.query('SELECT version()');
      const version = versionResult.rows[0].version;
      result.version = version.split(' ')[0] + ' ' + version.split(' ')[1];
      
      const sizeResult = await DatabaseService.query(`
        SELECT pg_size_pretty(pg_database_size(current_database())) as size
      `);
      result.size = sizeResult.rows[0].size;
      result.performance.queryTime = Date.now() - queryStart;

      // Get migration information
      try {
        const migrationTableQuery = `
          SELECT tablename FROM pg_tables 
          WHERE tablename = 'schema_migrations'
        `;
        
        const migrationTableResult = await DatabaseService.query(migrationTableQuery);
        if (migrationTableResult.rows.length > 0) {
          const migrationsResult = await DatabaseService.query(`
            SELECT COUNT(*) as count, MAX(filename) as latest 
            FROM schema_migrations
          `);
          result.migrations.applied = parseInt(migrationsResult.rows[0].count, 10);
          result.migrations.latest = migrationsResult.rows[0].latest;
          
          // Count available migration files
          const fs = require('fs');
          const migrationDir = './src/database/migrations';
          if (fs.existsSync(migrationDir)) {
            const files = fs.readdirSync(migrationDir);
            const totalMigrations = files.filter((f: string) => f.endsWith('.sql')).length;
            result.migrations.pending = Math.max(0, totalMigrations - result.migrations.applied);
          }
        }
      } catch (error) {
        logger.warn('Failed to get migration information', { error });
      }

      // Get PostgreSQL table information
      const tableQuery = `
        SELECT tablename as name FROM pg_tables 
        WHERE schemaname = 'public'
        ORDER BY tablename
      `;
      
      const tablesResult = await DatabaseService.query(tableQuery);
      
      // Get detailed information for each table
      for (const table of tablesResult.rows) {
        try {
          const countResult = await DatabaseService.query(`SELECT COUNT(*) as count FROM ${table.name}`);
          const rowCount = parseInt(countResult.rows[0].count, 10);
          
          const columns = await this.getTableColumns(table.name);
          const indexes = await this.getTableIndexes(table.name);
          const size = await this.getTableSize(table.name);
          
          result.tables.push({
            name: table.name,
            rows: rowCount,
            size,
            columns,
            indexes
          });
        } catch (error) {
          logger.warn(`Failed to inspect table ${table.name}`, { error });
          result.tables.push({
            name: table.name,
            rows: -1,
            columns: [],
            indexes: []
          });
        }
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Database inspection failed', { error: errorMessage });
      throw error;
    }
  }

  static async printInspection(): Promise<void> {
    try {
      const inspection = await this.inspect();
      
      console.log('\n=== Database Inspection Report ===\n');
      
      // Database overview
      console.log(`Database Type: ${inspection.type}`);
      console.log(`Version: ${inspection.version}`);
      console.log(`Size: ${inspection.size}`);
      console.log(`Connection Time: ${inspection.performance.connectionTime}ms`);
      console.log(`Query Time: ${inspection.performance.queryTime}ms`);
      
      // Migration status
      console.log('\n--- Migration Status ---');
      console.log(`Applied: ${inspection.migrations.applied}`);
      console.log(`Pending: ${inspection.migrations.pending}`);
      if (inspection.migrations.latest) {
        console.log(`Latest: ${inspection.migrations.latest}`);
      }
      
      // Tables overview
      console.log('\n--- Tables Overview ---');
      console.log(`Total Tables: ${inspection.tables.length}`);
      
      if (inspection.tables.length > 0) {
        console.log('\nTable Details:');
        console.log('┌─────────────────────────────┬──────────┬─────────────┬─────────┬─────────┐');
        console.log('│ Table Name                  │ Rows     │ Size        │ Columns │ Indexes │');
        console.log('├─────────────────────────────┼──────────┼─────────────┼─────────┼─────────┤');
        
        for (const table of inspection.tables) {
          const name = table.name.padEnd(27);
          const rows = table.rows >= 0 ? table.rows.toString().padStart(8) : 'Error'.padStart(8);
          const size = (table.size || 'N/A').padEnd(11);
          const columns = table.columns.length.toString().padStart(7);
          const indexes = table.indexes.length.toString().padStart(7);
          
          console.log(`│ ${name} │ ${rows} │ ${size} │ ${columns} │ ${indexes} │`);
        }
        console.log('└─────────────────────────────┴──────────┴─────────────┴─────────┴─────────┘');
      }
      
      // Configuration summary
      console.log('\n--- Configuration ---');
      console.log(JSON.stringify(inspection.configuration, null, 2));
      
      console.log('\n=== End of Report ===\n');
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to inspect database:', errorMessage);
      process.exit(1);
    }
  }

  static async printTableDetails(tableName: string): Promise<void> {
    try {
      const inspection = await this.inspect();
      const table = inspection.tables.find(t => t.name === tableName);
      
      if (!table) {
        console.error(`Table '${tableName}' not found`);
        console.log('Available tables:', inspection.tables.map(t => t.name).join(', '));
        return;
      }
      
      console.log(`\n=== Table Details: ${tableName} ===\n`);
      
      console.log(`Rows: ${table.rows}`);
      if (table.size) {
        console.log(`Size: ${table.size}`);
      }
      
      // Columns
      console.log('\n--- Columns ---');
      if (table.columns.length > 0) {
        console.log('┌─────────────────────────────┬─────────────────┬──────────┬─────────────────┐');
        console.log('│ Column Name                 │ Type            │ Nullable │ Default         │');
        console.log('├─────────────────────────────┼─────────────────┼──────────┼─────────────────┤');
        
        for (const column of table.columns) {
          const name = column.name.padEnd(27);
          const type = column.type.padEnd(15);
          const nullable = (column.nullable ? 'YES' : 'NO').padEnd(8);
          const defaultValue = (column.default || '').padEnd(15);
          
          console.log(`│ ${name} │ ${type} │ ${nullable} │ ${defaultValue} │`);
        }
        console.log('└─────────────────────────────┴─────────────────┴──────────┴─────────────────┘');
      } else {
        console.log('No column information available');
      }
      
      // Indexes
      console.log('\n--- Indexes ---');
      if (table.indexes.length > 0) {
        for (const index of table.indexes) {
          const uniqueStr = index.unique ? ' (UNIQUE)' : '';
          console.log(`${index.name}${uniqueStr}: ${index.columns.join(', ')}`);
        }
      } else {
        console.log('No indexes found');
      }
      
      console.log('\n=== End of Table Details ===\n');
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to inspect table:', errorMessage);
      process.exit(1);
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  try {
    switch (command) {
      case 'table':
        const tableName = args[1];
        if (!tableName) {
          console.error('Usage: npm run db:inspect table <table_name>');
          process.exit(1);
        }
        await DatabaseInspector.printTableDetails(tableName);
        break;
        
      case 'json':
        const inspection = await DatabaseInspector.inspect();
        console.log(JSON.stringify(inspection, null, 2));
        break;
        
      default:
        await DatabaseInspector.printInspection();
        break;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Database inspection failed:', errorMessage);
    process.exit(1);
  } finally {
    await DatabaseService.close();
  }
}

// Export for programmatic use
export { DatabaseInspector, DatabaseInspectionResult, TableInfo };

// Run CLI if called directly
if (require.main === module) {
  main();
}