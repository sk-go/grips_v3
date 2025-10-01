import { Request, Response, NextFunction } from 'express';
import { loggingService } from './loggingService';

export interface ErrorReport {
  id: string;
  timestamp: Date;
  message: string;
  stack?: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  context: {
    correlationId?: string;
    userId?: string;
    sessionId?: string;
    url?: string;
    method?: string;
    userAgent?: string;
    ip?: string;
    component?: string;
    action?: string;
    metadata?: Record<string, any>;
  };
  fingerprint: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  resolved: boolean;
  tags: string[];
}

export interface ErrorStats {
  totalErrors: number;
  errorsByType: Record<string, number>;
  errorsBySeverity: Record<string, number>;
  errorsByComponent: Record<string, number>;
  errorRate: number;
  topErrors: ErrorReport[];
  recentErrors: ErrorReport[];
}

class ErrorTrackingService {
  private errors: Map<string, ErrorReport> = new Map();
  private errorHistory: ErrorReport[] = [];
  private maxHistorySize = 10000;
  private alertThresholds = {
    errorRate: 5, // errors per minute
    criticalErrors: 1, // immediate alert
    highErrors: 5, // alert after 5 occurrences
    mediumErrors: 10 // alert after 10 occurrences
  };

  constructor() {
    this.startCleanupTimer();
    this.startAlertMonitoring();
  }

  private startCleanupTimer(): void {
    // Clean up old errors every hour
    setInterval(() => {
      this.cleanupOldErrors();
    }, 60 * 60 * 1000);
  }

  private startAlertMonitoring(): void {
    // Check error rates every minute
    setInterval(() => {
      this.checkErrorRateAlerts();
    }, 60 * 1000);
  }

  private generateFingerprint(error: Error, context?: any): string {
    // Create a unique fingerprint for grouping similar errors
    const message = error.message || 'Unknown error';
    const stack = error.stack || '';
    const component = context?.component || 'unknown';
    
    // Extract the first few lines of stack trace for fingerprinting
    const stackLines = stack.split('\n').slice(0, 3).join('\n');
    
    // Create hash-like fingerprint
    const fingerprint = `${error.name}-${message}-${component}-${stackLines}`
      .replace(/\s+/g, ' ')
      .replace(/[^a-zA-Z0-9\-_]/g, '')
      .substring(0, 100);
    
    return fingerprint;
  }

  private calculateSeverity(error: Error, context?: any): ErrorReport['severity'] {
    const message = error.message?.toLowerCase() || '';
    const name = error.name?.toLowerCase() || '';
    
    // Critical errors
    if (
      name.includes('security') ||
      message.includes('unauthorized') ||
      message.includes('forbidden') ||
      message.includes('database') ||
      message.includes('connection') ||
      context?.component === 'security'
    ) {
      return 'critical';
    }
    
    // High severity errors
    if (
      name.includes('validation') ||
      message.includes('timeout') ||
      message.includes('service unavailable') ||
      message.includes('internal server error') ||
      context?.component === 'ai' ||
      context?.component === 'crm'
    ) {
      return 'high';
    }
    
    // Medium severity errors
    if (
      name.includes('reference') ||
      name.includes('type') ||
      message.includes('not found') ||
      message.includes('bad request')
    ) {
      return 'medium';
    }
    
    // Default to low severity
    return 'low';
  }

  private generateTags(error: Error, context?: any): string[] {
    const tags: string[] = [];
    
    // Add error type tag
    if (error.name) {
      tags.push(`type:${error.name.toLowerCase()}`);
    }
    
    // Add component tag
    if (context?.component) {
      tags.push(`component:${context.component}`);
    }
    
    // Add action tag
    if (context?.action) {
      tags.push(`action:${context.action}`);
    }
    
    // Add HTTP method tag
    if (context?.method) {
      tags.push(`method:${context.method.toLowerCase()}`);
    }
    
    // Add environment tag
    tags.push(`env:${process.env.NODE_ENV || 'development'}`);
    
    return tags;
  }

  public trackError(error: Error, context?: any): string {
    const timestamp = new Date();
    const fingerprint = this.generateFingerprint(error, context);
    const severity = this.calculateSeverity(error, context);
    const tags = this.generateTags(error, context);
    
    // Check if this error already exists
    const existingError = this.errors.get(fingerprint);
    
    if (existingError) {
      // Update existing error
      existingError.count++;
      existingError.lastSeen = timestamp;
      
      // Add to history
      this.errorHistory.push({
        ...existingError,
        id: `${fingerprint}-${timestamp.getTime()}`,
        timestamp,
        count: 1
      });
      
    } else {
      // Create new error report
      const errorReport: ErrorReport = {
        id: `${fingerprint}-${timestamp.getTime()}`,
        timestamp,
        message: error.message || 'Unknown error',
        stack: error.stack,
        type: error.name || 'Error',
        severity,
        context: {
          correlationId: context?.correlationId || loggingService.getCorrelationId(),
          userId: context?.userId,
          sessionId: context?.sessionId,
          url: context?.url,
          method: context?.method,
          userAgent: context?.userAgent,
          ip: context?.ip,
          component: context?.component,
          action: context?.action,
          metadata: context?.metadata
        },
        fingerprint,
        count: 1,
        firstSeen: timestamp,
        lastSeen: timestamp,
        resolved: false,
        tags
      };
      
      this.errors.set(fingerprint, errorReport);
      this.errorHistory.push(errorReport);
    }
    
    // Trim history if too large
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory = this.errorHistory.slice(-this.maxHistorySize);
    }
    
    // Log the error
    loggingService.error('Error tracked', error, {
      correlationId: context?.correlationId,
      component: 'error-tracking',
      action: 'track_error',
      metadata: {
        fingerprint,
        severity,
        tags,
        count: this.errors.get(fingerprint)?.count || 1
      }
    });
    
    // Check for immediate alerts
    this.checkImmediateAlerts(this.errors.get(fingerprint)!);
    
    return fingerprint;
  }

  private checkImmediateAlerts(errorReport: ErrorReport): void {
    const { severity, count, message, fingerprint } = errorReport;
    
    // Critical errors - alert immediately
    if (severity === 'critical') {
      this.sendAlert('critical', `Critical error occurred: ${message}`, errorReport);
    }
    
    // High severity errors - alert after threshold
    else if (severity === 'high' && count >= this.alertThresholds.highErrors) {
      this.sendAlert('high', `High severity error occurred ${count} times: ${message}`, errorReport);
    }
    
    // Medium severity errors - alert after higher threshold
    else if (severity === 'medium' && count >= this.alertThresholds.mediumErrors) {
      this.sendAlert('medium', `Medium severity error occurred ${count} times: ${message}`, errorReport);
    }
  }

  private checkErrorRateAlerts(): void {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const recentErrors = this.errorHistory.filter(e => e.timestamp > oneMinuteAgo);
    
    if (recentErrors.length >= this.alertThresholds.errorRate) {
      this.sendAlert('high', `High error rate detected: ${recentErrors.length} errors in the last minute`, {
        errorCount: recentErrors.length,
        timeWindow: '1 minute'
      });
    }
  }

  private sendAlert(severity: string, message: string, data: any): void {
    loggingService.warn(`ERROR ALERT [${severity.toUpperCase()}]: ${message}`, {
      component: 'error-tracking',
      action: 'error_alert',
      metadata: {
        severity,
        alertData: data
      }
    });
    
    // Here you would integrate with your notification system
    // For example: send to SNS, Slack, email, etc.
  }

  private cleanupOldErrors(): void {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    // Remove old errors from the main map
    for (const [fingerprint, error] of this.errors.entries()) {
      if (error.lastSeen < sevenDaysAgo) {
        this.errors.delete(fingerprint);
      }
    }
    
    // Clean up history
    this.errorHistory = this.errorHistory.filter(e => e.timestamp > sevenDaysAgo);
    
    loggingService.info('Cleaned up old errors', {
      component: 'error-tracking',
      action: 'cleanup',
      metadata: {
        remainingErrors: this.errors.size,
        historySize: this.errorHistory.length
      }
    });
  }

  public getErrorStats(hours: number = 24): ErrorStats {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    const recentErrors = this.errorHistory.filter(e => e.timestamp > cutoffTime);
    
    const errorsByType: Record<string, number> = {};
    const errorsBySeverity: Record<string, number> = {};
    const errorsByComponent: Record<string, number> = {};
    
    recentErrors.forEach(error => {
      errorsByType[error.type] = (errorsByType[error.type] || 0) + 1;
      errorsBySeverity[error.severity] = (errorsBySeverity[error.severity] || 0) + 1;
      
      const component = error.context.component || 'unknown';
      errorsByComponent[component] = (errorsByComponent[component] || 0) + 1;
    });
    
    // Get top errors by count
    const topErrors = Array.from(this.errors.values())
      .filter(e => e.lastSeen > cutoffTime)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    // Get recent errors
    const recentErrorsList = recentErrors
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 20);
    
    return {
      totalErrors: recentErrors.length,
      errorsByType,
      errorsBySeverity,
      errorsByComponent,
      errorRate: recentErrors.length / hours,
      topErrors,
      recentErrors: recentErrorsList
    };
  }

  public getError(fingerprint: string): ErrorReport | undefined {
    return this.errors.get(fingerprint);
  }

  public resolveError(fingerprint: string): boolean {
    const error = this.errors.get(fingerprint);
    if (error) {
      error.resolved = true;
      loggingService.info(`Error resolved: ${error.message}`, {
        component: 'error-tracking',
        action: 'resolve_error',
        metadata: { fingerprint }
      });
      return true;
    }
    return false;
  }

  public getUnresolvedErrors(): ErrorReport[] {
    return Array.from(this.errors.values()).filter(e => !e.resolved);
  }

  public searchErrors(query: string, hours: number = 24): ErrorReport[] {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    const searchTerm = query.toLowerCase();
    
    return Array.from(this.errors.values())
      .filter(error => 
        error.lastSeen > cutoffTime &&
        (error.message.toLowerCase().includes(searchTerm) ||
         error.type.toLowerCase().includes(searchTerm) ||
         error.context.component?.toLowerCase().includes(searchTerm) ||
         error.tags.some(tag => tag.toLowerCase().includes(searchTerm)))
      );
  }
}

// Express middleware for automatic error tracking
export const errorTrackingMiddleware = (error: Error, req: Request, res: Response, next: NextFunction): void => {
  const context = {
    correlationId: (req as any).correlationId,
    userId: (req as any).user?.id,
    sessionId: (req as any).sessionId,
    url: req.url,
    method: req.method,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    metadata: {
      body: req.body,
      params: req.params,
      query: req.query
    }
  };
  
  const fingerprint = errorTrackingService.trackError(error, context);
  
  // Add error fingerprint to response headers for debugging
  res.set('X-Error-Fingerprint', fingerprint);
  
  next(error);
};

// Express route handlers
export const errorTrackingService = new ErrorTrackingService();

export const getErrorStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const hours = parseInt(req.query.hours as string) || 24;
    const stats = errorTrackingService.getErrorStats(hours);
    
    res.json(stats);
  } catch (error) {
    loggingService.error('Failed to get error stats', error as Error, {
      component: 'error-tracking',
      action: 'get_stats_error'
    });
    
    res.status(500).json({ error: 'Failed to retrieve error statistics' });
  }
};

export const getErrorDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fingerprint } = req.params;
    const error = errorTrackingService.getError(fingerprint);
    
    if (error) {
      res.json(error);
    } else {
      res.status(404).json({ error: 'Error not found' });
    }
  } catch (error) {
    loggingService.error('Failed to get error details', error as Error, {
      component: 'error-tracking',
      action: 'get_details_error'
    });
    
    res.status(500).json({ error: 'Failed to retrieve error details' });
  }
};

export const resolveError = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fingerprint } = req.params;
    const resolved = errorTrackingService.resolveError(fingerprint);
    
    if (resolved) {
      res.json({ success: true, message: 'Error resolved' });
    } else {
      res.status(404).json({ error: 'Error not found' });
    }
  } catch (error) {
    loggingService.error('Failed to resolve error', error as Error, {
      component: 'error-tracking',
      action: 'resolve_error_error'
    });
    
    res.status(500).json({ error: 'Failed to resolve error' });
  }
};

export const searchErrors = async (req: Request, res: Response): Promise<void> => {
  try {
    const query = req.query.q as string || '';
    const hours = parseInt(req.query.hours as string) || 24;
    
    const errors = errorTrackingService.searchErrors(query, hours);
    
    res.json({ errors, query, hours });
  } catch (error) {
    loggingService.error('Failed to search errors', error as Error, {
      component: 'error-tracking',
      action: 'search_errors_error'
    });
    
    res.status(500).json({ error: 'Failed to search errors' });
  }
};

export const getUnresolvedErrors = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = errorTrackingService.getUnresolvedErrors();
    
    res.json({ errors });
  } catch (error) {
    loggingService.error('Failed to get unresolved errors', error as Error, {
      component: 'error-tracking',
      action: 'get_unresolved_errors_error'
    });
    
    res.status(500).json({ error: 'Failed to retrieve unresolved errors' });
  }
};