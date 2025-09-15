/**
 * PostgreSQL Service - Simplified database service using only PostgreSQL/Supabase
 */

import { Pool, PoolConfig } from 'pg';
import { logger } from '../../utils/logger';

export class PostgreSQLService {
  private static pool: Pool | null = null;
  private static initialized = false;

  /**
   * Initialize PostgreSQL connection pool
   */
  static async initialize(): Promise<void> {
    if (this.initialized && this.pool) {
      return;
    }

    const config: PoolConfig = {
      connectionString: process.env.SUPABASE_DB_URL || process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: parseInt(process.env.DB_POOL_MAX || '20'),
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
      connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '2000'),
    };

    try {
      this.pool = new Pool(config);
      
      // Test connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      
      this.initialized = true;
      logger.info('PostgreSQL connection pool initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize PostgreSQL connection pool:', error);
      throw error;
    }
  }

  /**
   * Get the PostgreSQL pool instance
   */
  static getPool(): Pool {
    if (!this.pool || !this.initialized) {
      throw new Error('PostgreSQL service not initialized. Call initialize() first.');
    }
    return this.pool;
  }

  /**
   * Execute a query
   */
  static async query(text: string, params?: any[]): Promise<any> {
    const pool = this.getPool();
    return pool.query(text, params);
  }

  /**
   * Get a client for transactions
   */
  static async getClient() {
    const pool = this.getPool();
    return pool.connect();
  }

  /**
   * Close all connections
   */
  static async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.initialized = false;
      logger.info('PostgreSQL connection pool closed');
    }
  }

  /**
   * Health check
   */
  static async healthCheck(): Promise<{ status: string; timestamp: Date }> {
    try {
      await this.query('SELECT 1');
      return {
        status: 'healthy',
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('PostgreSQL health check failed:', error);
      return {
        status: 'unhealthy',
        timestamp: new Date()
      };
    }
  }

  /**
   * Run migrations (simplified)
   */
  static async runMigrations(): Promise<void> {
    try {
      // Create migrations table if it doesn't exist
      await this.query(`
        CREATE TABLE IF NOT EXISTS migrations (
          id SERIAL PRIMARY KEY,
          filename VARCHAR(255) NOT NULL UNIQUE,
          executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      logger.info('Migration system initialized');
    } catch (error) {
      logger.error('Failed to initialize migration system:', error);
      throw error;
    }
  }
}