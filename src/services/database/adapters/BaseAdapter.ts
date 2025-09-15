import { DatabaseAdapter, QueryResult, DatabaseClient } from '../../../types/database';
import { logger } from '../../../utils/logger';

/**
 * Base database adapter with common functionality
 */
export abstract class BaseAdapter implements DatabaseAdapter {
  protected initialized = false;

  abstract initialize(): Promise<void>;
  abstract query(text: string, params?: any[]): Promise<QueryResult>;
  abstract getClient(): Promise<DatabaseClient>;
  abstract close(): Promise<void>;
  abstract runMigrations(): Promise<void>;

  /**
   * Log query execution with timing
   */
  protected logQuery(query: string, params: any[] | undefined, duration: number, rowCount: number): void {
    logger.debug('Database query executed', {
      query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
      duration: `${duration}ms`,
      rows: rowCount,
      hasParams: !!params?.length
    });
  }

  /**
   * Log query errors
   */
  protected logQueryError(query: string, error: Error): void {
    logger.error('Database query failed', {
      query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
      error: error.message
    });
  }

  /**
   * Ensure adapter is initialized
   */
  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Database adapter not initialized. Call initialize() first.');
    }
  }

  /**
   * Normalize query result format across different database types
   */
  protected normalizeQueryResult(result: any): QueryResult {
    // This will be implemented by specific adapters
    return result;
  }
}