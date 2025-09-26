import { QueryResult, DatabaseClient, DatabaseAdapter } from '../../types/database';
import { DatabaseConfigManager } from './config';
import { PostgreSQLAdapter } from './adapters/PostgreSQLAdapter';
import { SupabaseAdapter } from './adapters/SupabaseAdapter';
import { logger } from '../../utils/logger';

/**
 * Database service that provides a unified interface for Supabase/PostgreSQL operations
 */
export class DatabaseService {
  private static adapter: DatabaseAdapter | null = null;
  private static initialized = false;

  /**
   * Initialize the database service with PostgreSQL/Supabase adapter
   */
  static async initialize(options: { skipMigrations?: boolean } = {}): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Validate configuration before attempting connection
    const validation = this.validateConfiguration();
    
    if (!validation.isValid) {
      const errorMessage = `Database configuration invalid: ${validation.errors.join('\n')}`;
      logger.error('Database configuration validation failed', { 
        errors: validation.errors,
        warnings: validation.warnings
      });
      
      const instructions = DatabaseConfigManager.getSetupInstructions();
      logger.info('Database setup instructions:', { instructions });
      
      throw new Error(errorMessage);
    }

    // Log warnings if any
    if (validation.warnings.length > 0) {
      logger.warn('Database configuration warnings', { warnings: validation.warnings });
    }

    const config = DatabaseConfigManager.getConfig();
    const configSummary = DatabaseConfigManager.getConfigSummary();
    
    logger.info('Database configuration loaded', configSummary);
    
    try {
      // Create appropriate adapter based on configuration
      if (config.type === 'supabase' && config.supabase) {
        this.adapter = new SupabaseAdapter(config.supabase);
      } else if (config.type === 'postgresql' && config.postgresql) {
        this.adapter = new PostgreSQLAdapter(config.postgresql);
      } else {
        throw new Error('Invalid database configuration: missing required configuration for selected type');
      }

      await this.adapter.initialize();
      
      // Run migrations to ensure schema is up to date (unless skipped)
      if (!options.skipMigrations) {
        await this.adapter.runMigrations();
      }
      
      this.initialized = true;
      
      logger.info('Database service initialized successfully', { 
        type: config.type,
        summary: configSummary
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Database service initialization failed', { 
        type: config.type,
        error: errorMessage,
        config: configSummary
      });
      
      // Provide helpful setup instructions on failure
      const instructions = DatabaseConfigManager.getSetupInstructions();
      logger.error('Database setup instructions:', { instructions });
      
      throw new Error(`Database initialization failed: ${errorMessage}. Check the setup instructions above.`);
    }
  }

  /**
   * Execute a database query
   */
  static async query(text: string, params?: any[]): Promise<QueryResult> {
    this.ensureInitialized();
    return this.adapter!.query(text, params);
  }

  /**
   * Get a database client for transaction management
   */
  static async getClient(): Promise<DatabaseClient> {
    this.ensureInitialized();
    return this.adapter!.getClient();
  }

  /**
   * Run database migrations
   */
  static async runMigrations(): Promise<void> {
    this.ensureInitialized();
    return this.adapter!.runMigrations();
  }

  /**
   * Close database connections
   */
  static async close(): Promise<void> {
    if (this.adapter) {
      await this.adapter.close();
      this.adapter = null;
      this.initialized = false;
      logger.info('Database service closed');
    }
  }

  /**
   * Get current database type for debugging/monitoring
   */
  static getDatabaseType(): string {
    const config = DatabaseConfigManager.getConfig();
    return config.type;
  }

  /**
   * Get configuration summary for debugging and monitoring
   */
  static getConfigSummary(): object {
    return DatabaseConfigManager.getConfigSummary();
  }

  /**
   * Validate current configuration
   */
  static validateConfiguration(): { isValid: boolean; errors: string[]; warnings: string[] } {
    return DatabaseConfigManager.validateEnvironmentSetup();
  }

  /**
   * Get setup instructions for current environment
   */
  static getSetupInstructions(): string {
    return DatabaseConfigManager.getSetupInstructions();
  }

  /**
   * Health check for the database connection
   */
  static async healthCheck(): Promise<{ status: string; type: string; timestamp: Date; version?: string; host?: string }> {
    try {
      this.ensureInitialized();
      
      // Enhanced health check with PostgreSQL-specific information
      const result = await this.query('SELECT NOW() as timestamp, version() as version');
      const config = DatabaseConfigManager.getConfig();
      
      return {
        status: 'healthy',
        type: this.getDatabaseType(),
        timestamp: new Date(),
        version: result.rows[0]?.version,
        host: config.postgresql?.host || config.supabase?.url || 'unknown'
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Database health check failed', { error: errorMessage });
      
      return {
        status: 'unhealthy',
        type: this.getDatabaseType(),
        timestamp: new Date()
      };
    }
  }

  /**
   * Ensure the service is initialized
   */
  private static ensureInitialized(): void {
    if (!this.initialized || !this.adapter) {
      throw new Error('Database service not initialized. Call initialize() first.');
    }
  }

  /**
   * Get the underlying PostgreSQL pool for services that need direct access
   * Note: Only available for PostgreSQL adapter, returns null for Supabase client
   */
  static getPool(): any {
    this.ensureInitialized();
    
    if (this.adapter!.getPool) {
      return this.adapter!.getPool();
    }
    
    logger.warn('getPool() not available for current database adapter');
    return null;
  }

  /**
   * Reset service state (useful for testing)
   */
  static reset(): void {
    this.adapter = null;
    this.initialized = false;
    DatabaseConfigManager.resetConfig();
  }


}