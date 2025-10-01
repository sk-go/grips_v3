import { RegistrationRateLimitingService } from '../../services/registrationRateLimitingService';
import { RedisService } from '../../services/redis';

describe('RegistrationRateLimitingService Integration', () => {
  beforeAll(async () => {
    // Initialize Redis connection for testing
    await RedisService.initialize();
  });

  afterAll(async () => {
    // Clean up Redis connection
    await RedisService.close();
  });

  beforeEach(async () => {
    // Clear any existing test data
    const testKeys = [
      'registration:ip:192.168.1.100',
      'registration:email:testuser@example.com',
      'registration:resend:testuser@example.com:192.168.1.100',
      'registration:global:attempts',
      'registration:alerts:count'
    ];
    
    for (const key of testKeys) {
      await RedisService.del(key);
    }
  });

  describe('IP-based rate limiting', () => {
    it('should enforce IP rate limits across multiple attempts', async () => {
      const ipAddress = '192.168.1.100';
      const userAgent = 'Test-Agent/1.0';
      
      // First attempt should be allowed
      let result = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(
        ipAddress,
        userAgent
      );
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
      expect(result.progressiveDelay).toBe(0);
      
      // Record the attempt
      await RegistrationRateLimitingService.recordRegistrationAttempt(
        'user1@example.com',
        ipAddress,
        false,
        userAgent
      );
      
      // Second attempt should have progressive delay
      result = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(ipAddress);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(3);
      expect(result.progressiveDelay).toBe(5); // 5 seconds delay
      
      // Record more attempts to reach the limit
      for (let i = 2; i <= 5; i++) {
        await RegistrationRateLimitingService.recordRegistrationAttempt(
          `user${i}@example.com`,
          ipAddress,
          false
        );
      }
      
      // Should now be blocked
      result = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(ipAddress);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBe(2 * 60 * 60); // 2 hours
      expect(result.alertTriggered).toBe(true);
    });

    it('should detect suspicious activity patterns', async () => {
      const ipAddress = '192.168.1.100';
      
      // Create many attempts with different emails to trigger suspicious activity
      for (let i = 0; i < 12; i++) {
        await RegistrationRateLimitingService.recordRegistrationAttempt(
          `user${i}@example.com`,
          ipAddress,
          false
        );
      }
      
      const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(ipAddress);
      expect(result.suspiciousActivity).toBe(true);
      expect(result.allowed).toBe(false);
    });
  });

  describe('Email-based rate limiting', () => {
    it('should enforce email rate limits', async () => {
      const email = 'testuser@example.com';
      const ipAddress = '192.168.1.100';
      
      // First attempt should be allowed
      let result = await RegistrationRateLimitingService.checkRegistrationRateLimitByEmail(
        email,
        ipAddress
      );
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
      
      // Record attempts to reach the limit
      for (let i = 1; i <= 3; i++) {
        await RegistrationRateLimitingService.recordRegistrationAttempt(
          email,
          `192.168.1.${100 + i}`, // Different IPs
          false
        );
      }
      
      // Should now be blocked
      result = await RegistrationRateLimitingService.checkRegistrationRateLimitByEmail(
        email,
        ipAddress
      );
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBe(24 * 60 * 60); // 24 hours
    });

    it('should normalize email addresses consistently', async () => {
      const email1 = 'TestUser@Example.Com';
      const email2 = 'testuser@example.com';
      const ipAddress = '192.168.1.100';
      
      // Record attempt with uppercase email
      await RegistrationRateLimitingService.recordRegistrationAttempt(
        email1,
        ipAddress,
        false
      );
      
      // Check with lowercase email - should see the previous attempt
      const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByEmail(
        email2,
        ipAddress
      );
      expect(result.totalHits).toBe(1);
      expect(result.remaining).toBe(1);
    });
  });

  describe('Verification rate limiting', () => {
    it('should enforce resend verification limits', async () => {
      const email = 'testuser@example.com';
      const ipAddress = '192.168.1.100';
      
      // First resend should be allowed
      let result = await RegistrationRateLimitingService.checkResendVerificationRateLimit(
        email,
        ipAddress
      );
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
      
      // Record resend attempts
      for (let i = 0; i < 3; i++) {
        await RegistrationRateLimitingService.recordResendVerificationAttempt(email, ipAddress);
      }
      
      // Should now be blocked
      result = await RegistrationRateLimitingService.checkResendVerificationRateLimit(
        email,
        ipAddress
      );
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });
  });

  describe('Statistics and monitoring', () => {
    it('should track registration statistics accurately', async () => {
      const ipAddress = '192.168.1.100';
      
      // Record various registration attempts
      await RegistrationRateLimitingService.recordRegistrationAttempt(
        'user1@example.com',
        ipAddress,
        true // Success
      );
      
      await RegistrationRateLimitingService.recordRegistrationAttempt(
        'user2@example.com',
        ipAddress,
        false // Failure
      );
      
      await RegistrationRateLimitingService.recordRegistrationAttempt(
        'user3@example.com',
        '192.168.1.101', // Different IP
        true // Success
      );
      
      const stats = await RegistrationRateLimitingService.getRegistrationStatistics();
      
      expect(stats.totalAttempts).toBe(3);
      expect(stats.successfulRegistrations).toBe(2);
      expect(stats.failedAttempts).toBe(1);
      expect(stats.uniqueIPs).toBe(2);
      expect(stats.uniqueEmails).toBe(3);
    });

    it('should track alerts correctly', async () => {
      const ipAddress = '192.168.1.100';
      
      // Create enough attempts to trigger an alert
      for (let i = 0; i < 6; i++) {
        await RegistrationRateLimitingService.recordRegistrationAttempt(
          `user${i}@example.com`,
          ipAddress,
          false
        );
      }
      
      // Check rate limit to trigger alert
      await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(ipAddress);
      
      const stats = await RegistrationRateLimitingService.getRegistrationStatistics();
      expect(stats.alertsTriggered).toBeGreaterThan(0);
    });
  });

  describe('Cleanup and recovery', () => {
    it('should clear attempts after successful registration', async () => {
      const email = 'testuser@example.com';
      const ipAddress = '192.168.1.100';
      
      // Record some failed attempts
      for (let i = 0; i < 3; i++) {
        await RegistrationRateLimitingService.recordRegistrationAttempt(
          email,
          ipAddress,
          false
        );
      }
      
      // Verify attempts are recorded
      let result = await RegistrationRateLimitingService.checkRegistrationRateLimitByEmail(
        email,
        ipAddress
      );
      expect(result.totalHits).toBe(3);
      
      // Clear attempts
      await RegistrationRateLimitingService.clearRegistrationAttempts(email, ipAddress);
      
      // Verify attempts are cleared
      result = await RegistrationRateLimitingService.checkRegistrationRateLimitByEmail(
        email,
        ipAddress
      );
      expect(result.totalHits).toBe(0);
      expect(result.remaining).toBe(2);
    });
  });

  describe('Progressive delays', () => {
    it('should implement progressive delays correctly', async () => {
      const ipAddress = '192.168.1.100';
      
      const expectedDelays = [0, 5, 15, 30, 60, 120];
      
      for (let i = 0; i < expectedDelays.length; i++) {
        const result = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(ipAddress);
        expect(result.progressiveDelay).toBe(expectedDelays[i]);
        
        // Record attempt for next iteration
        if (i < expectedDelays.length - 1) {
          await RegistrationRateLimitingService.recordRegistrationAttempt(
            `user${i}@example.com`,
            ipAddress,
            false
          );
        }
      }
    });
  });

  describe('Time window behavior', () => {
    it('should respect time windows for rate limiting', async () => {
      const email = 'testuser@example.com';
      const ipAddress = '192.168.1.100';
      
      // Record an attempt
      await RegistrationRateLimitingService.recordRegistrationAttempt(email, ipAddress, false);
      
      let result = await RegistrationRateLimitingService.checkRegistrationRateLimitByEmail(
        email,
        ipAddress
      );
      expect(result.totalHits).toBe(1);
      
      // Mock time passage by manipulating the stored data
      // In a real scenario, you would wait or use time manipulation libraries
      // For this test, we'll verify the reset time is calculated correctly
      expect(result.resetTime).toBeGreaterThan(Date.now());
      expect(result.resetTime).toBeLessThan(Date.now() + (25 * 60 * 60 * 1000)); // Within 25 hours
    });
  });
});