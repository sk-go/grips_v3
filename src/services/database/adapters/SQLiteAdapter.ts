import Database from 'better-sqlite3';
import { BaseAdapter } from './BaseAdapter';
import { QueryResult, DatabaseClient, DatabaseConfig } from '../../../types/database';
import { SQLCompatibilityLayer } from './SQLCompatibilityLayer';
import { logger } from '../../../utils/logger';
import * as path from 'path';
import * as fs from 'fs';

/**
 * SQLite database adapter implementation using better-sqlite3
 */
export class SQLiteAdapter extends BaseAdapter {
  private db: Database.Database | null = null;
  private config: DatabaseConfig['sqlite'];

  constructor(config?: DatabaseConfig['sqlite']) {
    super();
    this.config = config || { filename: './data/development.db' };
  }

  async initialize(): Promise<void> {
    try {
      const filename = this.config!.filename;
      
      // Handle in-memory database
      if (filename === ':memory:') {
        this.db = new Database(':memory:');
        logger.info('SQLite in-memory database initialized');
      } else {
        // Ensure the directory exists for file-based databases
        const dbPath = path.resolve(filename);
        const dbDir = path.dirname(dbPath);
        
        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true });
          logger.info(`Created database directory: ${dbDir}`);
        }

        // Initialize SQLite database
        this.db = new Database(dbPath);
        logger.info(`SQLite database initialized: ${dbPath}`);
      }
      
      // Enable WAL mode if configured (better for concurrent access)
      if (this.config!.enableWAL) {
        this.db.pragma('journal_mode = WAL');
        logger.debug('SQLite WAL mode enabled');
      }

      // Set other performance optimizations
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('cache_size = 1000');
      this.db.pragma('temp_store = memory');

      // Register custom functions for PostgreSQL compatibility
      SQLCompatibilityLayer.registerSQLiteFunctions(this.db);

      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize SQLite database', { error: (error as Error).message });
      throw error;
    }
  }

  async query(text: string, params?: any[]): Promise<QueryResult> {
    this.ensureInitialized();
    
    if (!this.db) {
      throw new Error('SQLite database not initialized');
    }

    const startTime = Date.now();
    
    try {
      // Translate PostgreSQL SQL to SQLite-compatible SQL
      const originalSQL = text;
      let translatedSQL = SQLCompatibilityLayer.translateSQL(text);
      
      // Handle parameter translation if needed
      const { sql: finalSQL, params: finalParams } = SQLCompatibilityLayer.translateParameters(
        translatedSQL, 
        params || []
      );
      
      // Log translation warnings if there were significant changes
      if (originalSQL !== finalSQL) {
        SQLCompatibilityLayer.logTranslationWarnings(originalSQL, finalSQL);
      }
      
      // Determine if this is a SELECT query or a modification query
      const isSelect = finalSQL.trim().toLowerCase().startsWith('select');
      
      if (isSelect) {
        // For SELECT queries, use all() to get all rows
        const stmt = this.db.prepare(finalSQL);
        const rows = finalParams.length > 0 ? stmt.all(finalParams) : stmt.all();
        
        const duration = Date.now() - startTime;
        const result: QueryResult = {
          rows,
          rowCount: rows.length
        };
        
        this.logQuery(originalSQL, params, duration, result.rowCount);
        return result;
      } else {
        // For INSERT, UPDATE, DELETE queries, use run()
        const stmt = this.db.prepare(finalSQL);
        const info = finalParams.length > 0 ? stmt.run(finalParams) : stmt.run();
        
        const duration = Date.now() - startTime;
        const result: QueryResult = {
          rows: [],
          rowCount: info.changes
        };
        
        this.logQuery(originalSQL, params, duration, result.rowCount);
        return result;
      }
    } catch (error) {
      this.logQueryError(text, error as Error);
      throw error;
    }
  }

  async getClient(): Promise<DatabaseClient> {
    this.ensureInitialized();
    
    if (!this.db) {
      throw new Error('SQLite database not initialized');
    }

    // SQLite doesn't use connection pooling like PostgreSQL
    // Return a client wrapper that uses the same database instance
    return {
      query: async (text: string, params?: any[]): Promise<QueryResult> => {
        return this.query(text, params);
      }
      // No release() method needed for SQLite
    };
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
      logger.info('SQLite database connection closed');
    }
  }

  async runMigrations(): Promise<void> {
    this.ensureInitialized();
    
    if (!this.db) {
      throw new Error('SQLite database not initialized');
    }

    const { MigrationRunner } = await import('../MigrationRunner');
    const migrationRunner = new MigrationRunner(this);
    
    await migrationRunner.runMigrations();
  }

  /**
   * Get the underlying SQLite database instance for advanced operations
   */
  getDatabase(): Database.Database | null {
    return this.db;
  }

  /**
   * Execute multiple statements in a transaction
   */
  async transaction<T>(callback: (db: Database.Database) => T): Promise<T> {
    this.ensureInitialized();
    
    if (!this.db) {
      throw new Error('SQLite database not initialized');
    }

    const transaction = this.db.transaction(() => callback(this.db!));
    return transaction();
  }

  /**
   * Execute a migration file with SQL translation
   */
  async executeMigrationSQL(migrationSQL: string): Promise<void> {
    this.ensureInitialized();
    
    if (!this.db) {
      throw new Error('SQLite database not initialized');
    }

    try {
      // Translate the entire migration SQL
      const translatedSQL = SQLCompatibilityLayer.translateSQL(migrationSQL);
      
      // Log translation warnings
      SQLCompatibilityLayer.logTranslationWarnings(migrationSQL, translatedSQL);
      
      // Split into individual statements and execute
      const statements = translatedSQL
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
      
      for (const statement of statements) {
        if (statement.trim()) {
          try {
            this.db.exec(statement);
          } catch (error) {
            logger.error('Failed to execute migration statement', {
              statement: statement.substring(0, 100) + '...',
              error: (error as Error).message
            });
            throw error;
          }
        }
      }
      
      logger.info('Migration SQL executed successfully');
    } catch (error) {
      logger.error('Failed to execute migration SQL', { error: (error as Error).message });
      throw error;
    }
  }
}