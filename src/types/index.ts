/**
 * Core TypeScript interfaces for the Relationship Care Platform
 * These interfaces define the data structures for overlay data that will be cached in Redis
 */

// ============================================================================
// Core Entity Interfaces
// ============================================================================

export interface Client {
  id: string;
  crmId: string; // Reference to CRM system record
  crmSystem: 'zoho' | 'salesforce' | 'hubspot' | 'agencybloc';
  // Core data fetched from CRM
  name: string;
  email: string;
  phone: string;
  photo?: string;
  // Overlay enhancements (cached from CRM)
  personalDetails: PersonalDetails;
  // Platform-specific relationship insights
  relationshipHealth: RelationshipHealth;
  lastCrmSync: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PersonalDetails {
  hobbies: string[];
  family: FamilyMember[];
  preferences: Record<string, any>;
  importantDates: ImportantDate[];
}

export interface FamilyMember {
  id: string;
  name: string;
  relationship: string; // 'spouse', 'child', 'parent', etc.
  age?: number;
  notes?: string;
}

export interface ImportantDate {
  id: string;
  type: 'birthday' | 'anniversary' | 'policy_renewal' | 'custom';
  date: Date;
  description: string;
  recurring: boolean;
}

export interface RelationshipHealth {
  score: number; // 0-100 scale
  lastInteraction: Date;
  sentimentTrend: 'positive' | 'neutral' | 'negative';
  interactionFrequency: number; // interactions per month
  responseTime: number; // average response time in hours
}

// ============================================================================
// Communication Interfaces
// ============================================================================

export interface Communication {
  id: string;
  clientId: string;
  type: 'email' | 'call' | 'sms';
  direction: 'inbound' | 'outbound';
  subject?: string;
  content: string;
  timestamp: Date;
  tags: string[];
  sentiment?: number; // -1 to 1 scale
  isUrgent: boolean;
  source: string; // email account or phone number
  metadata: CommunicationMetadata;
}

export interface CommunicationMetadata {
  messageId?: string; // Email message ID
  threadId?: string; // Email thread ID
  callDuration?: number; // Call duration in seconds
  transcriptionAccuracy?: number; // 0-1 scale for call transcriptions
  attachments?: Attachment[];
  readStatus?: 'read' | 'unread';
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url?: string;
}

// ============================================================================
// AI Action Interfaces
// ============================================================================

export interface AIAction {
  id: string;
  type: 'send_email' | 'update_client' | 'create_task' | 'schedule_meeting' | 'generate_document';
  description: string;
  payload: Record<string, any>;
  requiresApproval: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
  confidence: number; // 0-1 scale
  chainId?: string; // For agentic workflows
  stepNumber?: number; // Position in chain
  executedBy?: string; // Agent ID who approved/executed
  executedAt?: Date;
  result?: ActionResult;
  createdAt: Date;
}

export interface ActionResult {
  success: boolean;
  data?: any;
  error?: string;
  executionTime: number; // milliseconds
}

export interface AIChain {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  steps: AIAction[];
  currentStep: number;
  context: Record<string, any>;
  startedAt: Date;
  completedAt?: Date;
  createdBy: string; // Agent ID
}

// ============================================================================
// Document Template Interfaces
// ============================================================================

export interface DocumentTemplate {
  id: string;
  name: string;
  type: 'advisory_protocol' | 'policy_summary' | 'meeting_notes' | 'custom';
  jinjaTemplate: string;
  isDefault: boolean;
  requiredFields: string[];
  riskLevel: 'low' | 'medium' | 'high';
  category: string;
  description?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GeneratedDocument {
  id: string;
  templateId: string;
  clientId?: string;
  title: string;
  content: string; // HTML content
  pdfPath?: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'exported';
  metadata: DocumentMetadata;
  createdBy: 'agent' | 'ai';
  approvedBy?: string;
  createdAt: Date;
  expiresAt: Date; // Temporary storage expiration
}

export interface DocumentMetadata {
  templateVersion: string;
  dataSource: string[]; // Sources used for data population
  generationTime: number; // milliseconds
  fileSize?: number;
  downloadCount: number;
}

// ============================================================================
// Task Interfaces
// ============================================================================

export interface Task {
  id: string;
  clientId?: string;
  description: string;
  type: 'email' | 'call' | 'meeting' | 'follow-up' | 'document' | 'research';
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'in-progress' | 'completed' | 'cancelled';
  dueDate?: Date;
  assignedTo?: string; // Agent ID
  createdBy: 'agent' | 'ai';
  aiContext?: string;
  tags: string[];
  estimatedDuration?: number; // minutes
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Audit Log Interfaces
// ============================================================================

export interface AuditLog {
  id: string;
  timestamp: Date;
  userId: string; // Agent ID
  action: AuditAction;
  entityType: 'client' | 'communication' | 'task' | 'document' | 'ai_action';
  entityId: string;
  changes?: AuditChange[];
  metadata: AuditMetadata;
  ipAddress: string;
  userAgent: string;
}

export interface AuditAction {
  type: 'create' | 'read' | 'update' | 'delete' | 'execute' | 'approve' | 'reject';
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface AuditChange {
  field: string;
  oldValue: any;
  newValue: any;
}

export interface AuditMetadata {
  source: 'web' | 'api' | 'ai' | 'system';
  sessionId?: string;
  chainId?: string; // For AI chain actions
  correlationId: string;
  duration?: number; // milliseconds
}

// ============================================================================
// Cache-Specific Interfaces
// ============================================================================

export interface CacheEntry<T> {
  data: T;
  timestamp: Date;
  ttl: number; // seconds
  version: string;
  source: string;
}

export interface CrmCacheData {
  clientData: Client;
  lastSync: Date;
  syncStatus: 'success' | 'partial' | 'failed';
  errors?: string[];
}

export interface EmailSyncState {
  accountId: string;
  lastSyncTime: Date;
  lastMessageId?: string;
  syncStatus: 'idle' | 'syncing' | 'error';
  messageCount: number;
  errorCount: number;
  nextSyncTime?: Date;
}

export interface AIContextCache {
  sessionId: string;
  conversationHistory: ConversationMessage[];
  clientContext?: Client;
  activeChain?: AIChain;
  preferences: AIPreferences;
  lastActivity: Date;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  metadata?: {
    confidence?: number;
    processingTime?: number;
    actions?: string[];
  };
}

export interface AIPreferences {
  language: string;
  voiceEnabled: boolean;
  autoApprovalThreshold: number; // 0-1 scale
  riskTolerance: 'low' | 'medium' | 'high';
  notificationSettings: NotificationSettings;
}

export interface NotificationSettings {
  email: boolean;
  sms: boolean;
  push: boolean;
  urgentOnly: boolean;
}

// ============================================================================
// Redis Key Patterns
// ============================================================================

export const REDIS_KEYS = {
  // Session management
  SESSION: (sessionId: string) => `session:${sessionId}`,
  
  // CRM data caching
  CRM_CLIENT: (crmSystem: string, crmId: string) => `crm_client:${crmSystem}:${crmId}`,
  CRM_SYNC_STATUS: (crmSystem: string) => `crm_sync:${crmSystem}`,
  
  // Email synchronization
  EMAIL_SYNC: (accountId: string) => `email_sync:${accountId}`,
  
  // AI context and actions
  AI_CONTEXT: (sessionId: string) => `ai_context:${sessionId}`,
  AI_QUEUE: (agentId: string) => `ai_queue:${agentId}`,
  AI_CHAIN: (chainId: string) => `ai_chain:${chainId}`,
  
  // Communication caching
  COMMUNICATION: (communicationId: string) => `communication:${communicationId}`,
  CLIENT_COMMUNICATIONS: (clientId: string) => `client_comms:${clientId}`,
  
  // Task management
  TASK: (taskId: string) => `task:${taskId}`,
  CLIENT_TASKS: (clientId: string) => `client_tasks:${clientId}`,
  
  // Document generation
  DOCUMENT: (documentId: string) => `document:${documentId}`,
  TEMPLATE: (templateId: string) => `template:${templateId}`,
  
  // Rate limiting
  RATE_LIMIT: (identifier: string) => `rate_limit:${identifier}`,
  
  // Audit logs (for blockchain-lite implementation)
  AUDIT_BLOCK: (blockNumber: number) => `audit_block:${blockNumber}`,
  AUDIT_HASH: () => 'audit_hash:latest',
} as const;

// ============================================================================
// Utility Types
// ============================================================================

export type CrmSystem = 'zoho' | 'salesforce' | 'hubspot' | 'agencybloc';
export type CommunicationType = 'email' | 'call' | 'sms';
export type TaskType = 'email' | 'call' | 'meeting' | 'follow-up' | 'document' | 'research';
export type Priority = 'low' | 'medium' | 'high';
export type RiskLevel = 'low' | 'medium' | 'high';
export type SentimentTrend = 'positive' | 'neutral' | 'negative';

// Type guards for runtime type checking
export const isValidCrmSystem = (system: string): system is CrmSystem => {
  return ['zoho', 'salesforce', 'hubspot', 'agencybloc'].includes(system);
};

export const isValidCommunicationType = (type: string): type is CommunicationType => {
  return ['email', 'call', 'sms'].includes(type);
};

export const isValidRiskLevel = (level: string): level is RiskLevel => {
  return ['low', 'medium', 'high'].includes(level);
};