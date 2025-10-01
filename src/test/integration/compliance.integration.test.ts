import request from 'supertest';
import express from 'express';
import { DatabaseService } from '../../services/database';
import complianceRoutes from '../../routes/compliance';
import { authMiddleware } from '../../middleware/auth';

// Mock authentication middleware
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    req.user = { id: 'test-user-123' };
    req.sessionID = 'test-session-123';
    req.session = { mfaVerified: true };
    next();
  }
}));

// Mock database service
jest.mock('../../services/database');
const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;

describe('Compliance Integration Tests', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/compliance', complianceRoutes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Audit Logs API', () => {
    it('should get audit logs with filters', async () => {
      // Mock user roles check
      mockDatabaseService.query
        .mockResolvedValueOnce({
          rows: [{ permissions: { 'audit_logs': ['read'] } }]
        } as any)
        // Mock audit log creation for the API request
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-request-123' }]
        } as any)
        // Mock audit logs query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'audit-1',
              timestamp: new Date(),
              user_id: 'test-user-123',
              action_type: 'test_action',
              resource_type: 'test_resource',
              details: { test: true }
            }
          ]
        } as any)
        // Mock audit log creation for the API response
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-response-123' }]
        } as any);

      const response = await request(app)
        .get('/api/compliance/audit-logs')
        .query({
          userId: 'test-user-123',
          actionType: 'test_action',
          limit: 10
        })
        .expect(200);

      expect(response.body.logs).toHaveLength(1);
      expect(response.body.logs[0].action_type).toBe('test_action');
    });

    it('should require proper permissions for audit logs', async () => {
      // Mock insufficient permissions
      mockDatabaseService.query
        .mockResolvedValueOnce({
          rows: []
        } as any)
        // Mock permission denial audit log
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-denial-123' }]
        } as any);

      await request(app)
        .get('/api/compliance/audit-logs')
        .expect(403);
    });
  });

  describe('RBAC API', () => {
    it('should get user roles', async () => {
      // Mock permissions check
      mockDatabaseService.query
        .mockResolvedValueOnce({
          rows: [{ permissions: { 'rbac': ['read'] } }]
        } as any)
        // Mock audit log for request
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-123' }]
        } as any)
        // Mock get user roles
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'role-1',
              name: 'agent',
              description: 'Insurance Agent',
              permissions: { 'communications': ['read', 'write'] },
              is_system_role: true,
              created_at: new Date(),
              updated_at: new Date()
            }
          ]
        } as any)
        // Mock audit log for response
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-response-123' }]
        } as any);

      const response = await request(app)
        .get('/api/compliance/users/test-user-123/roles')
        .expect(200);

      expect(response.body.roles).toHaveLength(1);
      expect(response.body.roles[0].name).toBe('agent');
    });

    it('should assign role with MFA verification', async () => {
      // Mock permissions check
      mockDatabaseService.query
        .mockResolvedValueOnce({
          rows: [{ permissions: { 'rbac': ['write'] } }]
        } as any)
        // Mock MFA check
        .mockResolvedValueOnce({
          rows: [{ is_enabled: true }]
        } as any)
        // Mock audit log for request
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-123' }]
        } as any)
        // Mock role lookup
        .mockResolvedValueOnce({
          rows: [{ id: 'role-123', name: 'agent' }]
        } as any)
        // Mock existing assignment check
        .mockResolvedValueOnce({
          rows: []
        } as any)
        // Mock role assignment
        .mockResolvedValueOnce({
          rows: [{ id: 'assignment-123' }]
        } as any)
        // Mock audit log for role assignment
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-assignment-123' }]
        } as any)
        // Mock audit log for response
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-response-123' }]
        } as any);

      const response = await request(app)
        .post('/api/compliance/users/target-user-123/roles')
        .send({
          roleName: 'agent'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.assignmentId).toBe('assignment-123');
    });
  });

  describe('MFA API', () => {
    it('should setup MFA', async () => {
      // Mock audit log for request
      mockDatabaseService.query
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-123' }]
        } as any)
        // Mock MFA setup
        .mockResolvedValueOnce({
          rows: [{ id: 'mfa-setup-123' }]
        } as any)
        // Mock audit log for MFA setup
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-mfa-123' }]
        } as any)
        // Mock audit log for response
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-response-123' }]
        } as any);

      const response = await request(app)
        .post('/api/compliance/mfa/setup')
        .expect(200);

      expect(response.body.setup).toBeDefined();
      expect(response.body.setup.secret).toBeDefined();
      expect(response.body.setup.backupCodes).toBeDefined();
    });

    it('should verify MFA token', async () => {
      // Mock audit log for request
      mockDatabaseService.query
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-123' }]
        } as any)
        // Mock MFA settings lookup
        .mockResolvedValueOnce({
          rows: [{ 
            secret_key: 'encrypted-secret',
            is_enabled: true 
          }]
        } as any)
        // Mock MFA attempt logging
        .mockResolvedValueOnce({
          rows: [{ id: 'mfa-attempt-123' }]
        } as any)
        // Mock last used update
        .mockResolvedValueOnce({
          rows: [{ id: 'mfa-update-123' }]
        } as any)
        // Mock audit log for verification
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-verification-123' }]
        } as any)
        // Mock audit log for response
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-response-123' }]
        } as any);

      // Mock speakeasy verification (this would need to be mocked at the module level)
      const mockSpeakeasy = {
        totp: {
          verify: jest.fn().mockReturnValue(true)
        }
      };
      jest.doMock('speakeasy', () => mockSpeakeasy);

      const response = await request(app)
        .post('/api/compliance/mfa/verify')
        .send({
          token: '123456'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('Sensitive Data API', () => {
    it('should scan content for sensitive data', async () => {
      // Mock permissions check
      mockDatabaseService.query
        .mockResolvedValueOnce({
          rows: [{ permissions: { 'compliance': ['write'] } }]
        } as any)
        // Mock audit log for request
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-123' }]
        } as any)
        // Mock pattern loading
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
        // Mock compliance incident creation
        .mockResolvedValueOnce({
          rows: [{ id: 'incident-123' }]
        } as any)
        // Mock audit log for incident
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-incident-123' }]
        } as any)
        // Mock audit log for scan
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-scan-123' }]
        } as any)
        // Mock audit log for response
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-response-123' }]
        } as any);

      const response = await request(app)
        .post('/api/compliance/sensitive-data/scan')
        .send({
          content: 'Patient SSN: 123-45-6789'
        })
        .expect(200);

      expect(response.body.matches).toHaveLength(1);
      expect(response.body.matches[0].pattern.dataType).toBe('ssn');
    });

    it('should get compliance incidents', async () => {
      // Mock permissions check
      mockDatabaseService.query
        .mockResolvedValueOnce({
          rows: [{ permissions: { 'compliance': ['read'] } }]
        } as any)
        // Mock audit log for request
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-123' }]
        } as any)
        // Mock incidents query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'incident-1',
              incident_type: 'sensitive_data_detected',
              severity: 'critical',
              description: 'SSN detected',
              detected_data: '12*****89',
              user_id: 'test-user-123',
              session_id: 'session-123',
              chain_id: null,
              action_taken: 'halt_chain',
              status: 'open',
              created_at: new Date()
            }
          ]
        } as any)
        // Mock audit log for response
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-response-123' }]
        } as any);

      const response = await request(app)
        .get('/api/compliance/sensitive-data/incidents')
        .query({
          severity: 'critical',
          status: 'open'
        })
        .expect(200);

      expect(response.body.incidents).toHaveLength(1);
      expect(response.body.incidents[0].severity).toBe('critical');
    });
  });

  describe('Compliance Validation API', () => {
    it('should validate GDPR compliance', async () => {
      // Mock permissions check
      mockDatabaseService.query
        .mockResolvedValueOnce({
          rows: [{ permissions: { 'compliance': ['read'] } }]
        } as any)
        // Mock audit log for request
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-123' }]
        } as any)
        // Mock consent check
        .mockResolvedValueOnce({
          rows: [{ id: 'consent-123' }]
        } as any)
        // Mock audit log for validation
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-validation-123' }]
        } as any)
        // Mock audit log for response
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-response-123' }]
        } as any);

      const response = await request(app)
        .post('/api/compliance/validation/gdpr')
        .send({
          dataProcessing: {
            purpose: 'client_communication',
            dataTypes: ['personal_data', 'communication_data'],
            legalBasis: 'consent',
            retentionPeriod: 365,
            recipients: [],
            transferredOutsideEU: false
          },
          clientId: 'client-123'
        })
        .expect(200);

      expect(response.body.validation).toBeDefined();
      expect(response.body.validation.framework).toBe('GDPR');
      expect(response.body.validation.isCompliant).toBe(true);
    });
  });

  describe('Consent Management API', () => {
    it('should record consent', async () => {
      // Mock audit log for request
      mockDatabaseService.query
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-123' }]
        } as any)
        // Mock consent recording
        .mockResolvedValueOnce({
          rows: [{ id: 'consent-123' }]
        } as any)
        // Mock audit log for consent
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-consent-123' }]
        } as any)
        // Mock audit log for response
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-response-123' }]
        } as any);

      const response = await request(app)
        .post('/api/compliance/consents')
        .send({
          consentType: 'data_processing',
          complianceFramework: 'GDPR',
          granted: true,
          consentText: 'I consent to data processing for communication purposes',
          clientId: 'client-123'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.consentId).toBe('consent-123');
    });

    it('should get user consents', async () => {
      // Mock audit log for request
      mockDatabaseService.query
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-123' }]
        } as any)
        // Mock consents query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'consent-1',
              user_id: 'test-user-123',
              client_id: 'client-123',
              consent_type: 'data_processing',
              compliance_framework: 'GDPR',
              granted: true,
              consent_text: 'I consent to data processing',
              ip_address: '127.0.0.1',
              user_agent: 'test-agent',
              expires_at: null,
              withdrawn_at: null,
              created_at: new Date()
            }
          ]
        } as any)
        // Mock audit log for response
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-response-123' }]
        } as any);

      const response = await request(app)
        .get('/api/compliance/consents')
        .query({
          clientId: 'client-123'
        })
        .expect(200);

      expect(response.body.consents).toHaveLength(1);
      expect(response.body.consents[0].consentType).toBe('data_processing');
    });
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      // Mock audit log for request
      mockDatabaseService.query
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-123' }]
        } as any)
        // Mock health check audit log
        .mockResolvedValueOnce({
          rows: [{ id: 'health-audit-123' }]
        } as any)
        // Mock audit log for response
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-response-123' }]
        } as any);

      const response = await request(app)
        .get('/api/compliance/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body.services.auditLogging).toBe('healthy');
    });
  });
});