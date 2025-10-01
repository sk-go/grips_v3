import { logger } from '../../utils/logger';
import { SecurityMonitoringService } from './securityMonitoringService';

export interface SanitizationResult {
  sanitized: string;
  flagged: boolean;
  reasons: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  originalLength: number;
  sanitizedLength: number;
  patterns: Array<{
    pattern: string;
    matches: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>;
}

export interface SanitizationConfig {
  enableSQLInjectionDetection: boolean;
  enableXSSDetection: boolean;
  enableSensitiveDataDetection: boolean;
  enablePromptInjectionDetection: boolean;
  enablePathTraversalDetection: boolean;
  strictMode: boolean;
  customPatterns: Array<{
    pattern: RegExp;
    replacement: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
  }>;
}

export class AIInputSanitizationService {
  private static readonly DEFAULT_CONFIG: SanitizationConfig = {
    enableSQLInjectionDetection: true,
    enableXSSDetection: true,
    enableSensitiveDataDetection: true,
    enablePromptInjectionDetection: true,
    enablePathTraversalDetection: true,
    strictMode: false,
    customPatterns: []
  };

  // Security patterns with severity levels
  private static readonly SECURITY_PATTERNS = {
    // SQL Injection patterns
    sqlInjection: [
      { pattern: /(?:union|select|insert|delete|drop|create|alter|exec|execute)\s+/gi, severity: 'high' as const, description: 'SQL injection keywords' },
      { pattern: /(?:or|and)\s+(?:1=1|true|false|\d+\s*=\s*\d+)/gi, severity: 'high' as const, description: 'SQL injection boolean logic' },
      { pattern: /(?:--|\/\*|\*\/|;)/g, severity: 'medium' as const, description: 'SQL comment or terminator' },
      { pattern: /(?:information_schema|sys\.tables|mysql\.user)/gi, severity: 'critical' as const, description: 'Database system tables' }
    ],

    // XSS patterns
    xss: [
      { pattern: /<script[^>]*>.*?<\/script>/gis, severity: 'critical' as const, description: 'Script tag injection' },
      { pattern: /javascript:/gi, severity: 'high' as const, description: 'JavaScript protocol' },
      { pattern: /on(?:load|error|click|mouseover|focus|blur|change|submit)\s*=/gi, severity: 'high' as const, description: 'Event handler injection' },
      { pattern: /data:text\/html/gi, severity: 'medium' as const, description: 'Data URI HTML injection' },
      { pattern: /<iframe[^>]*>.*?<\/iframe>/gis, severity: 'high' as const, description: 'Iframe injection' }
    ],

    // Sensitive data patterns
    sensitiveData: [
      { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, severity: 'high' as const, description: 'Social Security Number' },
      { pattern: /\b(?:4\d{3}|5[1-5]\d{2}|6011|3[47]\d{2})\s?-?\s?\d{4}\s?-?\s?\d{4}\s?-?\s?\d{4}\b/g, severity: 'high' as const, description: 'Credit card number' },
      { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, severity: 'low' as const, description: 'Email address' },
      { pattern: /\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g, severity: 'medium' as const, description: 'Phone number' },
      { pattern: /\b(?:password|pwd|pass|secret|key|token|api[_-]?key)\s*[:=]\s*\S+/gi, severity: 'critical' as const, description: 'Credentials or secrets' }
    ],

    // Prompt injection patterns
    promptInjection: [
      { pattern: /(?:ignore|forget|disregard)\s+(?:previous|all|above|prior)\s+(?:instructions|prompts|rules|commands)/gi, severity: 'high' as const, description: 'Instruction override attempt' },
      { pattern: /(?:system|admin|root|developer)\s*[:=]\s*(?:mode|access|privileges)/gi, severity: 'critical' as const, description: 'Privilege escalation attempt' },
      { pattern: /(?:act|behave|pretend|roleplay)\s+(?:as|like)\s+(?:admin|system|root|developer|god)/gi, severity: 'high' as const, description: 'Role manipulation attempt' },
      { pattern: /(?:reveal|show|display|tell)\s+(?:your|the)\s+(?:prompt|instructions|system|rules)/gi, severity: 'medium' as const, description: 'Information extraction attempt' },
      { pattern: /(?:jailbreak|bypass|circumvent|override)\s+(?:safety|security|restrictions|limitations)/gi, severity: 'critical' as const, description: 'Security bypass attempt' }
    ],

    // Path traversal patterns
    pathTraversal: [
      { pattern: /\.\.\//g, severity: 'high' as const, description: 'Directory traversal' },
      { pattern: /(?:\/etc\/passwd|\/etc\/shadow|\/windows\/system32)/gi, severity: 'critical' as const, description: 'System file access attempt' },
      { pattern: /(?:file|ftp|http|https):\/\//gi, severity: 'medium' as const, description: 'URL protocol injection' }
    ],

    // Code injection patterns
    codeInjection: [
      { pattern: /(?:eval|exec|system|shell_exec|passthru|proc_open)\s*\(/gi, severity: 'critical' as const, description: 'Code execution function' },
      { pattern: /(?:__import__|import\s+os|import\s+subprocess|import\s+sys)/gi, severity: 'high' as const, description: 'Dangerous Python imports' },
      { pattern: /(?:require|include|include_once|require_once)\s*\(/gi, severity: 'medium' as const, description: 'File inclusion function' }
    ]
  };

  /**
   * Sanitize AI input with comprehensive security checks
   */
  static sanitizeInput(
    input: string,
    config: Partial<SanitizationConfig> = {}
  ): SanitizationResult {
    const finalConfig = { ...this.DEFAULT_CONFIG, ...config };
    
    let sanitized = input;
    const reasons: string[] = [];
    const patterns: Array<{ pattern: string; matches: number; severity: 'low' | 'medium' | 'high' | 'critical' }> = [];
    let maxSeverity: 'low' | 'medium' | 'high' | 'critical' = 'low';
    let flagged = false;

    try {
      // SQL Injection Detection
      if (finalConfig.enableSQLInjectionDetection) {
        const sqlResult = this.detectAndSanitizePatterns(
          sanitized,
          this.SECURITY_PATTERNS.sqlInjection,
          'SQL injection'
        );
        sanitized = sqlResult.sanitized;
        reasons.push(...sqlResult.reasons);
        patterns.push(...sqlResult.patterns);
        if (sqlResult.flagged) {
          flagged = true;
          maxSeverity = this.getMaxSeverity(maxSeverity, sqlResult.maxSeverity);
        }
      }

      // XSS Detection
      if (finalConfig.enableXSSDetection) {
        const xssResult = this.detectAndSanitizePatterns(
          sanitized,
          this.SECURITY_PATTERNS.xss,
          'XSS'
        );
        sanitized = xssResult.sanitized;
        reasons.push(...xssResult.reasons);
        patterns.push(...xssResult.patterns);
        if (xssResult.flagged) {
          flagged = true;
          maxSeverity = this.getMaxSeverity(maxSeverity, xssResult.maxSeverity);
        }
      }

      // Sensitive Data Detection
      if (finalConfig.enableSensitiveDataDetection) {
        const sensitiveResult = this.detectAndSanitizePatterns(
          sanitized,
          this.SECURITY_PATTERNS.sensitiveData,
          'sensitive data',
          '[REDACTED]'
        );
        sanitized = sensitiveResult.sanitized;
        reasons.push(...sensitiveResult.reasons);
        patterns.push(...sensitiveResult.patterns);
        if (sensitiveResult.flagged) {
          flagged = true;
          maxSeverity = this.getMaxSeverity(maxSeverity, sensitiveResult.maxSeverity);
        }
      }

      // Prompt Injection Detection
      if (finalConfig.enablePromptInjectionDetection) {
        const promptResult = this.detectAndSanitizePatterns(
          sanitized,
          this.SECURITY_PATTERNS.promptInjection,
          'prompt injection'
        );
        sanitized = promptResult.sanitized;
        reasons.push(...promptResult.reasons);
        patterns.push(...promptResult.patterns);
        if (promptResult.flagged) {
          flagged = true;
          maxSeverity = this.getMaxSeverity(maxSeverity, promptResult.maxSeverity);
        }
      }

      // Path Traversal Detection
      if (finalConfig.enablePathTraversalDetection) {
        const pathResult = this.detectAndSanitizePatterns(
          sanitized,
          this.SECURITY_PATTERNS.pathTraversal,
          'path traversal'
        );
        sanitized = pathResult.sanitized;
        reasons.push(...pathResult.reasons);
        patterns.push(...pathResult.patterns);
        if (pathResult.flagged) {
          flagged = true;
          maxSeverity = this.getMaxSeverity(maxSeverity, pathResult.maxSeverity);
        }
      }

      // Code Injection Detection
      const codeResult = this.detectAndSanitizePatterns(
        sanitized,
        this.SECURITY_PATTERNS.codeInjection,
        'code injection'
      );
      sanitized = codeResult.sanitized;
      reasons.push(...codeResult.reasons);
      patterns.push(...codeResult.patterns);
      if (codeResult.flagged) {
        flagged = true;
        maxSeverity = this.getMaxSeverity(maxSeverity, codeResult.maxSeverity);
      }

      // Custom Patterns
      if (finalConfig.customPatterns.length > 0) {
        const customResult = this.detectAndSanitizeCustomPatterns(
          sanitized,
          finalConfig.customPatterns
        );
        sanitized = customResult.sanitized;
        reasons.push(...customResult.reasons);
        patterns.push(...customResult.patterns);
        if (customResult.flagged) {
          flagged = true;
          maxSeverity = this.getMaxSeverity(maxSeverity, customResult.maxSeverity);
        }
      }

      // Additional sanitization in strict mode
      if (finalConfig.strictMode) {
        sanitized = this.applyStrictModeSanitization(sanitized);
      }

      const result: SanitizationResult = {
        sanitized,
        flagged,
        reasons: [...new Set(reasons)], // Remove duplicates
        riskLevel: maxSeverity,
        originalLength: input.length,
        sanitizedLength: sanitized.length,
        patterns
      };

      // Log if flagged
      if (flagged) {
        logger.warn('AI input sanitization triggered', {
          riskLevel: maxSeverity,
          reasons: result.reasons,
          originalLength: input.length,
          sanitizedLength: sanitized.length,
          patternsDetected: patterns.length
        });

        // Create security alert for high-risk inputs
        if (maxSeverity === 'critical' || maxSeverity === 'high') {
          (SecurityMonitoringService as any).createSecurityAlert({
            type: 'ai_input_sanitization',
            severity: maxSeverity === 'critical' ? 'critical' : 'high',
            title: 'High-Risk AI Input Detected',
            description: `Potentially dangerous content detected in AI input: ${reasons.join(', ')}`,
            metadata: {
              originalLength: input.length,
              sanitizedLength: sanitized.length,
              reasons: result.reasons,
              patterns: patterns.map(p => ({ pattern: p.pattern, matches: p.matches, severity: p.severity })),
              timestamp: new Date().toISOString()
            }
          });
        }
      }

      return result;
    } catch (error) {
      logger.error('Error in AI input sanitization', {
        error: error instanceof Error ? error.message : 'Unknown error',
        inputLength: input.length
      });

      // Return original input on error to avoid breaking functionality
      return {
        sanitized: input,
        flagged: false,
        reasons: ['Sanitization error occurred'],
        riskLevel: 'low',
        originalLength: input.length,
        sanitizedLength: input.length,
        patterns: []
      };
    }
  }

  /**
   * Detect and sanitize patterns
   */
  private static detectAndSanitizePatterns(
    input: string,
    patterns: Array<{ pattern: RegExp; severity: 'low' | 'medium' | 'high' | 'critical'; description: string }>,
    category: string,
    replacement: string = '[SANITIZED]'
  ): {
    sanitized: string;
    flagged: boolean;
    reasons: string[];
    patterns: Array<{ pattern: string; matches: number; severity: 'low' | 'medium' | 'high' | 'critical' }>;
    maxSeverity: 'low' | 'medium' | 'high' | 'critical';
  } {
    let sanitized = input;
    const reasons: string[] = [];
    const detectedPatterns: Array<{ pattern: string; matches: number; severity: 'low' | 'medium' | 'high' | 'critical' }> = [];
    let flagged = false;
    let maxSeverity: 'low' | 'medium' | 'high' | 'critical' = 'low';

    for (const { pattern, severity, description } of patterns) {
      const matches = input.match(pattern);
      if (matches && matches.length > 0) {
        flagged = true;
        reasons.push(`${category}: ${description}`);
        detectedPatterns.push({
          pattern: description,
          matches: matches.length,
          severity
        });
        maxSeverity = this.getMaxSeverity(maxSeverity, severity);
        sanitized = sanitized.replace(pattern, replacement);
      }
    }

    return { sanitized, flagged, reasons, patterns: detectedPatterns, maxSeverity };
  }

  /**
   * Detect and sanitize custom patterns
   */
  private static detectAndSanitizeCustomPatterns(
    input: string,
    customPatterns: Array<{
      pattern: RegExp;
      replacement: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      description: string;
    }>
  ): {
    sanitized: string;
    flagged: boolean;
    reasons: string[];
    patterns: Array<{ pattern: string; matches: number; severity: 'low' | 'medium' | 'high' | 'critical' }>;
    maxSeverity: 'low' | 'medium' | 'high' | 'critical';
  } {
    let sanitized = input;
    const reasons: string[] = [];
    const detectedPatterns: Array<{ pattern: string; matches: number; severity: 'low' | 'medium' | 'high' | 'critical' }> = [];
    let flagged = false;
    let maxSeverity: 'low' | 'medium' | 'high' | 'critical' = 'low';

    for (const { pattern, replacement, severity, description } of customPatterns) {
      const matches = input.match(pattern);
      if (matches && matches.length > 0) {
        flagged = true;
        reasons.push(`Custom pattern: ${description}`);
        detectedPatterns.push({
          pattern: description,
          matches: matches.length,
          severity
        });
        maxSeverity = this.getMaxSeverity(maxSeverity, severity);
        sanitized = sanitized.replace(pattern, replacement);
      }
    }

    return { sanitized, flagged, reasons, patterns: detectedPatterns, maxSeverity };
  }

  /**
   * Apply strict mode sanitization
   */
  private static applyStrictModeSanitization(input: string): string {
    let sanitized = input;

    // Remove potentially dangerous characters
    sanitized = sanitized.replace(/[<>'"&]/g, '');
    
    // Limit length to prevent DoS
    if (sanitized.length > 10000) {
      sanitized = sanitized.substring(0, 10000) + '[TRUNCATED]';
    }

    // Remove excessive whitespace
    sanitized = sanitized.replace(/\s{3,}/g, ' ');

    return sanitized;
  }

  /**
   * Get maximum severity level
   */
  private static getMaxSeverity(
    current: 'low' | 'medium' | 'high' | 'critical',
    new_severity: 'low' | 'medium' | 'high' | 'critical'
  ): 'low' | 'medium' | 'high' | 'critical' {
    const severityLevels = { low: 1, medium: 2, high: 3, critical: 4 };
    return severityLevels[new_severity] > severityLevels[current] ? new_severity : current;
  }

  /**
   * Validate AI output for potential security issues
   */
  static validateAIOutput(output: string): {
    safe: boolean;
    reasons: string[];
    sanitized: string;
  } {
    const reasons: string[] = [];
    let sanitized = output;
    let safe = true;

    // Check for potential data leakage
    const sensitivePatterns = [
      { pattern: /(?:password|secret|key|token)\s*[:=]\s*\S+/gi, reason: 'Potential credential exposure' },
      { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, reason: 'SSN in output' },
      { pattern: /\b(?:4\d{3}|5[1-5]\d{2}|6011|3[47]\d{2})\s?-?\s?\d{4}\s?-?\s?\d{4}\s?-?\s?\d{4}\b/g, reason: 'Credit card number in output' }
    ];

    for (const { pattern, reason } of sensitivePatterns) {
      if (pattern.test(output)) {
        safe = false;
        reasons.push(reason);
        sanitized = sanitized.replace(pattern, '[REDACTED]');
      }
    }

    return { safe, reasons, sanitized };
  }
}