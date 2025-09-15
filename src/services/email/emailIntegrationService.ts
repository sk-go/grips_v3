import { EventEmitter } from 'events';
import { EmailAccount, EmailMessage, EmailSyncResult, EmailSearchQuery } from '../../types/email';
import { ImapClient } from './imapClient';
import { EmailParser } from './emailParser';
import { EmailOAuthService } from './oauthService';
import { logger } from '../../utils/logger';
import { CacheService } from '../cacheService';
import { DatabaseService } from '../database';

export class EmailIntegrationService extends EventEmitter {
  private activeConnections: Map<string, ImapClient> = new Map();
  private syncIntervals: Map<string, NodeJS.Timeout> = new Map();
  private parser: EmailParser;
  private oauthService: EmailOAuthService;

  constructor(
    private cacheService: CacheService,
    oauthConfig: any
  ) {
    super();
    this.parser = new EmailParser();
    this.oauthService = new EmailOAuthService(oauthConfig);
  }

  public async addEmailAccount(account: Omit<EmailAccount, 'id' | 'createdAt' | 'updatedAt'>): Promise<EmailAccount> {
    try {
      // Validate OAuth token if present
      if (account.imapConfig.auth.accessToken) {
        const isValid = await this.oauthService.validateToken(
          account.provider,
          account.imapConfig.auth.accessToken
        );
        
        if (!isValid && account.imapConfig.auth.refreshToken) {
          // Try to refresh the token
          const newTokens = await this.oauthService.refreshAccessToken(
            account.provider,
            account.imapConfig.auth.refreshToken
          );
          
          account.imapConfig.auth.accessToken = newTokens.accessToken;
          account.smtpConfig.auth.accessToken = newTokens.accessToken;
          
          if (newTokens.refreshToken) {
            account.imapConfig.auth.refreshToken = newTokens.refreshToken;
            account.smtpConfig.auth.refreshToken = newTokens.refreshToken;
          }
        }
      }

      // Test connection
      const testClient = new ImapClient(account as EmailAccount);
      await testClient.connect();
      await testClient.disconnect();

      // Save to database
      const query = `
        INSERT INTO email_accounts (
          user_id, email, provider, imap_config, smtp_config, 
          is_active, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        RETURNING *
      `;
      
      const result = await DatabaseService.query(query, [
        account.userId,
        account.email,
        account.provider,
        JSON.stringify(account.imapConfig),
        JSON.stringify(account.smtpConfig),
        account.isActive
      ]);

      const savedAccount = this.mapDbRowToEmailAccount(result.rows[0]);
      
      // Start sync if active
      if (savedAccount.isActive) {
        await this.startSync(savedAccount);
      }

      logger.info(`Email account added: ${savedAccount.email}`);
      this.emit('accountAdded', savedAccount);
      
      return savedAccount;
    } catch (error) {
      logger.error(`Failed to add email account ${account.email}:`, error);
      throw new Error(`Failed to add email account: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  public async removeEmailAccount(accountId: string): Promise<void> {
    try {
      // Stop sync
      await this.stopSync(accountId);

      // Remove from database
      await DatabaseService.query('DELETE FROM email_accounts WHERE id = $1', [accountId]);

      // Clear cached messages
      await this.cacheService.delete(`email_messages:${accountId}:*`);

      logger.info(`Email account removed: ${accountId}`);
      this.emit('accountRemoved', accountId);
    } catch (error) {
      logger.error(`Failed to remove email account ${accountId}:`, error);
      throw error;
    }
  }

  public async getEmailAccounts(userId: string): Promise<EmailAccount[]> {
    try {
      const query = 'SELECT * FROM email_accounts WHERE user_id = $1 ORDER BY created_at DESC';
      const result = await DatabaseService.query(query, [userId]);
      
      return result.rows.map((row: any) => this.mapDbRowToEmailAccount(row));
    } catch (error) {
      logger.error(`Failed to get email accounts for user ${userId}:`, error);
      throw error;
    }
  }

  public async startSync(account: EmailAccount): Promise<void> {
    try {
      // Stop existing sync if running
      await this.stopSync(account.id);

      // Create IMAP connection
      const client = new ImapClient(account);
      await client.connect();
      
      this.activeConnections.set(account.id, client);

      // Perform initial sync
      await this.performSync(account);

      // Schedule periodic sync (every 5 minutes)
      const interval = setInterval(async () => {
        try {
          await this.performSync(account);
        } catch (error) {
          logger.error(`Sync error for account ${account.email}:`, error);
          this.emit('syncError', { accountId: account.id, error });
        }
      }, 5 * 60 * 1000);

      this.syncIntervals.set(account.id, interval);
      
      logger.info(`Email sync started for account: ${account.email}`);
      this.emit('syncStarted', account.id);
    } catch (error) {
      logger.error(`Failed to start sync for account ${account.email}:`, error);
      throw error;
    }
  }

  public async stopSync(accountId: string): Promise<void> {
    try {
      // Clear interval
      const interval = this.syncIntervals.get(accountId);
      if (interval) {
        clearInterval(interval);
        this.syncIntervals.delete(accountId);
      }

      // Disconnect IMAP client
      const client = this.activeConnections.get(accountId);
      if (client) {
        await client.disconnect();
        this.activeConnections.delete(accountId);
      }

      logger.info(`Email sync stopped for account: ${accountId}`);
      this.emit('syncStopped', accountId);
    } catch (error) {
      logger.error(`Failed to stop sync for account ${accountId}:`, error);
      throw error;
    }
  }

  private async performSync(account: EmailAccount): Promise<EmailSyncResult> {
    const startTime = Date.now();
    const result: EmailSyncResult = {
      accountId: account.id,
      newMessages: 0,
      updatedMessages: 0,
      errors: [],
      syncDuration: 0,
      lastSyncAt: new Date(),
    };

    try {
      const client = this.activeConnections.get(account.id);
      if (!client || !client.isConnectionActive()) {
        throw new Error('IMAP client not connected');
      }

      // Get folders to sync (INBOX and Sent)
      const folders = ['INBOX', 'Sent', 'OUTBOX'];
      
      for (const folder of folders) {
        try {
          await client.selectFolder(folder);
          
          // Get last synced UID for this folder
          const lastUid = account.syncState?.folderStates?.[folder]?.lastUid || 0;
          
          // Fetch new messages
          const messages = await client.fetchNewMessages(folder, lastUid);
          
          for (const message of messages) {
            try {
              // Parse and extract metadata
              const parsedMessage = this.parser.parseAndExtractMetadata(message);
              
              // Try to link to CRM client
              const crmClients = await this.getCrmClients(account.userId);
              parsedMessage.clientId = this.parser.extractClientIdentifiers(parsedMessage, crmClients) || undefined;
              
              // Save to database
              await this.saveMessage(parsedMessage);
              
              // Cache for quick access
              await this.cacheService.set(
                `email_message:${parsedMessage.id}`,
                JSON.stringify(parsedMessage),
                3600 // 1 hour
              );
              
              result.newMessages++;
              
              // Emit event for real-time updates
              this.emit('newMessage', parsedMessage);
              
            } catch (messageError) {
              logger.error(`Failed to process message ${message.id}:`, messageError);
              result.errors.push(`Message ${message.id}: ${messageError instanceof Error ? messageError.message : 'Unknown error'}`);
            }
          }
          
          // Update sync state
          if (messages.length > 0) {
            const maxUid = Math.max(...messages.map(m => m.uid));
            await this.updateSyncState(account.id, folder, { lastUid: maxUid });
          }
          
        } catch (folderError) {
          logger.error(`Failed to sync folder ${folder} for account ${account.email}:`, folderError);
          result.errors.push(`Folder ${folder}: ${folderError instanceof Error ? folderError.message : 'Unknown error'}`);
        }
      }

      // Update last sync time
      await DatabaseService.query(
        'UPDATE email_accounts SET last_sync_at = NOW() WHERE id = $1',
        [account.id]
      );

    } catch (error) {
      logger.error(`Sync failed for account ${account.email}:`, error);
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
    }

    result.syncDuration = Date.now() - startTime;
    
    logger.debug(`Sync completed for ${account.email}: ${result.newMessages} new messages`);
    this.emit('syncCompleted', result);
    
    return result;
  }

  private async saveMessage(message: EmailMessage): Promise<void> {
    const query = `
      INSERT INTO email_messages (
        id, account_id, message_id, uid, thread_id, folder,
        from_addresses, to_addresses, cc_addresses, bcc_addresses,
        subject, body_text, body_html, attachments, date,
        flags, is_read, is_important, labels, client_id,
        tags, sentiment, extracted_data, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, NOW(), NOW()
      ) ON CONFLICT (id) DO UPDATE SET
        flags = EXCLUDED.flags,
        is_read = EXCLUDED.is_read,
        is_important = EXCLUDED.is_important,
        labels = EXCLUDED.labels,
        tags = EXCLUDED.tags,
        sentiment = EXCLUDED.sentiment,
        updated_at = NOW()
    `;

    await DatabaseService.query(query, [
      message.id,
      message.accountId,
      message.messageId,
      message.uid,
      message.threadId,
      message.folder,
      JSON.stringify(message.from),
      JSON.stringify(message.to),
      JSON.stringify(message.cc),
      JSON.stringify(message.bcc),
      message.subject,
      message.body?.text,
      message.body?.html,
      JSON.stringify(message.attachments),
      message.date,
      JSON.stringify(message.flags),
      message.isRead,
      message.isImportant,
      JSON.stringify(message.labels),
      message.clientId,
      JSON.stringify(message.tags),
      message.sentiment,
      JSON.stringify(message.extractedData)
    ]);
  }

  public async searchMessages(query: EmailSearchQuery): Promise<EmailMessage[]> {
    try {
      let sql = 'SELECT * FROM email_messages WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;

      if (query.accountId) {
        sql += ` AND account_id = $${paramIndex}`;
        params.push(query.accountId);
        paramIndex++;
      }

      if (query.clientId) {
        sql += ` AND client_id = $${paramIndex}`;
        params.push(query.clientId);
        paramIndex++;
      }

      if (query.from) {
        sql += ` AND from_addresses::text ILIKE $${paramIndex}`;
        params.push(`%${query.from}%`);
        paramIndex++;
      }

      if (query.subject) {
        sql += ` AND subject ILIKE $${paramIndex}`;
        params.push(`%${query.subject}%`);
        paramIndex++;
      }

      if (query.body) {
        sql += ` AND (body_text ILIKE $${paramIndex} OR body_html ILIKE $${paramIndex})`;
        params.push(`%${query.body}%`);
        paramIndex++;
      }

      if (query.dateFrom) {
        sql += ` AND date >= $${paramIndex}`;
        params.push(query.dateFrom);
        paramIndex++;
      }

      if (query.dateTo) {
        sql += ` AND date <= $${paramIndex}`;
        params.push(query.dateTo);
        paramIndex++;
      }

      if (query.hasAttachments !== undefined) {
        sql += ` AND (attachments IS ${query.hasAttachments ? 'NOT' : ''} NULL)`;
      }

      if (query.isRead !== undefined) {
        sql += ` AND is_read = $${paramIndex}`;
        params.push(query.isRead);
        paramIndex++;
      }

      if (query.tags && query.tags.length > 0) {
        sql += ` AND tags::jsonb ?| $${paramIndex}`;
        params.push(query.tags);
        paramIndex++;
      }

      sql += ' ORDER BY date DESC';

      if (query.limit) {
        sql += ` LIMIT $${paramIndex}`;
        params.push(query.limit);
        paramIndex++;
      }

      if (query.offset) {
        sql += ` OFFSET $${paramIndex}`;
        params.push(query.offset);
        paramIndex++;
      }

      const result = await DatabaseService.query(sql, params);
      return result.rows.map((row: any) => this.mapDbRowToEmailMessage(row));
    } catch (error) {
      logger.error('Failed to search messages:', error);
      throw error;
    }
  }

  private async getCrmClients(userId: string): Promise<any[]> {
    // This would integrate with the CRM service
    // For now, return empty array
    return [];
  }

  private async updateSyncState(accountId: string, folder: string, state: any): Promise<void> {
    const query = `
      UPDATE email_accounts 
      SET sync_state = COALESCE(sync_state, '{}'::jsonb) || 
          jsonb_build_object('folderStates', 
            COALESCE(sync_state->'folderStates', '{}'::jsonb) || 
            jsonb_build_object($2, $3)
          )
      WHERE id = $1
    `;
    
    await DatabaseService.query(query, [accountId, folder, JSON.stringify(state)]);
  }

  private mapDbRowToEmailAccount(row: any): EmailAccount {
    return {
      id: row.id,
      userId: row.user_id,
      email: row.email,
      provider: row.provider,
      imapConfig: row.imap_config,
      smtpConfig: row.smtp_config,
      isActive: row.is_active,
      lastSyncAt: row.last_sync_at,
      syncState: row.sync_state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapDbRowToEmailMessage(row: any): EmailMessage {
    return {
      id: row.id,
      accountId: row.account_id,
      messageId: row.message_id,
      uid: row.uid,
      threadId: row.thread_id,
      folder: row.folder,
      from: row.from_addresses,
      to: row.to_addresses,
      cc: row.cc_addresses,
      bcc: row.bcc_addresses,
      subject: row.subject,
      body: {
        text: row.body_text,
        html: row.body_html,
      },
      attachments: row.attachments,
      date: row.date,
      flags: row.flags,
      isRead: row.is_read,
      isImportant: row.is_important,
      labels: row.labels,
      clientId: row.client_id,
      tags: row.tags,
      sentiment: row.sentiment,
      extractedData: row.extracted_data,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public async getAccountSyncStatus(accountId: string): Promise<any> {
    const query = 'SELECT last_sync_at, sync_state FROM email_accounts WHERE id = $1';
    const result = await DatabaseService.query(query, [accountId]);
    
    if (result.rows.length === 0) {
      throw new Error('Account not found');
    }
    
    return {
      lastSyncAt: result.rows[0].last_sync_at,
      syncState: result.rows[0].sync_state,
      isActive: this.activeConnections.has(accountId),
    };
  }
}