import { DatabaseService } from '../database';
import { logger } from '../../utils/logger';
import { AuditLoggingService } from './auditLoggingService';

export interface ComplianceConsent {
  id: string;
  userId?: string;
  clientId?: string;
  consentType: string;
  complianceFramework: 'GDPR' | 'HIPAA' | 'CCPA';
  granted: boolean;
  consentText: string;
  ipAddress?: string;
  userAgent?: string;
  expiresAt?: Date;
  withdrawnAt?: Date;
  createdAt: Date;
}

export interface ComplianceValidationResult {
  isCompliant: boolean;
  framework: string;
  violations: string[];
  recommendations: string[];
  consentRequired: boolean;
  dataRetentionDays?: number;
}

export interface DataProcessingRecord {
  purpose: string;
  dataTypes: string[];
  legalBasis: string;
  retentionPeriod: number;
  recipients?: string[];
  transferredOutsideEU?: boolean;
}

export class ComplianceValidationService {
  private static readonly GDPR_RETENTION_LIMITS = {
    'personal_data': 2555, // 7 years
    'financial_data': 2555, // 7 years
    'communication_data': 1095, // 3 years
    'marketing_data': 365, // 1 year
    'session_data': 30 // 30 days
  };

  private static readonly HIPAA_RETENTION_LIMITS = {
    'health_records': 2190, // 6 years minimum
    'insurance_records': 2555, // 7 years
    'communication_health': 2190, // 6 years
    'audit_logs': 2190 // 6 years
  };

  /**
   * Validate GDPR compliance for data processing
   */
  static async validateGDPRCompliance(
    dataProcessing: DataProcessingRecord,
    userId?: string,
    clientId?: string
  ): Promise<ComplianceValidationResult> {
    try {
      const violations: string[] = [];
      const recommendations: string[] = [];
      let consentRequired = false;

      // Check legal basis
      const validLegalBases = [
        'consent',
        'contract',
        'legal_obligation',
        'vital_interests',
        'public_task',
        'legitimate_interests'
      ];

      if (!validLegalBases.includes(dataProcessing.legalBasis)) {
        violations.push('Invalid or missing legal basis for data processing');
      }

      // Check if consent is required
      if (dataProcessing.legalBasis === 'consent') {
        consentRequired = true;
        
        // Verify consent exists
        if (userId || clientId) {
          const hasConsent = await this.hasValidConsent(
            dataProcessing.purpose,
            'GDPR',
            userId,
            clientId
          );
          
          if (!hasConsent) {
            violations.push('Required consent not found or expired');
          }
        }
      }

      // Check data retention limits
      const maxRetention = Math.max(
        ...dataProcessing.dataTypes.map(type => 
          this.GDPR_RETENTION_LIMITS[type as keyof typeof this.GDPR_RETENTION_LIMITS] || 365
        )
      );

      if (dataProcessing.retentionPeriod > maxRetention) {
        violations.push(`Retention period exceeds GDPR limits (max: ${maxRetention} days)`);
      }

      // Check for international transfers
      if (dataProcessing.transferredOutsideEU) {
        recommendations.push('Ensure adequate safeguards for international data transfers');
      }

      // Check data minimization
      if (dataProcessing.dataTypes.length > 5) {
        recommendations.push('Consider data minimization - only collect necessary data');
      }

      const isCompliant = violations.length === 0;

      // Log compliance check
      await AuditLoggingService.logAction({
        userId,
        actionType: 'gdpr_compliance_check',
        resourceType: 'compliance',
        details: {
          purpose: dataProcessing.purpose,
          legalBasis: dataProcessing.legalBasis,
          isCompliant,
          violationCount: violations.length,
          clientId
        },
        riskLevel: isCompliant ? 'low' : 'high'
      });

      return {
        isCompliant,
        framework: 'GDPR',
        violations,
        recommendations,
        consentRequired,
        dataRetentionDays: maxRetention
      };
    } catch (error) {
      logger.error('Failed to validate GDPR compliance', {
        error: error instanceof Error ? error.message : 'Unknown error',
        dataProcessing,
        userId,
        clientId
      });
      throw new Error('Failed to validate GDPR compliance');
    }
  }

  /**
   * Validate HIPAA compliance for health data processing
   */
  static async validateHIPAACompliance(
    dataProcessing: DataProcessingRecord,
    userId?: string,
    clientId?: string
  ): Promise<ComplianceValidationResult> {
    try {
      const violations: string[] = [];
      const recommendations: string[] = [];
      let consentRequired = false;

      // Check if health data is involved
      const healthDataTypes = ['health_records', 'medical_info', 'insurance_records'];
      const hasHealthData = dataProcessing.dataTypes.some(type => 
        healthDataTypes.includes(type)
      );

      if (hasHealthData) {
        // HIPAA requires authorization for most uses
        consentRequired = true;
        
        if (userId || clientId) {
          const hasConsent = await this.hasValidConsent(
            dataProcessing.purpose,
            'HIPAA',
            userId,
            clientId
          );
          
          if (!hasConsent) {
            violations.push('HIPAA authorization required for health data processing');
          }
        }

        // Check minimum necessary standard
        if (dataProcessing.dataTypes.length > 3) {
          recommendations.push('Apply minimum necessary standard - limit health data collection');
        }

        // Check retention limits
        const maxRetention = Math.max(
          ...dataProcessing.dataTypes.map(type => 
            this.HIPAA_RETENTION_LIMITS[type as keyof typeof this.HIPAA_RETENTION_LIMITS] || 2190
          )
        );

        if (dataProcessing.retentionPeriod > maxRetention) {
          violations.push(`Retention period exceeds HIPAA requirements (max: ${maxRetention} days)`);
        }

        // Check for business associate agreements
        if (dataProcessing.recipients && dataProcessing.recipients.length > 0) {
          recommendations.push('Ensure Business Associate Agreements are in place for data sharing');
        }
      }

      const isCompliant = violations.length === 0;

      // Log compliance check
      await AuditLoggingService.logAction({
        userId,
        actionType: 'hipaa_compliance_check',
        resourceType: 'compliance',
        details: {
          purpose: dataProcessing.purpose,
          hasHealthData,
          isCompliant,
          violationCount: violations.length,
          clientId
        },
        riskLevel: isCompliant ? 'low' : 'high'
      });

      return {
        isCompliant,
        framework: 'HIPAA',
        violations,
        recommendations,
        consentRequired,
        dataRetentionDays: this.HIPAA_RETENTION_LIMITS.health_records
      };
    } catch (error) {
      logger.error('Failed to validate HIPAA compliance', {
        error: error instanceof Error ? error.message : 'Unknown error',
        dataProcessing,
        userId,
        clientId
      });
      throw new Error('Failed to validate HIPAA compliance');
    }
  }

  /**
   * Record consent for data processing
   */
  static async recordConsent(
    consentType: string,
    complianceFramework: 'GDPR' | 'HIPAA' | 'CCPA',
    granted: boolean,
    consentText: string,
    userId?: string,
    clientId?: string,
    ipAddress?: string,
    userAgent?: string,
    expiresAt?: Date
  ): Promise<string> {
    try {
      const query = `
        INSERT INTO compliance_consents (
          user_id, client_id, consent_type, compliance_framework,
          granted, consent_text, ip_address, user_agent, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `;

      const values = [
        userId || null,
        clientId || null,
        consentType,
        complianceFramework,
        granted,
        consentText,
        ipAddress || null,
        userAgent || null,
        expiresAt || null
      ];

      const result = await DatabaseService.query(query, values);
      const consentId = result.rows[0].id;

      // Log consent recording
      await AuditLoggingService.logAction({
        userId,
        actionType: 'consent_recorded',
        resourceType: 'compliance',
        resourceId: consentId,
        details: {
          consentType,
          complianceFramework,
          granted,
          clientId,
          expiresAt: expiresAt?.toISOString()
        },
        ipAddress,
        userAgent,
        riskLevel: 'medium'
      });

      logger.info('Consent recorded', {
        consentId,
        consentType,
        complianceFramework,
        granted,
        userId,
        clientId
      });

      return consentId;
    } catch (error) {
      logger.error('Failed to record consent', {
        error: error instanceof Error ? error.message : 'Unknown error',
        consentType,
        complianceFramework,
        userId,
        clientId
      });
      throw new Error('Failed to record consent');
    }
  }

  /**
   * Withdraw consent
   */
  static async withdrawConsent(
    consentId: string,
    userId?: string,
    sessionId?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    try {
      const query = `
        UPDATE compliance_consents 
        SET withdrawn_at = NOW()
        WHERE id = $1 AND withdrawn_at IS NULL
        RETURNING consent_type, compliance_framework
      `;

      const result = await DatabaseService.query(query, [consentId]);
      
      if (result.rows.length === 0) {
        throw new Error('Consent not found or already withdrawn');
      }

      const { consent_type, compliance_framework } = result.rows[0];

      // Log consent withdrawal
      await AuditLoggingService.logAction({
        userId,
        sessionId,
        actionType: 'consent_withdrawn',
        resourceType: 'compliance',
        resourceId: consentId,
        details: {
          consentType: consent_type,
          complianceFramework: compliance_framework
        },
        ipAddress,
        userAgent,
        riskLevel: 'medium'
      });

      logger.info('Consent withdrawn', {
        consentId,
        consentType: consent_type,
        complianceFramework: compliance_framework,
        userId
      });
    } catch (error) {
      logger.error('Failed to withdraw consent', {
        error: error instanceof Error ? error.message : 'Unknown error',
        consentId,
        userId
      });
      throw error;
    }
  }

  /**
   * Check if valid consent exists
   */
  static async hasValidConsent(
    consentType: string,
    complianceFramework: 'GDPR' | 'HIPAA' | 'CCPA',
    userId?: string,
    clientId?: string
  ): Promise<boolean> {
    try {
      const query = `
        SELECT id FROM compliance_consents
        WHERE consent_type = $1 
          AND compliance_framework = $2
          AND granted = true
          AND withdrawn_at IS NULL
          AND (expires_at IS NULL OR expires_at > NOW())
          AND ($3::uuid IS NULL OR user_id = $3)
          AND ($4::text IS NULL OR client_id = $4)
        LIMIT 1
      `;

      const result = await DatabaseService.query(query, [
        consentType,
        complianceFramework,
        userId || null,
        clientId || null
      ]);

      return result.rows.length > 0;
    } catch (error) {
      logger.error('Failed to check consent', {
        error: error instanceof Error ? error.message : 'Unknown error',
        consentType,
        complianceFramework,
        userId,
        clientId
      });
      return false;
    }
  }

  /**
   * Get all consents for a user or client
   */
  static async getConsents(
    userId?: string,
    clientId?: string
  ): Promise<ComplianceConsent[]> {
    try {
      const query = `
        SELECT id, user_id, client_id, consent_type, compliance_framework,
               granted, consent_text, ip_address, user_agent, expires_at,
               withdrawn_at, created_at
        FROM compliance_consents
        WHERE ($1::uuid IS NULL OR user_id = $1)
          AND ($2::text IS NULL OR client_id = $2)
        ORDER BY created_at DESC
      `;

      const result = await DatabaseService.query(query, [
        userId || null,
        clientId || null
      ]);

      return result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        clientId: row.client_id,
        consentType: row.consent_type,
        complianceFramework: row.compliance_framework,
        granted: row.granted,
        consentText: row.consent_text,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        expiresAt: row.expires_at,
        withdrawnAt: row.withdrawn_at,
        createdAt: row.created_at
      }));
    } catch (error) {
      logger.error('Failed to get consents', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        clientId
      });
      throw new Error('Failed to get consents');
    }
  }

  /**
   * Generate compliance report
   */
  static async generateComplianceReport(
    framework: 'GDPR' | 'HIPAA' | 'CCPA',
    startDate: Date,
    endDate: Date
  ): Promise<any> {
    try {
      const consentQuery = `
        SELECT 
          COUNT(*) as total_consents,
          COUNT(CASE WHEN granted = true THEN 1 END) as granted_consents,
          COUNT(CASE WHEN withdrawn_at IS NOT NULL THEN 1 END) as withdrawn_consents,
          COUNT(CASE WHEN expires_at < NOW() THEN 1 END) as expired_consents
        FROM compliance_consents
        WHERE compliance_framework = $1
          AND created_at BETWEEN $2 AND $3
      `;

      const incidentQuery = `
        SELECT 
          COUNT(*) as total_incidents,
          COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_incidents,
          COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_incidents
        FROM compliance_incidents
        WHERE created_at BETWEEN $1 AND $2
      `;

      const auditQuery = `
        SELECT COUNT(*) as total_actions
        FROM audit_logs
        WHERE timestamp BETWEEN $1 AND $2
          AND compliance_flags ? 'complianceFramework'
          AND compliance_flags->>'complianceFramework' = $3
      `;

      const [consentResult, incidentResult, auditResult] = await Promise.all([
        DatabaseService.query(consentQuery, [framework, startDate, endDate]),
        DatabaseService.query(incidentQuery, [startDate, endDate]),
        DatabaseService.query(auditQuery, [startDate, endDate, framework])
      ]);

      const report = {
        framework,
        reportPeriod: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        },
        consents: consentResult.rows[0],
        incidents: incidentResult.rows[0],
        auditActions: auditResult.rows[0],
        generatedAt: new Date().toISOString()
      };

      // Log report generation
      await AuditLoggingService.logAction({
        actionType: 'compliance_report_generated',
        resourceType: 'compliance',
        details: {
          framework,
          reportPeriod: report.reportPeriod,
          summary: {
            totalConsents: report.consents.total_consents,
            totalIncidents: report.incidents.total_incidents,
            totalAuditActions: report.auditActions.total_actions
          }
        },
        riskLevel: 'low'
      });

      return report;
    } catch (error) {
      logger.error('Failed to generate compliance report', {
        error: error instanceof Error ? error.message : 'Unknown error',
        framework,
        startDate,
        endDate
      });
      throw new Error('Failed to generate compliance report');
    }
  }

  /**
   * Clean up expired consents
   */
  static async cleanupExpiredConsents(): Promise<number> {
    try {
      const query = `
        UPDATE compliance_consents 
        SET withdrawn_at = NOW()
        WHERE expires_at < NOW() 
          AND withdrawn_at IS NULL
        RETURNING id, consent_type, compliance_framework
      `;

      const result = await DatabaseService.query(query);
      const expiredCount = result.rows.length;

      if (expiredCount > 0) {
        await AuditLoggingService.logAction({
          actionType: 'consents_expired',
          resourceType: 'compliance',
          details: {
            expiredCount,
            expiredConsents: result.rows.map(r => ({
              id: r.id,
              type: r.consent_type,
              framework: r.compliance_framework
            }))
          },
          riskLevel: 'low'
        });

        logger.info('Expired consents cleaned up', { expiredCount });
      }

      return expiredCount;
    } catch (error) {
      logger.error('Failed to cleanup expired consents', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Failed to cleanup expired consents');
    }
  }
}