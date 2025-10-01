import request from 'supertest';
import { app } from '../../server';
import { DatabaseService } from '../../services/database/DatabaseService';
import { RedisService } from '../../services/redis';

describe('Security Testing Suite', () => {
  beforeAll(async () => {
    await DatabaseService.initialize();
    await RedisService.initialize();
  });

  afterAll(async () => {
    await DatabaseService.close();
    await RedisService.close();
  });

  describe('Authentication Security', () => {
    it('should reject requests without authentication', async () => {
      const protectedEndpoints = [
        '/api/performance/metrics',
        '/api/performance/database/analysis',
        '/api/performance/scaling/status',
        '/api/users',
        '/api/clients'
      ];

      for (const endpoint of protectedEndpoints) {
        const response = await request(app)
          .get(endpoint)
          .expect(401);

        expect(response.body.error).toMatch(/unauthorized|authentication/i);
      }
    });

    it('should reject invalid JWT tokens', async () => {
      const invalidTokens = [
        'invalid-token',
        'Bearer invalid-token',
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature',
        'Bearer ' + 'a'.repeat(500), // Very long token
        'Bearer ', // Empty token
        'Bearer null',
        'Bearer undefined'
      ];

      for (const token of invalidTokens) {
        const response = await request(app)
          .get('/api/performance/metrics')
          .set('Authorization', token)
          .expect(401);

        expect(response.body.error).toMatch(/unauthorized|invalid|token/i);
      }
    });

    it('should handle malformed authorization headers', async () => {
      const malformedHeaders = [
        'Basic dGVzdDp0ZXN0', // Basic auth instead of Bearer
        'Bearer', // Missing token
        'InvalidScheme token',
        'Bearer token1 token2', // Multiple tokens
        'Bearer ' + '\x00'.repeat(10), // Null bytes
        'Bearer ' + '🚀'.repeat(100) // Unicode characters
      ];

      for (const header of malformedHeaders) {
        const response = await request(app)
          .get('/api/performance/metrics')
          .set('Authorization', header)
          .expect(401);

        expect(response.body.error).toMatch(/unauthorized|invalid|token/i);
      }
    });
  });

  describe('Input Validation Security', () => {
    it('should prevent SQL injection attempts', async () => {
      const sqlInjectionPayloads = [
        "'; DROP TABLE users; --",
        "' OR '1'='1",
        "' UNION SELECT * FROM users --",
        "'; INSERT INTO users VALUES ('hacker', 'password'); --",
        "' OR 1=1 --",
        "admin'--",
        "admin'/*",
        "' OR 'x'='x",
        "'; EXEC xp_cmdshell('dir'); --"
      ];

      // Test SQL injection in query parameters
      for (const payload of sqlInjectionPayloads) {
        const response = await request(app)
          .get(`/api/health?test=${encodeURIComponent(payload)}`)
          .expect(200); // Health endpoint should still work but ignore malicious input

        expect(response.body.status).toBe('ok');
      }
    });

    it('should prevent XSS attacks', async () => {
      const xssPayloads = [
        '<script>alert("XSS")</script>',
        '<img src="x" onerror="alert(1)">',
        'javascript:alert("XSS")',
        '<svg onload="alert(1)">',
        '"><script>alert("XSS")</script>',
        '<iframe src="javascript:alert(1)"></iframe>',
        '<body onload="alert(1)">',
        '<div onclick="alert(1)">Click me</div>'
      ];

      for (const payload of xssPayloads) {
        const response = await request(app)
          .get(`/api/health?message=${encodeURIComponent(payload)}`)
          .expect(200);

        // Response should not contain unescaped script tags
        const responseText = JSON.stringify(response.body);
        expect(responseText).not.toMatch(/<script[^>]*>/i);
        expect(responseText).not.toMatch(/javascript:/i);
        expect(responseText).not.toMatch(/onerror=/i);
        expect(responseText).not.toMatch(/onload=/i);
      }
    });

    it('should handle oversized payloads', async () => {
      const largePayload = 'A'.repeat(20 * 1024 * 1024); // 20MB payload

      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'test', password: largePayload })
        .expect(413); // Payload too large

      expect(response.body.error).toMatch(/payload|large|limit/i);
    });

    it('should validate content types', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'text/plain')
        .send('invalid content type')
        .expect(400);

      expect(response.body.error).toMatch(/content|type|json/i);
    });
  });

  describe('Rate Limiting Security', () => {
    it('should enforce rate limits', async () => {
      const requests = [];
      const maxRequests = 200; // Exceed typical rate limit

      // Make many requests quickly
      for (let i = 0; i < maxRequests; i++) {
        requests.push(
          request(app)
            .get('/api/health')
            .then(response => ({ status: response.status, attempt: i }))
            .catch(error => ({ status: error.status || 500, attempt: i, error: true }))
        );
      }

      const results = await Promise.all(requests);
      const rateLimitedRequests = results.filter(r => r.status === 429).length;
      const successfulRequests = results.filter(r => r.status === 200).length;

      console.log(`Rate limiting test: ${successfulRequests} successful, ${rateLimitedRequests} rate limited`);

      // Should have some rate limited requests if limits are working
      expect(rateLimitedRequests).toBeGreaterThan(0);
      expect(successfulRequests).toBeGreaterThan(0);
    }, 10000);

    it('should include rate limit headers', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      // Should include rate limiting headers
      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
    });
  });

  describe('Security Headers', () => {
    it('should include security headers', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      // Check for important security headers
      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers).toHaveProperty('x-frame-options');
      expect(response.headers).toHaveProperty('x-xss-protection');
      expect(response.headers).toHaveProperty('strict-transport-security');

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
    });

    it('should not expose sensitive information in headers', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      // Should not expose server information
      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['server']).not.toMatch(/express|node/i);
    });
  });

  describe('Error Handling Security', () => {
    it('should not expose stack traces in production', async () => {
      // Force an error
      const response = await request(app)
        .get('/api/nonexistent-endpoint')
        .expect(404);

      // Should not contain stack traces or internal paths
      const responseText = JSON.stringify(response.body);
      expect(responseText).not.toMatch(/at\s+\w+\s+\(/); // Stack trace pattern
      expect(responseText).not.toMatch(/\/src\//); // Internal paths
      expect(responseText).not.toMatch(/node_modules/);
      expect(responseText).not.toMatch(/Error:\s+/);
    });

    it('should handle malformed JSON gracefully', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}')
        .expect(400);

      expect(response.body.error).toMatch(/json|parse|invalid/i);
      // Should not expose internal error details
      expect(JSON.stringify(response.body)).not.toMatch(/SyntaxError/);
    });
  });

  describe('CORS Security', () => {
    it('should handle CORS preflight requests', async () => {
      const response = await request(app)
        .options('/api/health')
        .set('Origin', 'http://localhost:3001')
        .set('Access-Control-Request-Method', 'GET')
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBeDefined();
      expect(response.headers['access-control-allow-methods']).toBeDefined();
    });

    it('should restrict CORS origins appropriately', async () => {
      const maliciousOrigins = [
        'http://evil.com',
        'https://malicious-site.com',
        'http://localhost:8080', // Unauthorized port
        'file://',
        'data:text/html,<script>alert(1)</script>'
      ];

      for (const origin of maliciousOrigins) {
        const response = await request(app)
          .get('/api/health')
          .set('Origin', origin)
          .expect(200);

        // Should not allow unauthorized origins
        if (response.headers['access-control-allow-origin']) {
          expect(response.headers['access-control-allow-origin']).not.toBe(origin);
        }
      }
    });
  });

  describe('File Upload Security', () => {
    it('should validate file types', async () => {
      // Test with potentially dangerous file types
      const dangerousFiles = [
        { filename: 'test.exe', content: 'MZ\x90\x00' }, // Executable
        { filename: 'test.php', content: '<?php echo "test"; ?>' }, // PHP script
        { filename: 'test.js', content: 'alert("xss");' }, // JavaScript
        { filename: 'test.html', content: '<script>alert(1)</script>' } // HTML with script
      ];

      for (const file of dangerousFiles) {
        // This would test file upload endpoints if they exist
        // For now, we test that the server handles unknown endpoints securely
        const response = await request(app)
          .post('/api/upload')
          .attach('file', Buffer.from(file.content), file.filename)
          .expect(404); // Should not exist, but handled securely

        expect(response.body.error).toBeDefined();
      }
    });
  });

  describe('Session Security', () => {
    it('should use secure session configuration', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      // Check for secure cookie settings if sessions are used
      const setCookieHeader = response.headers['set-cookie'];
      if (setCookieHeader) {
        const cookieString = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : setCookieHeader;
        expect(cookieString).toMatch(/HttpOnly/i);
        expect(cookieString).toMatch(/Secure/i);
        expect(cookieString).toMatch(/SameSite/i);
      }
    });
  });

  describe('Information Disclosure Prevention', () => {
    it('should not expose sensitive configuration', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      const responseText = JSON.stringify(response.body);
      
      // Should not expose sensitive environment variables or config
      expect(responseText).not.toMatch(/password/i);
      expect(responseText).not.toMatch(/secret/i);
      expect(responseText).not.toMatch(/key/i);
      expect(responseText).not.toMatch(/token/i);
      expect(responseText).not.toMatch(/database/i);
      expect(responseText).not.toMatch(/redis/i);
    });

    it('should not expose internal API endpoints', async () => {
      const internalEndpoints = [
        '/api/internal',
        '/api/admin',
        '/api/debug',
        '/api/config',
        '/api/env'
      ];

      for (const endpoint of internalEndpoints) {
        const response = await request(app)
          .get(endpoint)
          .expect(404);

        expect(response.body.error).toBeDefined();
      }
    });
  });

  describe('Timing Attack Prevention', () => {
    it('should have consistent response times for authentication failures', async () => {
      const attempts = 10;
      const responseTimes: number[] = [];

      for (let i = 0; i < attempts; i++) {
        const startTime = Date.now();
        
        await request(app)
          .post('/api/auth/login')
          .send({ username: `user${i}`, password: 'wrongpassword' })
          .expect(401);

        responseTimes.push(Date.now() - startTime);
      }

      // Calculate variance in response times
      const avgTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
      const variance = responseTimes.reduce((sum, time) => sum + Math.pow(time - avgTime, 2), 0) / responseTimes.length;
      const stdDev = Math.sqrt(variance);

      // Standard deviation should be relatively small (less than 50% of average)
      expect(stdDev / avgTime).toBeLessThan(0.5);
      
      console.log(`Authentication timing: avg=${avgTime.toFixed(2)}ms, stddev=${stdDev.toFixed(2)}ms`);
    });
  });
});