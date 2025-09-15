import { DatabaseAdapter, QueryResult, DatabaseClient } from '../../types/database';
import { DatabaseConfigManager } from './config';
import { logger } from '../../utils/logger';

/**
 * Database service facade that manages adapter selection and provides a unified interface
 */
export class DatabaseService {
  private static adapter: DatabaseAdapter | null = null;
  private static initialized = false;

  /**
   * Initialize the database service with the appropriate adapter
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
      // Dynamic import to avoid circular dependencies and allow for lazy loading
      if (config.type === 'sqlite') {
        const { SQLiteAdapter } = await import('./adapters/SQLiteAdapter');
        this.adapter = new SQLiteAdapter(config.sqlite!);
      } else {
        const { PostgreSQLAdapter } = await import('./adapters/PostgreSQLAdapter');
        this.adapter = new PostgreSQLAdapter(config.postgresql!);
      }

      await this.adapter.initialize();
      
      // Run migrations to ensure schema is up to date (unless skipped)
      if (!options.skipMigrations) {
        await this.adapter.runMigrations();
        
        // Create legacy schema if migrations don't exist (backward compatibility)
        await this.ensureLegacySchema();
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
  static async healthCheck(): Promise<{ status: string; type: string; timestamp: Date }> {
    try {
      this.ensureInitialized();
      
      // Simple query to test connection
      await this.query('SELECT 1 as health_check');
      
      return {
        status: 'healthy',
        type: this.getDatabaseType(),
        timestamp: new Date()
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
   * Reset service state (useful for testing)
   */
  static reset(): void {
    this.adapter = null;
    this.initialized = false;
    DatabaseConfigManager.resetConfig();
  }

  /**
   * Ensure legacy schema exists for backward compatibility
   * This creates essential tables if they don't exist from migrations
   */
  private static async ensureLegacySchema(): Promise<void> {
    try {
      // Check if basic tables exist, if not create them
      const tablesExist = await this.checkBasicTablesExist();
      
      if (!tablesExist) {
        logger.info('Creating legacy schema for backward compatibility');
        await this.createLegacySchema();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.warn('Failed to ensure legacy schema', { error: errorMessage });
      // Don't throw here as migrations might handle schema creation
    }
  }

  /**
   * Check if basic tables exist
   */
  private static async checkBasicTablesExist(): Promise<boolean> {
    try {
      // Use adapter directly since service might not be fully initialized yet
      if (!this.adapter) {
        return false;
      }
      await this.adapter.query("SELECT 1 FROM users LIMIT 1");
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Create legacy schema for backward compatibility
   */
  private static async createLegacySchema(): Promise<void> {
    if (!this.adapter) {
      throw new Error('Database adapter not initialized');
    }
    const client = await this.adapter.getClient();
    
    try {
      await client.query('BEGIN');

      // Create basic tables that are essential for the application
      // These will be created with SQLite-compatible syntax that gets translated
      
      // Users table (basic version for compatibility)
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255),
          first_name VARCHAR(100) NOT NULL,
          last_name VARCHAR(100) NOT NULL,
          role VARCHAR(50) DEFAULT 'agent',
          is_active BOOLEAN DEFAULT true,
          keycloak_id VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Clients table (CRM overlay data)
      await client.query(`
        CREATE TABLE IF NOT EXISTS clients (
          id TEXT PRIMARY KEY,
          crm_id VARCHAR(255) NOT NULL,
          crm_system VARCHAR(50) NOT NULL,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255),
          phone VARCHAR(50),
          photo_url TEXT,
          personal_details TEXT DEFAULT '{}',
          relationship_health TEXT DEFAULT '{}',
          last_crm_sync TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Communications table
      await client.query(`
        CREATE TABLE IF NOT EXISTS communications (
          id TEXT PRIMARY KEY,
          client_id TEXT,
          type VARCHAR(20) NOT NULL,
          direction VARCHAR(20) NOT NULL,
          subject TEXT,
          content TEXT NOT NULL,
          timestamp TIMESTAMP NOT NULL,
          tags TEXT DEFAULT '[]',
          sentiment DECIMAL(3,2),
          is_urgent BOOLEAN DEFAULT false,
          source VARCHAR(255),
          metadata TEXT DEFAULT '{}',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Tasks table
      await client.query(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          client_id TEXT,
          description TEXT NOT NULL,
          type VARCHAR(50) NOT NULL,
          priority VARCHAR(20) DEFAULT 'medium',
          status VARCHAR(20) DEFAULT 'pending',
          due_date TIMESTAMP,
          created_by VARCHAR(20) DEFAULT 'agent',
          ai_context TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // AI actions table
      await client.query(`
        CREATE TABLE IF NOT EXISTS ai_actions (
          id TEXT PRIMARY KEY,
          type VARCHAR(100) NOT NULL,
          description TEXT NOT NULL,
          payload TEXT NOT NULL,
          requires_approval BOOLEAN DEFAULT true,
          risk_level VARCHAR(20) DEFAULT 'medium',
          status VARCHAR(20) DEFAULT 'pending',
          confidence DECIMAL(3,2),
          chain_id TEXT,
          step_number INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Audit logs table for compliance
      await client.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          action VARCHAR(100) NOT NULL,
          resource_type VARCHAR(50),
          resource_id TEXT,
          details TEXT DEFAULT '{}',
          ip_address VARCHAR(45),
          user_agent TEXT,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await client.query('COMMIT');
      logger.info('Legacy database schema created successfully');
    } catch (error) {
      await client.query('ROLLBACK');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to create legacy schema', { error: errorMessage });
      throw error;
    } finally {
      if ('release' in client && typeof client.release === 'function') {
        client.release();
      }
    }
  }
}