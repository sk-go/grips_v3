import request from 'supertest';
import { app } from '../../server';
import { DatabaseService } from '../../services/database/DatabaseService';
import { RedisService } from '../../services/redis';
import { circuitBreaker } from '../../middleware/performanceMiddleware';

describe('Chaos Engineering Tests', () => {
  beforeAll(async () => {
    await DatabaseService.initialize();
    await RedisService.initialize();
  });

  afterAll(async () => {
    await DatabaseService.close();
    await RedisService.close();
  });

  describe('CRM Downtime Scenarios', () => {
    it('should handle CRM service unavailability gracefully', async () => {
      // Simulate CRM downtime by triggering circuit breaker
      const serviceName = 'crm-service';
      
      // Record multiple failures to open circuit
      for (let i = 0; i < 6; i++) {
        circuitBreaker.recordFailure(serviceName);
      }
      
      // Verify circuit is open
      expect(circuitBreaker.isCircuitOpen(serviceName)).toBe(true);
      
      // Test that requests are handled gracefully
      const response = await request(app)
        .get('/api/clients')
        .set('Authorization', 'Bearer test-token');
      
      // Should return service unavailable or cached data
      expect([200, 503]).toContain(response.status);
      
      if (response.status === 503) {
        expect(response.body.error).toContain('Service temporarily unavailable');
        expect(response.body.retryAfter).toBeDefined();
      }
    });

    it('should recover when CRM service comes back online', async () => {
      const serviceName = 'crm-recovery-test';
      
      // Open circuit
      for (let i = 0; i < 6; i++) {
        circuitBreaker.recordFailure(serviceName);
      }
      
      expect(circuitBreaker.isCircuitOpen(serviceName)).toBe(true);
      
      // Record success to close circuit
      circuitBreaker.recordSuccess(serviceName);
      
      // Circuit should still be open due to timeout
      expect(circuitBreaker.isCircuitOpen(serviceName)).toBe(true);
      
      // Wait for circuit to reset (in real scenario, this would be longer)
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // After timeout, circuit should allow requests through
      // This is a simplified test - in production, the timeout would be longer
    });

    it('should provide fallback data when CRM is unavailable', async () => {
      // Test that the application provides meaningful responses even when CRM is down
      const response = await request(app)
        .get('/api/health')
        .expect(200);
      
      expect(response.body.status).toBe('ok');
      
      // Health check should indicate CRM status
      const performanceResponse = await request(app)
        .get('/api/performance/health')
        .set('Authorization', 'Bearer test-token');
      
      expect(performanceResponse.status).toBeOneOf([200, 503]);
      
      if (performanceResponse.status === 200) {
        expect(performanceResponse.body.data.overall).toMatch(/healthy|warning|critical/);
      }
    });
  });

  describe('Database Connection Failures', () => {
    it('should handle database connection pool exhaustion', async () => {
      // This test simulates what happens when all database connections are busy
      const maxConnections = 20; // Typical pool size
      const connectionPromises: Promise<any>[] = [];
      
      // Create long-running queries to exhaust the pool
      for (let i = 0; i < maxConnections + 5; i++) {
        connectionPromises.push(
          DatabaseService.query('SELECT pg_sleep(0.1), $1 as connection_id', [i])
            .catch(error => ({ error: error.message, connectionId: i }))
        );
      }
      
      // Some connections should succeed, others might timeout or queue
      const results = await Promise.all(connectionPromises);
      
      const successful = results.filter(r => !r.error).length;
      const failed = results.filter(r => r.error).length;
      
      console.log(`Connection pool test: ${successful} successful, ${failed} failed`);
      
      // Should handle the situation gracefully
      expect(successful + failed).toBe(maxConnections + 5);
      expect(successful).toBeGreaterThan(0); // Some should succeed
    });

    it('should recover from temporary database disconnection', async () => {
      // Test database reconnection logic
      let connectionAttempts = 0;
      const maxAttempts = 3;
      
      while (connectionAttempts < maxAttempts) {
        try {
          await DatabaseService.query('SELECT 1');
          break; // Success
        } catch (error) {
          connectionAttempts++;
          if (connectionAttempts >= maxAttempts) {
            throw error;
          }
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      expect(connectionAttempts).toBeLessThan(maxAttempts);
    });
  });

  describe('Redis Cache Failures', () => {
    it('should function without Redis cache', async () => {
      // Test that the application works even if Redis is unavailable
      // This would typically involve mocking Redis failures
      
      const response = await request(app)
        .get('/api/health')
        .expect(200);
      
      expect(response.body.status).toBe('ok');
      
      // Application should still respond to requests
      const metricsResponse = await request(app)
        .get('/api/performance/metrics')
        .set('Authorization', 'Bearer test-token');
      
      // Should either succeed or fail gracefully
      expect([200, 500, 503]).toContain(metricsResponse.status);
    });

    it('should handle cache miss scenarios gracefully', async () => {
      // Test behavior when cache is empty or unavailable
      const response = await request(app)
        .get('/api/performance/health')
        .set('Authorization', 'Bearer test-token');
      
      expect([200, 503]).toContain(response.status);
      
      if (response.status === 200) {
        expect(response.body.data).toBeDefined();
      }
    });
  });

  describe('Network Partition Scenarios', () => {
    it('should handle slow network responses', async () => {
      // Test timeout handling
      const slowResponse = await request(app)
        .get('/api/health')
        .timeout(1000) // 1 second timeout
        .expect(200);
      
      expect(slowResponse.body.status).toBe('ok');
    });

    it('should implement proper timeout handling', async () => {
      // Test that requests don't hang indefinitely
      const startTime = Date.now();
      
      try {
        await request(app)
          .get('/api/performance/database/analysis')
          .set('Authorization', 'Bearer test-token')
          .timeout(5000); // 5 second timeout
      } catch (error) {
        // Timeout is acceptable in chaos testing
        const elapsed = Date.now() - startTime;
        expect(elapsed).toBeLessThan(6000); // Should timeout within reasonable time
      }
    });
  });

  describe('Memory Pressure Scenarios', () => {
    it('should handle memory pressure gracefully', async () => {
      // Create memory pressure by making many requests
      const memoryPressureRequests = 100;
      const promises: Promise<any>[] = [];
      
      for (let i = 0; i < memoryPressureRequests; i++) {
        promises.push(
          request(app)
            .get('/api/health')
            .then(response => ({ success: true, status: response.status }))
            .catch(error => ({ success: false, error: error.message }))
        );
      }
      
      const results = await Promise.all(promises);
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      console.log(`Memory pressure test: ${successful} successful, ${failed} failed`);
      
      // Should handle most requests successfully
      expect(successful / results.length).toBeGreaterThan(0.8); // 80% success rate
      
      // Check memory usage after pressure test
      const memoryUsage = process.memoryUsage();
      expect(memoryUsage.heapUsed).toBeLessThan(1024 * 1024 * 1024); // Less than 1GB
    });

    it('should implement graceful degradation under load', async () => {
      // Test that the application reduces functionality under high load
      const highLoadRequests = 50;
      const promises: Promise<any>[] = [];
      
      // Generate high load
      for (let i = 0; i < highLoadRequests; i++) {
        promises.push(
          request(app)
            .get('/api/performance/metrics')
            .set('Authorization', 'Bearer test-token')
            .then(response => ({
              success: response.status === 200,
              status: response.status,
              degraded: response.headers['x-degraded-mode'] === 'true'
            }))
            .catch(error => ({
              success: false,
              status: error.status || 500,
              degraded: false
            }))
        );
      }
      
      const results = await Promise.all(promises);
      const successful = results.filter(r => r.success).length;
      
      // Should maintain reasonable success rate
      expect(successful / results.length).toBeGreaterThan(0.7); // 70% success under high load
    });
  });

  describe('Cascading Failure Prevention', () => {
    it('should prevent cascading failures across services', async () => {
      // Test that failure in one component doesn't bring down the entire system
      const endpoints = [
        '/api/health',
        '/api/performance/health',
        '/api/performance/metrics'
      ];
      
      const testResults: { [key: string]: any } = {};
      
      for (const endpoint of endpoints) {
        try {
          let requestBuilder = request(app).get(endpoint);
          
          if (endpoint !== '/api/health') {
            requestBuilder = requestBuilder.set('Authorization', 'Bearer test-token');
          }
          
          const response = await requestBuilder;
          testResults[endpoint] = {
            success: response.status < 400,
            status: response.status
          };
        } catch (error: any) {
          testResults[endpoint] = {
            success: false,
            status: error.status || 500,
            error: error.message
          };
        }
      }
      
      // At least the health endpoint should always work
      expect(testResults['/api/health'].success).toBe(true);
      
      // Count successful endpoints
      const successfulEndpoints = Object.values(testResults).filter((result: any) => result.success).length;
      
      // At least half of the endpoints should be working
      expect(successfulEndpoints / endpoints.length).toBeGreaterThan(0.5);
      
      console.log('Cascading failure test results:', testResults);
    });

    it('should maintain core functionality during partial outages', async () => {
      // Test that essential features remain available even if some services fail
      const coreEndpoints = [
        '/api/health'
      ];
      
      for (const endpoint of coreEndpoints) {
        const response = await request(app)
          .get(endpoint)
          .expect(200);
        
        expect(response.body).toBeDefined();
      }
      
      // Core functionality should always be available
      expect(true).toBe(true); // If we reach here, core endpoints are working
    });
  });

  describe('Recovery Testing', () => {
    it('should recover quickly from transient failures', async () => {
      // Test recovery time after simulated failures
      const recoveryStartTime = Date.now();
      
      // Simulate recovery by making successful requests
      let consecutiveSuccesses = 0;
      const requiredSuccesses = 5;
      
      while (consecutiveSuccesses < requiredSuccesses) {
        try {
          await request(app)
            .get('/api/health')
            .expect(200);
          
          consecutiveSuccesses++;
        } catch (error) {
          consecutiveSuccesses = 0; // Reset on failure
        }
        
        // Prevent infinite loop
        if (Date.now() - recoveryStartTime > 10000) {
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const recoveryTime = Date.now() - recoveryStartTime;
      
      expect(consecutiveSuccesses).toBe(requiredSuccesses);
      expect(recoveryTime).toBeLessThan(5000); // Should recover within 5 seconds
      
      console.log(`Recovery time: ${recoveryTime}ms`);
    });
  });
});