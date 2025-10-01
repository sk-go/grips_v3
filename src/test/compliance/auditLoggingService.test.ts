import { AuditLoggingService } from '../../services/compliance/auditLoggingService';
import { DatabaseService } from '../../services/database';

// Mock the database service
jest.mock('../../services/database');
const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;

describe('AuditLoggingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('logAction', () => {
    it('should log an action successfully', async () => {
      const mockId = 'audit-123';
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [{ id: mockId }]
      } as any);

      const entry = {
        userId: 'user-123',
        actionType: 'test_action',
        resourceType: 'test_resource',
        details: { test: true }
      };

      const result = await AuditLoggingService.logAction(entry);

      expect(result).toBe(mockId);
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_logs'),
        expect.arrayContaining([
          'user-123',
          null, // sessionId
          'test_action',
          'test_resource',
          null, // resourceId
          JSON.stringify({ test: true }),
          null, // ipAddress
          null, // userAgent
          null, // chainId
          null, // stepNumber
          null, // confidenceScore
          null, // riskLevel
          JSON.stringify({}) // complianceFlags
        ])
      );
    });

    it('should log agentic action with chain details', async () => {
      const mockId = 'audit-456';
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [{ id: mockId }]
      } as any);

      const result = await AuditLoggingService.logAgenticAction(
        'chain-123',
        1,
        'email_send',
        'communication',
        { recipient: 'test@example.com' },
        0.95,
        'medium',
        'user-123',
        'session-123'
      );

      expect(result).toBe(mockId);
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_logs'),
        expect.arrayContaining([
          'user-123',
          'session-123',
          'agentic_email_send',
          'communication',
          null,
          JSON.stringify({
            recipient: 'test@example.com',
            isAgenticAction: true,
            chainStep: 1
          }),
          null,
          null,
          'chain-123',
          1,
          0.95,
          'medium',
          JSON.stringify({
            requiresHumanReview: false,
            agenticWorkflow: true
          })
        ])
      );
    });

    it('should handle database errors gracefully', async () => {
      mockDatabaseService.query.mockRejectedValueOnce(new Error('Database error'));

      const entry = {
        actionType: 'test_action',
        resourceType: 'test_resource',
        details: { test: true }
      };

      await expect(AuditLoggingService.logAction(entry)).rejects.toThrow('Failed to create audit log entry');
    });
  });

  describe('queryAuditLogs', () => {
    it('should query audit logs with filters', async () => {
      const mockLogs = [
        {
          id: 'audit-1',
          timestamp: new Date(),
          action_type: 'test_action',
          resource_type: 'test_resource'
        }
      ];

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: mockLogs
      } as any);

      const query = {
        userId: 'user-123',
        actionType: 'test_action',
        limit: 10
      };

      const result = await AuditLoggingService.queryAuditLogs(query);

      expect(result).toEqual(mockLogs);
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE 1=1'),
        ['user-123', 'test_action', 10]
      );
    });

    it('should handle empty results', async () => {
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: []
      } as any);

      const result = await AuditLoggingService.queryAuditLogs({});
      expect(result).toEqual([]);
    });
  });

  describe('getChainAuditTrail', () => {
    it('should get audit trail for a chain', async () => {
      const mockTrail = [
        {
          id: 'audit-1',
          step_number: 1,
          action_type: 'agentic_start'
        },
        {
          id: 'audit-2',
          step_number: 2,
          action_type: 'agentic_email_send'
        }
      ];

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: mockTrail
      } as any);

      const result = await AuditLoggingService.getChainAuditTrail('chain-123');

      expect(result).toEqual(mockTrail);
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE chain_id = $1'),
        ['chain-123']
      );
    });
  });

  describe('getComplianceSummary', () => {
    it('should get compliance summary for user', async () => {
      const mockSummary = {
        total_actions: 100,
        high_risk_actions: 5,
        agentic_actions: 20,
        unique_chains: 8,
        avg_confidence: 0.85
      };

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [mockSummary]
      } as any);

      const result = await AuditLoggingService.getComplianceSummary('user-123', 30);

      expect(result).toEqual(mockSummary);
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = $1'),
        ['user-123']
      );
    });
  });

  describe('healthCheck', () => {
    it('should return true when audit logging is healthy', async () => {
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [{ id: 'test-audit' }]
      } as any);

      const result = await AuditLoggingService.healthCheck();
      expect(result).toBe(true);
    });

    it('should return false when audit logging fails', async () => {
      mockDatabaseService.query.mockRejectedValueOnce(new Error('Database error'));

      const result = await AuditLoggingService.healthCheck();
      expect(result).toBe(false);
    });
  });
});