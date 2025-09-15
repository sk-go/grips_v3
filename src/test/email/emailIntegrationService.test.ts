import { EmailIntegrationService } from '../../services/email/emailIntegrationService';
import { EmailParser } from '../../services/email/emailParser';
import { EmailOAuthService } from '../../services/email/oauthService';
import { CacheService } from '../../services/cacheService';
import { DatabaseService } from '../../services/database';
import { EmailAccount, EmailMessage } from '../../types/email';

// Mock dependencies
jest.mock('../../services/cacheService');
jest.mock('../../services/database');
jest.mock('../../services/email/emailParser');
jest.mock('../../services/email/oauthService');
jest.mock('../../services/email/imapClient');

describe('EmailIntegrationService', () => {
  let emailService: EmailIntegrationService;
  let mockCacheService: jest.Mocked<CacheService>;
  let mockDbService: jest.Mocked<DatabaseService>;
  let mockOAuthService: jest.Mocked<EmailOAuthService>;

  const mockAccount: EmailAccount = {
    id: 'test-account-id',
    userId: 'test-user-id',
    email: 'test@example.com',
    provider: 'gmail',
    imapConfig: {
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: 'test@example.com',
        accessToken: 'test-token',
        refreshToken: 'test-refresh-token',
      },
    },
    smtpConfig: {
      host: 'smtp.gmail.com',
      port: 587,
      secure: true,
      auth: {
        user: 'test@example.com',
        accessToken: 'test-token',
        refreshToken: 'test-refresh-token',
      },
    },
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    // Create proper mocks
    mockCacheService = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn(),
    } as jest.Mocked<CacheService>;

    mockDbService = {
      query: jest.fn(),
      initialize: jest.fn(),
      close: jest.fn(),
    } as jest.Mocked<DatabaseService>;

    mockOAuthService = {
      getAuthorizationUrl: jest.fn(),
      exchangeCodeForTokens: jest.fn(),
      refreshAccessToken: jest.fn(),
      validateToken: jest.fn(),
    } as jest.Mocked<EmailOAuthService>;
    
    const oauthConfig = {
      gmail: {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      },
    };

    emailService = new EmailIntegrationService(
      mockCacheService,
      mockDbService,
      oauthConfig
    );

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('addEmailAccount', () => {
    it('should add a new email account successfully', async () => {
      // Mock database insert
      mockDbService.query.mockResolvedValue({
        rows: [{
          id: mockAccount.id,
          user_id: mockAccount.userId,
          email: mockAccount.email,
          provider: mockAccount.provider,
          imap_config: mockAccount.imapConfig,
          smtp_config: mockAccount.smtpConfig,
          is_active: mockAccount.isActive,
          created_at: mockAccount.createdAt,
          updated_at: mockAccount.updatedAt,
        }],
      });

      const accountData = {
        userId: mockAccount.userId,
        email: mockAccount.email,
        provider: mockAccount.provider,
        imapConfig: mockAccount.imapConfig,
        smtpConfig: mockAccount.smtpConfig,
        isActive: mockAccount.isActive,
      };

      const result = await emailService.addEmailAccount(accountData);

      expect(result).toMatchObject({
        id: mockAccount.id,
        email: mockAccount.email,
        provider: mockAccount.provider,
      });

      expect(mockDbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO email_accounts'),
        expect.arrayContaining([
          mockAccount.userId,
          mockAccount.email,
          mockAccount.provider,
        ])
      );
    });

    it('should handle account with basic auth', async () => {
      const basicAuthAccount = {
        ...mockAccount,
        imapConfig: {
          ...mockAccount.imapConfig,
          auth: {
            user: 'test@example.com',
            pass: 'password',
          },
        },
      };

      mockDbService.query.mockResolvedValue({
        rows: [{ ...basicAuthAccount, id: 'basic-auth-id' }],
      });

      const accountData = {
        userId: basicAuthAccount.userId,
        email: basicAuthAccount.email,
        provider: basicAuthAccount.provider,
        imapConfig: basicAuthAccount.imapConfig,
        smtpConfig: basicAuthAccount.smtpConfig,
        isActive: basicAuthAccount.isActive,
      };

      const result = await emailService.addEmailAccount(accountData);

      expect(result).toMatchObject({
        email: basicAuthAccount.email,
        provider: basicAuthAccount.provider,
      });
    });
  });

  describe('getEmailAccounts', () => {
    it('should return user email accounts', async () => {
      mockDbService.query.mockResolvedValue({
        rows: [{
          id: mockAccount.id,
          user_id: mockAccount.userId,
          email: mockAccount.email,
          provider: mockAccount.provider,
          imap_config: mockAccount.imapConfig,
          smtp_config: mockAccount.smtpConfig,
          is_active: mockAccount.isActive,
          last_sync_at: mockAccount.lastSyncAt,
          sync_state: mockAccount.syncState,
          created_at: mockAccount.createdAt,
          updated_at: mockAccount.updatedAt,
        }],
      });

      const result = await emailService.getEmailAccounts(mockAccount.userId);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: mockAccount.id,
        email: mockAccount.email,
        provider: mockAccount.provider,
      });

      expect(mockDbService.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM email_accounts WHERE user_id = $1'),
        [mockAccount.userId]
      );
    });

    it('should return empty array if no accounts found', async () => {
      mockDbService.query.mockResolvedValue({ rows: [] });

      const result = await emailService.getEmailAccounts('non-existent-user');

      expect(result).toHaveLength(0);
    });
  });

  describe('removeEmailAccount', () => {
    it('should remove email account successfully', async () => {
      mockDbService.query.mockResolvedValue({ rows: [] });
      mockCacheService.delete.mockResolvedValue(true);

      await emailService.removeEmailAccount(mockAccount.id);

      expect(mockDbService.query).toHaveBeenCalledWith(
        'DELETE FROM email_accounts WHERE id = $1',
        [mockAccount.id]
      );
      expect(mockCacheService.delete).toHaveBeenCalledWith(
        `email_messages:${mockAccount.id}:*`
      );
    });
  });

  describe('searchMessages', () => {
    const mockMessage: EmailMessage = {
      id: 'test-message-id',
      accountId: mockAccount.id,
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
      tags: ['test'],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should search messages with basic query', async () => {
      mockDbService.query.mockResolvedValue({
        rows: [{
          id: mockMessage.id,
          account_id: mockMessage.accountId,
          message_id: mockMessage.messageId,
          uid: mockMessage.uid,
          folder: mockMessage.folder,
          from_addresses: mockMessage.from,
          to_addresses: mockMessage.to,
          subject: mockMessage.subject,
          body_text: mockMessage.body?.text,
          body_html: mockMessage.body?.html,
          date: mockMessage.date,
          flags: mockMessage.flags,
          is_read: mockMessage.isRead,
          is_important: mockMessage.isImportant,
          tags: mockMessage.tags,
          created_at: mockMessage.createdAt,
          updated_at: mockMessage.updatedAt,
        }],
      });

      const query = {
        accountId: mockAccount.id,
        subject: 'Test',
        limit: 10,
        offset: 0,
      };

      const result = await emailService.searchMessages(query);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: mockMessage.id,
        subject: mockMessage.subject,
      });

      expect(mockDbService.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM email_messages WHERE 1=1'),
        expect.arrayContaining([mockAccount.id, '%Test%', 10, 0])
      );
    });

    it('should search messages with date range', async () => {
      mockDbService.query.mockResolvedValue({ rows: [] });

      const dateFrom = new Date('2023-01-01');
      const dateTo = new Date('2023-12-31');

      const query = {
        accountId: mockAccount.id,
        dateFrom,
        dateTo,
        limit: 20,
      };

      await emailService.searchMessages(query);

      expect(mockDbService.query).toHaveBeenCalledWith(
        expect.stringContaining('AND date >= $2 AND date <= $3'),
        expect.arrayContaining([mockAccount.id, dateFrom, dateTo, 20])
      );
    });

    it('should search messages with tags filter', async () => {
      mockDbService.query.mockResolvedValue({ rows: [] });

      const query = {
        accountId: mockAccount.id,
        tags: ['urgent', 'client-related'],
        limit: 20,
      };

      await emailService.searchMessages(query);

      expect(mockDbService.query).toHaveBeenCalledWith(
        expect.stringContaining('AND tags::jsonb ?| $2'),
        expect.arrayContaining([mockAccount.id, ['urgent', 'client-related'], 20])
      );
    });
  });

  describe('getAccountSyncStatus', () => {
    it('should return sync status for account', async () => {
      const lastSyncAt = new Date();
      const syncState = { folderStates: { INBOX: { lastUid: 100 } } };

      mockDbService.query.mockResolvedValue({
        rows: [{
          last_sync_at: lastSyncAt,
          sync_state: syncState,
        }],
      });

      const result = await emailService.getAccountSyncStatus(mockAccount.id);

      expect(result).toEqual({
        lastSyncAt,
        syncState,
        isActive: false, // No active connection in test
      });

      expect(mockDbService.query).toHaveBeenCalledWith(
        'SELECT last_sync_at, sync_state FROM email_accounts WHERE id = $1',
        [mockAccount.id]
      );
    });

    it('should throw error if account not found', async () => {
      mockDbService.query.mockResolvedValue({ rows: [] });

      await expect(emailService.getAccountSyncStatus('non-existent')).rejects.toThrow(
        'Account not found'
      );
    });
  });
});