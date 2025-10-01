import { DatabaseService } from '../database';
import { logger } from '../../utils/logger';

export interface AuditLogEntry {
  userId?: string;
  sessionId?: string;
  actionType: string;
  resourceType: string;
  resourceId?: string;
  details: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  chainId?: string;
  stepNumber?: number;
  confidenceScore?: number;
  riskLevel?: 'low' | 'medium' | 'high';
  complianceFlags?: Record<string, any>;
}

export interface AuditQuery {
  userId?: string;
  actionType?: string;
  resourceType?: string;
  chainId?: string;
  startDate?: Date;
  endDate?: Date;
  riskLevel?: string;
  limit?: number;
  offset?: number;
}

export class AuditLoggingService {
  /**
   * Log an action to the immutable audit trail
   */
  static async logAction(entry: AuditLogEntry): Promise<string> {
    try {
      const query = `
        INSERT INTO audit_logs (
          user_id, session_id, action_type, resource_type, resource_id,
          details, ip_address, user_agent, chain_id, step_number,
          confidence_score, risk_level, compliance_flags
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id
      `;

      const values = [
        entry.userId || null,
        entry.sessionId || null,
        entry.actionType,
        entry.resourceType,
        entry.resourceId || null,
        JSON.stringify(entry.details),
        entry.ipAddress || null,
        entry.userAgent || null,
        entry.chainId || null,
        entry.stepNumber || null,
        entry.confidenceScore || null,
        entry.riskLevel || null,
        JSON.stringify(entry.complianceFlags || {})
      ];

      const result = await DatabaseService.query(query, values);
      const auditId = result.rows[0].id;

      logger.info('Audit log entry created', {
        auditId,
        actionType: entry.actionType,
        resourceType: entry.resourceType,
        userId: entry.userId,
        chainId: entry.chainId
      });

      return auditId;
    } catch (error) {
      logger.error('Failed to create audit log entry', {
        error: error instanceof Error ? error.message : 'Unknown error',
        entry
      });
      throw new Error('Failed to create audit log entry');
    }
  }

  /**
   * Log agentic workflow chain action
   */
  static async logAgenticAction(
    chainId: string,
    stepNumber: number,
    actionType: string,
    resourceType: string,
    details: Record<string, any>,
    confidenceScore: number,
    riskLevel: 'low' | 'medium' | 'high',
    userId?: string,
    sessionId?: string
  ): Promise<string> {
    return this.logAction({
      userId,
      sessionId,
      actionType: `agentic_${actionType}`,
      resourceType,
      details: {
        ...details,
        isAgenticAction: true,
        chainStep: stepNumber
      },
      chainId,
      stepNumber,
      confidenceScore,
      riskLevel,
      complianceFlags: {
        requiresHumanReview: riskLevel === 'high',
        agenticWorkflow: true
      }
    });
  }

  /**
   * Query audit logs with filtering
   */
  static async queryAuditLogs(query: AuditQuery): Promise<any[]> {
    try {
      let sql = `
        SELECT 
          id, timestamp, user_id, session_id, action_type, resource_type,
          resource_id, details, ip_address, user_agent, chain_id, step_number,
          confidence_score, risk_level, compliance_flags, created_at
        FROM audit_logs
        WHERE 1=1
      `;
      const values: any[] = [];
      let paramCount = 0;

      if (query.userId) {
        sql += ` AND user_id = $${++paramCount}`;
        values.push(query.userId);
      }

      if (query.actionType) {
        sql += ` AND action_type = $${++paramCount}`;
        values.push(query.actionType);
      }

      if (query.resourceType) {
        sql += ` AND resource_type = $${++paramCount}`;
        values.push(query.resourceType);
      }

      if (query.chainId) {
        sql += ` AND chain_id = $${++paramCount}`;
        values.push(query.chainId);
      }

      if (query.riskLevel) {
        sql += ` AND risk_level = $${++paramCount}`;
        values.push(query.riskLevel);
      }

      if (query.startDate) {
        sql += ` AND timestamp >= $${++paramCount}`;
        values.push(query.startDate);
      }

      if (query.endDate) {
        sql += ` AND timestamp <= $${++paramCount}`;
        values.push(query.endDate);
      }

      sql += ` ORDER BY timestamp DESC`;

      if (query.limit) {
        sql += ` LIMIT $${++paramCount}`;
        values.push(query.limit);
      }

      if (query.offset) {
        sql += ` OFFSET $${++paramCount}`;
        values.push(query.offset);
      }

      const result = await DatabaseService.query(sql, values);
      return result.rows;
    } catch (error) {
      logger.error('Failed to query audit logs', {
        error: error instanceof Error ? error.message : 'Unknown error',
        query
      });
      throw new Error('Failed to query audit logs');
    }
  }

  /**
   * Get audit trail for a specific agentic workflow chain
   */
  static async getChainAuditTrail(chainId: string): Promise<any[]> {
    try {
      const query = `
        SELECT 
          id, timestamp, action_type, resource_type, resource_id,
          details, step_number, confidence_score, risk_level,
          compliance_flags, created_at
        FROM audit_logs
        WHERE chain_id = $1
        ORDER BY step_number ASC, timestamp ASC
      `;

      const result = await DatabaseService.query(query, [chainId]);
      return result.rows;
    } catch (error) {
      logger.error('Failed to get chain audit trail', {
        error: error instanceof Error ? error.message : 'Unknown error',
        chainId
      });
      throw new Error('Failed to get chain audit trail');
    }
  }

  /**
   * Get compliance summary for a user
   */
  static async getComplianceSummary(userId: string, days: number = 30): Promise<any> {
    try {
      const query = `
        SELECT 
          COUNT(*) as total_actions,
          COUNT(CASE WHEN risk_level = 'high' THEN 1 END) as high_risk_actions,
          COUNT(CASE WHEN chain_id IS NOT NULL THEN 1 END) as agentic_actions,
          COUNT(DISTINCT chain_id) as unique_chains,
          AVG(confidence_score) as avg_confidence
        FROM audit_logs
        WHERE user_id = $1 
          AND timestamp >= NOW() - INTERVAL '${days} days'
      `;

      const result = await DatabaseService.query(query, [userId]);
      return result.rows[0];
    } catch (error) {
      logger.error('Failed to get compliance summary', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        days
      });
      throw new Error('Failed to get compliance summary');
    }
  }

  /**
   * Check if audit logging is healthy
   */
  static async healthCheck(): Promise<boolean> {
    try {
      // Test basic audit log insertion
      const testEntry: AuditLogEntry = {
        actionType: 'health_check',
        resourceType: 'system',
        details: { test: true, timestamp: new Date().toISOString() }
      };

      await this.logAction(testEntry);
      return true;
    } catch (error) {
      logger.error('Audit logging health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }
}