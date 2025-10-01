import { SensitiveDataService } from '../../services/compliance/sensitiveDataService';
import { DatabaseService } from '../../services/database';
import { AuditLoggingService } from '../../services/compliance/auditLoggingService';

// Mock dependencies
jest.mock('../../services/database');
jest.mock('../../services/compliance/auditLoggingService');

const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;
const mockAuditLoggingService = AuditLoggingService as jest.Mocked<typeof AuditLoggingService>;

describe('SensitiveDataService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset static properties
    (SensitiveDataService as any).patterns = [];
    (SensitiveDataService as any).lastPatternLoad = null;
  });

  describe('scanContent', () => {
    beforeEach(() => {
      // Mock pattern loading
      mockDatabaseService.query.mockResolvedValue({
        rows: [
          {
            id: 'pattern-1',
            name: 'US SSN',
            pattern: '\\b\\d{3}-?\\d{2}-?\\d{4}\\b',
            data_type: 'ssn',
            severity: 'critical',
            compliance_type: 'HIPAA',
            is_active: true
          },
          {
            id: 'pattern-2',
            name: 'Email',
            pattern: '\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b',
            data_type: 'email',
            severity: 'medium',
            compliance_type: 'GDPR',
            is_active: true
          }
        ]
      } as any);
    });

    it('should detect SSN in content', async () => {
      const content = 'Patient SSN: 123-45-6789 for reference';
      
      mockAuditLoggingService.logAction.mockResolvedValue('audit-123');

      const matches = await SensitiveDataService.scanContent(content, 'user-123', 'session-123');

      expect(matches).toHaveLength(1);
      expect(matches[0].pattern.dataType).toBe('ssn');
      expect(matches[0].matches).toEqual(['123-45-6789']);
      expect(matches[0].sanitizedContent).toContain('[REDACTED]');
    });

    it('should detect multiple patterns in content', async () => {
      const content = 'Contact: john@example.com, SSN: 123456789';
      
      mockAuditLoggingService.logAction.mockResolvedValue('audit-123');

      const matches = await SensitiveDataService.scanContent(content, 'user-123', 'session-123');

      expect(matches).toHaveLength(2);
      expect(matches.some(m => m.pattern.dataType === 'ssn')).toBe(true);
      expect(matches.some(m => m.pattern.dataType === 'email')).toBe(true);
    });

    it('should create compliance incident for critical severity', async () => {
      const content = 'SSN: 123-45-6789';
      
      mockAuditLoggingService.logAction.mockResolvedValue('audit-123');
      mockDatabaseService.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'pattern-1',
              name: 'US SSN',
              pattern: '\\b\\d{3}-?\\d{2}-?\\d{4}\\b',
              data_type: 'ssn',
              severity: 'critical',
              compliance_type: 'HIPAA',
              is_active: true
            }
          ]
        } as any)
        .mockResolvedValueOnce({
          rows: [{ id: 'incident-123' }]
        } as any);

      await SensitiveDataService.scanContent(content, 'user-123', 'session-123', 'chain-123');

      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO compliance_incidents'),
        expect.arrayContaining([
          'sensitive_data_detected',
          'critical',
          'Detected ssn in content',
          expect.stringContaining('12*****89'),
          'user-123',
          'session-123',
          'chain-123',
          'halt_chain'
        ])
      );
    });

    it('should return empty array when no patterns match', async () => {
      const content = 'This is clean content with no sensitive data';
      
      const matches = await SensitiveDataService.scanContent(content, 'user-123', 'session-123');

      expect(matches).toHaveLength(0);
    });
  });

  describe('shouldHaltChain', () => {
    beforeEach(() => {
      mockDatabaseService.query.mockResolvedValue({
        rows: [
          {
            id: 'pattern-1',
            name: 'US SSN',
            pattern: '\\b\\d{3}-?\\d{2}-?\\d{4}\\b',
            data_type: 'ssn',
            severity: 'critical',
            compliance_type: 'HIPAA',
            is_active: true
          }
        ]
      } as any);
    });

    it('should halt chain for critical sensitive data', async () => {
      const content = 'Processing SSN: 123-45-6789';
      
      mockAuditLoggingService.logAction.mockResolvedValue('audit-123');
      mockDatabaseService.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'pattern-1',
              name: 'US SSN',
              pattern: '\\b\\d{3}-?\\d{2}-?\\d{4}\\b',
              data_type: 'ssn',
              severity: 'critical',
              compliance_type: 'HIPAA',
              is_active: true
            }
          ]
        } as any)
        .mockResolvedValueOnce({
          rows: [{ id: 'incident-123' }]
        } as any);

      const result = await SensitiveDataService.shouldHaltChain(
        content,
        'user-123',
        'session-123',
        'chain-123'
      );

      expect(result.shouldHalt).toBe(true);
      expect(result.reason).toContain('Critical sensitive data detected');
      expect(mockAuditLoggingService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'agentic_chain_halted'
        })
      );
    });

    it('should not halt chain for non-critical data', async () => {
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'pattern-2',
            name: 'Email',
            pattern: '\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b',
            data_type: 'email',
            severity: 'medium',
            compliance_type: 'GDPR',
            is_active: true
          }
        ]
      } as any);

      const content = 'Contact: john@example.com';
      
      mockAuditLoggingService.logAction.mockResolvedValue('audit-123');

      const result = await SensitiveDataService.shouldHaltChain(content, 'user-123', 'session-123');

      expect(result.shouldHalt).toBe(false);
      expect(result.matches).toHaveLength(1);
    });

    it('should halt chain on scanning error', async () => {
      mockDatabaseService.query.mockRejectedValueOnce(new Error('Database error'));

      const result = await SensitiveDataService.shouldHaltChain('test content', 'user-123');

      expect(result.shouldHalt).toBe(true);
      expect(result.reason).toBe('Error during sensitive data scan');
    });
  });

  describe('createComplianceIncident', () => {
    it('should create compliance incident successfully', async () => {
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [{ id: 'incident-123' }]
      } as any);

      mockAuditLoggingService.logAction.mockResolvedValue('audit-123');

      const incident = {
        incidentType: 'sensitive_data_detected',
        severity: 'critical' as const,
        description: 'SSN detected in content',
        detectedData: '12*****89',
        userId: 'user-123',
        actionTaken: 'halt_chain'
      };

      const result = await SensitiveDataService.createComplianceIncident(incident);

      expect(result).toBe('incident-123');
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO compliance_incidents'),
        expect.arrayContaining([
          'sensitive_data_detected',
          'critical',
          'SSN detected in content',
          '12*****89',
          'user-123',
          null,
          null,
          'halt_chain'
        ])
      );
    });
  });

  describe('getComplianceIncidents', () => {
    it('should get incidents with filters', async () => {
      const mockIncidents = [
        {
          id: 'incident-1',
          incident_type: 'sensitive_data_detected',
          severity: 'critical',
          description: 'SSN detected',
          detected_data: '12*****89',
          user_id: 'user-123',
          session_id: 'session-123',
          chain_id: null,
          action_taken: 'halt_chain',
          status: 'open',
          created_at: new Date()
        }
      ];

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: mockIncidents
      } as any);

      const filters = {
        severity: 'critical',
        status: 'open',
        limit: 10
      };

      const result = await SensitiveDataService.getComplianceIncidents(filters);

      expect(result).toHaveLength(1);
      expect(result[0].incidentType).toBe('sensitive_data_detected');
      expect(result[0].severity).toBe('critical');
    });
  });

  describe('resolveIncident', () => {
    it('should resolve incident successfully', async () => {
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [{ id: 'incident-123' }]
      } as any);

      mockAuditLoggingService.logAction.mockResolvedValue('audit-123');

      await SensitiveDataService.resolveIncident(
        'incident-123',
        'admin-123',
        'resolved',
        'session-123'
      );

      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE compliance_incidents'),
        ['resolved', 'admin-123', 'incident-123']
      );

      expect(mockAuditLoggingService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'compliance_incident_resolved'
        })
      );
    });
  });

  describe('addPattern', () => {
    it('should add valid pattern successfully', async () => {
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [{ id: 'pattern-123' }]
      } as any);

      mockAuditLoggingService.logAction.mockResolvedValue('audit-123');

      const pattern = {
        name: 'Test Pattern',
        pattern: '\\btest\\b',
        dataType: 'test_data',
        severity: 'medium' as const,
        complianceType: 'GDPR',
        isActive: true
      };

      const result = await SensitiveDataService.addPattern(
        pattern,
        'admin-123',
        'session-123'
      );

      expect(result).toBe('pattern-123');
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO sensitive_data_patterns'),
        expect.arrayContaining([
          'Test Pattern',
          '\\btest\\b',
          'test_data',
          'medium',
          'GDPR',
          true
        ])
      );
    });

    it('should reject invalid regex pattern', async () => {
      const pattern = {
        name: 'Invalid Pattern',
        pattern: '[invalid regex',
        dataType: 'test_data',
        severity: 'medium' as const,
        complianceType: 'GDPR',
        isActive: true
      };

      await expect(
        SensitiveDataService.addPattern(pattern, 'admin-123')
      ).rejects.toThrow('Invalid regex pattern');
    });
  });

  describe('getComplianceStats', () => {
    it('should get compliance statistics', async () => {
      const mockStats = {
        total_incidents: 10,
        critical_incidents: 2,
        high_incidents: 3,
        open_incidents: 5,
        resolved_incidents: 5
      };

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [mockStats]
      } as any);

      const result = await SensitiveDataService.getComplianceStats(30);

      expect(result).toEqual(mockStats);
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM compliance_incidents'),
        []
      );
    });
  });
});