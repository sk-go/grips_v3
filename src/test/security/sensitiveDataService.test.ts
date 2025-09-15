import { SensitiveDataService } from '../../services/security/sensitiveDataService';

describe('SensitiveDataService', () => {
  let sensitiveDataService: SensitiveDataService;

  beforeEach(() => {
    sensitiveDataService = new SensitiveDataService();
  });

  describe('classifyText', () => {
    it('should detect Social Security Numbers', () => {
      const text = 'My SSN is 123-45-6789 and I need help.';
      
      const classification = sensitiveDataService.classifyText(text);
      
      expect(classification.hasSensitiveData).toBe(true);
      expect(classification.riskLevel).toBe('high');
      expect(classification.matches).toHaveLength(1);
      expect(classification.matches[0].pattern).toBe('ssn');
      expect(classification.matches[0].match).toBe('123-45-6789');
      expect(classification.redactedText).toContain('XXX-XX-6789');
    });

    it('should detect credit card numbers', () => {
      const text = 'My card number is 4532 1234 5678 9012';
      
      const classification = sensitiveDataService.classifyText(text);
      
      expect(classification.hasSensitiveData).toBe(true);
      expect(classification.riskLevel).toBe('high');
      expect(classification.matches[0].pattern).toBe('credit_card');
      expect(classification.redactedText).toContain('**** **** **** 9012');
    });

    it('should detect phone numbers', () => {
      const text = 'Call me at (555) 123-4567 tomorrow.';
      
      const classification = sensitiveDataService.classifyText(text);
      
      expect(classification.hasSensitiveData).toBe(true);
      expect(classification.riskLevel).toBe('medium');
      expect(classification.matches[0].pattern).toBe('phone');
      expect(classification.redactedText).toContain('(XXX) XXX-4567');
    });

    it('should detect email addresses', () => {
      const text = 'Send it to john.doe@example.com please.';
      
      const classification = sensitiveDataService.classifyText(text);
      
      expect(classification.hasSensitiveData).toBe(true);
      expect(classification.riskLevel).toBe('medium');
      expect(classification.matches[0].pattern).toBe('email');
      expect(classification.redactedText).toContain('j***@example.com');
    });

    it('should detect health conditions', () => {
      const text = 'Patient has diabetes and heart disease.';
      
      const classification = sensitiveDataService.classifyText(text);
      
      expect(classification.hasSensitiveData).toBe(true);
      expect(classification.riskLevel).toBe('high');
      expect(classification.matches.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle text with no sensitive data', () => {
      const text = 'This is just normal conversation about the weather.';
      
      const classification = sensitiveDataService.classifyText(text);
      
      expect(classification.hasSensitiveData).toBe(false);
      expect(classification.riskLevel).toBe('low');
      expect(classification.matches).toHaveLength(0);
      expect(classification.redactedText).toBe(text);
    });

    it('should handle multiple sensitive data types', () => {
      const text = 'Contact John at john@example.com or (555) 123-4567. His SSN is 123-45-6789.';
      
      const classification = sensitiveDataService.classifyText(text);
      
      expect(classification.hasSensitiveData).toBe(true);
      expect(classification.riskLevel).toBe('high'); // Highest risk level
      expect(classification.matches.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('encryptSensitiveFields', () => {
    it('should encrypt specified sensitive fields', () => {
      const data = {
        name: 'John Doe',
        ssn: '123-45-6789',
        email: 'john@example.com',
        publicInfo: 'This is public'
      };
      
      const encrypted = sensitiveDataService.encryptSensitiveFields(data, ['ssn', 'email']);
      
      expect(encrypted.name).toBe('John Doe');
      expect(encrypted.publicInfo).toBe('This is public');
      expect(encrypted.ssn).not.toBe('123-45-6789');
      expect(encrypted.email).not.toBe('john@example.com');
      expect(encrypted.ssn_encrypted).toBe(true);
      expect(encrypted.email_encrypted).toBe(true);
    });

    it('should handle non-existent fields gracefully', () => {
      const data = { name: 'John Doe' };
      
      const encrypted = sensitiveDataService.encryptSensitiveFields(data, ['ssn', 'nonexistent']);
      
      expect(encrypted.name).toBe('John Doe');
      expect(encrypted.ssn).toBeUndefined();
      expect(encrypted.nonexistent).toBeUndefined();
    });
  });

  describe('decryptSensitiveFields', () => {
    it('should decrypt previously encrypted fields', () => {
      const originalData = {
        name: 'John Doe',
        ssn: '123-45-6789',
        email: 'john@example.com'
      };
      
      const encrypted = sensitiveDataService.encryptSensitiveFields(originalData, ['ssn', 'email']);
      const decrypted = sensitiveDataService.decryptSensitiveFields(encrypted, ['ssn', 'email']);
      
      expect(decrypted.name).toBe('John Doe');
      expect(decrypted.ssn).toBe('123-45-6789');
      expect(decrypted.email).toBe('john@example.com');
      expect(decrypted.ssn_encrypted).toBeUndefined();
      expect(decrypted.email_encrypted).toBeUndefined();
    });

    it('should handle fields that are not encrypted', () => {
      const data = {
        name: 'John Doe',
        ssn: '123-45-6789'
      };
      
      const result = sensitiveDataService.decryptSensitiveFields(data, ['ssn']);
      
      expect(result.name).toBe('John Doe');
      expect(result.ssn).toBe('123-45-6789');
    });
  });

  describe('shouldHaltAgenticAction', () => {
    it('should halt action for high-risk sensitive data', () => {
      const text = 'Send email with SSN 123-45-6789 to client';
      
      const result = sensitiveDataService.shouldHaltAgenticAction(text, 'email');
      
      expect(result.shouldHalt).toBe(true);
      expect(result.reason).toContain('High-risk sensitive data detected');
      expect(result.riskLevel).toBe('high');
    });

    it('should halt action for multiple medium-risk data points', () => {
      const text = 'Contact john@example.com at (555) 123-4567 and send to mary@example.com';
      
      const result = sensitiveDataService.shouldHaltAgenticAction(text, 'email');
      
      expect(result.shouldHalt).toBe(true);
      expect(result.reason).toContain('Multiple sensitive data points detected');
      expect(result.riskLevel).toBe('medium');
    });

    it('should not halt action for low-risk or single medium-risk data', () => {
      const text = 'Contact john@example.com for more information';
      
      const result = sensitiveDataService.shouldHaltAgenticAction(text, 'email');
      
      expect(result.shouldHalt).toBe(false);
      expect(result.riskLevel).toBe('medium');
    });

    it('should not halt action for non-sensitive data', () => {
      const text = 'Schedule a meeting for next week';
      
      const result = sensitiveDataService.shouldHaltAgenticAction(text, 'calendar');
      
      expect(result.shouldHalt).toBe(false);
      expect(result.riskLevel).toBe('low');
    });
  });

  describe('sanitizeForLogging', () => {
    it('should redact sensitive data in log messages', () => {
      const text = 'User SSN is 123-45-6789 and email is john@example.com';
      
      const sanitized = sensitiveDataService.sanitizeForLogging(text);
      
      expect(sanitized).not.toContain('123-45-6789');
      expect(sanitized).not.toContain('john@example.com');
      expect(sanitized).toContain('XXX-XX-6789');
      expect(sanitized).toContain('j***@example.com');
    });

    it('should return original text if no sensitive data', () => {
      const text = 'This is a normal log message';
      
      const sanitized = sensitiveDataService.sanitizeForLogging(text);
      
      expect(sanitized).toBe(text);
    });
  });

  describe('custom patterns', () => {
    it('should allow adding custom sensitive data patterns', () => {
      const customPattern = {
        name: 'employee_id',
        pattern: /EMP\d{6}/g,
        riskLevel: 'medium' as const,
        description: 'Employee ID'
      };
      
      sensitiveDataService.addCustomPattern(customPattern);
      
      const text = 'Employee EMP123456 needs access';
      const classification = sensitiveDataService.classifyText(text);
      
      expect(classification.hasSensitiveData).toBe(true);
      expect(classification.matches[0].pattern).toBe('employee_id');
    });

    it('should return all configured patterns', () => {
      const patterns = sensitiveDataService.getPatterns();
      
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns.some(p => p.name === 'ssn')).toBe(true);
      expect(patterns.some(p => p.name === 'email')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty strings', () => {
      const classification = sensitiveDataService.classifyText('');
      
      expect(classification.hasSensitiveData).toBe(false);
      expect(classification.matches).toHaveLength(0);
    });

    it('should handle very long text', () => {
      const longText = 'Normal text '.repeat(1000) + 'SSN: 123-45-6789';
      
      const classification = sensitiveDataService.classifyText(longText);
      
      expect(classification.hasSensitiveData).toBe(true);
      expect(classification.matches).toHaveLength(1);
    });

    it('should handle special characters and formatting', () => {
      const text = 'SSN: 123.45.6789 or 123 45 6789';
      
      const classification = sensitiveDataService.classifyText(text);
      
      expect(classification.hasSensitiveData).toBe(true);
      expect(classification.matches.length).toBeGreaterThanOrEqual(1);
    });
  });
});