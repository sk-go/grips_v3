import { DatabaseService } from '../database';
import { logger } from '../../utils/logger';
import { AuditLoggingService } from './auditLoggingService';

export interface SensitiveDataPattern {
  id: string;
  name: string;
  pattern: string;
  dataType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  complianceType: string;
  isActive: boolean;
}

export interface SensitiveDataMatch {
  pattern: SensitiveDataPattern;
  matches: string[];
  sanitizedContent: string;
}

export interface ComplianceIncident {
  id: string;
  incidentType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  detectedData: string;
  userId?: string;
  sessionId?: string;
  chainId?: string;
  actionTaken: string;
  status: 'open' | 'investigating' | 'resolved' | 'false_positive';
  createdAt: Date;
}

export class SensitiveDataService {
  private static patterns: SensitiveDataPattern[] = [];
  private static lastPatternLoad: Date | null = null;
  private static readonly PATTERN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Scan content for sensitive data patterns
   */
  static async scanContent(
    content: string,
    userId?: string,
    sessionId?: string,
    chainId?: string
  ): Promise<SensitiveDataMatch[]> {
    try {
      await this.loadPatterns();
      const matches: SensitiveDataMatch[] = [];

      for (const pattern of this.patterns) {
        if (!pattern.isActive) continue;

        const regex = new RegExp(pattern.pattern, 'gi');
        const foundMatches = content.match(regex);

        if (foundMatches && foundMatches.length > 0) {
          // Create sanitized version
          const sanitizedContent = content.replace(regex, '[REDACTED]');

          matches.push({
            pattern,
            matches: foundMatches,
            sanitizedContent
          });

          // Log compliance incident for high/critical severity
          if (pattern.severity === 'high' || pattern.severity === 'critical') {
            await this.createComplianceIncident({
              incidentType: 'sensitive_data_detected',
              severity: pattern.severity,
              description: `Detected ${pattern.dataType} in content`,
              detectedData: this.sanitizeForLogging(foundMatches),
              userId,
              sessionId,
              chainId,
              actionTaken: pattern.severity === 'critical' ? 'halt_chain' : 'flag_for_review'
            });
          }
        }
      }

      // Log scan results
      if (matches.length > 0) {
        await AuditLoggingService.logAction({
          userId,
          sessionId,
          actionType: 'sensitive_data_scan',
          resourceType: 'compliance',
          details: {
            matchCount: matches.length,
            patterns: matches.map(m => ({
              type: m.pattern.dataType,
              severity: m.pattern.severity,
              matchCount: m.matches.length
            })),
            chainId
          },
          chainId,
          riskLevel: matches.some(m => m.pattern.severity === 'critical') ? 'high' : 'medium'
        });
      }

      return matches;
    } catch (error) {
      logger.error('Failed to scan content for sensitive data', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        sessionId,
        chainId
      });
      throw new Error('Failed to scan content for sensitive data');
    }
  }

  /**
   * Check if content should halt agentic chain execution
   */
  static async shouldHaltChain(
    content: string,
    userId?: string,
    sessionId?: string,
    chainId?: string
  ): Promise<{ shouldHalt: boolean; reason?: string; matches?: SensitiveDataMatch[] }> {
    try {
      const matches = await this.scanContent(content, userId, sessionId, chainId);
      
      // Halt chain if any critical severity patterns are found
      const criticalMatches = matches.filter(m => m.pattern.severity === 'critical');
      
      if (criticalMatches.length > 0) {
        const reason = `Critical sensitive data detected: ${criticalMatches.map(m => m.pattern.dataType).join(', ')}`;
        
        await AuditLoggingService.logAction({
          userId,
          sessionId,
          actionType: 'agentic_chain_halted',
          resourceType: 'compliance',
          details: {
            reason,
            criticalPatterns: criticalMatches.map(m => m.pattern.dataType),
            chainId
          },
          chainId,
          riskLevel: 'high'
        });

        return {
          shouldHalt: true,
          reason,
          matches: criticalMatches
        };
      }

      return {
        shouldHalt: false,
        matches
      };
    } catch (error) {
      logger.error('Failed to check chain halt condition', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        sessionId,
        chainId
      });
      
      // Err on the side of caution - halt chain on error
      return {
        shouldHalt: true,
        reason: 'Error during sensitive data scan'
      };
    }
  }

  /**
   * Create compliance incident
   */
  static async createComplianceIncident(incident: Omit<ComplianceIncident, 'id' | 'status' | 'createdAt'>): Promise<string> {
    try {
      const query = `
        INSERT INTO compliance_incidents (
          incident_type, severity, description, detected_data,
          user_id, session_id, chain_id, action_taken, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open')
        RETURNING id
      `;

      const values = [
        incident.incidentType,
        incident.severity,
        incident.description,
        incident.detectedData,
        incident.userId || null,
        incident.sessionId || null,
        incident.chainId || null,
        incident.actionTaken
      ];

      const result = await DatabaseService.query(query, values);
      const incidentId = result.rows[0].id;

      // Log incident creation
      await AuditLoggingService.logAction({
        userId: incident.userId,
        sessionId: incident.sessionId,
        actionType: 'compliance_incident_created',
        resourceType: 'compliance',
        resourceId: incidentId,
        details: {
          incidentType: incident.incidentType,
          severity: incident.severity,
          actionTaken: incident.actionTaken
        },
        chainId: incident.chainId,
        riskLevel: incident.severity === 'critical' ? 'high' : 'medium'
      });

      logger.warn('Compliance incident created', {
        incidentId,
        type: incident.incidentType,
        severity: incident.severity,
        userId: incident.userId,
        chainId: incident.chainId
      });

      return incidentId;
    } catch (error) {
      logger.error('Failed to create compliance incident', {
        error: error instanceof Error ? error.message : 'Unknown error',
        incident
      });
      throw new Error('Failed to create compliance incident');
    }
  }

  /**
   * Get compliance incidents
   */
  static async getComplianceIncidents(
    filters: {
      severity?: string;
      status?: string;
      userId?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<ComplianceIncident[]> {
    try {
      let query = `
        SELECT id, incident_type, severity, description, detected_data,
               user_id, session_id, chain_id, action_taken, status,
               created_at, updated_at
        FROM compliance_incidents
        WHERE 1=1
      `;
      const values: any[] = [];
      let paramCount = 0;

      if (filters.severity) {
        query += ` AND severity = $${++paramCount}`;
        values.push(filters.severity);
      }

      if (filters.status) {
        query += ` AND status = $${++paramCount}`;
        values.push(filters.status);
      }

      if (filters.userId) {
        query += ` AND user_id = $${++paramCount}`;
        values.push(filters.userId);
      }

      if (filters.startDate) {
        query += ` AND created_at >= $${++paramCount}`;
        values.push(filters.startDate);
      }

      if (filters.endDate) {
        query += ` AND created_at <= $${++paramCount}`;
        values.push(filters.endDate);
      }

      query += ` ORDER BY created_at DESC`;

      if (filters.limit) {
        query += ` LIMIT $${++paramCount}`;
        values.push(filters.limit);
      }

      if (filters.offset) {
        query += ` OFFSET $${++paramCount}`;
        values.push(filters.offset);
      }

      const result = await DatabaseService.query(query, values);
      return result.rows.map(row => ({
        id: row.id,
        incidentType: row.incident_type,
        severity: row.severity,
        description: row.description,
        detectedData: row.detected_data,
        userId: row.user_id,
        sessionId: row.session_id,
        chainId: row.chain_id,
        actionTaken: row.action_taken,
        status: row.status,
        createdAt: row.created_at
      }));
    } catch (error) {
      logger.error('Failed to get compliance incidents', {
        error: error instanceof Error ? error.message : 'Unknown error',
        filters
      });
      throw new Error('Failed to get compliance incidents');
    }
  }

  /**
   * Resolve compliance incident
   */
  static async resolveIncident(
    incidentId: string,
    resolvedBy: string,
    status: 'resolved' | 'false_positive',
    sessionId?: string
  ): Promise<void> {
    try {
      const query = `
        UPDATE compliance_incidents 
        SET status = $1, resolved_by = $2, resolved_at = NOW(), updated_at = NOW()
        WHERE id = $3
      `;

      await DatabaseService.query(query, [status, resolvedBy, incidentId]);

      await AuditLoggingService.logAction({
        userId: resolvedBy,
        sessionId,
        actionType: 'compliance_incident_resolved',
        resourceType: 'compliance',
        resourceId: incidentId,
        details: {
          resolution: status
        },
        riskLevel: 'low'
      });

      logger.info('Compliance incident resolved', {
        incidentId,
        status,
        resolvedBy
      });
    } catch (error) {
      logger.error('Failed to resolve compliance incident', {
        error: error instanceof Error ? error.message : 'Unknown error',
        incidentId,
        resolvedBy,
        status
      });
      throw new Error('Failed to resolve compliance incident');
    }
  }

  /**
   * Add new sensitive data pattern
   */
  static async addPattern(
    pattern: Omit<SensitiveDataPattern, 'id'>,
    createdBy: string,
    sessionId?: string
  ): Promise<string> {
    try {
      // Validate regex pattern
      try {
        new RegExp(pattern.pattern);
      } catch (regexError) {
        throw new Error('Invalid regex pattern');
      }

      const query = `
        INSERT INTO sensitive_data_patterns (
          name, pattern, data_type, severity, compliance_type, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `;

      const result = await DatabaseService.query(query, [
        pattern.name,
        pattern.pattern,
        pattern.dataType,
        pattern.severity,
        pattern.complianceType,
        pattern.isActive
      ]);

      const patternId = result.rows[0].id;

      // Clear pattern cache
      this.patterns = [];
      this.lastPatternLoad = null;

      await AuditLoggingService.logAction({
        userId: createdBy,
        sessionId,
        actionType: 'sensitive_pattern_added',
        resourceType: 'compliance',
        resourceId: patternId,
        details: {
          name: pattern.name,
          dataType: pattern.dataType,
          severity: pattern.severity
        },
        riskLevel: 'medium'
      });

      logger.info('Sensitive data pattern added', {
        patternId,
        name: pattern.name,
        createdBy
      });

      return patternId;
    } catch (error) {
      logger.error('Failed to add sensitive data pattern', {
        error: error instanceof Error ? error.message : 'Unknown error',
        pattern,
        createdBy
      });
      throw error;
    }
  }

  /**
   * Load patterns from database with caching
   */
  private static async loadPatterns(): Promise<void> {
    const now = new Date();
    
    if (this.lastPatternLoad && 
        (now.getTime() - this.lastPatternLoad.getTime()) < this.PATTERN_CACHE_TTL) {
      return; // Use cached patterns
    }

    try {
      const query = `
        SELECT id, name, pattern, data_type, severity, compliance_type, is_active
        FROM sensitive_data_patterns
        WHERE is_active = true
        ORDER BY severity DESC, name ASC
      `;

      const result = await DatabaseService.query(query);
      this.patterns = result.rows.map(row => ({
        id: row.id,
        name: row.name,
        pattern: row.pattern,
        dataType: row.data_type,
        severity: row.severity,
        complianceType: row.compliance_type,
        isActive: row.is_active
      }));

      this.lastPatternLoad = now;
      
      logger.debug('Sensitive data patterns loaded', {
        patternCount: this.patterns.length
      });
    } catch (error) {
      logger.error('Failed to load sensitive data patterns', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Failed to load sensitive data patterns');
    }
  }

  /**
   * Sanitize sensitive data for logging
   */
  private static sanitizeForLogging(matches: string[]): string {
    return matches.map(match => {
      if (match.length <= 4) {
        return '[REDACTED]';
      }
      // Show first and last 2 characters with asterisks in between
      return match.substring(0, 2) + '*'.repeat(match.length - 4) + match.substring(match.length - 2);
    }).join(', ');
  }

  /**
   * Get compliance statistics
   */
  static async getComplianceStats(days: number = 30): Promise<any> {
    try {
      const query = `
        SELECT 
          COUNT(*) as total_incidents,
          COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_incidents,
          COUNT(CASE WHEN severity = 'high' THEN 1 END) as high_incidents,
          COUNT(CASE WHEN status = 'open' THEN 1 END) as open_incidents,
          COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_incidents
        FROM compliance_incidents
        WHERE created_at >= NOW() - INTERVAL '${days} days'
      `;

      const result = await DatabaseService.query(query);
      return result.rows[0];
    } catch (error) {
      logger.error('Failed to get compliance statistics', {
        error: error instanceof Error ? error.message : 'Unknown error',
        days
      });
      throw new Error('Failed to get compliance statistics');
    }
  }
}