import { DatabaseOptimizer } from '../../services/performance/databaseOptimizer';
import { DatabaseService } from '../../services/database/DatabaseService';

// Mock DatabaseService
jest.mock('../../services/database/DatabaseService');
const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;

describe('DatabaseOptimizer', () => {
  let optimizer: DatabaseOptimizer;

  beforeEach(() => {
    optimizer = new DatabaseOptimizer();
    jest.clearAllMocks();
  });

  describe('analyzePerformance', () => {
    it('should analyze database performance successfully', async () => {
      // Mock database responses
      mockDatabaseService.query
        .mockResolvedValueOnce({ rows: [] }) // slow queries
        .mockResolvedValueOnce({ rows: [{ // table stats
          schemaname: 'public',
          tablename: 'communications',
          attname: 'client_id',
          n_distinct: 1000,
          correlation: 0.1
        }] })
        .mockResolvedValueOnce({ rows: [{ // connection stats
          total_connections: 10,
          active_connections: 5,
          idle_connections: 5,
          idle_in_transaction: 0
        }] })
        .mockResolvedValueOnce({ rows: [] }) // foreign keys
        .mockResolvedValueOnce({ rows: [] }); // index checks

      const analysis = await optimizer.analyzePerformance();

      expect(analysis).toHaveProperty('slowQueries');
      expect(analysis).toHaveProperty('indexRecommendations');
      expect(analysis).toHaveProperty('tableStats');
      expect(analysis).toHaveProperty('connectionStats');
      
      expect(Array.isArray(analysis.slowQueries)).toBe(true);
      expect(Array.isArray(analysis.indexRecommendations)).toBe(true);
      expect(Array.isArray(analysis.tableStats)).toBe(true);
    });

    it('should handle database errors gracefully', async () => {
      mockDatabaseService.query.mockRejectedValue(new Error('Database connection failed'));

      await expect(optimizer.analyzePerformance()).rejects.toThrow('Database connection failed');
    });

    it('should handle missing pg_stat_statements extension', async () => {
      // First call fails (pg_stat_statements not available)
      mockDatabaseService.query
        .mockRejectedValueOnce(new Error('relation "pg_stat_statements" does not exist'))
        .mockResolvedValueOnce({ rows: [] }) // table stats
        .mockResolvedValueOnce({ rows: [] }) // connection stats
        .mockResolvedValueOnce({ rows: [] }) // foreign keys
        .mockResolvedValueOnce({ rows: [] }); // index checks

      const analysis = await optimizer.analyzePerformance();
      expect(analysis.slowQueries).toEqual([]);
    });
  });

  describe('generateIndexRecommendations', () => {
    it('should recommend indexes for foreign keys without indexes', async () => {
      mockDatabaseService.query
        .mockResolvedValueOnce({ rows: [{ // foreign keys
          table_name: 'communications',
          column_name: 'client_id'
        }] })
        .mockResolvedValueOnce({ rows: [] }) // index check - no existing index
        .mockResolvedValueOnce({ rows: [] }) // more index checks
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const analysis = await optimizer.analyzePerformance();
      
      const fkRecommendation = analysis.indexRecommendations.find(r => 
        r.table === 'communications' && 
        r.columns.includes('client_id') &&
        r.reason.includes('Foreign key without index')
      );
      
      expect(fkRecommendation).toBeDefined();
      expect(fkRecommendation?.estimatedImpact).toBe('high');
    });

    it('should include application-specific index recommendations', async () => {
      mockDatabaseService.query
        .mockResolvedValueOnce({ rows: [] }) // no foreign keys
        .mockResolvedValueOnce({ rows: [] }) // index checks
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const analysis = await optimizer.analyzePerformance();
      
      // Should include recommendations for communications table
      const commRecommendation = analysis.indexRecommendations.find(r => 
        r.table === 'communications' && 
        r.columns.includes('client_id') &&
        r.columns.includes('timestamp')
      );
      
      expect(commRecommendation).toBeDefined();
      expect(commRecommendation?.reason).toContain('timeline queries');
    });

    it('should not recommend existing indexes', async () => {
      mockDatabaseService.query
        .mockResolvedValueOnce({ rows: [] }) // no foreign keys
        .mockResolvedValueOnce({ rows: [{ indexdef: 'CREATE INDEX idx_test ON communications (client_id, timestamp)' }] }) // existing index
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const analysis = await optimizer.analyzePerformance();
      
      // Should not recommend index that already exists
      const existingRecommendation = analysis.indexRecommendations.find(r => 
        r.table === 'communications' && 
        r.columns.includes('client_id') &&
        r.columns.includes('timestamp')
      );
      
      expect(existingRecommendation).toBeUndefined();
    });
  });

  describe('applyIndexRecommendations', () => {
    it('should create indexes from recommendations', async () => {
      const recommendations = [
        {
          table: 'communications',
          columns: ['client_id', 'timestamp'],
          type: 'btree' as const,
          reason: 'Test index',
          estimatedImpact: 'high' as const
        }
      ];

      mockDatabaseService.query.mockResolvedValue({ rows: [] });

      await optimizer.applyIndexRecommendations(recommendations);

      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE INDEX CONCURRENTLY')
      );
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('idx_communications_client_id_timestamp')
      );
    });

    it('should handle index creation errors gracefully', async () => {
      const recommendations = [
        {
          table: 'invalid_table',
          columns: ['invalid_column'],
          type: 'btree' as const,
          reason: 'Test index',
          estimatedImpact: 'high' as const
        }
      ];

      mockDatabaseService.query.mockRejectedValue(new Error('Table does not exist'));

      // Should not throw, but log the error
      await expect(optimizer.applyIndexRecommendations(recommendations)).resolves.not.toThrow();
    });
  });

  describe('updateTableStatistics', () => {
    it('should analyze all application tables', async () => {
      mockDatabaseService.query.mockResolvedValue({ rows: [] });

      await optimizer.updateTableStatistics();

      // Should call ANALYZE for each table
      expect(mockDatabaseService.query).toHaveBeenCalledWith('ANALYZE users');
      expect(mockDatabaseService.query).toHaveBeenCalledWith('ANALYZE client_profiles');
      expect(mockDatabaseService.query).toHaveBeenCalledWith('ANALYZE communications');
      expect(mockDatabaseService.query).toHaveBeenCalledWith('ANALYZE email_messages');
      expect(mockDatabaseService.query).toHaveBeenCalledWith('ANALYZE twilio_messages');
      expect(mockDatabaseService.query).toHaveBeenCalledWith('ANALYZE ai_actions');
      expect(mockDatabaseService.query).toHaveBeenCalledWith('ANALYZE document_templates');
      expect(mockDatabaseService.query).toHaveBeenCalledWith('ANALYZE audit_logs');
    });

    it('should handle analyze errors', async () => {
      mockDatabaseService.query.mockRejectedValue(new Error('Permission denied'));

      await expect(optimizer.updateTableStatistics()).rejects.toThrow('Permission denied');
    });
  });

  describe('monitorConnectionPool', () => {
    it('should return healthy pool status', async () => {
      const mockPool = {
        totalCount: 10,
        idleCount: 5,
        waitingCount: 0,
        options: { max: 20 }
      };

      mockDatabaseService.getPool.mockReturnValue(mockPool as any);

      const status = await optimizer.monitorConnectionPool();

      expect(status.totalConnections).toBe(10);
      expect(status.activeConnections).toBe(5);
      expect(status.idleConnections).toBe(5);
      expect(status.waitingConnections).toBe(0);
      expect(status.poolHealth).toBe('healthy');
    });

    it('should detect warning conditions', async () => {
      const mockPool = {
        totalCount: 18,
        idleCount: 2,
        waitingCount: 0,
        options: { max: 20 }
      };

      mockDatabaseService.getPool.mockReturnValue(mockPool as any);

      const status = await optimizer.monitorConnectionPool();
      expect(status.poolHealth).toBe('warning'); // 80% utilization
    });

    it('should detect critical conditions', async () => {
      const mockPool = {
        totalCount: 19,
        idleCount: 1,
        waitingCount: 0,
        options: { max: 20 }
      };

      mockDatabaseService.getPool.mockReturnValue(mockPool as any);

      const status = await optimizer.monitorConnectionPool();
      expect(status.poolHealth).toBe('critical'); // 95% utilization
    });

    it('should detect waiting connections', async () => {
      const mockPool = {
        totalCount: 10,
        idleCount: 5,
        waitingCount: 3,
        options: { max: 20 }
      };

      mockDatabaseService.getPool.mockReturnValue(mockPool as any);

      const status = await optimizer.monitorConnectionPool();
      expect(status.poolHealth).toBe('warning'); // Has waiting connections
    });

    it('should handle pool monitoring errors', async () => {
      mockDatabaseService.getPool.mockImplementation(() => {
        throw new Error('Pool not available');
      });

      const status = await optimizer.monitorConnectionPool();
      expect(status.poolHealth).toBe('critical');
      expect(status.totalConnections).toBe(0);
    });
  });

  describe('getQueryOptimizations', () => {
    it('should return query optimization suggestions', () => {
      const optimizations = optimizer.getQueryOptimizations();

      expect(Array.isArray(optimizations)).toBe(true);
      expect(optimizations.length).toBeGreaterThan(0);
      
      optimizations.forEach(opt => {
        expect(opt).toHaveProperty('originalQuery');
        expect(opt).toHaveProperty('optimizedQuery');
        expect(opt).toHaveProperty('explanation');
        expect(opt).toHaveProperty('estimatedImprovement');
      });
    });

    it('should include SELECT * optimization', () => {
      const optimizations = optimizer.getQueryOptimizations();
      
      const selectAllOpt = optimizations.find(opt => 
        opt.originalQuery.includes('SELECT *')
      );
      
      expect(selectAllOpt).toBeDefined();
      expect(selectAllOpt?.explanation).toContain('Avoid SELECT *');
    });

    it('should include count optimization', () => {
      const optimizations = optimizer.getQueryOptimizations();
      
      const countOpt = optimizations.find(opt => 
        opt.originalQuery.includes('COUNT(*)')
      );
      
      expect(countOpt).toBeDefined();
      expect(countOpt?.explanation).toContain('table statistics');
    });
  });
});