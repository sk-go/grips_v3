import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { SecurityMonitoringService } from '../services/security/securityMonitoringService';
import { ErrorHandlingService } from '../services/errorHandlingService';
import { DatabaseService } from '../services/database';
import { logger } from '../utils/logger';

const router = Router();

// All security routes require authentication and admin privileges
router.use(authenticateToken);
router.use((req: Request, res: Response, next): void => {
  if (req.user?.role !== 'admin') {
    const errorResponse = ErrorHandlingService.createErrorResponse(
      'Access denied. Admin privileges required.',
      'INSUFFICIENT_PRIVILEGES'
    );
    res.status(403).json(errorResponse);
    return;
  }
  next();
});

// Get security dashboard data
router.get('/dashboard', asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await DatabaseService.query('SELECT get_security_dashboard_data() as data');
    const dashboardData = result.rows[0]?.data || {};

    return res.json({
      success: true,
      data: dashboardData
    });
  } catch (error: any) {
    logger.error('Failed to get security dashboard data', {
      adminId: req.user!.id,
      error: error.message
    });

    const errorResponse = ErrorHandlingService.createErrorResponse(
      'Failed to retrieve security dashboard data',
      'DASHBOARD_FAILED'
    );
    return res.status(500).json(errorResponse);
  }
}));

// Get security alerts with filtering
router.get('/alerts', asyncHandler(async (req: Request, res: Response) => {
  try {
    const filters = {
      type: req.query.type as string,
      severity: req.query.severity as string,
      resolved: req.query.resolved === 'true' ? true : req.query.resolved === 'false' ? false : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0
    };

    const alerts = await SecurityMonitoringService.getSecurityAlerts(filters);

    return res.json({
      success: true,
      alerts,
      count: alerts.length,
      filters
    });
  } catch (error: any) {
    logger.error('Failed to get security alerts', {
      adminId: req.user!.id,
      error: error.message
    });

    const errorResponse = ErrorHandlingService.createErrorResponse(
      'Failed to retrieve security alerts',
      'ALERTS_RETRIEVAL_FAILED'
    );
    return res.status(500).json(errorResponse);
  }
}));

// Resolve a security alert
router.post('/alerts/:alertId/resolve', asyncHandler(async (req: Request, res: Response) => {
  const { alertId } = req.params;
  const { notes } = req.body;

  try {
    const success = await SecurityMonitoringService.resolveAlert(
      alertId,
      req.user!.id,
      notes
    );

    if (success) {
      return res.json({
        success: true,
        message: 'Security alert resolved successfully'
      });
    } else {
      const errorResponse = ErrorHandlingService.createErrorResponse(
        'Failed to resolve security alert',
        'ALERT_RESOLUTION_FAILED'
      );
      return res.status(400).json(errorResponse);
    }
  } catch (error: any) {
    logger.error('Failed to resolve security alert', {
      alertId,
      adminId: req.user!.id,
      error: error.message
    });

    const errorResponse = ErrorHandlingService.createErrorResponse(
      'Failed to resolve security alert',
      'ALERT_RESOLUTION_FAILED'
    );
    return res.status(500).json(errorResponse);
  }
}));

// Get IP reputation information
router.get('/ip-reputation/:ipAddress', asyncHandler(async (req: Request, res: Response) => {
  const { ipAddress } = req.params;

  try {
    // Validate IP address format
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (!ipRegex.test(ipAddress)) {
      const errorResponse = ErrorHandlingService.createErrorResponse(
        'Invalid IP address format',
        'INVALID_IP_ADDRESS'
      );
      return res.status(400).json(errorResponse);
    }

    const reputationScore = await SecurityMonitoringService.checkIPReputation(ipAddress);

    // Get cached reputation data if available
    const result = await DatabaseService.query(
      'SELECT * FROM ip_reputation_cache WHERE ip_address = $1',
      [ipAddress]
    );

    const reputationData = result.rows[0] ? {
      ipAddress: result.rows[0].ip_address,
      reputation: result.rows[0].reputation,
      score: result.rows[0].score,
      sources: result.rows[0].sources,
      lastChecked: result.rows[0].last_checked,
      metadata: result.rows[0].metadata
    } : null;

    return res.json({
      success: true,
      ipAddress,
      reputationScore,
      reputationData
    });
  } catch (error: any) {
    logger.error('Failed to get IP reputation', {
      ipAddress,
      adminId: req.user!.id,
      error: error.message
    });

    const errorResponse = ErrorHandlingService.createErrorResponse(
      'Failed to retrieve IP reputation',
      'IP_REPUTATION_FAILED'
    );
    return res.status(500).json(errorResponse);
  }
}));

// Get registration patterns
router.get('/registration-patterns', asyncHandler(async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const flaggedOnly = req.query.flagged === 'true';

    let query = `
      SELECT 
        ip_address,
        email_pattern,
        registration_count,
        time_window_minutes,
        first_seen,
        last_seen,
        suspicious_score,
        flagged
      FROM registration_patterns
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (flaggedOnly) {
      query += ` WHERE flagged = true`;
    }

    query += ` ORDER BY suspicious_score DESC, last_seen DESC`;
    query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const result = await DatabaseService.query(query, params);

    const patterns = result.rows.map(row => ({
      ipAddress: row.ip_address,
      emailPattern: row.email_pattern,
      registrationCount: row.registration_count,
      timeWindowMinutes: row.time_window_minutes,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      suspiciousScore: row.suspicious_score,
      flagged: row.flagged
    }));

    return res.json({
      success: true,
      patterns,
      count: patterns.length,
      limit,
      offset
    });
  } catch (error: any) {
    logger.error('Failed to get registration patterns', {
      adminId: req.user!.id,
      error: error.message
    });

    const errorResponse = ErrorHandlingService.createErrorResponse(
      'Failed to retrieve registration patterns',
      'PATTERNS_RETRIEVAL_FAILED'
    );
    return res.status(500).json(errorResponse);
  }
}));

// Get security statistics
router.get('/statistics', asyncHandler(async (req: Request, res: Response) => {
  try {
    const timeWindow = req.query.timeWindow as string || '7d';
    
    let interval: string;
    switch (timeWindow) {
      case '24h':
        interval = '24 hours';
        break;
      case '7d':
        interval = '7 days';
        break;
      case '30d':
        interval = '30 days';
        break;
      default:
        interval = '7 days';
    }

    const result = await DatabaseService.query(`
      SELECT 
        type,
        severity,
        COUNT(*) as count,
        COUNT(*) FILTER (WHERE resolved = false) as unresolved_count
      FROM security_alerts 
      WHERE timestamp >= CURRENT_TIMESTAMP - INTERVAL '${interval}'
      GROUP BY type, severity
      ORDER BY count DESC
    `);

    const statistics = result.rows.map(row => ({
      type: row.type,
      severity: row.severity,
      count: parseInt(row.count),
      unresolvedCount: parseInt(row.unresolved_count)
    }));

    return res.json({
      success: true,
      timeWindow,
      statistics
    });
  } catch (error: any) {
    logger.error('Failed to get security statistics', {
      adminId: req.user!.id,
      error: error.message
    });

    const errorResponse = ErrorHandlingService.createErrorResponse(
      'Failed to retrieve security statistics',
      'STATISTICS_RETRIEVAL_FAILED'
    );
    return res.status(500).json(errorResponse);
  }
}));

// Manual security cleanup
router.post('/cleanup', asyncHandler(async (req: Request, res: Response) => {
  try {
    await DatabaseService.query('SELECT cleanup_security_data()');

    logger.info('Manual security cleanup executed', {
      adminId: req.user!.id
    });

    return res.json({
      success: true,
      message: 'Security data cleanup completed successfully'
    });
  } catch (error: any) {
    logger.error('Failed to execute security cleanup', {
      adminId: req.user!.id,
      error: error.message
    });

    const errorResponse = ErrorHandlingService.createErrorResponse(
      'Failed to execute security cleanup',
      'CLEANUP_FAILED'
    );
    return res.status(500).json(errorResponse);
  }
}));

export default router;