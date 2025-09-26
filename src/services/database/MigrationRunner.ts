import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { DatabaseAdapter } from '../../types/database';
import { logger } from '../../utils/logger';

export interface MigrationRecord {
  id: string;
  filename: string;
  executed_at: Date;
  checksum: string;
}

export interface MigrationFile {
  id: string;
  filename: string;
  filepath: string;
  content: string;
  checksum: string;
}

/**
 * PostgreSQL migration runner for Supabase database
 * Executes migrations directly as PostgreSQL SQL
 */
export class MigrationRunner {
  private adapter: DatabaseAdapter;
  private migrationsDir: string;

  constructor(adapter: DatabaseAdapter, migrationsDir?: string) {
    this.adapter = adapter;
    this.migrationsDir = migrationsDir || path.join(__dirname, '../../database/migrations');
  }

  /**
   * Run all pending migrations
   */
  async runMigrations(): Promise<void> {
    logger.info('Starting migration process');

    try {
      // Ensure migrations table exists
      await this.ensureMigrationsTable();

      // Get all migration files
      const migrationFiles = await this.getMigrationFiles();
      
      // Get executed migrations from database
      const executedMigrations = await this.getExecutedMigrations();
      
      // Find pending migrations
      const pendingMigrations = this.findPendingMigrations(migrationFiles, executedMigrations);
      
      if (pendingMigrations.length === 0) {
        logger.info('No pending migrations found');
        return;
      }

      logger.info(`Found ${pendingMigrations.length} pending migrations`);

      // Execute pending migrations in order
      for (const migration of pendingMigrations) {
        await this.executeMigration(migration);
      }

      logger.info('All migrations completed successfully');
    } catch (error) {
      logger.error('Migration process failed', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Create migrations table if it doesn't exist
   */
  private async ensureMigrationsTable(): Promise<void> {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS migrations (
        id VARCHAR(255) PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        checksum VARCHAR(64) NOT NULL
      )
    `;

    try {
      await this.adapter.query(createTableSQL);
      logger.debug('Migrations table ensured');
    } catch (error) {
      logger.error('Failed to create migrations table', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Get all migration files from the migrations directory
   */
  private async getMigrationFiles(): Promise<MigrationFile[]> {
    if (!fs.existsSync(this.migrationsDir)) {
      logger.warn(`Migrations directory not found: ${this.migrationsDir}`);
      return [];
    }

    const files = fs.readdirSync(this.migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort(); // Ensure migrations run in order

    const migrationFiles: MigrationFile[] = [];

    for (const filename of files) {
      const filepath = path.join(this.migrationsDir, filename);
      const content = fs.readFileSync(filepath, 'utf8');
      const checksum = this.calculateChecksum(content);
      
      // Extract migration ID from filename (e.g., "001_users_table.sql" -> "001")
      const id = filename.split('_')[0];
      
      migrationFiles.push({
        id,
        filename,
        filepath,
        content,
        checksum
      });
    }

    logger.debug(`Found ${migrationFiles.length} migration files`);
    return migrationFiles;
  }

  /**
   * Get list of executed migrations from database
   */
  private async getExecutedMigrations(): Promise<MigrationRecord[]> {
    try {
      const result = await this.adapter.query(
        'SELECT id, filename, executed_at, checksum FROM migrations ORDER BY id'
      );
      
      return result.rows.map(row => ({
        id: row.id,
        filename: row.filename,
        executed_at: new Date(row.executed_at),
        checksum: row.checksum
      }));
    } catch (error) {
      // If migrations table doesn't exist yet, return empty array
      logger.debug('No executed migrations found (migrations table may not exist yet)');
      return [];
    }
  }

  /**
   * Find migrations that haven't been executed yet
   */
  private findPendingMigrations(
    migrationFiles: MigrationFile[], 
    executedMigrations: MigrationRecord[]
  ): MigrationFile[] {
    const executedIds = new Set(executedMigrations.map(m => m.id));
    
    const pendingMigrations = migrationFiles.filter(file => {
      if (!executedIds.has(file.id)) {
        return true; // Migration hasn't been executed
      }
      
      // Check if checksum matches (detect modified migrations)
      const executedMigration = executedMigrations.find(m => m.id === file.id);
      if (executedMigration && executedMigration.checksum !== file.checksum) {
        logger.warn(`Migration ${file.id} has been modified since execution`, {
          originalChecksum: executedMigration.checksum,
          currentChecksum: file.checksum
        });
        // For safety, don't re-run modified migrations automatically
        // This could be made configurable in the future
      }
      
      return false;
    });

    return pendingMigrations;
  }

  /**
   * Execute a single migration
   */
  private async executeMigration(migration: MigrationFile): Promise<void> {
    logger.info(`Executing migration: ${migration.filename}`);
    
    const startTime = Date.now();
    
    try {
      // Execute the migration SQL
      await this.executeMigrationSQL(migration.content);
      
      // Record the migration as executed
      await this.recordMigrationExecution(migration);
      
      const duration = Date.now() - startTime;
      logger.info(`Migration ${migration.filename} completed successfully`, { 
        duration: `${duration}ms` 
      });
    } catch (error) {
      logger.error(`Migration ${migration.filename} failed`, { 
        error: (error as Error).message 
      });
      throw new Error(`Migration ${migration.filename} failed: ${(error as Error).message}`);
    }
  }

  /**
   * Execute migration SQL directly as PostgreSQL
   */
  private async executeMigrationSQL(migrationSQL: string): Promise<void> {
    // Split migration into individual statements
    const statements = this.splitMigrationSQL(migrationSQL);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.trim()) {
        try {
          await this.adapter.query(statement);
        } catch (error) {
          logger.error(`Failed to execute migration statement ${i + 1}`, {
            statement: statement.substring(0, 100) + (statement.length > 100 ? '...' : ''),
            error: (error as Error).message
          });
          throw error;
        }
      }
    }
  }

  /**
   * Split migration SQL into individual statements for PostgreSQL
   */
  private splitMigrationSQL(sql: string): string[] {
    const statements: string[] = [];
    
    // Handle PostgreSQL functions by preserving them as complete statements
    let processedSQL = sql;
    const functionPlaceholders: { [key: string]: string } = {};
    let placeholderIndex = 0;
    
    // Find and replace PostgreSQL functions (including triggers and procedures)
    const functionPattern = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|TRIGGER|PROCEDURE)[^$]*\$[^$]*\$[^;]*;/gis;
    processedSQL = processedSQL.replace(functionPattern, (match) => {
      const placeholder = `__FUNCTION_PLACEHOLDER_${placeholderIndex++}__`;
      functionPlaceholders[placeholder] = match;
      return placeholder;
    });
    
    // Split by semicolon
    const rawStatements = processedSQL.split(';');
    
    for (let i = 0; i < rawStatements.length; i++) {
      let statement = rawStatements[i].trim();
      
      if (!statement) {
        continue;
      }
      
      // Add semicolon back for SQL statements
      if (statement && !statement.endsWith(';')) {
        statement += ';';
      }
      
      // Replace function placeholders back
      for (const [placeholder, originalFunction] of Object.entries(functionPlaceholders)) {
        statement = statement.replace(placeholder, originalFunction);
      }
      
      // Skip comments-only statements
      const lines = statement.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      const nonCommentLines = lines.filter(line => !line.startsWith('--'));
      if (nonCommentLines.length === 0) {
        continue;
      }
      
      // Skip empty statements
      if (statement.trim() === ';') {
        continue;
      }
      
      statements.push(statement);
    }
    
    return statements;
  }

  /**
   * Record migration execution in the database
   */
  private async recordMigrationExecution(migration: MigrationFile): Promise<void> {
    const insertSQL = `
      INSERT INTO migrations (id, filename, executed_at, checksum)
      VALUES ($1, $2, CURRENT_TIMESTAMP, $3)
    `;
    
    await this.adapter.query(insertSQL, [
      migration.id,
      migration.filename,
      migration.checksum
    ]);
  }

  /**
   * Calculate checksum for migration content
   */
  private calculateChecksum(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Get migration status for debugging
   */
  async getMigrationStatus(): Promise<{
    total: number;
    executed: number;
    pending: number;
    migrations: Array<{
      id: string;
      filename: string;
      status: 'executed' | 'pending';
      executed_at?: Date;
    }>;
  }> {
    const migrationFiles = await this.getMigrationFiles();
    const executedMigrations = await this.getExecutedMigrations();
    const executedIds = new Set(executedMigrations.map(m => m.id));
    
    const migrations = migrationFiles.map(file => {
      const executed = executedMigrations.find(m => m.id === file.id);
      return {
        id: file.id,
        filename: file.filename,
        status: executedIds.has(file.id) ? 'executed' as const : 'pending' as const,
        executed_at: executed?.executed_at
      };
    });
    
    return {
      total: migrationFiles.length,
      executed: executedMigrations.length,
      pending: migrationFiles.length - executedMigrations.length,
      migrations
    };
  }

  /**
   * Validate migration integrity
   */
  async validateMigrations(): Promise<{
    valid: boolean;
    issues: string[];
  }> {
    const issues: string[] = [];
    
    try {
      const migrationFiles = await this.getMigrationFiles();
      const executedMigrations = await this.getExecutedMigrations();
      
      // Check for modified migrations
      for (const executed of executedMigrations) {
        const file = migrationFiles.find(f => f.id === executed.id);
        if (file && file.checksum !== executed.checksum) {
          issues.push(`Migration ${executed.filename} has been modified since execution`);
        }
        if (!file) {
          issues.push(`Executed migration ${executed.filename} no longer exists in filesystem`);
        }
      }
      
      // Check for gaps in migration sequence
      const ids = migrationFiles.map(f => parseInt(f.id)).sort((a, b) => a - b);
      for (let i = 1; i < ids.length; i++) {
        if (ids[i] !== ids[i-1] + 1) {
          issues.push(`Gap in migration sequence: missing migration ${ids[i-1] + 1}`);
        }
      }
      
    } catch (error) {
      issues.push(`Failed to validate migrations: ${(error as Error).message}`);
    }
    
    return {
      valid: issues.length === 0,
      issues
    };
  }
}