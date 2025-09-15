import { EmailParser } from '../../services/email/emailParser';
import { EmailMessage } from '../../types/email';

describe('EmailParser', () => {
  let parser: EmailParser;

  beforeEach(() => {
    parser = new EmailParser();
  });

  const createMockMessage = (overrides: Partial<EmailMessage> = {}): EmailMessage => ({
    id: 'test-message-id',
    accountId: 'test-account-id',
    messageId: 'test-msg-id',
    uid: 123,
    folder: 'INBOX',
    from: [{ address: 'sender@example.com', name: 'Sender' }],
    to: [{ address: 'test@example.com', name: 'Test User' }],
    subject: 'Test Subject',
    body: { text: 'Test body content' },
    date: new Date(),
    flags: [],
    isRead: false,
    isImportant: false,
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  describe('parseAndExtractMetadata', () => {
    it('should extract phone numbers from email content', () => {
      const message = createMockMessage({
        subject: 'Call me at (555) 123-4567',
        body: { text: 'My number is 555-987-6543 or +1-555-111-2222' },
      });

      const result = parser.parseAndExtractMetadata(message);

      expect(result.extractedData?.phoneNumbers).toContain('(555) 123-4567');
      expect(result.extractedData?.phoneNumbers).toContain('555-987-6543');
      expect(result.extractedData?.phoneNumbers).toContain('+1-555-111-2222');
    });

    it('should extract email addresses from content', () => {
      const message = createMockMessage({
        subject: 'Contact john.doe@company.com',
        body: { text: 'Also reach out to support@example.org' },
      });

      const result = parser.parseAndExtractMetadata(message);

      expect(result.extractedData?.emails).toContain('john.doe@company.com');
      expect(result.extractedData?.emails).toContain('support@example.org');
    });

    it('should extract dates from content', () => {
      const message = createMockMessage({
        subject: 'Meeting on 12/25/2023',
        body: { text: 'Follow up by 2023-12-31' },
      });

      const result = parser.parseAndExtractMetadata(message);

      expect(result.extractedData?.dates).toHaveLength(2);
      expect(result.extractedData?.dates?.[0]).toBeInstanceOf(Date);
    });

    it('should extract insurance-related keywords', () => {
      const message = createMockMessage({
        subject: 'Policy renewal reminder',
        body: { text: 'Your premium payment is due. Please review your coverage and deductible.' },
      });

      const result = parser.parseAndExtractMetadata(message);

      expect(result.extractedData?.keywords).toContain('policy');
      expect(result.extractedData?.keywords).toContain('premium');
      expect(result.extractedData?.keywords).toContain('coverage');
      expect(result.extractedData?.keywords).toContain('deductible');
    });

    it('should auto-tag urgent messages', () => {
      const message = createMockMessage({
        subject: 'URGENT: Emergency claim',
        body: { text: 'This is critical and needs immediate attention ASAP!' },
      });

      const result = parser.parseAndExtractMetadata(message);

      expect(result.tags).toContain('urgent');
    });

    it('should auto-tag follow-up messages', () => {
      const message = createMockMessage({
        subject: 'Follow up on our meeting',
        body: { text: 'Next steps: schedule a call back and review action items' },
      });

      const result = parser.parseAndExtractMetadata(message);

      expect(result.tags).toContain('follow-up');
    });

    it('should auto-tag client-related messages', () => {
      const message = createMockMessage({
        subject: 'Insurance policy question',
        body: { text: 'I have a question about my claim and coverage details' },
      });

      const result = parser.parseAndExtractMetadata(message);

      expect(result.tags).toContain('client-related');
    });

    it('should tag messages with sender domain', () => {
      const message = createMockMessage({
        from: [{ address: 'client@company.com', name: 'Client Name' }],
      });

      const result = parser.parseAndExtractMetadata(message);

      expect(result.tags).toContain('domain:company.com');
    });

    it('should tag after-hours messages', () => {
      const afterHoursDate = new Date();
      afterHoursDate.setHours(20); // 8 PM

      const message = createMockMessage({
        date: afterHoursDate,
      });

      const result = parser.parseAndExtractMetadata(message);

      expect(result.tags).toContain('after-hours');
    });

    it('should tag messages with attachments', () => {
      const message = createMockMessage({
        attachments: [
          {
            id: 'att-1',
            filename: 'document.pdf',
            contentType: 'application/pdf',
            size: 1024,
            isInline: false,
          },
        ],
      });

      const result = parser.parseAndExtractMetadata(message);

      expect(result.tags).toContain('has-attachments');
    });

    it('should calculate positive sentiment', () => {
      const message = createMockMessage({
        subject: 'Thank you for excellent service',
        body: { text: 'I am very happy and satisfied with your wonderful support. Great job!' },
      });

      const result = parser.parseAndExtractMetadata(message);

      expect(result.sentiment).toBeGreaterThan(0);
    });

    it('should calculate negative sentiment', () => {
      const message = createMockMessage({
        subject: 'Terrible experience',
        body: { text: 'I am very disappointed and frustrated with the poor service. This is awful!' },
      });

      const result = parser.parseAndExtractMetadata(message);

      expect(result.sentiment).toBeLessThan(0);
    });

    it('should calculate neutral sentiment', () => {
      const message = createMockMessage({
        subject: 'Policy information',
        body: { text: 'Please find the requested policy documents attached.' },
      });

      const result = parser.parseAndExtractMetadata(message);

      expect(result.sentiment).toBe(0);
    });
  });

  describe('extractClientIdentifiers', () => {
    const mockCrmClients = [
      {
        id: 'client-1',
        name: 'John Doe',
        email: 'john.doe@example.com',
        phone: '555-123-4567',
      },
      {
        id: 'client-2',
        name: 'Jane Smith',
        email: 'jane.smith@company.com',
        phone: '555-987-6543',
      },
    ];

    it('should match client by email address', () => {
      const message = createMockMessage({
        from: [{ address: 'john.doe@example.com', name: 'John Doe' }],
      });

      const result = parser.extractClientIdentifiers(message, mockCrmClients);

      expect(result).toBe('client-1');
    });

    it('should match client by phone number in content', () => {
      const message = createMockMessage({
        from: [{ address: 'unknown@example.com', name: 'Unknown' }],
        body: { text: 'Please call me back at (555) 987-6543' },
      });

      const result = parser.extractClientIdentifiers(message, mockCrmClients);

      expect(result).toBe('client-2');
    });

    it('should match client by name', () => {
      const message = createMockMessage({
        from: [{ address: 'different@example.com', name: 'Jane Smith' }],
      });

      const result = parser.extractClientIdentifiers(message, mockCrmClients);

      expect(result).toBe('client-2');
    });

    it('should return null if no match found', () => {
      const message = createMockMessage({
        from: [{ address: 'unknown@example.com', name: 'Unknown Person' }],
        body: { text: 'No identifying information here' },
      });

      const result = parser.extractClientIdentifiers(message, mockCrmClients);

      expect(result).toBeNull();
    });

    it('should handle case-insensitive matching', () => {
      const message = createMockMessage({
        from: [{ address: 'JOHN.DOE@EXAMPLE.COM', name: 'JOHN DOE' }],
      });

      const result = parser.extractClientIdentifiers(message, mockCrmClients);

      expect(result).toBe('client-1');
    });

    it('should handle partial name matching', () => {
      const message = createMockMessage({
        from: [{ address: 'j.doe@example.com', name: 'John' }],
      });

      const result = parser.extractClientIdentifiers(message, mockCrmClients);

      expect(result).toBe('client-1');
    });

    it('should normalize phone numbers for matching', () => {
      const message = createMockMessage({
        body: { text: 'Call me at 5559876543' }, // No formatting
      });

      const result = parser.extractClientIdentifiers(message, mockCrmClients);

      expect(result).toBe('client-2');
    });
  });
});