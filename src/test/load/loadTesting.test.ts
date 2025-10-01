import request from 'supertest';
import { app } from '../../server';
import { DatabaseService } from '../../services/database/DatabaseService';
import { RedisService } from '../../services/redis';
import { performanceMonitor } from '../../services/performance/performanceMonitor';

describe('Load Testing Suite', () => {
  beforeAll(async () => {
    await DatabaseService.initialize();
    await RedisService.initialize();
    performanceMonitor.startMonitoring(5000);
  });

  afterAll(async () => {
    performanceMonitor.stopMonitoring();
    await DatabaseService.close();
    await RedisService.close();
  });

  describe('100 Concurrent Agents Load Test', () => {
    it('should handle 100 concurrent health check requests', async () => {
      const concurrentUsers = 100;
      const requestsPerUser = 5;
      const totalRequests = concurrentUsers * requestsPerUser;
      
      console.log(`Starting load test: ${concurrentUsers} concurrent users, ${requestsPerUser} requests each`);
      
      const startTime = Date.now();
      const promises: Promise<any>[] = [];
      
      // Create concurrent user sessions
      for (let user = 0; user < concurrentUsers; user++) {
        // Each user makes multiple requests
        for (let req = 0; req < requestsPerUser; req++) {
          promises.push(
            request(app)
              .get('/api/health')
              .expect(200)
              .then(response => ({
                user,
                request: req,
                responseTime: parseInt(response.headers['x-response-time'] || '0'),
                status: response.status
              }))
          );
        }
      }

      const results = await Promise.all(promises);
      const totalTime = Date.now() - startTime;
      
      // Analyze results
      const responseTimes = results.map(r => r.responseTime).filter(rt => rt > 0);
      const avgResponseTime = responseTimes.reduce((sum, rt) => sum + rt, 0) / responseTimes.length;
      const maxResponseTime = Math.max(...responseTimes);
      const minResponseTime = Math.min(...responseTimes);
      const p95ResponseTime = responseTimes.sort((a, b) => a - b)[Math.floor(responseTimes.length * 0.95)];
      const p99ResponseTime = responseTimes.sort((a, b) => a - b)[Math.floor(responseTimes.length * 0.99)];
      
      const throughput = totalRequests / (totalTime / 1000); // requests per second
      
      console.log('Load Test Results:');
      console.log(`Total Requests: ${totalRequests}`);
      console.log(`Total Time: ${totalTime}ms`);
      console.log(`Throughput: ${throughput.toFixed(2)} req/s`);
      console.log(`Avg Response Time: ${avgResponseTime.toFixed(2)}ms`);
      console.log(`Min Response Time: ${minResponseTime}ms`);
      console.log(`Max Response Time: ${maxResponseTime}ms`);
      console.log(`P95 Response Time: ${p95ResponseTime}ms`);
      console.log(`P99 Response Time: ${p99ResponseTime}ms`);
      
      // Performance assertions
      expect(results).toHaveLength(totalRequests);
      expect(avgResponseTime).toBeLessThan(500); // Average under 500ms
      expect(p95ResponseTime).toBeLessThan(1000); // 95% under 1 second
      expect(p99ResponseTime).toBeLessThan(2000); // 99% under 2 seconds
      expect(throughput).toBeGreaterThan(50); // At least 50 req/s
      
      // All requests should succeed
      const successfulRequests = results.filter(r => r.status === 200).length;
      expect(successfulRequests).toBe(totalRequests);
    }, 30000); // 30 second timeout

    it('should maintain database performance under load', async () => {
      const concurrentQueries = 50;
      const queriesPerConnection = 10;
      
      console.log(`Database load test: ${concurrentQueries} concurrent connections`);
      
      const startTime = Date.now();
      const promises: Promise<any>[] = [];
      
      for (let conn = 0; conn < concurrentQueries; conn++) {
        for (let query = 0; query < queriesPerConnection; query++) {
          promises.push(
            DatabaseService.query('SELECT $1 as connection_id, $2 as query_id, NOW() as timestamp', [conn, query])
              .then(result => ({
                connectionId: conn,
                queryId: query,
                success: true,
                timestamp: result.rows[0].timestamp
              }))
              .catch(error => ({
                connectionId: conn,
                queryId: query,
                success: false,
                error: error.message
              }))
          );
        }
      }

      const results = await Promise.all(promises);
      const totalTime = Date.now() - startTime;
      
      const successfulQueries = results.filter(r => r.success).length;
      const failedQueries = results.filter(r => !r.success).length;
      const queryThroughput = results.length / (totalTime / 1000);
      
      console.log('Database Load Test Results:');
      console.log(`Total Queries: ${results.length}`);
      console.log(`Successful: ${successfulQueries}`);
      console.log(`Failed: ${failedQueries}`);
      console.log(`Total Time: ${totalTime}ms`);
      console.log(`Query Throughput: ${queryThroughput.toFixed(2)} queries/s`);
      
      // Database performance assertions
      expect(successfulQueries).toBe(results.length); // All queries should succeed
      expect(failedQueries).toBe(0);
      expect(totalTime).toBeLessThan(10000); // Should complete within 10 seconds
      expect(queryThroughput).toBeGreaterThan(20); // At least 20 queries/s
    }, 15000);

    it('should handle mixed API endpoint load', async () => {
      const endpoints = [
        { path: '/api/health', method: 'GET', weight: 40 },
        { path: '/api/performance/metrics', method: 'GET', weight: 20, auth: true },
        { path: '/api/performance/health', method: 'GET', weight: 20, auth: true },
        { path: '/api/performance/scaling/status', method: 'GET', weight: 10, auth: true },
        { path: '/api/performance/database/analysis', method: 'GET', weight: 10, auth: true }
      ];
      
      const totalRequests = 200;
      const concurrentUsers = 20;
      const requestsPerUser = totalRequests / concurrentUsers;
      
      console.log(`Mixed endpoint load test: ${totalRequests} total requests across ${endpoints.length} endpoints`);
      
      const startTime = Date.now();
      const promises: Promise<any>[] = [];
      
      for (let user = 0; user < concurrentUsers; user++) {
        for (let req = 0; req < requestsPerUser; req++) {
          // Select endpoint based on weight
          const random = Math.random() * 100;
          let cumulativeWeight = 0;
          let selectedEndpoint = endpoints[0];
          
          for (const endpoint of endpoints) {
            cumulativeWeight += endpoint.weight;
            if (random <= cumulativeWeight) {
              selectedEndpoint = endpoint;
              break;
            }
          }
          
          let requestPromise = request(app)[selectedEndpoint.method.toLowerCase() as 'get'](selectedEndpoint.path);
          
          if (selectedEndpoint.auth) {
            requestPromise = requestPromise.set('Authorization', 'Bearer test-token');
          }
          
          promises.push(
            requestPromise
              .then(response => ({
                user,
                request: req,
                endpoint: selectedEndpoint.path,
                method: selectedEndpoint.method,
                status: response.status,
                responseTime: parseInt(response.headers['x-response-time'] || '0'),
                success: response.status < 400
              }))
              .catch(error => ({
                user,
                request: req,
                endpoint: selectedEndpoint.path,
                method: selectedEndpoint.method,
                status: error.status || 500,
                responseTime: 0,
                success: false,
                error: error.message
              }))
          );
        }
      }

      const results = await Promise.all(promises);
      const totalTime = Date.now() - startTime;
      
      // Analyze results by endpoint
      const endpointStats = endpoints.map(endpoint => {
        const endpointResults = results.filter(r => r.endpoint === endpoint.path);
        const successfulRequests = endpointResults.filter(r => r.success).length;
        const responseTimes = endpointResults.map(r => r.responseTime).filter(rt => rt > 0);
        const avgResponseTime = responseTimes.length > 0 
          ? responseTimes.reduce((sum, rt) => sum + rt, 0) / responseTimes.length 
          : 0;
        
        return {
          endpoint: endpoint.path,
          totalRequests: endpointResults.length,
          successfulRequests,
          successRate: (successfulRequests / endpointResults.length) * 100,
          avgResponseTime
        };
      });
      
      const overallSuccessRate = (results.filter(r => r.success).length / results.length) * 100;
      const throughput = results.length / (totalTime / 1000);
      
      console.log('Mixed Endpoint Load Test Results:');
      console.log(`Total Requests: ${results.length}`);
      console.log(`Overall Success Rate: ${overallSuccessRate.toFixed(2)}%`);
      console.log(`Total Time: ${totalTime}ms`);
      console.log(`Throughput: ${throughput.toFixed(2)} req/s`);
      
      console.log('\nPer-Endpoint Results:');
      endpointStats.forEach(stat => {
        console.log(`${stat.endpoint}: ${stat.totalRequests} requests, ${stat.successRate.toFixed(1)}% success, ${stat.avgResponseTime.toFixed(1)}ms avg`);
      });
      
      // Performance assertions
      expect(overallSuccessRate).toBeGreaterThan(95); // 95% success rate
      expect(throughput).toBeGreaterThan(10); // At least 10 req/s overall
      
      // Each endpoint should have reasonable performance
      endpointStats.forEach(stat => {
        expect(stat.successRate).toBeGreaterThan(90); // 90% success per endpoint
        if (stat.avgResponseTime > 0) {
          expect(stat.avgResponseTime).toBeLessThan(2000); // Under 2 seconds average
        }
      });
    }, 45000); // 45 second timeout
  });

  describe('Memory and Resource Load Testing', () => {
    it('should maintain stable memory usage under sustained load', async () => {
      const initialMemory = process.memoryUsage();
      const duration = 10000; // 10 seconds
      const requestInterval = 100; // Request every 100ms
      const expectedRequests = duration / requestInterval;
      
      console.log(`Memory stability test: ${expectedRequests} requests over ${duration}ms`);
      
      const startTime = Date.now();
      const memorySnapshots: NodeJS.MemoryUsage[] = [];
      const requestPromises: Promise<any>[] = [];
      
      // Take memory snapshots every second
      const memoryInterval = setInterval(() => {
        memorySnapshots.push(process.memoryUsage());
      }, 1000);
      
      // Generate sustained load
      const loadInterval = setInterval(() => {
        if (Date.now() - startTime >= duration) {
          clearInterval(loadInterval);
          return;
        }
        
        requestPromises.push(
          request(app)
            .get('/api/health')
            .expect(200)
            .catch(() => {}) // Ignore individual failures
        );
      }, requestInterval);
      
      // Wait for test duration
      await new Promise(resolve => setTimeout(resolve, duration + 1000));
      
      clearInterval(memoryInterval);
      clearInterval(loadInterval);
      
      // Wait for all requests to complete
      await Promise.allSettled(requestPromises);
      
      const finalMemory = process.memoryUsage();
      
      // Analyze memory usage
      const heapGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
      const maxHeapUsed = Math.max(...memorySnapshots.map(m => m.heapUsed));
      const avgHeapUsed = memorySnapshots.reduce((sum, m) => sum + m.heapUsed, 0) / memorySnapshots.length;
      
      console.log('Memory Stability Test Results:');
      console.log(`Initial Heap: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
      console.log(`Final Heap: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
      console.log(`Heap Growth: ${(heapGrowth / 1024 / 1024).toFixed(2)}MB`);
      console.log(`Max Heap: ${(maxHeapUsed / 1024 / 1024).toFixed(2)}MB`);
      console.log(`Avg Heap: ${(avgHeapUsed / 1024 / 1024).toFixed(2)}MB`);
      console.log(`Requests Completed: ${requestPromises.length}`);
      
      // Memory assertions
      expect(heapGrowth).toBeLessThan(100 * 1024 * 1024); // Less than 100MB growth
      expect(maxHeapUsed).toBeLessThan(500 * 1024 * 1024); // Less than 500MB max
      expect(requestPromises.length).toBeGreaterThan(expectedRequests * 0.8); // At least 80% of expected requests
    }, 20000);
  });

  describe('Stress Testing', () => {
    it('should gracefully handle overload conditions', async () => {
      const overloadRequests = 500;
      const burstConcurrency = 100;
      
      console.log(`Stress test: ${overloadRequests} requests in bursts of ${burstConcurrency}`);
      
      const startTime = Date.now();
      const results: any[] = [];
      
      // Send requests in bursts to simulate overload
      for (let burst = 0; burst < Math.ceil(overloadRequests / burstConcurrency); burst++) {
        const burstPromises: Promise<any>[] = [];
        const burstSize = Math.min(burstConcurrency, overloadRequests - (burst * burstConcurrency));
        
        for (let i = 0; i < burstSize; i++) {
          burstPromises.push(
            request(app)
              .get('/api/health')
              .timeout(5000) // 5 second timeout
              .then(response => ({
                burst,
                request: i,
                status: response.status,
                responseTime: parseInt(response.headers['x-response-time'] || '0'),
                success: true
              }))
              .catch(error => ({
                burst,
                request: i,
                status: error.status || 0,
                responseTime: 0,
                success: false,
                error: error.code || error.message
              }))
          );
        }
        
        const burstResults = await Promise.allSettled(burstPromises);
        results.push(...burstResults.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: 'Promise rejected' }));
        
        // Small delay between bursts
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const totalTime = Date.now() - startTime;
      const successfulRequests = results.filter(r => r.success).length;
      const failedRequests = results.filter(r => !r.success).length;
      const timeoutErrors = results.filter(r => r.error === 'ECONNABORTED' || r.error === 'timeout').length;
      const serverErrors = results.filter(r => r.status >= 500).length;
      
      console.log('Stress Test Results:');
      console.log(`Total Requests: ${results.length}`);
      console.log(`Successful: ${successfulRequests} (${(successfulRequests/results.length*100).toFixed(1)}%)`);
      console.log(`Failed: ${failedRequests} (${(failedRequests/results.length*100).toFixed(1)}%)`);
      console.log(`Timeouts: ${timeoutErrors}`);
      console.log(`Server Errors: ${serverErrors}`);
      console.log(`Total Time: ${totalTime}ms`);
      
      // Stress test assertions - should handle graceful degradation
      expect(results.length).toBe(overloadRequests);
      expect(successfulRequests / results.length).toBeGreaterThan(0.7); // At least 70% success under stress
      expect(serverErrors / results.length).toBeLessThan(0.1); // Less than 10% server errors
      
      // System should remain responsive
      expect(totalTime).toBeLessThan(60000); // Complete within 1 minute
    }, 90000); // 90 second timeout
  });
});