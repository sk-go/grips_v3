import { encryptionService } from './encryptionService';
import { logger } from '../../utils/logger';

export interface SensitiveDataPattern {
  name: string;
  pattern: RegExp;
  riskLevel: 'low' | 'medium' | 'high';
  description: string;
}

export interface SensitiveDataMatch {
  pattern: string;
  match: string;
  position: number;
  riskLevel: 'low' | 'medium' | 'high';
  redacted: string;
}

export interface DataClassification {
  hasSensitiveData: boolean;
  matches: SensitiveDataMatch[];
  riskLevel: 'low' | 'medium' | 'high';
  redactedText: string;
}

export class SensitiveDataService {
  private patterns: SensitiveDataPattern[] = [
    // Social Security Numbers
    {
      name: 'ssn',
      pattern: /\b\d{3}-?\d{2}-?\d{4}\b/g,
      riskLevel: 'high',
      description: 'Social Security Number'
    },
    // Credit Card Numbers (basic pattern)
    {
      name: 'credit_card',
      pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
      riskLevel: 'high',
      description: 'Credit Card Number'
    },
    // Phone Numbers
    {
      name: 'phone',
      pattern: /\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g,
      riskLevel: 'medium',
      description: 'Phone Number'
    },
    // Email Addresses
    {
      name: 'email',
      pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      riskLevel: 'medium',
      description: 'Email Address'
    },
    // Driver's License (generic pattern)
    {
      name: 'drivers_license',
      pattern: /\b[A-Z]{1,2}\d{6,8}\b/g,
      riskLevel: 'high',
      description: 'Driver\'s License Number'
    },
    // Date of Birth
    {
      name: 'date_of_birth',
      pattern: /\b(?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01])[-/](?:19|20)\d{2}\b/g,
      riskLevel: 'medium',
      description: 'Date of Birth'
    },
    // Medical Record Numbers
    {
      name: 'medical_record',
      pattern: /\b(?:MRN|MR|Medical Record)[-:\s]*\d{6,10}\b/gi,
      riskLevel: 'high',
      description: 'Medical Record Number'
    },
    // Policy Numbers (insurance specific)
    {
      name: 'policy_number',
      pattern: /\b(?:Policy|POL)[-:\s]*[A-Z0-9]{6,15}\b/gi,
      riskLevel: 'medium',
      description: 'Insurance Policy Number'
    },
    // Bank Account Numbers
    {
      name: 'bank_account',
      pattern: /\b(?:Account|Acct)[-:\s]*\d{8,17}\b/gi,
      riskLevel: 'high',
      description: 'Bank Account Number'
    },
    // Health conditions (basic keywords)
    {
      name: 'health_condition',
      pattern: /\b(?:diabetes|cancer|HIV|AIDS|depression|anxiety|bipolar|schizophrenia|heart disease|stroke)\b/gi,
      riskLevel: 'high',
      description: 'Health Condition'
    }
  ];

  /**
   * Classify text for sensitive data
   */
  public classifyText(text: string): DataClassification {
    const matches: SensitiveDataMatch[] = [];
    let redactedText = text;
    let highestRiskLevel: 'low' | 'medium' | 'high' = 'low';

    for (const pattern of this.patterns) {
      const patternMatches = Array.from(text.matchAll(pattern.pattern));
      
      for (const match of patternMatches) {
        const matchText = match[0];
        const position = match.index || 0;
        
        // Create redacted version
        const redacted = this.redactMatch(matchText, pattern.name);
        
        matches.push({
          pattern: pattern.name,
          match: matchText,
          position,
          riskLevel: pattern.riskLevel,
          redacted
        });

        // Update highest risk level
        if (this.getRiskPriority(pattern.riskLevel) > this.getRiskPriority(highestRiskLevel)) {
          highestRiskLevel = pattern.riskLevel;
        }

        // Replace in redacted text
        redactedText = redactedText.replace(matchText, redacted);
      }
    }

    return {
      hasSensitiveData: matches.length > 0,
      matches,
      riskLevel: matches.length > 0 ? highestRiskLevel : 'low',
      redactedText
    };
  }

  /**
   * Encrypt sensitive fields in an object
   */
  public encryptSensitiveFields(data: Record<string, any>, sensitiveFields: string[]): Record<string, any> {
    const encrypted = { ...data };

    for (const field of sensitiveFields) {
      if (encrypted[field] && typeof encrypted[field] === 'string') {
        encrypted[field] = encryptionService.encryptField(field, encrypted[field]);
        encrypted[`${field}_encrypted`] = true;
      }
    }

    return encrypted;
  }

  /**
   * Decrypt sensitive fields in an object
   */
  public decryptSensitiveFields(data: Record<string, any>, sensitiveFields: string[]): Record<string, any> {
    const decrypted = { ...data };

    for (const field of sensitiveFields) {
      if (decrypted[`${field}_encrypted`] && decrypted[field]) {
        try {
          decrypted[field] = encryptionService.decryptField(decrypted[field]);
          delete decrypted[`${field}_encrypted`];
        } catch (error) {
          logger.error(`Failed to decrypt field ${field}:`, error);
          // Keep encrypted data if decryption fails
        }
      }
    }

    return decrypted;
  }

  /**
   * Check if agentic AI action should be halted due to sensitive data
   */
  public shouldHaltAgenticAction(text: string, actionType: string): {
    shouldHalt: boolean;
    reason?: string;
    riskLevel: 'low' | 'medium' | 'high';
  } {
    const classification = this.classifyText(text);

    // Halt high-risk actions with sensitive data
    if (classification.hasSensitiveData && classification.riskLevel === 'high') {
      return {
        shouldHalt: true,
        reason: `High-risk sensitive data detected in ${actionType} action`,
        riskLevel: classification.riskLevel
      };
    }

    // Halt medium-risk actions with multiple sensitive data points
    if (classification.matches.length > 2 && classification.riskLevel === 'medium') {
      return {
        shouldHalt: true,
        reason: `Multiple sensitive data points detected in ${actionType} action`,
        riskLevel: classification.riskLevel
      };
    }

    return {
      shouldHalt: false,
      riskLevel: classification.riskLevel
    };
  }

  /**
   * Sanitize text for logging or display
   */
  public sanitizeForLogging(text: string): string {
    const classification = this.classifyText(text);
    return classification.redactedText;
  }

  /**
   * Add custom sensitive data pattern
   */
  public addCustomPattern(pattern: SensitiveDataPattern): void {
    this.patterns.push(pattern);
    logger.info(`Added custom sensitive data pattern: ${pattern.name}`);
  }

  /**
   * Get all configured patterns
   */
  public getPatterns(): SensitiveDataPattern[] {
    return [...this.patterns];
  }

  /**
   * Redact a match based on pattern type
   */
  private redactMatch(match: string, patternName: string): string {
    switch (patternName) {
      case 'ssn':
        return 'XXX-XX-' + match.slice(-4);
      case 'credit_card':
        return '**** **** **** ' + match.slice(-4);
      case 'phone':
        return '(XXX) XXX-' + match.slice(-4);
      case 'email':
        const [local, domain] = match.split('@');
        return local.charAt(0) + '***@' + domain;
      default:
        return '[REDACTED]';
    }
  }

  /**
   * Get numeric priority for risk levels
   */
  private getRiskPriority(riskLevel: 'low' | 'medium' | 'high'): number {
    switch (riskLevel) {
      case 'low': return 1;
      case 'medium': return 2;
      case 'high': return 3;
      default: return 0;
    }
  }
}

// Singleton instance
export const sensitiveDataService = new SensitiveDataService();