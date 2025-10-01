/**
 * Message Queue Types and Interfaces
 * Standardized message contracts for inter-service communication
 */

export interface MessageContract {
  messageId: string;
  timestamp: Date;
  source: string;
  type: string;
  payload: any;
  correlationId: string;
  version?: string;
  priority?: MessagePriority;
  retryCount?: number;
  maxRetries?: number;
  expiresAt?: Date;
}

export enum MessagePriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3
}

export enum MessageType {
  // AI Service Messages
  AI_REQUEST = 'ai.request',
  AI_RESPONSE = 'ai.response',
  AI_ERROR = 'ai.error',
  
  // CRM Service Messages
  CRM_SYNC_REQUEST = 'crm.sync.request',
  CRM_SYNC_COMPLETE = 'crm.sync.complete',
  CRM_SYNC_ERROR = 'crm.sync.error',
  
  // Communication Service Messages
  COMMUNICATION_RECEIVED = 'communication.received',
  COMMUNICATION_SENT = 'communication.sent',
  COMMUNICATION_ERROR = 'communication.error',
  
  // Document Service Messages
  DOCUMENT_GENERATE_REQUEST = 'document.generate.request',
  DOCUMENT_GENERATE_COMPLETE = 'document.generate.complete',
  DOCUMENT_GENERATE_ERROR = 'document.generate.error',
  
  // Team Collaboration Messages
  HANDOFF_REQUEST = 'team.handoff.request',
  HANDOFF_ACCEPTED = 'team.handoff.accepted',
  HANDOFF_REJECTED = 'team.handoff.rejected',
  
  // System Messages
  HEALTH_CHECK = 'system.health.check',
  SERVICE_REGISTERED = 'system.service.registered',
  SERVICE_DEREGISTERED = 'system.service.deregistered'
}

export interface QueueConfig {
  name: string;
  durable: boolean;
  exclusive: boolean;
  autoDelete: boolean;
  arguments?: Record<string, any>;
}

export interface ExchangeConfig {
  name: string;
  type: 'direct' | 'topic' | 'fanout' | 'headers';
  durable: boolean;
  autoDelete: boolean;
  arguments?: Record<string, any>;
}

export interface PublishOptions {
  exchange?: string;
  routingKey: string;
  persistent?: boolean;
  priority?: MessagePriority;
  expiration?: number;
  correlationId?: string;
}

export interface ConsumeOptions {
  queue: string;
  consumerTag?: string;
  noLocal?: boolean;
  noAck?: boolean;
  exclusive?: boolean;
  priority?: number;
  arguments?: Record<string, any>;
}

export interface MessageHandler {
  (message: MessageContract): Promise<void>;
}

export interface RetryPolicy {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  monitoringPeriod: number;
}

export enum CircuitBreakerState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half-open'
}

export interface MessageQueueMetrics {
  messagesPublished: number;
  messagesConsumed: number;
  messagesRetried: number;
  messagesFailed: number;
  averageProcessingTime: number;
  queueDepth: number;
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
}