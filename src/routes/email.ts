import { Router, Request, Response } from 'express';
import { EmailIntegrationService } from '../services/email/emailIntegrationService';
import { EmailOAuthService } from '../services/email/oauthService';
import { authenticateToken } from '../middleware/auth';
import { logger } from '../utils/logger';
import Joi from 'joi';

const router = Router();

// Validation schemas
const addAccountSchema = Joi.object({
  email: Joi.string().email().required(),
  provider: Joi.string().valid('gmail', 'outlook', 'exchange', 'imap').required(),
  imapConfig: Joi.object({
    host: Joi.string().required(),
    port: Joi.number().integer().min(1).max(65535).required(),
    secure: Joi.boolean().required(),
    auth: Joi.object({
      user: Joi.string().required(),
      pass: Joi.string().optional(),
      accessToken: Joi.string().optional(),
      refreshToken: Joi.string().optional(),
    }).required(),
  }).required(),
  smtpConfig: Joi.object({
    host: Joi.string().required(),
    port: Joi.number().integer().min(1).max(65535).required(),
    secure: Joi.boolean().required(),
    auth: Joi.object({
      user: Joi.string().required(),
      pass: Joi.string().optional(),
      accessToken: Joi.string().optional(),
      refreshToken: Joi.string().optional(),
    }).required(),
  }).required(),
  isActive: Joi.boolean().default(true),
});

const searchSchema = Joi.object({
  accountId: Joi.string().uuid().optional(),
  clientId: Joi.string().uuid().optional(),
  from: Joi.string().optional(),
  to: Joi.string().optional(),
  subject: Joi.string().optional(),
  body: Joi.string().optional(),
  dateFrom: Joi.date().optional(),
  dateTo: Joi.date().optional(),
  hasAttachments: Joi.boolean().optional(),
  isRead: Joi.boolean().optional(),
  tags: Joi.array().items(Joi.string()).optional(),
  folder: Joi.string().optional(),
  limit: Joi.number().integer().min(1).max(100).default(20),
  offset: Joi.number().integer().min(0).default(0),
});

// Initialize services (these would be injected in a real app)
let emailService: EmailIntegrationService;
let oauthService: EmailOAuthService;

// Middleware to ensure services are initialized
const ensureServices = (req: Request, res: Response, next: any): void => {
  if (!emailService || !oauthService) {
    res.status(500).json({ error: 'Email services not initialized' });
    return;
  }
  next();
};

// OAuth authorization URL
router.get('/oauth/authorize/:provider', authenticateToken, ensureServices, async (req: Request, res: Response): Promise<void> => {
  try {
    const { provider } = req.params;
    const { state } = req.query;

    if (!['gmail', 'outlook', 'exchange'].includes(provider)) {
      res.status(400).json({ error: 'Unsupported provider' });
      return;
    }

    const authUrl = oauthService.getAuthorizationUrl(provider, state as string);
    
    res.json({ authorizationUrl: authUrl });
  } catch (error) {
    logger.error('OAuth authorization URL error:', error);
    res.status(500).json({ error: 'Failed to generate authorization URL' });
  }
});

// OAuth callback
router.post('/oauth/callback/:provider', authenticateToken, ensureServices, async (req: Request, res: Response): Promise<void> => {
  try {
    const { provider } = req.params;
    const { code, state } = req.body;

    if (!code) {
      res.status(400).json({ error: 'Authorization code required' });
      return;
    }

    const tokens = await oauthService.exchangeCodeForTokens(provider, code, state);
    
    res.json({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });
  } catch (error) {
    logger.error('OAuth callback error:', error);
    res.status(500).json({ error: 'Failed to exchange authorization code' });
  }
});

// Get email accounts
router.get('/accounts', authenticateToken, ensureServices, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const accounts = await emailService.getEmailAccounts(userId);
    
    // Remove sensitive auth data from response
    const sanitizedAccounts = accounts.map(account => ({
      ...account,
      imapConfig: {
        ...account.imapConfig,
        auth: {
          user: account.imapConfig.auth.user,
          // Don't expose passwords or tokens
        },
      },
      smtpConfig: {
        ...account.smtpConfig,
        auth: {
          user: account.smtpConfig.auth.user,
        },
      },
    }));
    
    res.json(sanitizedAccounts);
  } catch (error) {
    logger.error('Get email accounts error:', error);
    res.status(500).json({ error: 'Failed to get email accounts' });
  }
});

// Add email account
router.post('/accounts', authenticateToken, ensureServices, async (req: Request, res: Response): Promise<void> => {
  try {
    const { error, value } = addAccountSchema.validate(req.body);
    if (error) {
      res.status(400).json({ error: error.details[0].message });
      return;
    }

    const userId = (req as any).user.id;
    const accountData = {
      ...value,
      userId,
    };

    const account = await emailService.addEmailAccount(accountData);
    
    // Remove sensitive data from response
    const sanitizedAccount = {
      ...account,
      imapConfig: {
        ...account.imapConfig,
        auth: {
          user: account.imapConfig.auth.user,
        },
      },
      smtpConfig: {
        ...account.smtpConfig,
        auth: {
          user: account.smtpConfig.auth.user,
        },
      },
    };
    
    res.status(201).json(sanitizedAccount);
  } catch (error) {
    logger.error('Add email account error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to add email account';
    res.status(500).json({ error: errorMessage });
  }
});

// Remove email account
router.delete('/accounts/:accountId', authenticateToken, ensureServices, async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    const userId = (req as any).user.id;

    // Verify account belongs to user
    const accounts = await emailService.getEmailAccounts(userId);
    const account = accounts.find(a => a.id === accountId);
    
    if (!account) {
      res.status(404).json({ error: 'Email account not found' });
      return;
    }

    await emailService.removeEmailAccount(accountId);
    
    res.status(204).send();
  } catch (error) {
    logger.error('Remove email account error:', error);
    res.status(500).json({ error: 'Failed to remove email account' });
  }
});

// Start sync for account
router.post('/accounts/:accountId/sync/start', authenticateToken, ensureServices, async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    const userId = (req as any).user.id;

    // Verify account belongs to user
    const accounts = await emailService.getEmailAccounts(userId);
    const account = accounts.find(a => a.id === accountId);
    
    if (!account) {
      res.status(404).json({ error: 'Email account not found' });
      return;
    }

    await emailService.startSync(account);
    
    res.json({ message: 'Sync started successfully' });
  } catch (error) {
    logger.error('Start sync error:', error);
    res.status(500).json({ error: 'Failed to start sync' });
  }
});

// Stop sync for account
router.post('/accounts/:accountId/sync/stop', authenticateToken, ensureServices, async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    const userId = (req as any).user.id;

    // Verify account belongs to user
    const accounts = await emailService.getEmailAccounts(userId);
    const account = accounts.find(a => a.id === accountId);
    
    if (!account) {
      res.status(404).json({ error: 'Email account not found' });
      return;
    }

    await emailService.stopSync(accountId);
    
    res.json({ message: 'Sync stopped successfully' });
  } catch (error) {
    logger.error('Stop sync error:', error);
    res.status(500).json({ error: 'Failed to stop sync' });
  }
});

// Get sync status
router.get('/accounts/:accountId/sync/status', authenticateToken, ensureServices, async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    const userId = (req as any).user.id;

    // Verify account belongs to user
    const accounts = await emailService.getEmailAccounts(userId);
    const account = accounts.find(a => a.id === accountId);
    
    if (!account) {
      res.status(404).json({ error: 'Email account not found' });
      return;
    }

    const status = await emailService.getAccountSyncStatus(accountId);
    
    res.json(status);
  } catch (error) {
    logger.error('Get sync status error:', error);
    res.status(500).json({ error: 'Failed to get sync status' });
  }
});

// Search messages
router.get('/messages/search', authenticateToken, ensureServices, async (req: Request, res: Response): Promise<void> => {
  try {
    const { error, value } = searchSchema.validate(req.query);
    if (error) {
      res.status(400).json({ error: error.details[0].message });
      return;
    }

    const userId = (req as any).user.id;
    
    // If no accountId specified, search across all user's accounts
    if (!value.accountId) {
      const accounts = await emailService.getEmailAccounts(userId);
      const accountIds = accounts.map(a => a.id);
      
      if (accountIds.length === 0) {
        res.json([]);
        return;
      }
      
      // Search across all accounts (simplified - in production, you'd want to optimize this)
      const allMessages = [];
      for (const accountId of accountIds) {
        const messages = await emailService.searchMessages({ ...value, accountId });
        allMessages.push(...messages);
      }
      
      // Sort by date and apply limit/offset
      allMessages.sort((a, b) => b.date.getTime() - a.date.getTime());
      const start = value.offset || 0;
      const end = start + (value.limit || 20);
      
      res.json(allMessages.slice(start, end));
      return;
    }

    // Verify account belongs to user
    const accounts = await emailService.getEmailAccounts(userId);
    const account = accounts.find(a => a.id === value.accountId);
    
    if (!account) {
      res.status(404).json({ error: 'Email account not found' });
      return;
    }

    const messages = await emailService.searchMessages(value);
    
    res.json(messages);
  } catch (error) {
    logger.error('Search messages error:', error);
    res.status(500).json({ error: 'Failed to search messages' });
  }
});

// Get message by ID
router.get('/messages/:messageId', authenticateToken, ensureServices, async (req: Request, res: Response): Promise<void> => {
  try {
    const { messageId } = req.params;
    const userId = (req as any).user.id;

    // Search for the message across user's accounts
    const messages = await emailService.searchMessages({ 
      limit: 1,
      offset: 0 
    });
    
    const message = messages.find(m => m.id === messageId);
    
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    // Verify message belongs to user's account
    const accounts = await emailService.getEmailAccounts(userId);
    const hasAccess = accounts.some(a => a.id === message.accountId);
    
    if (!hasAccess) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.json(message);
  } catch (error) {
    logger.error('Get message error:', error);
    res.status(500).json({ error: 'Failed to get message' });
  }
});

// Initialize services function (to be called from main app)
export const initializeEmailServices = (
  emailIntegrationService: EmailIntegrationService,
  emailOAuthService: EmailOAuthService
) => {
  emailService = emailIntegrationService;
  oauthService = emailOAuthService;
};

export default router;