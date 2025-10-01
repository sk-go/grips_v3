import { Request, Response } from 'express';
import { loggingService } from './loggingService';
import { cacheService } from '../cacheService';

export interface UserSession {
  sessionId: string;
  userId?: string;
  startTime: Date;
  lastActivity: Date;
  duration: number;
  pageViews: number;
  actions: UserAction[];
  userAgent: string;
  ip: string;
  location?: {
    country?: string;
    region?: string;
    city?: string;
  };
}

export interface UserAction {
  timestamp: Date;
  type: 'page_view' | 'api_call' | 'feature_use' | 'error' | 'conversion';
  category: string;
  action: string;
  label?: string;
  value?: number;
  metadata?: Record<string, any>;
}

export interface UsageMetrics {
  timestamp: Date;
  activeUsers: number;
  totalSessions: number;
  averageSessionDuration: number;
  pageViews: number;
  uniquePageViews: number;
  bounceRate: number;
  topPages: Array<{ page: string; views: number }>;
  topFeatures: Array<{ feature: string; uses: number }>;
  userFlow: Array<{ from: string; to: string; count: number }>;
}

export interface SystemHealth {
  timestamp: Date;
  status: 'healthy' | 'degraded' | 'unhealthy';
  components: {
    database: ComponentHealth;
    cache: ComponentHealth;
    ai: ComponentHealth;
    crm: ComponentHealth;
    email: ComponentHealth;
    voice: ComponentHealth;
  };
  overallScore: number;
  uptime: number;
  responseTime: number;
  errorRate: number;
  throughput: number;
}

export interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime: number;
  errorRate: number;
  lastCheck: Date;
  details?: Record<string, any>;
}

class AnalyticsService {
  private sessions: Map<string, UserSession> = new Map();
  private dailyMetrics: Map<string, UsageMetrics> = new Map();
  private healthHistory: SystemHealth[] = [];
  private sessionTimeout = 30 * 60 * 1000; // 30 minutes

  constructor() {
    this.startSessionCleanup();
    this.startMetricsCollection();
    this.startHealthMonitoring();
  }

  private startSessionCleanup(): void {
    // Clean up expired sessions every 5 minutes
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000);
  }

  private startMetricsCollection(): void {
    // Collect daily metrics every hour
    setInterval(() => {
      this.collectDailyMetrics();
    }, 60 * 60 * 1000);
  }

  private startHealthMonitoring(): void {
    // Check system health every 2 minutes
    setInterval(() => {
      this.checkSystemHealth();
    }, 2 * 60 * 1000);
  }

  // Session Management
  public startSession(sessionId: string, userId?: string, userAgent?: string, ip?: string): void {
    const session: UserSession = {
      sessionId,
      userId,
      startTime: new Date(),
      lastActivity: new Date(),
      duration: 0,
      pageViews: 0,
      actions: [],
      userAgent: userAgent || 'unknown',
      ip: ip || 'unknown'
    };

    this.sessions.set(sessionId, session);

    loggingService.info('User session started', {
      component: 'analytics',
      action: 'session_start',
      metadata: {
        sessionId,
        userId,
        userAgent,
        ip
      }
    });
  }

  public updateSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      const now = new Date();
      session.lastActivity = now;
      session.duration = now.getTime() - session.startTime.getTime();
    }
  }

  public endSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      const now = new Date();
      session.duration = now.getTime() - session.startTime.getTime();

      loggingService.info('User session ended', {
        component: 'analytics',
        action: 'session_end',
        metadata: {
          sessionId: session.sessionId,
          userId: session.userId,
          duration: session.duration,
          pageViews: session.pageViews,
          actions: session.actions.length
        }
      });

      this.sessions.delete(sessionId);
    }
  }

  // Event Tracking
  public trackEvent(sessionId: string, event: Omit<UserAction, 'timestamp'>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      const action: UserAction = {
        ...event,
        timestamp: new Date()
      };

      session.actions.push(action);
      this.updateSession(sessionId);

      // Track page views
      if (event.type === 'page_view') {
        session.pageViews++;
      }

      loggingService.info('User event tracked', {
        component: 'analytics',
        action: 'track_event',
        metadata: {
          sessionId,
          userId: session.userId,
          eventType: event.type,
          category: event.category,
          action: event.action,
          label: event.label,
          value: event.value
        }
      });
    }
  }

  public trackPageView(sessionId: string, page: string, title?: string): void {
    this.trackEvent(sessionId, {
      type: 'page_view',
      category: 'navigation',
      action: 'page_view',
      label: page,
      metadata: { title }
    });
  }

  public trackFeatureUse(sessionId: string, feature: string, action: string, metadata?: Record<string, any>): void {
    this.trackEvent(sessionId, {
      type: 'feature_use',
      category: 'feature',
      action,
      label: feature,
      metadata
    });
  }

  public trackApiCall(sessionId: string, endpoint: string, method: string, statusCode: number, duration: number): void {
    this.trackEvent(sessionId, {
      type: 'api_call',
      category: 'api',
      action: `${method} ${endpoint}`,
      value: duration,
      metadata: {
        statusCode,
        success: statusCode < 400
      }
    });
  }

  public trackConversion(sessionId: string, goal: string, value?: number): void {
    this.trackEvent(sessionId, {
      type: 'conversion',
      category: 'conversion',
      action: goal,
      value,
      metadata: { goal }
    });
  }

  // Metrics Collection
  private collectDailyMetrics(): void {
    const today = new Date().toISOString().split('T')[0];
    const activeSessions = Array.from(this.sessions.values());
    
    // Calculate metrics
    const activeUsers = new Set(activeSessions.map(s => s.userId).filter(Boolean)).size;
    const totalSessions = activeSessions.length;
    const averageSessionDuration = activeSessions.length > 0 
      ? activeSessions.reduce((sum, s) => sum + s.duration, 0) / activeSessions.length 
      : 0;
    
    const allActions = activeSessions.flatMap(s => s.actions);
    const pageViews = allActions.filter(a => a.type === 'page_view').length;
    const uniquePageViews = new Set(allActions.filter(a => a.type === 'page_view').map(a => a.label)).size;
    
    // Calculate bounce rate (sessions with only 1 page view)
    const singlePageSessions = activeSessions.filter(s => s.pageViews <= 1).length;
    const bounceRate = totalSessions > 0 ? (singlePageSessions / totalSessions) * 100 : 0;
    
    // Top pages
    const pageViewCounts: Record<string, number> = {};
    allActions.filter(a => a.type === 'page_view').forEach(a => {
      if (a.label) {
        pageViewCounts[a.label] = (pageViewCounts[a.label] || 0) + 1;
      }
    });
    const topPages = Object.entries(pageViewCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([page, views]) => ({ page, views }));
    
    // Top features
    const featureUseCounts: Record<string, number> = {};
    allActions.filter(a => a.type === 'feature_use').forEach(a => {
      if (a.label) {
        featureUseCounts[a.label] = (featureUseCounts[a.label] || 0) + 1;
      }
    });
    const topFeatures = Object.entries(featureUseCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([feature, uses]) => ({ feature, uses }));
    
    // User flow (simplified)
    const userFlow: Array<{ from: string; to: string; count: number }> = [];
    
    const metrics: UsageMetrics = {
      timestamp: new Date(),
      activeUsers,
      totalSessions,
      averageSessionDuration,
      pageViews,
      uniquePageViews,
      bounceRate,
      topPages,
      topFeatures,
      userFlow
    };

    this.dailyMetrics.set(today, metrics);

    loggingService.info('Daily metrics collected', {
      component: 'analytics',
      action: 'collect_metrics',
      metadata: {
        date: today,
        activeUsers,
        totalSessions,
        pageViews
      }
    });
  }

  // System Health Monitoring
  private async checkSystemHealth(): Promise<void> {
    try {
      const timestamp = new Date();
      
      // Check each component
      const database = await this.checkDatabaseHealth();
      const cache = await this.checkCacheHealth();
      const ai = await this.checkAIHealth();
      const crm = await this.checkCRMHealth();
      const email = await this.checkEmailHealth();
      const voice = await this.checkVoiceHealth();
      
      const components = { database, cache, ai, crm, email, voice };
      
      // Calculate overall score
      const componentScores = Object.values(components).map(c => {
        switch (c.status) {
          case 'healthy': return 100;
          case 'degraded': return 50;
          case 'unhealthy': return 0;
          default: return 0;
        }
      });
      const overallScore = componentScores.reduce((sum, score) => sum + score, 0) / componentScores.length;
      
      // Determine overall status
      let status: SystemHealth['status'] = 'healthy';
      if (overallScore < 50) status = 'unhealthy';
      else if (overallScore < 80) status = 'degraded';
      
      const health: SystemHealth = {
        timestamp,
        status,
        components,
        overallScore,
        uptime: process.uptime(),
        responseTime: 0, // Would be calculated from recent requests
        errorRate: 0, // Would be calculated from error tracking
        throughput: 0 // Would be calculated from request metrics
      };
      
      this.healthHistory.push(health);
      
      // Keep only last 24 hours of health data
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      this.healthHistory = this.healthHistory.filter(h => h.timestamp > oneDayAgo);
      
      loggingService.info('System health check completed', {
        component: 'analytics',
        action: 'health_check',
        metadata: {
          status,
          overallScore: Math.round(overallScore),
          unhealthyComponents: Object.entries(components)
            .filter(([, c]) => c.status === 'unhealthy')
            .map(([name]) => name)
        }
      });
      
    } catch (error) {
      loggingService.error('System health check failed', error as Error, {
        component: 'analytics',
        action: 'health_check_error'
      });
    }
  }

  private async checkDatabaseHealth(): Promise<ComponentHealth> {
    try {
      const startTime = Date.now();
      // Simple database health check - would be more comprehensive in practice
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'healthy',
        responseTime,
        errorRate: 0,
        lastCheck: new Date()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        responseTime: 0,
        errorRate: 100,
        lastCheck: new Date(),
        details: { error: (error as Error).message }
      };
    }
  }

  private async checkCacheHealth(): Promise<ComponentHealth> {
    try {
      const startTime = Date.now();
      await cacheService.ping();
      const responseTime = Date.now() - startTime;
      
      return {
        status: responseTime < 100 ? 'healthy' : 'degraded',
        responseTime,
        errorRate: 0,
        lastCheck: new Date()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        responseTime: 0,
        errorRate: 100,
        lastCheck: new Date(),
        details: { error: (error as Error).message }
      };
    }
  }

  private async checkAIHealth(): Promise<ComponentHealth> {
    // Mock AI health check - would integrate with actual AI services
    return {
      status: 'healthy',
      responseTime: 1200,
      errorRate: 2,
      lastCheck: new Date()
    };
  }

  private async checkCRMHealth(): Promise<ComponentHealth> {
    // Mock CRM health check - would integrate with actual CRM services
    return {
      status: 'healthy',
      responseTime: 800,
      errorRate: 1,
      lastCheck: new Date()
    };
  }

  private async checkEmailHealth(): Promise<ComponentHealth> {
    // Mock email health check - would integrate with actual email services
    return {
      status: 'healthy',
      responseTime: 300,
      errorRate: 0,
      lastCheck: new Date()
    };
  }

  private async checkVoiceHealth(): Promise<ComponentHealth> {
    // Mock voice health check - would integrate with actual voice services
    return {
      status: 'healthy',
      responseTime: 150,
      errorRate: 0,
      lastCheck: new Date()
    };
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    let expiredCount = 0;
    
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActivity.getTime() > this.sessionTimeout) {
        this.endSession(sessionId);
        expiredCount++;
      }
    }
    
    if (expiredCount > 0) {
      loggingService.info(`Cleaned up ${expiredCount} expired sessions`, {
        component: 'analytics',
        action: 'session_cleanup',
        metadata: { expiredCount, activeSessions: this.sessions.size }
      });
    }
  }

  // Public API methods
  public getUsageMetrics(days: number = 7): UsageMetrics[] {
    const metrics: UsageMetrics[] = [];
    const today = new Date();
    
    for (let i = 0; i < days; i++) {
      const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      const dateKey = date.toISOString().split('T')[0];
      const dayMetrics = this.dailyMetrics.get(dateKey);
      
      if (dayMetrics) {
        metrics.push(dayMetrics);
      }
    }
    
    return metrics.reverse();
  }

  public getCurrentHealth(): SystemHealth | null {
    return this.healthHistory[this.healthHistory.length - 1] || null;
  }

  public getHealthHistory(hours: number = 24): SystemHealth[] {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.healthHistory.filter(h => h.timestamp > cutoffTime);
  }

  public getActiveSessions(): UserSession[] {
    return Array.from(this.sessions.values());
  }

  public getSessionById(sessionId: string): UserSession | undefined {
    return this.sessions.get(sessionId);
  }

  public getUserSessions(userId: string): UserSession[] {
    return Array.from(this.sessions.values()).filter(s => s.userId === userId);
  }
}

// Express route handlers
export const analyticsService = new AnalyticsService();

export const getUsageAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const metrics = analyticsService.getUsageMetrics(days);
    
    res.json({ metrics, period: `${days} days` });
  } catch (error) {
    loggingService.error('Failed to get usage analytics', error as Error, {
      component: 'analytics',
      action: 'get_usage_error'
    });
    
    res.status(500).json({ error: 'Failed to retrieve usage analytics' });
  }
};

export const getSystemHealth = async (req: Request, res: Response): Promise<void> => {
  try {
    const current = analyticsService.getCurrentHealth();
    const hours = parseInt(req.query.hours as string) || 24;
    const history = analyticsService.getHealthHistory(hours);
    
    res.json({ current, history });
  } catch (error) {
    loggingService.error('Failed to get system health', error as Error, {
      component: 'analytics',
      action: 'get_health_error'
    });
    
    res.status(500).json({ error: 'Failed to retrieve system health' });
  }
};

export const getActiveSessions = async (req: Request, res: Response): Promise<void> => {
  try {
    const sessions = analyticsService.getActiveSessions();
    
    res.json({ 
      sessions: sessions.map(s => ({
        sessionId: s.sessionId,
        userId: s.userId,
        startTime: s.startTime,
        duration: s.duration,
        pageViews: s.pageViews,
        actionsCount: s.actions.length
      })),
      count: sessions.length
    });
  } catch (error) {
    loggingService.error('Failed to get active sessions', error as Error, {
      component: 'analytics',
      action: 'get_sessions_error'
    });
    
    res.status(500).json({ error: 'Failed to retrieve active sessions' });
  }
};

// Middleware for automatic session and event tracking
export const analyticsMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const sessionId = req.sessionID || (req as any).correlationId;
  const userId = (req as any).user?.id;
  
  if (sessionId) {
    // Start or update session
    if (!analyticsService.getSessionById(sessionId)) {
      analyticsService.startSession(sessionId, userId, req.get('User-Agent'), req.ip);
    } else {
      analyticsService.updateSession(sessionId);
    }
    
    // Track API call
    const startTime = Date.now();
    const originalEnd = res.end;
    
    res.end = function(chunk?: any, encoding?: any) {
      const duration = Date.now() - startTime;
      analyticsService.trackApiCall(sessionId, req.path, req.method, res.statusCode, duration);
      originalEnd.call(this, chunk, encoding);
    };
  }
  
  next();
};