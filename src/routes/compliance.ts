import express from 'express';

// Extend Express Request interface
declare module 'express-serve-static-core' {
  interface Request {
    sessionID?: string;
    session?: {
      mfaVerified?: boolean;
      [key: string]: any;
    };
  }
}
import { 
  AuditLoggingService, 
  RBACService, 
  MFAService, 
  SensitiveDataService,
  ComplianceValidationService 
} from '../services/compliance';
import { requirePermission, requireMFA, auditLogger } from '../middleware/compliance';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = express.Router();

// Apply authentication and audit logging to all routes
router.use(authMiddleware);
router.use(auditLogger());

// Audit Log Routes
router.get('/audit-logs', 
  requirePermission('audit_logs', 'read'),
  async (req, res) => {
    try {
      const query = {
        userId: req.query.userId as string,
        actionType: req.query.actionType as string,
        resourceType: req.query.resourceType as string,
        chainId: req.query.chainId as string,
        riskLevel: req.query.riskLevel as string,
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0
      };

      const logs = await AuditLoggingService.queryAuditLogs(query);
      res.json({ logs, query });
    } catch (error) {
      logger.error('Failed to get audit logs', {
        error: error instanceof Error ? error.message : 'Unknown error',
        query: req.query
      });
      res.status(500).json({ error: 'Failed to get audit logs' });
    }
  }
);

router.get('/audit-logs/chain/:chainId',
  requirePermission('audit_logs', 'read'),
  async (req, res) => {
    try {
      const { chainId } = req.params;
      const trail = await AuditLoggingService.getChainAuditTrail(chainId);
      res.json({ chainId, trail });
    } catch (error) {
      logger.error('Failed to get chain audit trail', {
        error: error instanceof Error ? error.message : 'Unknown error',
        chainId: req.params.chainId
      });
      res.status(500).json({ error: 'Failed to get chain audit trail' });
    }
  }
);

router.get('/audit-logs/summary/:userId',
  requirePermission('audit_logs', 'read'),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const days = req.query.days ? parseInt(req.query.days as string) : 30;
      const summary = await AuditLoggingService.getComplianceSummary(userId, days);
      res.json({ userId, days, summary });
    } catch (error) {
      logger.error('Failed to get compliance summary', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.params.userId
      });
      res.status(500).json({ error: 'Failed to get compliance summary' });
    }
  }
);

// RBAC Routes
router.get('/roles',
  requirePermission('rbac', 'read'),
  async (req, res) => {
    try {
      const roles = await RBACService.getAllRoles();
      res.json({ roles });
    } catch (error) {
      logger.error('Failed to get roles', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      res.status(500).json({ error: 'Failed to get roles' });
    }
  }
);

router.get('/users/:userId/roles',
  requirePermission('rbac', 'read'),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const roles = await RBACService.getUserRoles(userId);
      res.json({ userId, roles });
    } catch (error) {
      logger.error('Failed to get user roles', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.params.userId
      });
      res.status(500).json({ error: 'Failed to get user roles' });
    }
  }
);

router.post('/users/:userId/roles',
  requirePermission('rbac', 'write'),
  requireMFA(),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { roleName, expiresAt } = req.body;
      const assignedBy = req.user!.id;
      const sessionId = req.sessionID;

      const assignmentId = await RBACService.assignRole(
        userId,
        roleName,
        assignedBy,
        expiresAt ? new Date(expiresAt) : undefined,
        sessionId
      );

      res.json({ 
        success: true, 
        assignmentId,
        message: `Role '${roleName}' assigned to user` 
      });
    } catch (error) {
      logger.error('Failed to assign role', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.params.userId,
        body: req.body
      });
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to assign role' });
    }
  }
);

router.delete('/users/:userId/roles/:roleName',
  requirePermission('rbac', 'write'),
  requireMFA(),
  async (req, res) => {
    try {
      const { userId, roleName } = req.params;
      const revokedBy = req.user!.id;
      const sessionId = req.sessionID;

      await RBACService.revokeRole(userId, roleName, revokedBy, sessionId);
      res.json({ 
        success: true, 
        message: `Role '${roleName}' revoked from user` 
      });
    } catch (error) {
      logger.error('Failed to revoke role', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.params.userId,
        roleName: req.params.roleName
      });
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to revoke role' });
    }
  }
);

router.post('/roles',
  requirePermission('rbac', 'admin'),
  requireMFA(),
  async (req, res) => {
    try {
      const { name, description, permissions } = req.body;
      const createdBy = req.user!.id;
      const sessionId = req.sessionID;

      const roleId = await RBACService.createRole(
        name,
        description,
        permissions,
        createdBy,
        sessionId
      );

      res.json({ 
        success: true, 
        roleId,
        message: `Role '${name}' created` 
      });
    } catch (error) {
      logger.error('Failed to create role', {
        error: error instanceof Error ? error.message : 'Unknown error',
        body: req.body
      });
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to create role' });
    }
  }
);

// MFA Routes
router.get('/mfa/settings',
  async (req, res) => {
    try {
      const userId = req.user!.id;
      const settings = await MFAService.getMFASettings(userId);
      res.json({ settings });
    } catch (error) {
      logger.error('Failed to get MFA settings', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.user?.id
      });
      res.status(500).json({ error: 'Failed to get MFA settings' });
    }
  }
);

router.post('/mfa/setup',
  async (req, res) => {
    try {
      const userId = req.user!.id;
      const sessionId = req.sessionID;
      
      const setup = await MFAService.setupMFA(userId, sessionId);
      res.json({ setup });
    } catch (error) {
      logger.error('Failed to setup MFA', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.user?.id
      });
      res.status(500).json({ error: 'Failed to setup MFA' });
    }
  }
);

router.post('/mfa/enable',
  async (req, res) => {
    try {
      const userId = req.user!.id;
      const sessionId = req.sessionID;
      const { token } = req.body;

      await MFAService.enableMFA(userId, token, sessionId);
      res.json({ 
        success: true, 
        message: 'MFA enabled successfully' 
      });
    } catch (error) {
      logger.error('Failed to enable MFA', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.user?.id
      });
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to enable MFA' });
    }
  }
);

router.post('/mfa/disable',
  async (req, res) => {
    try {
      const userId = req.user!.id;
      const sessionId = req.sessionID;
      const { token } = req.body;

      await MFAService.disableMFA(userId, token, sessionId);
      res.json({ 
        success: true, 
        message: 'MFA disabled successfully' 
      });
    } catch (error) {
      logger.error('Failed to disable MFA', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.user?.id
      });
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to disable MFA' });
    }
  }
);

router.post('/mfa/verify',
  async (req, res) => {
    try {
      const userId = req.user!.id;
      const sessionId = req.sessionID;
      const { token, backupCode } = req.body;
      const ipAddress = req.ip;
      const userAgent = req.get('User-Agent');

      let verified = false;

      if (token) {
        verified = await MFAService.verifyTOTP(userId, token, sessionId, ipAddress, userAgent);
      } else if (backupCode) {
        verified = await MFAService.verifyBackupCode(userId, backupCode, sessionId, ipAddress, userAgent);
      }

      if (verified) {
        // Mark session as MFA verified
        req.session!.mfaVerified = true;
        res.json({ 
          success: true, 
          message: 'MFA verification successful' 
        });
      } else {
        res.status(400).json({ 
          error: 'Invalid verification code' 
        });
      }
    } catch (error) {
      logger.error('Failed to verify MFA', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.user?.id
      });
      res.status(500).json({ error: 'MFA verification failed' });
    }
  }
);

router.post('/mfa/regenerate-backup-codes',
  async (req, res) => {
    try {
      const userId = req.user!.id;
      const sessionId = req.sessionID;
      const { token } = req.body;

      const backupCodes = await MFAService.regenerateBackupCodes(userId, token, sessionId);
      res.json({ 
        success: true, 
        backupCodes,
        message: 'Backup codes regenerated' 
      });
    } catch (error) {
      logger.error('Failed to regenerate backup codes', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.user?.id
      });
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to regenerate backup codes' });
    }
  }
);

// Sensitive Data Routes
router.post('/sensitive-data/scan',
  requirePermission('compliance', 'write'),
  async (req, res) => {
    try {
      const { content } = req.body;
      const userId = req.user!.id;
      const sessionId = req.sessionID;
      const chainId = req.headers['x-chain-id'] as string;

      const matches = await SensitiveDataService.scanContent(content, userId, sessionId, chainId);
      res.json({ matches });
    } catch (error) {
      logger.error('Failed to scan content', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.user?.id
      });
      res.status(500).json({ error: 'Failed to scan content' });
    }
  }
);

router.get('/sensitive-data/incidents',
  requirePermission('compliance', 'read'),
  async (req, res) => {
    try {
      const filters = {
        severity: req.query.severity as string,
        status: req.query.status as string,
        userId: req.query.userId as string,
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0
      };

      const incidents = await SensitiveDataService.getComplianceIncidents(filters);
      res.json({ incidents, filters });
    } catch (error) {
      logger.error('Failed to get compliance incidents', {
        error: error instanceof Error ? error.message : 'Unknown error',
        query: req.query
      });
      res.status(500).json({ error: 'Failed to get compliance incidents' });
    }
  }
);

router.put('/sensitive-data/incidents/:incidentId/resolve',
  requirePermission('compliance', 'write'),
  requireMFA(),
  async (req, res) => {
    try {
      const { incidentId } = req.params;
      const { status } = req.body;
      const resolvedBy = req.user!.id;
      const sessionId = req.sessionID;

      await SensitiveDataService.resolveIncident(incidentId, resolvedBy, status, sessionId);
      res.json({ 
        success: true, 
        message: `Incident ${status}` 
      });
    } catch (error) {
      logger.error('Failed to resolve incident', {
        error: error instanceof Error ? error.message : 'Unknown error',
        incidentId: req.params.incidentId,
        body: req.body
      });
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to resolve incident' });
    }
  }
);

// Compliance Validation Routes
router.post('/validation/gdpr',
  requirePermission('compliance', 'read'),
  async (req, res) => {
    try {
      const { dataProcessing } = req.body;
      const userId = req.user!.id;
      const clientId = req.body.clientId;

      const validation = await ComplianceValidationService.validateGDPRCompliance(
        dataProcessing,
        userId,
        clientId
      );

      res.json({ validation });
    } catch (error) {
      logger.error('Failed to validate GDPR compliance', {
        error: error instanceof Error ? error.message : 'Unknown error',
        body: req.body
      });
      res.status(500).json({ error: 'Failed to validate GDPR compliance' });
    }
  }
);

router.post('/validation/hipaa',
  requirePermission('compliance', 'read'),
  async (req, res) => {
    try {
      const { dataProcessing } = req.body;
      const userId = req.user!.id;
      const clientId = req.body.clientId;

      const validation = await ComplianceValidationService.validateHIPAACompliance(
        dataProcessing,
        userId,
        clientId
      );

      res.json({ validation });
    } catch (error) {
      logger.error('Failed to validate HIPAA compliance', {
        error: error instanceof Error ? error.message : 'Unknown error',
        body: req.body
      });
      res.status(500).json({ error: 'Failed to validate HIPAA compliance' });
    }
  }
);

// Consent Management Routes
router.post('/consents',
  async (req, res) => {
    try {
      const {
        consentType,
        complianceFramework,
        granted,
        consentText,
        clientId,
        expiresAt
      } = req.body;
      
      const userId = req.user!.id;
      const ipAddress = req.ip;
      const userAgent = req.get('User-Agent');

      const consentId = await ComplianceValidationService.recordConsent(
        consentType,
        complianceFramework,
        granted,
        consentText,
        userId,
        clientId,
        ipAddress,
        userAgent,
        expiresAt ? new Date(expiresAt) : undefined
      );

      res.json({ 
        success: true, 
        consentId,
        message: 'Consent recorded' 
      });
    } catch (error) {
      logger.error('Failed to record consent', {
        error: error instanceof Error ? error.message : 'Unknown error',
        body: req.body
      });
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to record consent' });
    }
  }
);

router.get('/consents',
  async (req, res) => {
    try {
      const userId = req.user!.id;
      const clientId = req.query.clientId as string;

      const consents = await ComplianceValidationService.getConsents(userId, clientId);
      res.json({ consents });
    } catch (error) {
      logger.error('Failed to get consents', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.user?.id,
        query: req.query
      });
      res.status(500).json({ error: 'Failed to get consents' });
    }
  }
);

router.put('/consents/:consentId/withdraw',
  async (req, res) => {
    try {
      const { consentId } = req.params;
      const userId = req.user!.id;
      const sessionId = req.sessionID;
      const ipAddress = req.ip;
      const userAgent = req.get('User-Agent');

      await ComplianceValidationService.withdrawConsent(
        consentId,
        userId,
        sessionId,
        ipAddress,
        userAgent
      );

      res.json({ 
        success: true, 
        message: 'Consent withdrawn' 
      });
    } catch (error) {
      logger.error('Failed to withdraw consent', {
        error: error instanceof Error ? error.message : 'Unknown error',
        consentId: req.params.consentId
      });
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to withdraw consent' });
    }
  }
);

// Compliance Reports
router.get('/reports/:framework',
  requirePermission('compliance', 'read'),
  async (req, res) => {
    try {
      const { framework } = req.params;
      const startDate = new Date(req.query.startDate as string);
      const endDate = new Date(req.query.endDate as string);

      const report = await ComplianceValidationService.generateComplianceReport(
        framework as 'GDPR' | 'HIPAA' | 'CCPA',
        startDate,
        endDate
      );

      res.json({ report });
    } catch (error) {
      logger.error('Failed to generate compliance report', {
        error: error instanceof Error ? error.message : 'Unknown error',
        framework: req.params.framework,
        query: req.query
      });
      res.status(500).json({ error: 'Failed to generate compliance report' });
    }
  }
);

// Health Check
router.get('/health',
  async (req, res) => {
    try {
      const auditHealthy = await AuditLoggingService.healthCheck();
      
      res.json({
        status: 'healthy',
        services: {
          auditLogging: auditHealthy ? 'healthy' : 'unhealthy'
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Compliance health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      res.status(500).json({
        status: 'unhealthy',
        error: 'Health check failed'
      });
    }
  }
);

export default router;