import { logger } from '../../utils/logger';
import { DatabaseService } from '../database';
import { RedisService } from '../redis';
import { EmailNotificationService } from '../email/emailNotificationService';

export interface SecurityAlert {
  id: string;
  type: 'suspicious_registration' | 'ip_reputation' | 'pattern_detection' | 'rate_limit_abuse' | 'breach_detected' | 'ai_input_sanitization' | 'auto_lockdown';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  metadata: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  email?: string;
  timestamp: Date;
  resolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
}

export interface RegistrationPattern {
  ipAddress: string;
  registrationCount: number;
  timeWindow: number; // minutes
  emails: string[];
  userAgents: string[];
  firstSeen: Date;
  lastSeen: Date;
  suspiciousScore: number;
}

export interface IPReputationData {
  ipAddress: string;
  reputation: 'good' | 'suspicious' | 'malicious' | 'unknown';
  score: number; // 0-100, higher is more suspicious
  sources: string[];
  lastChecked: Date;
  metadata: {
    country?: string;
    isp?: string;
    isVpn?: boolean;
    isTor?: boolean;
    isProxy?: boolean;
    threatTypes?: string[];
  };
}

export class SecurityMonitoringService {
  private static readonly SUSPICIOUS_PATTERNS = {
    // Multiple registrations from same IP in short time
    RAPID_REGISTRATION: {
      threshold: 5,
      timeWindow: 60, // minutes
      score: 75
    },
    // Similar email patterns
    EMAIL_PATTERN_ABUSE: {
      threshold: 3,
      timeWindow: 1440, // 24 hours
      score: 60
    },
    // Suspicious user agents
    BOT_USER_AGENTS: {
      patterns: [
        /bot/i,
        /crawler/i,
        /spider/i,
        /scraper/i,
        /curl/i,
        /wget/i,
        /python/i,
        /requests/i
      ],
      score: 80
    },
    // Rapid sequential attempts
    SEQUENTIAL_ATTEMPTS: {
      threshold: 10,
      timeWindow: 5, // minutes
      score: 90
    }
  };

  private static readonly IP_REPUTATION_CACHE_TTL = 3600; // 1 hour

  /**
   * Analyze registration patterns for suspicious activity
   */
  static async analyzeRegistrationPattern(
    ipAddress: string,
    email: string,
    userAgent?: string
  ): Promise<{ suspicious: boolean; score: number; reasons: string[] }> {
    const reasons: string[] = [];
    let totalScore = 0;

    try {
      // Check rapid registration pattern
      const rapidRegistrationScore = await this.checkRapidRegistration(ipAddress);
      if (rapidRegistrationScore > 0) {
        totalScore += rapidRegistrationScore;
        reasons.push(`Rapid registration pattern detected (${rapidRegistrationScore} points)`);
      }

      // Check email pattern abuse
      const emailPatternScore = await this.checkEmailPatternAbuse(email, ipAddress);
      if (emailPatternScore > 0) {
        totalScore += emailPatternScore;
        reasons.push(`Suspicious email pattern detected (${emailPatternScore} points)`);
      }

      // Check user agent patterns
      if (userAgent) {
        const userAgentScore = this.checkSuspiciousUserAgent(userAgent);
        if (userAgentScore > 0) {
          totalScore += userAgentScore;
          reasons.push(`Suspicious user agent detected (${userAgentScore} points)`);
        }
      }

      // Check IP reputation
      const ipReputationScore = await this.checkIPReputation(ipAddress);
      if (ipReputationScore > 0) {
        totalScore += ipReputationScore;
        reasons.push(`Poor IP reputation detected (${ipReputationScore} points)`);
      }

      // Check sequential attempts
      const sequentialScore = await this.checkSequentialAttempts(ipAddress);
      if (sequentialScore > 0) {
        totalScore += sequentialScore;
        reasons.push(`Sequential registration attempts detected (${sequentialScore} points)`);
      }

      const suspicious = totalScore >= 50; // Threshold for suspicious activity

      if (suspicious) {
        await this.createSecurityAlert({
          type: 'suspicious_registration',
          severity: totalScore >= 80 ? 'high' : 'medium',
          title: 'Suspicious Registration Pattern Detected',
          description: `Registration attempt from ${ipAddress} flagged as suspicious`,
          metadata: {
            ipAddress,
            email,
            userAgent,
            score: totalScore,
            reasons
          },
          ipAddress,
          userAgent,
          email
        });
      }

      return { suspicious, score: totalScore, reasons };
    } catch (error) {
      logger.error('Error analyzing registration pattern', {
        ipAddress,
        email,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return { suspicious: false, score: 0, reasons: ['Analysis failed'] };
    }
  }

  /**
   * Check for rapid registration attempts from the same IP
   */
  private static async checkRapidRegistration(ipAddress: string): Promise<number> {
    try {
      const redis = RedisService.getClient();
      const key = `reg_pattern:${ipAddress}`;
      
      // Get current count
      const count = await redis.incr(key);
      
      // Set expiry on first increment
      if (count === 1) {
        await redis.expire(key, this.SUSPICIOUS_PATTERNS.RAPID_REGISTRATION.timeWindow * 60);
      }

      if (count >= this.SUSPICIOUS_PATTERNS.RAPID_REGISTRATION.threshold) {
        return this.SUSPICIOUS_PATTERNS.RAPID_REGISTRATION.score;
      }

      return 0;
    } catch (error) {
      logger.error('Error checking rapid registration pattern', { ipAddress, error });
      return 0;
    }
  }

  /**
   * Check for suspicious email patterns
   */
  private static async checkEmailPatternAbuse(email: string, ipAddress: string): Promise<number> {
    try {
      // Extract email pattern (e.g., user+1@domain.com -> user+*@domain.com)
      const emailPattern = this.extractEmailPattern(email);
      
      const redis = RedisService.getClient();
      const key = `email_pattern:${emailPattern}:${ipAddress}`;
      
      const count = await redis.incr(key);
      
      if (count === 1) {
        await redis.expire(key, this.SUSPICIOUS_PATTERNS.EMAIL_PATTERN_ABUSE.timeWindow * 60);
      }

      if (count >= this.SUSPICIOUS_PATTERNS.EMAIL_PATTERN_ABUSE.threshold) {
        return this.SUSPICIOUS_PATTERNS.EMAIL_PATTERN_ABUSE.score;
      }

      return 0;
    } catch (error) {
      logger.error('Error checking email pattern abuse', { email, ipAddress, error });
      return 0;
    }
  }

  /**
   * Check for suspicious user agents
   */
  private static checkSuspiciousUserAgent(userAgent: string): number {
    for (const pattern of this.SUSPICIOUS_PATTERNS.BOT_USER_AGENTS.patterns) {
      if (pattern.test(userAgent)) {
        return this.SUSPICIOUS_PATTERNS.BOT_USER_AGENTS.score;
      }
    }

    // Check for missing or very short user agents
    if (!userAgent || userAgent.length < 10) {
      return 30;
    }

    return 0;
  }

  /**
   * Check for sequential registration attempts
   */
  private static async checkSequentialAttempts(ipAddress: string): Promise<number> {
    try {
      const redis = RedisService.getClient();
      const key = `seq_attempts:${ipAddress}`;
      
      // Use a sliding window approach
      const now = Date.now();
      const windowStart = now - (this.SUSPICIOUS_PATTERNS.SEQUENTIAL_ATTEMPTS.timeWindow * 60 * 1000);
      
      // Add current timestamp
      await redis.zAdd(key, { score: now, value: now.toString() });
      
      // Remove old entries
      await redis.zRemRangeByScore(key, '-inf', windowStart);
      
      // Set expiry
      await redis.expire(key, this.SUSPICIOUS_PATTERNS.SEQUENTIAL_ATTEMPTS.timeWindow * 60);
      
      // Count entries in window
      const count = await redis.zCard(key);
      
      if (count >= this.SUSPICIOUS_PATTERNS.SEQUENTIAL_ATTEMPTS.threshold) {
        return this.SUSPICIOUS_PATTERNS.SEQUENTIAL_ATTEMPTS.score;
      }

      return 0;
    } catch (error) {
      logger.error('Error checking sequential attempts', { ipAddress, error });
      return 0;
    }
  }

  /**
   * Check IP reputation using multiple sources
   */
  static async checkIPReputation(ipAddress: string): Promise<number> {
    try {
      // Check cache first
      const cached = await this.getCachedIPReputation(ipAddress);
      if (cached && this.isReputationCacheValid(cached)) {
        return this.calculateReputationScore(cached);
      }

      // Fetch fresh reputation data
      const reputation = await this.fetchIPReputation(ipAddress);
      
      // Cache the result
      await this.cacheIPReputation(ipAddress, reputation);
      
      return this.calculateReputationScore(reputation);
    } catch (error) {
      logger.error('Error checking IP reputation', { ipAddress, error });
      return 0;
    }
  }

  /**
   * Fetch IP reputation from external sources
   */
  private static async fetchIPReputation(ipAddress: string): Promise<IPReputationData> {
    // In a real implementation, you would integrate with services like:
    // - AbuseIPDB
    // - VirusTotal
    // - IPQualityScore
    // - MaxMind
    
    // For now, we'll implement basic checks
    const reputation: IPReputationData = {
      ipAddress,
      reputation: 'unknown',
      score: 0,
      sources: ['internal'],
      lastChecked: new Date(),
      metadata: {}
    };

    // Basic checks for known suspicious patterns
    if (this.isPrivateIP(ipAddress)) {
      reputation.reputation = 'good';
      reputation.score = 0;
    } else if (this.isSuspiciousIPPattern(ipAddress)) {
      reputation.reputation = 'suspicious';
      reputation.score = 40;
    }

    return reputation;
  }

  /**
   * Create a security alert
   */
  private static async createSecurityAlert(alertData: Omit<SecurityAlert, 'id' | 'timestamp' | 'resolved'>): Promise<void> {
    try {
      const alert: SecurityAlert = {
        id: this.generateAlertId(),
        timestamp: new Date(),
        resolved: false,
        ...alertData
      };

      // Store in database
      await DatabaseService.query(`
        INSERT INTO security_alerts (
          id, type, severity, title, description, metadata, 
          ip_address, user_agent, email, timestamp, resolved
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        alert.id,
        alert.type,
        alert.severity,
        alert.title,
        alert.description,
        JSON.stringify(alert.metadata),
        alert.ipAddress,
        alert.userAgent,
        alert.email,
        alert.timestamp,
        alert.resolved
      ]);

      // Log the alert
      logger.warn('Security alert created', {
        alertId: alert.id,
        type: alert.type,
        severity: alert.severity,
        ipAddress: alert.ipAddress,
        email: alert.email
      });

      // Send notification to administrators (implement based on your notification system)
      await this.notifyAdministrators(alert);
    } catch (error) {
      logger.error('Error creating security alert', {
        alertData,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get security alerts with filtering
   */
  static async getSecurityAlerts(filters: {
    type?: string;
    severity?: string;
    resolved?: boolean;
    limit?: number;
    offset?: number;
  } = {}): Promise<SecurityAlert[]> {
    try {
      let query = 'SELECT * FROM security_alerts WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;

      if (filters.type) {
        query += ` AND type = $${paramIndex++}`;
        params.push(filters.type);
      }

      if (filters.severity) {
        query += ` AND severity = $${paramIndex++}`;
        params.push(filters.severity);
      }

      if (filters.resolved !== undefined) {
        query += ` AND resolved = $${paramIndex++}`;
        params.push(filters.resolved);
      }

      query += ' ORDER BY timestamp DESC';

      if (filters.limit) {
        query += ` LIMIT $${paramIndex++}`;
        params.push(filters.limit);
      }

      if (filters.offset) {
        query += ` OFFSET $${paramIndex++}`;
        params.push(filters.offset);
      }

      const result = await DatabaseService.query(query, params);
      
      return result.rows.map(row => ({
        id: row.id,
        type: row.type,
        severity: row.severity,
        title: row.title,
        description: row.description,
        metadata: JSON.parse(row.metadata || '{}'),
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        email: row.email,
        timestamp: row.timestamp,
        resolved: row.resolved,
        resolvedAt: row.resolved_at,
        resolvedBy: row.resolved_by
      }));
    } catch (error) {
      logger.error('Error fetching security alerts', { filters, error });
      return [];
    }
  }

  /**
   * Resolve a security alert
   */
  static async resolveAlert(alertId: string, resolvedBy: string, notes?: string): Promise<boolean> {
    try {
      await DatabaseService.query(`
        UPDATE security_alerts 
        SET resolved = true, resolved_at = CURRENT_TIMESTAMP, resolved_by = $2
        WHERE id = $1
      `, [alertId, resolvedBy]);

      logger.info('Security alert resolved', { alertId, resolvedBy, notes });
      return true;
    } catch (error) {
      logger.error('Error resolving security alert', { alertId, resolvedBy, error });
      return false;
    }
  }

  // Helper methods
  private static extractEmailPattern(email: string): string {
    // Convert user+123@domain.com to user+*@domain.com
    return email.replace(/\+\d+@/, '+*@');
  }

  private static isPrivateIP(ip: string): boolean {
    const privateRanges = [
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^127\./,
      /^::1$/,
      /^fc00:/,
      /^fe80:/
    ];
    
    return privateRanges.some(range => range.test(ip));
  }

  private static isSuspiciousIPPattern(ip: string): boolean {
    // Add patterns for known suspicious IP ranges
    // This is a simplified example
    const suspiciousPatterns = [
      /^1\.1\.1\./, // Example pattern
      /^8\.8\.8\./, // Example pattern
    ];
    
    return suspiciousPatterns.some(pattern => pattern.test(ip));
  }

  private static async getCachedIPReputation(ipAddress: string): Promise<IPReputationData | null> {
    try {
      const redis = RedisService.getClient();
      const cached = await redis.get(`ip_reputation:${ipAddress}`);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.error('Error getting cached IP reputation', { ipAddress, error });
      return null;
    }
  }

  private static async cacheIPReputation(ipAddress: string, reputation: IPReputationData): Promise<void> {
    try {
      const redis = RedisService.getClient();
      await redis.setEx(
        `ip_reputation:${ipAddress}`,
        this.IP_REPUTATION_CACHE_TTL,
        JSON.stringify(reputation)
      );
    } catch (error) {
      logger.error('Error caching IP reputation', { ipAddress, error });
    }
  }

  private static isReputationCacheValid(reputation: IPReputationData): boolean {
    const now = new Date();
    const lastChecked = typeof reputation.lastChecked === 'string' 
      ? new Date(reputation.lastChecked) 
      : reputation.lastChecked;
    const cacheAge = now.getTime() - lastChecked.getTime();
    return cacheAge < (this.IP_REPUTATION_CACHE_TTL * 1000);
  }

  private static calculateReputationScore(reputation: IPReputationData): number {
    switch (reputation.reputation) {
      case 'malicious':
        return 100;
      case 'suspicious':
        return reputation.score || 60;
      case 'good':
        return 0;
      default:
        return reputation.score || 0;
    }
  }

  private static generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Detect potential security breaches and trigger auto-lockdown
   */
  static async detectBreach(
    type: 'multiple_failed_logins' | 'suspicious_api_calls' | 'data_exfiltration' | 'injection_attempt',
    metadata: Record<string, any>
  ): Promise<{ breachDetected: boolean; lockdownTriggered: boolean }> {
    try {
      const breachScore = await this.calculateBreachScore(type, metadata);
      const breachDetected = breachScore >= 80; // High threshold for breach detection
      
      if (breachDetected) {
        // Create critical security alert
        await this.createSecurityAlert({
          type: 'breach_detected',
          severity: 'critical',
          title: 'Security Breach Detected',
          description: `Potential security breach detected: ${type}`,
          metadata: {
            ...metadata,
            breachScore,
            detectionTime: new Date().toISOString()
          },
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
          email: metadata.email
        });

        // Trigger auto-lockdown for critical breaches
        const lockdownTriggered = await this.triggerAutoLockdown(type, metadata);
        
        return { breachDetected: true, lockdownTriggered };
      }

      return { breachDetected: false, lockdownTriggered: false };
    } catch (error) {
      logger.error('Error in breach detection', { type, metadata, error });
      return { breachDetected: false, lockdownTriggered: false };
    }
  }

  /**
   * Calculate breach score based on type and metadata
   */
  private static async calculateBreachScore(
    type: string,
    metadata: Record<string, any>
  ): Promise<number> {
    let score = 0;

    switch (type) {
      case 'multiple_failed_logins':
        score = Math.min(metadata.attemptCount * 10, 100);
        break;
      case 'suspicious_api_calls':
        score = Math.min(metadata.callCount * 5, 90);
        break;
      case 'data_exfiltration':
        score = 95; // Very high score for data exfiltration
        break;
      case 'injection_attempt':
        score = 85; // High score for injection attempts
        break;
      default:
        score = 50;
    }

    // Increase score for known bad IPs
    if (metadata.ipAddress) {
      const ipScore = await this.checkIPReputation(metadata.ipAddress);
      score += ipScore * 0.3; // 30% weight for IP reputation
    }

    return Math.min(score, 100);
  }

  /**
   * Trigger auto-lockdown system
   */
  private static async triggerAutoLockdown(
    breachType: string,
    metadata: Record<string, any>
  ): Promise<boolean> {
    try {
      const lockdownId = this.generateAlertId();
      
      // Store lockdown record
      await DatabaseService.query(`
        INSERT INTO security_lockdowns (
          id, breach_type, metadata, ip_address, triggered_at, active
        ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, true)
      `, [
        lockdownId,
        breachType,
        JSON.stringify(metadata),
        metadata.ipAddress
      ]);

      // Block IP address if provided
      if (metadata.ipAddress) {
        await this.blockIPAddress(metadata.ipAddress, lockdownId);
      }

      // Block user account if provided
      if (metadata.userId) {
        await this.lockUserAccount(metadata.userId, lockdownId);
      }

      // Create lockdown alert
      await this.createSecurityAlert({
        type: 'auto_lockdown',
        severity: 'critical',
        title: 'Auto-Lockdown Triggered',
        description: `System auto-lockdown triggered due to: ${breachType}`,
        metadata: {
          ...metadata,
          lockdownId,
          lockdownTime: new Date().toISOString()
        },
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        email: metadata.email
      });

      logger.error('Auto-lockdown triggered', {
        lockdownId,
        breachType,
        metadata,
        level: 'critical'
      });

      return true;
    } catch (error) {
      logger.error('Error triggering auto-lockdown', { breachType, metadata, error });
      return false;
    }
  }

  /**
   * Block IP address
   */
  private static async blockIPAddress(ipAddress: string, lockdownId: string): Promise<void> {
    try {
      const redis = RedisService.getClient();
      const blockKey = `blocked_ip:${ipAddress}`;
      
      // Block for 24 hours initially
      await redis.setEx(blockKey, 86400, JSON.stringify({
        lockdownId,
        blockedAt: new Date().toISOString(),
        reason: 'Auto-lockdown triggered'
      }));

      logger.warn('IP address blocked', { ipAddress, lockdownId });
    } catch (error) {
      logger.error('Error blocking IP address', { ipAddress, lockdownId, error });
    }
  }

  /**
   * Lock user account
   */
  private static async lockUserAccount(userId: string, lockdownId: string): Promise<void> {
    try {
      await DatabaseService.query(`
        UPDATE users 
        SET locked = true, locked_at = CURRENT_TIMESTAMP, locked_reason = $2
        WHERE id = $1
      `, [userId, `Auto-lockdown: ${lockdownId}`]);

      logger.warn('User account locked', { userId, lockdownId });
    } catch (error) {
      logger.error('Error locking user account', { userId, lockdownId, error });
    }
  }

  /**
   * Check if IP address is blocked
   */
  static async isIPBlocked(ipAddress: string): Promise<boolean> {
    try {
      const redis = RedisService.getClient();
      const blockData = await redis.get(`blocked_ip:${ipAddress}`);
      return blockData !== null;
    } catch (error) {
      logger.error('Error checking IP block status', { ipAddress, error });
      return false;
    }
  }

  /**
   * Sanitize AI input for security
   */
  static sanitizeAIInput(input: string): { sanitized: string; flagged: boolean; reasons: string[] } {
    const reasons: string[] = [];
    let sanitized = input;
    let flagged = false;

    // Check for injection patterns
    const injectionPatterns = [
      { pattern: /(?:union|select|insert|delete|drop|create|alter)\s+/gi, reason: 'SQL injection attempt' },
      { pattern: /<script[^>]*>.*?<\/script>/gi, reason: 'XSS script injection' },
      { pattern: /javascript:/gi, reason: 'JavaScript protocol injection' },
      { pattern: /data:text\/html/gi, reason: 'Data URI XSS attempt' },
      { pattern: /\.\.\//g, reason: 'Path traversal attempt' },
      { pattern: /__proto__|constructor|prototype/gi, reason: 'Prototype pollution attempt' }
    ];

    for (const { pattern, reason } of injectionPatterns) {
      if (pattern.test(input)) {
        flagged = true;
        reasons.push(reason);
        sanitized = sanitized.replace(pattern, '[SANITIZED]');
      }
    }

    // Check for sensitive data patterns
    const sensitivePatterns = [
      { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, reason: 'SSN detected' },
      { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, reason: 'Credit card number detected' },
      { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, reason: 'Email address detected' }
    ];

    for (const { pattern, reason } of sensitivePatterns) {
      if (pattern.test(input)) {
        flagged = true;
        reasons.push(reason);
        sanitized = sanitized.replace(pattern, '[REDACTED]');
      }
    }

    // Log flagged input
    if (flagged) {
      this.createSecurityAlert({
        type: 'ai_input_sanitization',
        severity: 'medium',
        title: 'AI Input Sanitization Triggered',
        description: 'Potentially dangerous content detected in AI input',
        metadata: {
          originalLength: input.length,
          sanitizedLength: sanitized.length,
          reasons,
          timestamp: new Date().toISOString()
        }
      });
    }

    return { sanitized, flagged, reasons };
  }

  /**
   * Enhanced rate limiting with abuse detection
   */
  static async checkRateLimit(
    key: string,
    limit: number,
    windowMs: number,
    options: {
      skipSuccessfulRequests?: boolean;
      skipFailedRequests?: boolean;
      keyGenerator?: (req: any) => string;
    } = {}
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number; abusive: boolean }> {
    try {
      const redis = RedisService.getClient();
      const now = Date.now();
      const windowStart = now - windowMs;
      
      // Use sliding window log approach
      const requestKey = `rate_limit:${key}`;
      
      // Add current request
      await redis.zAdd(requestKey, { score: now, value: now.toString() });
      
      // Remove old entries
      await redis.zRemRangeByScore(requestKey, '-inf', windowStart);
      
      // Set expiry
      await redis.expire(requestKey, Math.ceil(windowMs / 1000));
      
      // Count current requests
      const requestCount = await redis.zCard(requestKey);
      const remaining = Math.max(0, limit - requestCount);
      const resetTime = now + windowMs;
      
      // Check for abusive behavior (significantly exceeding limits)
      const abusive = requestCount > (limit * 2);
      
      if (abusive) {
        await this.createSecurityAlert({
          type: 'rate_limit_abuse',
          severity: 'high',
          title: 'Rate Limit Abuse Detected',
          description: `Excessive requests detected for key: ${key}`,
          metadata: {
            key,
            requestCount,
            limit,
            windowMs,
            timestamp: new Date().toISOString()
          }
        });
      }
      
      return {
        allowed: requestCount <= limit,
        remaining,
        resetTime,
        abusive
      };
    } catch (error) {
      logger.error('Error checking rate limit', { key, limit, windowMs, error });
      return { allowed: true, remaining: limit, resetTime: Date.now() + windowMs, abusive: false };
    }
  }

  /**
   * Send security alert notifications via email/SMS
   */
  private static async notifyAdministrators(alert: SecurityAlert): Promise<void> {
    try {
      // Get admin users
      const adminUsers = await DatabaseService.query(`
        SELECT id, email, phone, notification_preferences 
        FROM users 
        WHERE role = 'admin' AND active = true
      `);

      for (const admin of adminUsers.rows) {
        const preferences = admin.notification_preferences || {};
        
        // Send email notification if enabled
        if (preferences.email !== false && admin.email) {
          await this.sendEmailAlert(admin.email, alert);
        }
        
        // Send SMS notification for critical alerts if enabled
        if (alert.severity === 'critical' && preferences.sms !== false && admin.phone) {
          await this.sendSMSAlert(admin.phone, alert);
        }
      }

      logger.info('Security alert notifications sent to administrators', {
        alertId: alert.id,
        type: alert.type,
        severity: alert.severity,
        adminCount: adminUsers.rows.length
      });
    } catch (error) {
      logger.error('Error sending security alert notifications', {
        alertId: alert.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Send email alert to administrator
   */
  private static async sendEmailAlert(email: string, alert: SecurityAlert): Promise<void> {
    try {
      const subject = `🚨 Security Alert: ${alert.title}`;
      const body = `
        <h2>Security Alert</h2>
        <p><strong>Type:</strong> ${alert.type}</p>
        <p><strong>Severity:</strong> ${alert.severity}</p>
        <p><strong>Description:</strong> ${alert.description}</p>
        <p><strong>Time:</strong> ${alert.timestamp.toISOString()}</p>
        
        ${alert.ipAddress ? `<p><strong>IP Address:</strong> ${alert.ipAddress}</p>` : ''}
        ${alert.email ? `<p><strong>Email:</strong> ${alert.email}</p>` : ''}
        
        <h3>Metadata:</h3>
        <pre>${JSON.stringify(alert.metadata, null, 2)}</pre>
        
        <p>Please review this alert in the security dashboard.</p>
      `;

      // Note: EmailNotificationService.sendEmail method needs to be implemented
      // For now, we'll log the email that would be sent
      logger.info('Email alert would be sent', {
        to: email,
        subject,
        alertId: alert.id
      });
    } catch (error) {
      logger.error('Error sending email alert', { email, alertId: alert.id, error });
    }
  }

  /**
   * Send SMS alert to administrator
   */
  private static async sendSMSAlert(phone: string, alert: SecurityAlert): Promise<void> {
    try {
      const message = `🚨 SECURITY ALERT: ${alert.title} - ${alert.severity.toUpperCase()} - ${alert.description}. Check dashboard immediately.`;
      
      // Note: This would integrate with your SMS service (Twilio, etc.)
      // For now, we'll log it
      logger.info('SMS alert would be sent', { phone, message, alertId: alert.id });
      
      // TODO: Implement actual SMS sending via Twilio or similar service
    } catch (error) {
      logger.error('Error sending SMS alert', { phone, alertId: alert.id, error });
    }
  }
}