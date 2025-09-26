import { Pool, PoolClient } from 'pg';
import { BaseAdapter } from './BaseAdapter';
import { QueryResult, DatabaseClient, DatabaseConfig } from '../../../types/database';
import { logger } from '../../../utils/logger';

/**
 * PostgreSQL database adapter implementation
 * Extracted from existing database.ts logic with connection pooling support
 */
export class PostgreSQLAdapter extends BaseAdapter {
  private pool: Pool | null = null;
  private config: DatabaseConfig['postgresql'];

  constructor(config: DatabaseConfig['postgresql']) {
    super();
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (!this.config) {
      throw new Error('PostgreSQL configuration is required');
    }

    const poolConfig = {
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl ? {
        rejectUnauthorized: false // Accept self-signed certificates for Supabase
      } : false,
      max: this.config.max || 20,
      idleTimeoutMillis: this.config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: this.config.connectionTimeoutMillis || 2000,
    };

    this.pool = new Pool(poolConfig);

    // Test the connection with enhanced error handling
    await this.validateConnection();

    // Create initial schema
    await this.createInitialSchema();
  }

  /**
   * Validate database connection with detailed error reporting
   */
  private async validateConnection(): Promise<void> {
    if (!this.pool) {
      throw new Error('PostgreSQL pool not initialized');
    }

    try {
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      
      logger.info('PostgreSQL connection test successful', {
        host: this.config?.host,
        port: this.config?.port,
        database: this.config?.database,
        ssl: this.config?.ssl
      });
      
      this.initialized = true;
    } catch (error) {
      const err = error as any;
      
      // Enhanced error reporting for common connection issues
      let errorMessage = 'PostgreSQL connection failed';
      let suggestions: string[] = [];

      if (err.code === 'ENOTFOUND') {
        errorMessage = 'Database host not found';
        suggestions.push('Check DB_HOST or SUPABASE_DB_URL');
        suggestions.push('Verify network connectivity');
      } else if (err.code === 'ECONNREFUSED') {
        errorMessage = 'Connection refused by database server';
        suggestions.push('Check if PostgreSQL is running');
        suggestions.push('Verify DB_PORT is correct');
      } else if (err.code === '28P01') {
        errorMessage = 'Authentication failed';
        suggestions.push('Check DB_USER and DB_PASSWORD');
        suggestions.push('For Supabase, verify your connection string password');
      } else if (err.code === '3D000') {
        errorMessage = 'Database does not exist';
        suggestions.push('Check DB_NAME in your configuration');
        suggestions.push('Create the database first');
      } else if (err.code === 'ETIMEDOUT') {
        errorMessage = 'Connection timeout';
        suggestions.push('Check network connectivity');
        suggestions.push('For Supabase, try increasing DB_CONNECTION_TIMEOUT');
      } else if (err.message?.includes('SSL') || err.message?.includes('certificate')) {
        errorMessage = 'SSL connection error';
        suggestions.push('For Supabase, ensure SSL is enabled');
        suggestions.push('Check SSL certificate configuration');
      } else if (err.code === 'SELF_SIGNED_CERT_IN_CHAIN' || err.message?.includes('self-signed certificate')) {
        errorMessage = 'SSL certificate validation failed';
        suggestions.push('This is usually fixed automatically for Supabase connections');
        suggestions.push('If the issue persists, check your Supabase project settings');
      }

      logger.error(errorMessage, {
        error: err.message,
        code: err.code,
        host: this.config?.host,
        port: this.config?.port,
        database: this.config?.database,
        suggestions
      });

      // Create a more helpful error message
      const helpfulError = new Error(
        `${errorMessage}: ${err.message}${suggestions.length > 0 ? '\n\nSuggestions:\n- ' + suggestions.join('\n- ') : ''}`
      );
      
      throw helpfulError;
    }
  }

  async query(text: string, params?: any[]): Promise<QueryResult> {
    this.ensureInitialized();
    
    if (!this.pool) {
      throw new Error('PostgreSQL pool not initialized');
    }

    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      
      this.logQuery(text, params, duration, result.rowCount || 0);
      
      return this.normalizeQueryResult(result);
    } catch (error) {
      const err = error as Error;
      this.logQueryError(text, err);
      throw error;
    }
  }

  async getClient(): Promise<DatabaseClient> {
    this.ensureInitialized();
    
    if (!this.pool) {
      throw new Error('PostgreSQL pool not initialized');
    }

    const client = await this.pool.connect();
    
    return {
      query: async (text: string, params?: any[]): Promise<QueryResult> => {
        const start = Date.now();
        try {
          const result = await client.query(text, params);
          const duration = Date.now() - start;
          
          this.logQuery(text, params, duration, result.rowCount || 0);
          
          return this.normalizeQueryResult(result);
        } catch (error) {
          const err = error as Error;
          this.logQueryError(text, err);
          throw error;
        }
      },
      release: () => client.release()
    };
  }

  /**
   * Get the underlying PostgreSQL pool for services that need direct access
   */
  getPool(): Pool {
    this.ensureInitialized();
    
    if (!this.pool) {
      throw new Error('PostgreSQL pool not initialized');
    }
    
    return this.pool;
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.initialized = false;
      logger.info('PostgreSQL connection pool closed');
    }
  }

  async runMigrations(): Promise<void> {
    this.ensureInitialized();
    
    if (!this.pool) {
      throw new Error('PostgreSQL pool not initialized');
    }

    const { MigrationRunner } = await import('../MigrationRunner');
    const migrationRunner = new MigrationRunner(this);
    
    await migrationRunner.runMigrations();
  }

  protected normalizeQueryResult(result: any): QueryResult {
    return {
      rows: result.rows || [],
      rowCount: result.rowCount || 0,
      fields: result.fields
    };
  }

  private async createInitialSchema(): Promise<void> {
    const client = await this.getClient();
    
    try {
      await client.query('BEGIN');

      // Create users table for authentication
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          first_name VARCHAR(100) NOT NULL,
          last_name VARCHAR(100) NOT NULL,
          role VARCHAR(50) DEFAULT 'agent',
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      // Create clients table (CRM overlay data)
      await client.query(`
        CREATE TABLE IF NOT EXISTS clients (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          crm_id VARCHAR(255) NOT NULL,
          crm_system VARCHAR(50) NOT NULL,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255),
          phone VARCHAR(50),
          photo_url TEXT,
          personal_details JSONB DEFAULT '{}',
          relationship_health JSONB DEFAULT '{}',
          last_crm_sync TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(crm_system, crm_id)
        )
      `);

      // Create communications table
      await client.query(`
        CREATE TABLE IF NOT EXISTS communications (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
          type VARCHAR(20) NOT NULL CHECK (type IN ('email', 'call', 'sms')),
          direction VARCHAR(20) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
          subject TEXT,
          content TEXT NOT NULL,
          timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
          tags TEXT[] DEFAULT '{}',
          sentiment DECIMAL(3,2),
          is_urgent BOOLEAN DEFAULT false,
          source VARCHAR(255),
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      // Create tasks table
      await client.query(`
        CREATE TABLE IF NOT EXISTS tasks (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
          description TEXT NOT NULL,
          type VARCHAR(50) NOT NULL,
          priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
          status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in-progress', 'completed')),
          due_date TIMESTAMP WITH TIME ZONE,
          created_by VARCHAR(20) DEFAULT 'agent' CHECK (created_by IN ('agent', 'ai')),
          ai_context TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      // Create ai_actions table
      await client.query(`
        CREATE TABLE IF NOT EXISTS ai_actions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          type VARCHAR(100) NOT NULL,
          description TEXT NOT NULL,
          payload JSONB NOT NULL,
          requires_approval BOOLEAN DEFAULT true,
          risk_level VARCHAR(20) DEFAULT 'medium' CHECK (risk_level IN ('low', 'medium', 'high')),
          status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'executed')),
          confidence DECIMAL(3,2),
          chain_id UUID,
          step_number INTEGER,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      // Create audit_logs table for compliance
      await client.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id),
          action VARCHAR(100) NOT NULL,
          resource_type VARCHAR(50),
          resource_id UUID,
          details JSONB DEFAULT '{}',
          ip_address INET,
          user_agent TEXT,
          timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      // Create indexes for performance
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_clients_crm_system_id ON clients(crm_system, crm_id);
        CREATE INDEX IF NOT EXISTS idx_communications_client_id ON communications(client_id);
        CREATE INDEX IF NOT EXISTS idx_communications_timestamp ON communications(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_tasks_client_id ON tasks(client_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_ai_actions_status ON ai_actions(status);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
      `);

      await client.query('COMMIT');
      logger.info('Initial PostgreSQL database schema created successfully');
    } catch (error) {
      await client.query('ROLLBACK');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to create initial PostgreSQL schema', { error: errorMessage });
      throw error;
    } finally {
      if (client.release) {
        client.release();
      }
    }
  }
}