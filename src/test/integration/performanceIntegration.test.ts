import request from 'supertest';
import { app } from '../../server';
import { DatabaseService } from '../../services/database/DatabaseService';
import { RedisService } from '../../services/redis';
import { performanceMonitor } from '../../services/performance/performanceMonitor';

describe('Performance Integration Tests', () => {
  beforeAll(async () => {
    // Initialize services for testing
    await DatabaseService.initialize();
    await RedisService.initialize();
    performanceMonitor.startMonitoring(1000); // Monitor every second for testing
  });

  afterAll(async () => {
    performanceMonitor.stopMonitoring();
    await DatabaseService.close();
    await RedisService.close();
  });

  beforeEach(() => {
    performanceMonitor.reset();
  });

  describe('Response Time Requirements', () => {
    it('should respond to health check within 500ms', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(500);
      expect(response.headers['x-response-time']).toBeDefined();
    });

    it('should respond to performance metrics within 500ms', async () => {
      const startTime = Date.now();
      
      await request(app)
        .get('/api/performance/metrics')
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(500);
    });

    it('should handle database queries within performance thresholds', async () => {
      const startTime = Date.now();
      
      // Test a database-heavy endpoint
      await request(app)
        .get('/api/performance/database/analysis')
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(2000); // Allow more time for complex queries
    });
  });

  describe('Concurrent User Handling', () => {
    it('should handle multiple concurrent requests', async () => {
      const concurrentRequests = 10;
      const promises = [];

      for (let i = 0; i < concurrentRequests; i++) {
        promises.push(
          request(app)
            .get('/api/health')
            .expect(200)
        );
      }

      const startTime = Date.now();
      const responses = await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      // All requests should complete
      expect(responses).toHaveLength(concurrentRequests);
      
      // Average response time should be reasonable
      const avgResponseTime = totalTime / concurrentRequests;
      expect(avgResponseTime).toBeLessThan(1000);
    });

    it('should maintain performance under load', async () => {
      const loadTestRequests = 50;
      const batchSize = 10;
      const batches = Math.ceil(loadTestRequests / batchSize);
      
      const allResponseTimes: number[] = [];

      for (let batch = 0; batch < batches; batch++) {
        const batchPromises = [];
        
        for (let i = 0; i < batchSize && (batch * batchSize + i) < loadTestRequests; i++) {
          const startTime = Date.now();
          batchPromises.push(
            request(app)
              .get('/api/health')
              .expect(200)
              .then(() => Date.now() - startTime)
          );
        }

        const batchResponseTimes = await Promise.all(batchPromises);
        allResponseTimes.push(...batchResponseTimes);
        
        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Calculate statistics
      const avgResponseTime = allResponseTimes.reduce((sum, time) => sum + time, 0) / allResponseTimes.length;
      const maxResponseTime = Math.max(...allResponseTimes);
      const p95ResponseTime = allResponseTimes.sort((a, b) => a - b)[Math.floor(allResponseTimes.length * 0.95)];

      expect(avgResponseTime).toBeLessThan(500);
      expect(maxResponseTime).toBeLessThan(2000);
      expect(p95ResponseTime).toBeLessThan(1000);
    });
  });

  describe('Memory Usage Monitoring', () => {
    it('should not exceed memory thresholds during normal operation', async () => {
      const initialMemory = process.memoryUsage();
      
      // Perform several operations
      for (let i = 0; i < 20; i++) {
        await request(app)
          .get('/api/health')
          .expect(200);
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      
      // Memory increase should be reasonable (less than 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });

    it('should collect and report memory metrics', async () => {
      await performanceMonitor.collectMetrics();
      
      const summary = performanceMonitor.getPerformanceSummary();
      expect(summary.current).toBeDefined();
      expect(summary.current?.memoryUsage).toBeDefined();
      expect(typeof summary.current?.memoryUsage.heapUsed).toBe('number');
    });
  });

  describe('Database Performance', () => {
    it('should maintain database connection pool health', async () => {
      const response = await request(app)
        .get('/api/performance/database/analysis')
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.connectionPool).toBeDefined();
      expect(response.body.data.connectionPool.poolHealth).toMatch(/healthy|warning/);
    });

    it('should execute database queries efficiently', async () => {
      const startTime = Date.now();
      
      // Test direct database query
      await DatabaseService.query('SELECT 1 as test');
      
      const queryTime = Date.now() - startTime;
      expect(queryTime).toBeLessThan(200); // Should be under 200ms
    });

    it('should handle multiple database connections', async () => {
      const queries = [];
      
      for (let i = 0; i < 10; i++) {
        queries.push(DatabaseService.query('SELECT $1 as test_value', [i]));
      }

      const startTime = Date.now();
      const results = await Promise.all(queries);
      const totalTime = Date.now() - startTime;

      expect(results).toHaveLength(10);
      expect(totalTime).toBeLessThan(1000); // All queries should complete within 1 second
      
      results.forEach((result, index) => {
        expect(result.rows[0].test_value).toBe(index);
      });
    });
  });

  describe('Performance Monitoring Integration', () => {
    it('should track request metrics automatically', async () => {
      // Make a few requests
      await request(app).get('/api/health').expect(200);
      await request(app).get('/api/health').expect(200);
      await request(app).get('/api/health').expect(200);

      // Wait for metrics to be collected
      await new Promise(resolve => setTimeout(resolve, 1100));

      const summary = performanceMonitor.getPerformanceSummary();
      expect(summary.current).toBeDefined();
      expect(summary.current?.responseTime).toBeGreaterThan(0);
    });

    it('should provide performance health status', async () => {
      const response = await request(app)
        .get('/api/performance/health')
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.overall).toMatch(/healthy|warning|critical/);
      expect(response.body.data.performance).toBeDefined();
      expect(response.body.data.database).toBeDefined();
    });
  });

  describe('Error Handling Performance', () => {
    it('should handle 404 errors efficiently', async () => {
      const startTime = Date.now();
      
      await request(app)
        .get('/api/nonexistent-endpoint')
        .expect(404);

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(100); // Error responses should be very fast
    });

    it('should handle validation errors efficiently', async () => {
      const startTime = Date.now();
      
      await request(app)
        .post('/api/auth/login')
        .send({ invalid: 'data' })
        .expect(400);

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(200);
    });
  });

  describe('Auto-scaling Integration', () => {
    it('should provide scaling status', async () => {
      const response = await request(app)
        .get('/api/performance/scaling/status')
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBeDefined();
      expect(response.body.data.status.currentInstances).toBeGreaterThan(0);
      expect(response.body.data.cloudConfig).toBeDefined();
    });

    it('should evaluate scaling decisions', async () => {
      const response = await request(app)
        .post('/api/performance/scaling/evaluate')
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.action).toBeDefined();
      expect(response.body.data.action.type).toMatch(/scale_up|scale_down|no_action/);
    });
  });
});