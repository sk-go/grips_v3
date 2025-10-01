import request from 'supertest';
import { app } from '../../server';
import { DatabaseService } from '../../services/database';
import { RedisService } from '../../services/redis';
import { SecurityMonitoringService } from '../../services/security/securityMonitoringService';

describe('Security Monitoring Integration Tests', () => {
  let adminToken: string;
  let agentToken: string;

  beforeAll(async () => {
    await DatabaseService.initialize();
    await RedisService.initialize();
  });

  afterAll(async () => {
    await DatabaseService.close();
    await RedisService.close();
  });

  beforeEach(async () => {
    // Create test admin and agent users
    const adminUser = {
      email: 'admin@security.test',
      password: 'AdminPassword123!',
      firstName: 'Security',
      lastName: 'Admin',
      role: 'admin'
    };

    const agentUser = {
      email: 'agent@security.test',
      password: 'AgentPassword123!',
      firstName: 'Security',
      lastName: 'Agent',
      role: 'agent'
    };

    // Clean up existing users
    try {
      await DatabaseService.query('DELETE FROM users WHERE email IN ($1, $2)', 
        [adminUser.email, agentUser.email]);
    } catch (error) {
      // Ignore if users don't exist
    }

    // Register admin user
    const adminRegResponse = await request(app)
      .post('/api/auth/register')
      .send(adminUser);

    // Register agent user
    const agentRegResponse = await request(app)
      .post('/api/auth/register')
      .send(agentUser);

    // Manually verify emails and activate accounts for testing
    await DatabaseService.query(
      'UPDATE users SET email_verified = true, is_active = true WHERE email IN ($1, $2)',
      [adminUser.email, agentUser.email]
    );

    // Login to get tokens
    const adminLoginResponse = await request(app)
      .post('/api/auth/login')
      .send({ email: adminUser.email, password: adminUser.password });

    const agentLoginResponse = await request(app)
      .post('/api/auth/login')
      .send({ email: agentUser.email, password: agentUser.password });

    adminToken = adminLoginResponse.body.accessToken;
    agentToken = agentLoginResponse.body.accessToken;
  });

  describe('Security Dashboard', () => {
    it('should return security dashboard data for admin', async () => {
      const response = await request(app)
        .get('/api/security/dashboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data).toHaveProperty('alerts');
      expect(response.body.data).toHaveProperty('patterns');
      expect(response.body.data).toHaveProperty('reputation');
    });

    it('should deny access to non-admin users', async () => {
      const response = await request(app)
        .get('/api/security/dashboard')
        .set('Authorization', `Bearer ${agentToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Admin privileges required');
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/security/dashboard')
        .expect(401);
    });
  });

  describe('Security Alerts', () => {
    let testAlertId: string;

    beforeEach(async () => {
      // Create a test security alert
      await DatabaseService.query(`
        INSERT INTO security_alerts (
          id, type, severity, title, description, metadata, 
          ip_address, email, resolved
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        'test_alert_1',
        'suspicious_registration',
        'high',
        'Test Security Alert',
        'This is a test alert for integration testing',
        JSON.stringify({ test: true }),
        '192.168.1.100',
        'test@example.com',
        false
      ]);
      testAlertId = 'test_alert_1';
    });

    afterEach(async () => {
      // Clean up test alerts
      await DatabaseService.query('DELETE FROM security_alerts WHERE id LIKE $1', ['test_alert_%']);
    });

    it('should retrieve security alerts for admin', async () => {
      const response = await request(app)
        .get('/api/security/alerts')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.alerts).toBeDefined();
      expect(Array.isArray(response.body.alerts)).toBe(true);
      
      const testAlert = response.body.alerts.find((alert: any) => alert.id === testAlertId);
      expect(testAlert).toBeDefined();
      expect(testAlert.type).toBe('suspicious_registration');
      expect(testAlert.severity).toBe('high');
    });

    it('should filter alerts by type', async () => {
      const response = await request(app)
        .get('/api/security/alerts?type=suspicious_registration')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      response.body.alerts.forEach((alert: any) => {
        expect(alert.type).toBe('suspicious_registration');
      });
    });

    it('should filter alerts by severity', async () => {
      const response = await request(app)
        .get('/api/security/alerts?severity=high')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      response.body.alerts.forEach((alert: any) => {
        expect(alert.severity).toBe('high');
      });
    });

    it('should resolve security alerts', async () => {
      const response = await request(app)
        .post(`/api/security/alerts/${testAlertId}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Resolved during testing' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('resolved successfully');

      // Verify alert is marked as resolved
      const result = await DatabaseService.query(
        'SELECT resolved FROM security_alerts WHERE id = $1',
        [testAlertId]
      );
      expect(result.rows[0].resolved).toBe(true);
    });

    it('should deny access to non-admin users', async () => {
      await request(app)
        .get('/api/security/alerts')
        .set('Authorization', `Bearer ${agentToken}`)
        .expect(403);
    });
  });

  describe('IP Reputation', () => {
    it('should check IP reputation for admin', async () => {
      const testIP = '192.168.1.100';
      
      const response = await request(app)
        .get(`/api/security/ip-reputation/${testIP}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.ipAddress).toBe(testIP);
      expect(response.body.reputationScore).toBeDefined();
      expect(typeof response.body.reputationScore).toBe('number');
    });

    it('should reject invalid IP addresses', async () => {
      const invalidIP = '999.999.999.999';
      
      const response = await request(app)
        .get(`/api/security/ip-reputation/${invalidIP}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid IP address format');
    });

    it('should deny access to non-admin users', async () => {
      await request(app)
        .get('/api/security/ip-reputation/192.168.1.100')
        .set('Authorization', `Bearer ${agentToken}`)
        .expect(403);
    });
  });

  describe('Registration Patterns', () => {
    beforeEach(async () => {
      // Create test registration patterns
      await DatabaseService.query(`
        INSERT INTO registration_patterns (
          ip_address, email_pattern, registration_count, 
          time_window_minutes, suspicious_score, flagged
        ) VALUES 
        ($1, $2, $3, $4, $5, $6),
        ($7, $8, $9, $10, $11, $12)
      `, [
        '192.168.1.100', 'user+*@example.com', 5, 60, 75, true,
        '10.0.0.1', 'test@domain.com', 2, 60, 25, false
      ]);
    });

    afterEach(async () => {
      // Clean up test patterns
      await DatabaseService.query(
        'DELETE FROM registration_patterns WHERE ip_address IN ($1, $2)',
        ['192.168.1.100', '10.0.0.1']
      );
    });

    it('should retrieve registration patterns for admin', async () => {
      const response = await request(app)
        .get('/api/security/registration-patterns')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.patterns).toBeDefined();
      expect(Array.isArray(response.body.patterns)).toBe(true);
      expect(response.body.patterns.length).toBeGreaterThan(0);
    });

    it('should filter flagged patterns only', async () => {
      const response = await request(app)
        .get('/api/security/registration-patterns?flagged=true')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      response.body.patterns.forEach((pattern: any) => {
        expect(pattern.flagged).toBe(true);
      });
    });

    it('should deny access to non-admin users', async () => {
      await request(app)
        .get('/api/security/registration-patterns')
        .set('Authorization', `Bearer ${agentToken}`)
        .expect(403);
    });
  });

  describe('Security Statistics', () => {
    it('should retrieve security statistics for admin', async () => {
      const response = await request(app)
        .get('/api/security/statistics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.timeWindow).toBeDefined();
      expect(response.body.statistics).toBeDefined();
      expect(Array.isArray(response.body.statistics)).toBe(true);
    });

    it('should accept different time windows', async () => {
      const response = await request(app)
        .get('/api/security/statistics?timeWindow=24h')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.timeWindow).toBe('24h');
    });

    it('should deny access to non-admin users', async () => {
      await request(app)
        .get('/api/security/statistics')
        .set('Authorization', `Bearer ${agentToken}`)
        .expect(403);
    });
  });

  describe('Security Cleanup', () => {
    it('should execute security cleanup for admin', async () => {
      const response = await request(app)
        .post('/api/security/cleanup')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('cleanup completed successfully');
    });

    it('should deny access to non-admin users', async () => {
      await request(app)
        .post('/api/security/cleanup')
        .set('Authorization', `Bearer ${agentToken}`)
        .expect(403);
    });
  });

  describe('Registration Security Integration', () => {
    it('should detect and block high-risk registrations', async () => {
      // Simulate rapid registrations from the same IP to trigger security monitoring
      const suspiciousRegistrations = [];
      
      for (let i = 0; i < 6; i++) {
        suspiciousRegistrations.push(
          request(app)
            .post('/api/auth/register')
            .send({
              email: `user${i}@suspicious.com`,
              password: 'Password123!',
              firstName: 'Test',
              lastName: 'User',
              role: 'agent'
            })
            .set('X-Forwarded-For', '192.168.1.200') // Simulate same IP
        );
      }

      const responses = await Promise.all(suspiciousRegistrations);
      
      // Later registrations should be blocked or flagged
      const blockedResponses = responses.filter(res => res.status === 403);
      expect(blockedResponses.length).toBeGreaterThan(0);
    });

    it('should detect suspicious user agents', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'bot@example.com',
          password: 'Password123!',
          firstName: 'Bot',
          lastName: 'User',
          role: 'agent'
        })
        .set('User-Agent', 'python-requests/2.28.1') // Suspicious bot user agent
        .expect(403); // Should be blocked

      expect(response.body.error).toContain('Registration temporarily unavailable');
    });
  });
});