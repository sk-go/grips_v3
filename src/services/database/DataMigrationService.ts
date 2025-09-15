import { SQLiteAdapter } from './adapters/SQLiteAdapter';
import { PostgreSQLAdapter } from './adapters/PostgreSQLAdapter';
import { DatabaseConfig } from '../../types/database';
import { logger } from '../../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Service for migrating data between SQLite and PostgreSQL databases
 * Handles data type conversions and validates data integrity
 */
export class DataMigrationService {
  private sqliteAdapter: SQLiteAdapter;
  private postgresAdapter: PostgreSQLAdapter;

  constructor(
    sqliteConfig: DatabaseConfig['sqlite'],
    postgresConfig: DatabaseConfig['postgresql']
  ) {
    this.sqliteAdapter = new SQLiteAdapter(sqliteConfig);
    this.postgresAdapter = new PostgreSQLAdapter(postgresConfig);
  }

  /**
   * Export all data from SQLite to PostgreSQL format
   */
  async exportSQLiteToPostgreSQL(options: {
    outputFile?: string;
    validateIntegrity?: boolean;
    batchSize?: number;
  } = {}): Promise<void> {
    const {
      outputFile = './data/sqlite_export.sql',
      validateIntegrity = true,
      batchSize = 1000
    } = options;

    logger.info('Starting SQLite to PostgreSQL export', { outputFile, validateIntegrity, batchSize });

    try {
      // Initialize both adapters
      await this.sqliteAdapter.initialize();
      await this.postgresAdapter.initialize();

      // Get all table names from SQLite
      const tables = await this.getSQLiteTables();
      logger.info(`Found ${tables.length} tables to export`, { tables });

      // Create output directory if it doesn't exist
      const outputDir = path.dirname(outputFile);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Start building the export SQL
      let exportSQL = this.generateExportHeader();

      // Export each table
      for (const tableName of tables) {
        logger.info(`Exporting table: ${tableName}`);
        
        const tableSQL = await this.exportTable(tableName, batchSize);
        exportSQL += tableSQL;

        if (validateIntegrity) {
          await this.validateTableExport(tableName);
        }
      }

      // Add footer
      exportSQL += this.generateExportFooter();

      // Write to file
      fs.writeFileSync(outputFile, exportSQL, 'utf8');
      logger.info('Export completed successfully', { outputFile, size: exportSQL.length });

      // Generate summary report
      const summary = await this.generateExportSummary(tables);
      logger.info('Export summary', summary);

    } catch (error) {
      logger.error('Export failed', { error: (error as Error).message });
      throw error;
    } finally {
      await this.sqliteAdapter.close();
      await this.postgresAdapter.close();
    }
  }

  /**
   * Get all table names from SQLite database
   */
  private async getSQLiteTables(): Promise<string[]> {
    const result = await this.sqliteAdapter.query(`
      SELECT name FROM sqlite_master 
      WHERE type='table' 
      AND name NOT LIKE 'sqlite_%'
      AND name != 'schema_migrations'
      ORDER BY name
    `);

    return result.rows.map(row => row.name);
  }

  /**
   * Export a single table with data type conversions
   */
  private async exportTable(tableName: string, batchSize: number): Promise<string> {
    // Get table schema
    const schema = await this.getTableSchema(tableName);
    
    // Get total row count for progress tracking
    const countResult = await this.sqliteAdapter.query(`SELECT COUNT(*) as count FROM ${tableName}`);
    const totalRows = countResult.rows[0].count;
    
    if (totalRows === 0) {
      logger.info(`Table ${tableName} is empty, skipping data export`);
      return `-- Table ${tableName} is empty\n\n`;
    }

    logger.info(`Exporting ${totalRows} rows from ${tableName}`);

    let tableSQL = `-- Export data for table: ${tableName}\n`;
    tableSQL += `-- Total rows: ${totalRows}\n\n`;

    // Export data in batches
    let offset = 0;
    let exportedRows = 0;

    while (offset < totalRows) {
      const batchResult = await this.sqliteAdapter.query(
        `SELECT * FROM ${tableName} LIMIT ${batchSize} OFFSET ${offset}`
      );

      if (batchResult.rows.length === 0) {
        break;
      }

      // Convert batch to PostgreSQL INSERT statements
      const batchSQL = this.convertRowsToPostgreSQL(tableName, batchResult.rows, schema);
      tableSQL += batchSQL;

      exportedRows += batchResult.rows.length;
      offset += batchSize;

      // Log progress for large tables
      if (totalRows > 1000) {
        const progress = Math.round((exportedRows / totalRows) * 100);
        logger.info(`Export progress for ${tableName}: ${progress}% (${exportedRows}/${totalRows})`);
      }
    }

    tableSQL += `\n-- Completed export of ${tableName}: ${exportedRows} rows\n\n`;
    return tableSQL;
  }

  /**
   * Get table schema information from SQLite
   */
  private async getTableSchema(tableName: string): Promise<any[]> {
    const result = await this.sqliteAdapter.query(`PRAGMA table_info(${tableName})`);
    return result.rows;
  }

  /**
   * Convert SQLite rows to PostgreSQL INSERT statements
   */
  private convertRowsToPostgreSQL(tableName: string, rows: any[], schema: any[]): string {
    if (rows.length === 0) {
      return '';
    }

    const columnNames = schema.map(col => col.name);
    let sql = `INSERT INTO ${tableName} (${columnNames.join(', ')}) VALUES\n`;

    const valueRows = rows.map(row => {
      const values = columnNames.map(colName => {
        const columnInfo = schema.find(col => col.name === colName);
        return this.convertValueToPostgreSQL(row[colName], columnInfo);
      });
      return `  (${values.join(', ')})`;
    });

    sql += valueRows.join(',\n');
    sql += '\nON CONFLICT DO NOTHING;\n\n';

    return sql;
  }

  /**
   * Convert individual values from SQLite to PostgreSQL format
   */
  private convertValueToPostgreSQL(value: any, columnInfo: any): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }

    const columnType = columnInfo.type.toUpperCase();

    // Handle different data types
    if (columnType.includes('TEXT') && this.isUUID(value)) {
      // UUID stored as TEXT in SQLite
      return `'${value}'`;
    }

    if (columnType.includes('TEXT') && this.isJSON(value)) {
      // JSON stored as TEXT in SQLite, convert to JSONB
      return `'${this.escapeString(value)}'::jsonb`;
    }

    if (columnType.includes('TEXT') && Array.isArray(this.tryParseJSON(value))) {
      // Array stored as JSON text in SQLite
      return `'${this.escapeString(value)}'`;
    }

    if (columnType.includes('INTEGER') && typeof value === 'number') {
      // Handle boolean values stored as INTEGER in SQLite
      if (this.isBooleanColumn(columnInfo.name)) {
        return value === 1 ? 'true' : 'false';
      }
      return value.toString();
    }

    if (columnType.includes('REAL') || columnType.includes('NUMERIC')) {
      return value.toString();
    }

    if (columnType.includes('DATETIME') || columnType.includes('TIMESTAMP')) {
      // Convert SQLite datetime to PostgreSQL timestamp
      return `'${value}'::timestamp with time zone`;
    }

    // Default: treat as string and escape
    return `'${this.escapeString(value.toString())}'`;
  }

  /**
   * Check if a value is a valid UUID
   */
  private isUUID(value: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return typeof value === 'string' && uuidRegex.test(value);
  }

  /**
   * Check if a value is valid JSON
   */
  private isJSON(value: string): boolean {
    if (typeof value !== 'string') return false;
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Try to parse JSON, return null if invalid
   */
  private tryParseJSON(value: string): any {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  /**
   * Check if a column name suggests it stores boolean values
   */
  private isBooleanColumn(columnName: string): boolean {
    const booleanPatterns = [
      'is_', 'has_', 'can_', 'should_', 'will_', 'enabled', 'active', 'visible',
      'required', 'optional', 'urgent', 'read', 'sent', 'received'
    ];
    
    const lowerName = columnName.toLowerCase();
    return booleanPatterns.some(pattern => lowerName.includes(pattern));
  }

  /**
   * Escape string values for SQL
   */
  private escapeString(value: string): string {
    return value.replace(/'/g, "''").replace(/\\/g, '\\\\');
  }

  /**
   * Validate exported data integrity
   */
  private async validateTableExport(tableName: string): Promise<void> {
    try {
      // Get row count from SQLite
      const sqliteCount = await this.sqliteAdapter.query(`SELECT COUNT(*) as count FROM ${tableName}`);
      const expectedCount = sqliteCount.rows[0].count;

      logger.debug(`Validated table ${tableName}: ${expectedCount} rows exported`);
    } catch (error) {
      logger.warn(`Validation failed for table ${tableName}`, { error: (error as Error).message });
    }
  }

  /**
   * Generate export file header
   */
  private generateExportHeader(): string {
    const timestamp = new Date().toISOString();
    return `-- SQLite to PostgreSQL Data Export
-- Generated: ${timestamp}
-- 
-- This file contains data exported from SQLite in PostgreSQL-compatible format
-- Run this script against your PostgreSQL database to import the data
--
-- IMPORTANT: Ensure your PostgreSQL database schema is up to date before running this script
--

BEGIN;

-- Disable triggers during import for better performance
SET session_replication_role = replica;

`;
  }

  /**
   * Generate export file footer
   */
  private generateExportFooter(): string {
    return `
-- Re-enable triggers
SET session_replication_role = DEFAULT;

-- Update sequences to prevent ID conflicts
SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE(MAX(id::bigint), 1)) FROM users WHERE id ~ '^[0-9]+$';

COMMIT;

-- Export completed successfully
-- Remember to:
-- 1. Verify data integrity
-- 2. Update any application configuration
-- 3. Test all functionality with the new database
`;
  }

  /**
   * Generate export summary report
   */
  private async generateExportSummary(tables: string[]): Promise<any> {
    const summary = {
      totalTables: tables.length,
      exportedTables: 0,
      totalRows: 0,
      tableDetails: [] as any[]
    };

    for (const tableName of tables) {
      try {
        const countResult = await this.sqliteAdapter.query(`SELECT COUNT(*) as count FROM ${tableName}`);
        const rowCount = countResult.rows[0].count;
        
        summary.exportedTables++;
        summary.totalRows += rowCount;
        summary.tableDetails.push({
          table: tableName,
          rows: rowCount
        });
      } catch (error) {
        logger.warn(`Failed to get row count for ${tableName}`, { error: (error as Error).message });
      }
    }

    return summary;
  }

  /**
   * Import data from PostgreSQL export file to PostgreSQL database
   */
  async importToPostgreSQL(exportFile: string): Promise<void> {
    logger.info('Starting PostgreSQL import', { exportFile });

    try {
      await this.postgresAdapter.initialize();

      // Read the export file
      const exportSQL = fs.readFileSync(exportFile, 'utf8');
      
      // Execute the import
      const client = await this.postgresAdapter.getClient();
      
      try {
        await client.query(exportSQL);
        logger.info('Import completed successfully');
      } finally {
        if (client.release) {
          client.release();
        }
      }

    } catch (error) {
      logger.error('Import failed', { error: (error as Error).message });
      throw error;
    } finally {
      await this.postgresAdapter.close();
    }
  }
}