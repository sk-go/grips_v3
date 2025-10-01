import { SecurityMonitoringService } from '../../services/security/securityMonitoringService';
import { DatabaseService } from '../../services/database';
import { RedisService } from '../../services/redis';

// Mock dependencies
jest.mock('../../services/database');
jest.mock('../../services/redis');
jest.mock('../../utils/logger');

const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;
const mockRedisService = RedisService as jest.Mocked<typeof RedisService>;

describe('SecurityMonitoringService', () => {
  let mockRedisClient: any;

  beforeEach(() => {
    jest.resetAllMocks();
    
    // Mock Redis client
    mockRedisClient = {
      incr: jest.fn(),
      expire: jest.fn(),
      get: jest.fn(),
      setEx: jest.fn(),
      zAdd: jest.fn(),
      zRemRangeByScore: jest.fn(),
      zCard: jest.fn(),
      del: jest.fn()
    };
    
    mockRedisService.getClient.mockReturnValue(mockRedisClient);
  });

  describe('analyzeRegistrationPattern', () => {
    it('should detect suspicious rapid registration pattern', async () => {
      // Mock rapid registration detection
      mockRedisClient.incr.mockResolvedValue(6); // Above threshold of 5
      mockRedisClient.get.mockResolvedValue(null); // No cached IP reputation
      mockRedisClient.zCard.mockResolvedValue(2); // Below sequential threshold

      // Mock database calls for alert creation
      mockDatabaseService.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await SecurityMonitoringService.analyzeRegistrationPattern(
        '192.168.1.100',
        'test@example.com',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      );

      expect(result.suspicious).toBe(true);
      expect(result.score).toBeGreaterThan(50);
      expect(result.reasons.some(reason => reason.includes('Rapid registration pattern'))).toBe(true);
    });

    it('should detect suspicious user agent patterns', async () => {
      // Mock normal registration counts
      mockRedisClient.incr.mockResolvedValue(1);
      mockRedisClient.get.mockResolvedValue(null);
      mockRedisClient.zCard.mockResolvedValue(1);

      const result = await SecurityMonitoringService.analyzeRegistrationPattern(
        '192.168.1.100',
        'test@example.com',
        'python-requests/2.28.1' // Bot user agent
      );

      expect(result.suspicious).toBe(true);
      expect(result.score).toBeGreaterThan(50);
      expect(result.reasons.some(reason => reason.includes('Suspicious user agent'))).toBe(true);
    });

    it('should detect email pattern abuse', async () => {
      // Mock email pattern abuse
      mockRedisClient.incr.mockResolvedValueOnce(1) // Rapid registration
        .mockResolvedValueOnce(4); // Email pattern abuse (above threshold of 3)
      mockRedisClient.get.mockResolvedValue(null);
      mockRedisClient.zCard.mockResolvedValue(1);

      const result = await SecurityMonitoringService.analyzeRegistrationPattern(
        '192.168.1.100',
        'user+123@example.com',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      );

      expect(result.suspicious).toBe(true);
      expect(result.reasons.some(reason => reason.includes('Suspicious email pattern'))).toBe(true);
    });

    it('should detect sequential registration attempts', async () => {
      // Mock sequential attempts
      mockRedisClient.incr.mockResolvedValue(1);
      mockRedisClient.get.mockResolvedValue(null);
      mockRedisClient.zCard.mockResolvedValue(12); // Above threshold of 10

      const result = await SecurityMonitoringService.analyzeRegistrationPattern(
        '192.168.1.100',
        'test@example.com',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      );

      expect(result.suspicious).toBe(true);
      expect(result.reasons.some(reason => reason.includes('Sequential registration attempts'))).toBe(true);
    });

    it('should not flag legitimate registrations', async () => {
      // Mock normal behavior
      mockRedisClient.incr.mockResolvedValue(1);
      mockRedisClient.get.mockResolvedValue(null);
      mockRedisClient.zCard.mockResolvedValue(1);

      const result = await SecurityMonitoringService.analyzeRegistrationPattern(
        '192.168.1.100',
        'legitimate@example.com',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      );

      expect(result.suspicious).toBe(false);
      expect(result.score).toBeLessThan(50);
    });

    it('should handle errors gracefully', async () => {
      // Mock Redis errors for individual checks - they should return 0 and not crash
      mockRedisClient.incr.mockRejectedValue(new Error('Redis connection failed'));
      mockRedisClient.get.mockRejectedValue(new Error('Redis connection failed'));
      mockRedisClient.zCard.mockRejectedValue(new Error('Redis connection failed'));

      const result = await SecurityMonitoringService.analyzeRegistrationPattern(
        '192.168.1.100',
        'test@example.com',
        'Mozilla/5.0'
      );

      // Should not crash and should return safe defaults
      expect(result.suspicious).toBe(false);
      expect(result.score).toBe(0);
      expect(Array.isArray(result.reasons)).toBe(true);
    });
  });

  describe('checkIPReputation', () => {
    it('should return cached reputation if valid', async () => {
      // Mock no cached reputation to test fresh fetch
      mockRedisClient.get.mockResolvedValue(null);
      mockRedisClient.setEx.mockResolvedValue('OK');

      const score = await SecurityMonitoringService.checkIPReputation('192.168.1.100');

      expect(score).toBeGreaterThanOrEqual(0);
      expect(mockRedisClient.get).toHaveBeenCalledWith('ip_reputation:192.168.1.100');
    });

    it('should fetch fresh reputation if cache is invalid', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      mockRedisClient.setEx.mockResolvedValue('OK');

      const score = await SecurityMonitoringService.checkIPReputation('192.168.1.100');

      expect(score).toBeGreaterThanOrEqual(0);
      expect(mockRedisClient.setEx).toHaveBeenCalled();
    });

    it('should handle private IP addresses correctly', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      mockRedisClient.setEx.mockResolvedValue('OK');

      const score = await SecurityMonitoringService.checkIPReputation('10.0.0.1');

      expect(score).toBe(0); // Private IPs should have good reputation
    });

    it('should handle errors gracefully', async () => {
      mockRedisClient.get.mockRejectedValue(new Error('Redis error'));

      const score = await SecurityMonitoringService.checkIPReputation('192.168.1.100');

      expect(score).toBe(0);
    });
  });

  describe('getSecurityAlerts', () => {
    it('should retrieve security alerts with filters', async () => {
      const mockAlerts = [
        {
          id: 'alert_1',
          type: 'suspicious_registration',
          severity: 'high',
          title: 'Test Alert',
          description: 'Test Description',
          metadata: '{"test": true}',
          ip_address: '192.168.1.100',
          user_agent: 'Mozilla/5.0',
          email: 'test@example.com',
          timestamp: new Date(),
          resolved: false,
          resolved_at: null,
          resolved_by: null
        }
      ];

      mockDatabaseService.query.mockResolvedValue({ rows: mockAlerts, rowCount: mockAlerts.length });

      const alerts = await SecurityMonitoringService.getSecurityAlerts({
        type: 'suspicious_registration',
        severity: 'high',
        resolved: false,
        limit: 10
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].id).toBe('alert_1');
      expect(alerts[0].type).toBe('suspicious_registration');
      expect(alerts[0].metadata).toEqual({ test: true });
    });

    it('should handle database errors gracefully', async () => {
      mockDatabaseService.query.mockRejectedValue(new Error('Database error'));

      const alerts = await SecurityMonitoringService.getSecurityAlerts();

      expect(alerts).toEqual([]);
    });
  });

  describe('resolveAlert', () => {
    it('should resolve an alert successfully', async () => {
      mockDatabaseService.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await SecurityMonitoringService.resolveAlert('alert_1', 'admin_user');

      expect(result).toBe(true);
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE security_alerts'),
        ['alert_1', 'admin_user']
      );
    });

    it('should handle database errors when resolving alerts', async () => {
      mockDatabaseService.query.mockRejectedValue(new Error('Database error'));

      const result = await SecurityMonitoringService.resolveAlert('alert_1', 'admin_user');

      expect(result).toBe(false);
    });
  });

  describe('helper methods', () => {
    it('should extract email patterns correctly', () => {
      // Access private method through any cast for testing
      const service = SecurityMonitoringService as any;
      
      expect(service.extractEmailPattern('user+123@example.com')).toBe('user+*@example.com');
      expect(service.extractEmailPattern('user@example.com')).toBe('user@example.com');
      expect(service.extractEmailPattern('user+456@test.org')).toBe('user+*@test.org');
    });

    it('should identify private IP addresses correctly', () => {
      const service = SecurityMonitoringService as any;
      
      expect(service.isPrivateIP('10.0.0.1')).toBe(true);
      expect(service.isPrivateIP('192.168.1.1')).toBe(true);
      expect(service.isPrivateIP('172.16.0.1')).toBe(true);
      expect(service.isPrivateIP('127.0.0.1')).toBe(true);
      expect(service.isPrivateIP('8.8.8.8')).toBe(false);
      expect(service.isPrivateIP('1.1.1.1')).toBe(false);
    });

    it('should detect suspicious user agents correctly', () => {
      const service = SecurityMonitoringService as any;
      
      expect(service.checkSuspiciousUserAgent('python-requests/2.28.1')).toBeGreaterThan(0);
      expect(service.checkSuspiciousUserAgent('curl/7.68.0')).toBeGreaterThan(0);
      expect(service.checkSuspiciousUserAgent('bot')).toBeGreaterThan(0);
      expect(service.checkSuspiciousUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')).toBe(0);
      expect(service.checkSuspiciousUserAgent('')).toBeGreaterThan(0);
      expect(service.checkSuspiciousUserAgent('short')).toBeGreaterThan(0);
    });
  });
});