import { DatabaseService } from '../database/DatabaseService';
import { logger } from '../../utils/logger';

export interface IndexRecommendation {
  table: string;
  columns: string[];
  type: 'btree' | 'hash' | 'gin' | 'gist';
  reason: string;
  estimatedImpact: 'high' | 'medium' | 'low';
}

export interface QueryOptimization {
  originalQuery: string;
  optimizedQuery: string;
  explanation: string;
  estimatedImprovement: string;
}

export class DatabaseOptimizer {
  /**
   * Analyze database performance and suggest optimizations
   */
  async analyzePerformance(): Promise<{
    slowQueries: any[];
    indexRecommendations: IndexRecommendation[];
    tableStats: any[];
    connectionStats: any;
  }> {
    try {
      // Get slow queries (PostgreSQL specific)
      const slowQueries = await this.getSlowQueries();
      
      // Get table statistics
      const tableStats = await this.getTableStatistics();
      
      // Get connection statistics
      const connectionStats = await this.getConnectionStatistics();
      
      // Generate index recommendations
      const indexRecommendations = await this.generateIndexRecommendations();

      return {
        slowQueries,
        indexRecommendations,
        tableStats,
        connectionStats
      };
    } catch (error) {
      logger.error('Failed to analyze database performance', { error });
      throw error;
    }
  }

  /**
   * Get slow queries from PostgreSQL
   */
  private async getSlowQueries(): Promise<any[]> {
    try {
      // Enable pg_stat_statements if available
      const result = await DatabaseService.query(`
        SELECT 
          query,
          calls,
          total_time,
          mean_time,
          rows,
          100.0 * shared_blks_hit / nullif(shared_blks_hit + shared_blks_read, 0) AS hit_percent
        FROM pg_stat_statements 
        WHERE mean_time > 100 -- queries taking more than 100ms on average
        ORDER BY mean_time DESC 
        LIMIT 10
      `);
      
      return result.rows || [];
    } catch (error) {
      // pg_stat_statements might not be enabled
      logger.info('pg_stat_statements not available, using alternative method');
      return [];
    }
  }

  /**
   * Get table statistics
   */
  private async getTableStatistics(): Promise<any[]> {
    try {
      const result = await DatabaseService.query(`
        SELECT 
          schemaname,
          tablename,
          attname,
          n_distinct,
          correlation,
          most_common_vals,
          most_common_freqs
        FROM pg_stats 
        WHERE schemaname = 'public'
        ORDER BY tablename, attname
      `);
      
      return result.rows || [];
    } catch (error) {
      logger.error('Failed to get table statistics', { error });
      return [];
    }
  }

  /**
   * Get connection statistics
   */
  private async getConnectionStatistics(): Promise<any> {
    try {
      const result = await DatabaseService.query(`
        SELECT 
          count(*) as total_connections,
          count(*) FILTER (WHERE state = 'active') as active_connections,
          count(*) FILTER (WHERE state = 'idle') as idle_connections,
          count(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction
        FROM pg_stat_activity 
        WHERE datname = current_database()
      `);
      
      return result.rows?.[0] || {};
    } catch (error) {
      logger.error('Failed to get connection statistics', { error });
      return {};
    }
  }

  /**
   * Generate index recommendations based on table usage
   */
  private async generateIndexRecommendations(): Promise<IndexRecommendation[]> {
    const recommendations: IndexRecommendation[] = [];

    try {
      // Check for missing indexes on foreign keys
      const foreignKeyResult = await DatabaseService.query(`
        SELECT 
          tc.table_name,
          kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
      `);

      for (const row of foreignKeyResult.rows || []) {
        // Check if index exists
        const indexExists = await this.checkIndexExists(row.table_name, [row.column_name]);
        if (!indexExists) {
          recommendations.push({
            table: row.table_name,
            columns: [row.column_name],
            type: 'btree',
            reason: 'Foreign key without index - will improve JOIN performance',
            estimatedImpact: 'high'
          });
        }
      }

      // Add specific recommendations for our application tables
      const appRecommendations: IndexRecommendation[] = [
        {
          table: 'communications',
          columns: ['client_id', 'timestamp'],
          type: 'btree',
          reason: 'Composite index for client communication timeline queries',
          estimatedImpact: 'high'
        },
        {
          table: 'communications',
          columns: ['type', 'direction'],
          type: 'btree',
          reason: 'Index for filtering communications by type and direction',
          estimatedImpact: 'medium'
        },
        {
          table: 'ai_actions',
          columns: ['status', 'created_at'],
          type: 'btree',
          reason: 'Index for querying pending actions by status and time',
          estimatedImpact: 'high'
        },
        {
          table: 'client_profiles',
          columns: ['crm_system', 'crm_id'],
          type: 'btree',
          reason: 'Composite index for CRM lookups',
          estimatedImpact: 'high'
        },
        {
          table: 'email_messages',
          columns: ['account_id', 'received_at'],
          type: 'btree',
          reason: 'Index for email timeline queries by account',
          estimatedImpact: 'medium'
        },
        {
          table: 'twilio_messages',
          columns: ['phone_number', 'created_at'],
          type: 'btree',
          reason: 'Index for SMS/call history by phone number',
          estimatedImpact: 'medium'
        }
      ];

      // Check which recommendations are not already implemented
      for (const rec of appRecommendations) {
        const exists = await this.checkIndexExists(rec.table, rec.columns);
        if (!exists) {
          recommendations.push(rec);
        }
      }

    } catch (error) {
      logger.error('Failed to generate index recommendations', { error });
    }

    return recommendations;
  }

  /**
   * Check if an index exists on specified columns
   */
  private async checkIndexExists(tableName: string, columns: string[]): Promise<boolean> {
    try {
      const result = await DatabaseService.query(`
        SELECT 1
        FROM pg_indexes 
        WHERE tablename = $1 
          AND indexdef LIKE '%' || $2 || '%'
      `, [tableName, columns.join(', ')]);
      
      return (result.rows?.length || 0) > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Apply recommended indexes
   */
  async applyIndexRecommendations(recommendations: IndexRecommendation[]): Promise<void> {
    for (const rec of recommendations) {
      try {
        const indexName = `idx_${rec.table}_${rec.columns.join('_')}`;
        const columnsStr = rec.columns.join(', ');
        
        const createIndexQuery = `
          CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName} 
          ON ${rec.table} USING ${rec.type} (${columnsStr})
        `;
        
        logger.info('Creating index', { 
          table: rec.table, 
          columns: rec.columns, 
          type: rec.type 
        });
        
        await DatabaseService.query(createIndexQuery);
        
        logger.info('Index created successfully', { indexName });
      } catch (error) {
        logger.error('Failed to create index', { 
          table: rec.table, 
          columns: rec.columns, 
          error 
        });
      }
    }
  }

  /**
   * Optimize query plans by updating table statistics
   */
  async updateTableStatistics(): Promise<void> {
    try {
      const tables = [
        'users', 'client_profiles', 'communications', 'email_messages',
        'twilio_messages', 'ai_actions', 'document_templates', 'audit_logs'
      ];

      for (const table of tables) {
        logger.info('Analyzing table', { table });
        await DatabaseService.query(`ANALYZE ${table}`);
      }

      logger.info('Table statistics updated successfully');
    } catch (error) {
      logger.error('Failed to update table statistics', { error });
      throw error;
    }
  }

  /**
   * Get query optimization suggestions
   */
  getQueryOptimizations(): QueryOptimization[] {
    return [
      {
        originalQuery: 'SELECT * FROM communications WHERE client_id = ?',
        optimizedQuery: 'SELECT id, type, direction, subject, timestamp FROM communications WHERE client_id = ? ORDER BY timestamp DESC LIMIT 100',
        explanation: 'Avoid SELECT *, add ORDER BY and LIMIT for better performance',
        estimatedImprovement: '50-70% faster'
      },
      {
        originalQuery: 'SELECT * FROM client_profiles WHERE name LIKE ?',
        optimizedQuery: 'SELECT id, name, email FROM client_profiles WHERE name ILIKE ? AND active = true',
        explanation: 'Use ILIKE for case-insensitive search, add active filter, select only needed columns',
        estimatedImprovement: '30-50% faster'
      },
      {
        originalQuery: 'SELECT COUNT(*) FROM communications',
        optimizedQuery: 'SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = \'communications\'',
        explanation: 'Use table statistics for approximate counts instead of full table scan',
        estimatedImprovement: '90%+ faster for large tables'
      }
    ];
  }

  /**
   * Monitor connection pool health
   */
  async monitorConnectionPool(): Promise<{
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    waitingConnections: number;
    poolHealth: 'healthy' | 'warning' | 'critical';
  }> {
    try {
      const pool = DatabaseService.getPool();
      
      const stats = {
        totalConnections: pool.totalCount,
        activeConnections: pool.totalCount - pool.idleCount,
        idleConnections: pool.idleCount,
        waitingConnections: pool.waitingCount,
        poolHealth: 'healthy' as const
      };

      // Determine pool health
      const utilizationRate = stats.activeConnections / pool.options.max;
      
      if (utilizationRate > 0.9) {
        stats.poolHealth = 'critical';
      } else if (utilizationRate > 0.7) {
        stats.poolHealth = 'warning';
      }

      if (stats.waitingConnections > 0) {
        stats.poolHealth = 'warning';
      }

      return stats;
    } catch (error) {
      logger.error('Failed to monitor connection pool', { error });
      return {
        totalConnections: 0,
        activeConnections: 0,
        idleConnections: 0,
        waitingConnections: 0,
        poolHealth: 'critical'
      };
    }
  }
}