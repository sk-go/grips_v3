import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { VoiceService } from './services/voice';

import { logger } from './utils/logger';
import { rateLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';
import { 
  securityHeaders, 
  enforceHTTPS, 
  sensitiveDataScanner, 
  validateTLS, 
  securityAuditLogger, 
  breachDetection 
} from './middleware/security';
import { authRoutes } from './routes/auth';
import { keycloakAuthRoutes } from './routes/keycloakAuth';
import { healthRoutes } from './routes/health';
import securityRoutes from './routes/security';
import emailRoutes, { initializeEmailServices } from './routes/email';
import twilioRoutes, { initializeTwilioServices } from './routes/twilio';
import communicationRoutes, { initializeCommunicationService } from './routes/communications';
import voiceRoutes, { initializeVoiceRoutes } from './routes/voice';
import { createClientProfileRoutes } from './routes/clientProfile';
import { createRelationshipInsightsRoutes } from './routes/relationshipInsights';
import createDocumentRoutes from './routes/documents';
import { PostgreSQLService } from './services/database/postgresqlService';
import { RedisService } from './services/redis';
import { CacheService } from './services/cacheService';
import { EmailIntegrationService } from './services/email/emailIntegrationService';
import { EmailOAuthService } from './services/email/oauthService';
import { TwilioService } from './services/twilio/twilioService';
import { OfficeHoursService } from './services/twilio/officeHoursService';
import { CommunicationCenterService } from './services/communication/communicationCenterService';
import { NLPService } from './services/nlp';
import { NLPConfig } from './types/nlp';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Initialize Voice Service
const voiceService = new VoiceService(server);

// Security middleware
app.use(enforceHTTPS);
app.use(validateTLS);
app.use(securityHeaders);
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3001',
  credentials: true
}));
app.use(securityAuditLogger);
app.use(breachDetection);
app.use(sensitiveDataScanner);

// Rate limiting
app.use(rateLimiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/keycloak-auth', keycloakAuthRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/twilio', twilioRoutes);
app.use('/api/communications', communicationRoutes);
app.use('/api/voice', voiceRoutes);
// Client profile routes will be added after database initialization

// WebSocket handling for AI interactions
wss.on('connection', (ws, req) => {
  logger.info('WebSocket connection established', { ip: req.socket.remoteAddress });
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      logger.info('WebSocket message received', { type: data.type });
      // AI interaction handling will be implemented in later tasks
    } catch (error: any) {
      logger.error('Invalid WebSocket message', { error: error.message });
      ws.send(JSON.stringify({ error: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    logger.info('WebSocket connection closed');
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Initialize PostgreSQL connection
    await PostgreSQLService.initialize();
    await PostgreSQLService.runMigrations();
    logger.info('PostgreSQL connection established');

    // Get the PostgreSQL pool for services
    const dbPool = PostgreSQLService.getPool();

    // Add client profile routes after database is initialized
    app.use('/api/clients', createClientProfileRoutes(dbPool, RedisService));
    app.use('/api/documents', createDocumentRoutes(dbPool));

    // Initialize Redis connection
    await RedisService.initialize();
    logger.info('Redis connection established');

    // Initialize NLP service
    const nlpCacheService = new CacheService(RedisService.getClient());
    const nlpConfig: NLPConfig = {
      grok: {
        apiKey: process.env.GROK_API_KEY || '',
        baseUrl: process.env.GROK_BASE_URL || 'https://api.x.ai/v1',
        model: process.env.GROK_MODEL || 'grok-beta',
        temperature: parseFloat(process.env.GROK_TEMPERATURE || '0.7'),
        maxTokens: parseInt(process.env.GROK_MAX_TOKENS || '2048')
      },
      languages: [
        { code: 'en', name: 'English', grokModel: 'grok-beta', supported: true },
        { code: 'es', name: 'Spanish', grokModel: 'grok-beta', supported: true }
      ],
      sentiment: {
        threshold: {
          veryNegative: -0.6,
          negative: -0.2,
          neutral: 0.2,
          positive: 0.6
        }
      },
      taskExtraction: {
        confidenceThreshold: 0.7,
        approvalThreshold: 0.8
      },
      vectorSearch: {
        enabled: process.env.VECTOR_SEARCH_ENABLED === 'true',
        dimensions: parseInt(process.env.VECTOR_SEARCH_DIMENSIONS || '1536'),
        similarityThreshold: parseFloat(process.env.VECTOR_SEARCH_THRESHOLD || '0.8')
      }
    };

    const nlpService = new NLPService(nlpCacheService, nlpConfig);
    logger.info('NLP service initialized');

    // Add relationship insights routes
    app.use('/api/relationship-insights', createRelationshipInsightsRoutes(dbPool, RedisService.getClient(), nlpService.getProcessor()));
    logger.info('Relationship insights routes initialized');

    // Initialize email services
    const cacheService = new CacheService(RedisService.getClient());
    const oauthConfig = {
      gmail: {
        clientId: process.env.GMAIL_CLIENT_ID || '',
        clientSecret: process.env.GMAIL_CLIENT_SECRET || '',
        redirectUri: process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/api/email/oauth/callback/gmail',
        scopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],
      },
      outlook: {
        clientId: process.env.OUTLOOK_CLIENT_ID || '',
        clientSecret: process.env.OUTLOOK_CLIENT_SECRET || '',
        redirectUri: process.env.OUTLOOK_REDIRECT_URI || 'http://localhost:3000/api/email/oauth/callback/outlook',
        scopes: ['https://graph.microsoft.com/mail.read', 'https://graph.microsoft.com/mail.send'],
      },
      exchange: {
        clientId: process.env.EXCHANGE_CLIENT_ID || '',
        clientSecret: process.env.EXCHANGE_CLIENT_SECRET || '',
        redirectUri: process.env.EXCHANGE_REDIRECT_URI || 'http://localhost:3000/api/email/oauth/callback/exchange',
        scopes: ['https://graph.microsoft.com/mail.read', 'https://graph.microsoft.com/mail.send'],
      },
    };

    const emailIntegrationService = new EmailIntegrationService(
      cacheService,
      oauthConfig
    );
    const emailOAuthService = new EmailOAuthService(oauthConfig);

    initializeEmailServices(emailIntegrationService, emailOAuthService);
    logger.info('Email services initialized');

    // Initialize Twilio services
    const twilioConfig = {
      accountSid: process.env.TWILIO_ACCOUNT_SID || '',
      authToken: process.env.TWILIO_AUTH_TOKEN || '',
      phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
      webhookBaseUrl: process.env.TWILIO_WEBHOOK_BASE_URL || 'http://localhost:3000',
      enableRecording: process.env.TWILIO_ENABLE_RECORDING === 'true',
      enableTranscription: process.env.TWILIO_ENABLE_TRANSCRIPTION === 'true',
      transcriptionAccuracyThreshold: parseFloat(process.env.TWILIO_TRANSCRIPTION_ACCURACY_THRESHOLD || '0.95'),
    };

    const twilioService = new TwilioService(twilioConfig, dbPool, cacheService);
    const officeHoursService = new OfficeHoursService(dbPool);

    // Setup Twilio webhooks if configured
    if (twilioConfig.accountSid && twilioConfig.authToken && twilioConfig.phoneNumber) {
      try {
        await twilioService.setupWebhooks();
        logger.info('Twilio webhooks configured');
      } catch (error) {
        logger.warn('Failed to setup Twilio webhooks:', error);
      }
    }

    initializeTwilioServices(twilioService, officeHoursService);
    logger.info('Twilio services initialized');

    // Initialize Communication Center service
    const communicationCenterService = new CommunicationCenterService(dbPool, cacheService);
    communicationCenterService.setWebSocketServer(wss);

    // Set up event listeners for real-time updates
    emailIntegrationService.on('newMessage', (message) => {
      // Convert email to unified communication and broadcast
      const unifiedComm = {
        id: message.id,
        type: 'email' as const,
        direction: 'inbound' as const,
        from: message.from[0]?.address || '',
        to: message.to[0]?.address || '',
        subject: message.subject,
        content: message.body?.text || message.body?.html || '',
        timestamp: message.date,
        clientId: message.clientId,
        tags: message.tags,
        isUrgent: message.isImportant,
        isRead: message.isRead,
        sentiment: message.sentiment,
        metadata: { originalType: 'email' },
        originalData: message,
      };
      communicationCenterService.broadcastNewCommunication(unifiedComm);
    });

    twilioService.on('incomingSms', (sms) => {
      // Convert SMS to unified communication and broadcast
      const unifiedComm = {
        id: sms.id,
        type: 'sms' as const,
        direction: sms.direction,
        from: sms.from,
        to: sms.to,
        subject: `SMS - ${sms.body.substring(0, 50)}`,
        content: sms.body,
        timestamp: sms.dateSent || sms.createdAt,
        clientId: sms.clientId,
        tags: sms.tags,
        isUrgent: false,
        isRead: true,
        metadata: { originalType: 'sms' },
        originalData: sms,
      };
      communicationCenterService.broadcastNewCommunication(unifiedComm);
    });

    twilioService.on('incomingCall', (call) => {
      // Convert call to unified communication and broadcast
      const unifiedComm = {
        id: call.id,
        type: 'call' as const,
        direction: call.direction,
        from: call.from,
        to: call.to,
        subject: `Call - ${call.duration ? `${call.duration}s` : 'In progress'}`,
        content: call.transcription || 'No transcription available',
        timestamp: call.startTime || call.createdAt,
        clientId: call.clientId,
        tags: call.tags,
        isUrgent: false,
        isRead: true,
        metadata: { originalType: 'call' },
        originalData: call,
      };
      communicationCenterService.broadcastNewCommunication(unifiedComm);
    });

    initializeCommunicationService(communicationCenterService);
    logger.info('Communication center service initialized');

    // Initialize Voice routes
    initializeVoiceRoutes(voiceService);
    logger.info('Voice service initialized');

    // Start server
    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV}`);
    });
  } catch (error: any) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await PostgreSQLService.close();
  await RedisService.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await PostgreSQLService.close();
  await RedisService.close();
  process.exit(0);
});

startServer();