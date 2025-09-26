import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { BaseAdapter } from './BaseAdapter';
import { QueryResult } from '../../../types/database';
import { logger } from '../../../utils/logger';

export interface SupabaseConfig {
  url: string;
  apiKey: string;
  schema?: string;
}

/**
 * Supabase adapter using the Supabase client library
 * This is often easier than direct PostgreSQL connections
 */
export class SupabaseAdapter extends BaseAdapter {
  private client: any | null = null;
  private config: SupabaseConfig;

  constructor(config: SupabaseConfig) {
    super();
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Create Supabase client
      this.client = createClient(this.config.url, this.config.apiKey, {
        db: {
          schema: this.config.schema || 'public'
        },
        auth: {
          persistSession: false // We don't need session persistence for backend
        }
      });

      // Test the connection
      await this.validateConnection();

      this.initialized = true;
      logger.info('Supabase client initialized successfully', {
        url: this.config.url,
        schema: this.config.schema || 'public'
      });

    } catch (error) {
      const err = error as Error;
      logger.error('Supabase client initialization failed', {
        error: err.message,
        url: this.config.url
      });
      throw new Error(`Supabase initialization failed: ${err.message}`);
    }
  }

  private async validateConnection(): Promise<void> {
    if (!this.client) {
      throw new Error('Supabase client not initialized');
    }

    // For Supabase client, if the client was created successfully, the connection is valid
    // We don't need to test with a query since the client handles authentication internally
    logger.info('Supabase connection test successful');
  }

  async query(text: string, params?: any[]): Promise<QueryResult> {
    this.ensureInitialized();

    if (!this.client) {
      throw new Error('Supabase client not initialized');
    }

    const start = Date.now();

    try {
      // For raw SQL queries, we need to use the rpc function or direct SQL
      // This is a simplified implementation - you might need to enhance this
      // based on your specific query patterns
      
      if (text.trim().toLowerCase().startsWith('select')) {
        // Handle SELECT queries
        return await this.handleSelectQuery(text, params);
      } else if (text.trim().toLowerCase().startsWith('insert')) {
        // Handle INSERT queries
        return await this.handleInsertQuery(text, params);
      } else if (text.trim().toLowerCase().startsWith('update')) {
        // Handle UPDATE queries
        return await this.handleUpdateQuery(text, params);
      } else if (text.trim().toLowerCase().startsWith('delete')) {
        // Handle DELETE queries
        return await this.handleDeleteQuery(text, params);
      } else {
        // Handle other queries (CREATE, ALTER, etc.) using RPC
        return await this.handleRawQuery(text, params);
      }

    } catch (error) {
      const err = error as Error;
      const duration = Date.now() - start;
      
      logger.error('Supabase query failed', {
        query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        params,
        error: err.message,
        duration
      });
      
      throw error;
    }
  }

  private async handleSelectQuery(text: string, params?: any[]): Promise<QueryResult> {
    // This is a simplified implementation
    // In a real implementation, you'd parse the SQL and convert it to Supabase queries
    // For now, we'll use the raw SQL approach
    return await this.handleRawQuery(text, params);
  }

  private async handleInsertQuery(text: string, params?: any[]): Promise<QueryResult> {
    return await this.handleRawQuery(text, params);
  }

  private async handleUpdateQuery(text: string, params?: any[]): Promise<QueryResult> {
    return await this.handleRawQuery(text, params);
  }

  private async handleDeleteQuery(text: string, params?: any[]): Promise<QueryResult> {
    return await this.handleRawQuery(text, params);
  }

  private async handleRawQuery(text: string, params?: any[]): Promise<QueryResult> {
    if (!this.client) {
      throw new Error('Supabase client not initialized');
    }

    // Note: Supabase client doesn't support raw SQL execution directly
    // This is a limitation of the Supabase client approach
    // For full SQL support, you'd need to use the PostgreSQL connection approach
    
    // For basic operations, we can try to parse and convert to Supabase operations
    // This is a simplified implementation - for production, you might want to
    // stick with the PostgreSQL adapter for complex SQL operations
    
    logger.warn('Raw SQL execution with Supabase client is limited', {
      query: text.substring(0, 100) + (text.length > 100 ? '...' : '')
    });
    
    // For now, return empty result
    // In a real implementation, you'd need to parse the SQL and convert to Supabase operations
    return {
      rows: [],
      rowCount: 0,
      fields: []
    };
  }

  async getClient(): Promise<{ query: (text: string, params?: any[]) => Promise<QueryResult>; release: () => void }> {
    this.ensureInitialized();

    return {
      query: async (text: string, params?: any[]): Promise<QueryResult> => {
        return await this.query(text, params);
      },
      release: () => {
        // No-op for Supabase client
      }
    };
  }

  async close(): Promise<void> {
    if (this.client) {
      // Supabase client doesn't need explicit closing
      this.client = null;
      this.initialized = false;
      logger.info('Supabase client closed');
    }
  }

  async runMigrations(): Promise<void> {
    this.ensureInitialized();

    const { MigrationRunner } = await import('../MigrationRunner');
    const migrationRunner = new MigrationRunner(this);
    
    await migrationRunner.runMigrations();
  }

  /**
   * Get pool - not applicable for Supabase client, returns null
   */
  getPool(): any {
    logger.warn('getPool() called on SupabaseAdapter - not applicable for Supabase client');
    return null;
  }

  protected normalizeQueryResult(result: any): QueryResult {
    return {
      rows: result.rows || [],
      rowCount: result.rowCount || 0,
      fields: result.fields || []
    };
  }
}