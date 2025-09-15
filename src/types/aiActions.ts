export interface AIAction {
  id: string;
  type: ActionType;
  description: string;
  status: ActionStatus;
  priority: ActionPriority;
  riskLevel: RiskLevel;
  confidence: number;
  requiresApproval: boolean;
  createdAt: Date;
  updatedAt: Date;
  scheduledAt?: Date;
  executedAt?: Date;
  approvedAt?: Date;
  parameters: ActionParameters;
  context: ActionContext;
  result?: ActionResult;
  approvalRequest?: ApprovalRequest;
  auditTrail: AuditEntry[];
  retryCount: number;
  maxRetries: number;
  timeout: number;
}

export interface ActionParameters {
  [key: string]: any;
  target?: string;
  clientId?: string;
  agentId?: string;
  templateId?: string;
  data?: Record<string, any>;
}

export interface ActionContext {
  sessionId: string;
  workflowId?: string;
  stepId?: string;
  agentId: string;
  clientId?: string;
  originalRequest: string;
  extractedIntent?: string;
  entities?: any[];
  crmData?: any;
  communicationHistory?: any[];
}

export interface ActionResult {
  success: boolean;
  data?: any;
  error?: string;
  executionTime: number;
  confidence: number;
  metadata: Record<string, any>;
  sideEffects?: SideEffect[];
}

export interface SideEffect {
  type: 'crm_update' | 'email_sent' | 'document_created' | 'notification_sent' | 'task_created';
  description: string;
  data: any;
  timestamp: Date;
  reversible: boolean;
}

export interface ApprovalRequest {
  id: string;
  actionId: string;
  type: ApprovalType;
  description: string;
  riskAssessment: RiskAssessment;
  requestedBy: string;
  requestedAt: Date;
  timeout: number;
  approvers: string[];
  response?: ApprovalResponse;
  escalated: boolean;
}

export interface ApprovalResponse {
  approved: boolean;
  approvedBy: string;
  approvedAt: Date;
  reason?: string;
  conditions?: string[];
  modifications?: Record<string, any>;
}

export interface RiskAssessment {
  level: RiskLevel;
  score: number;
  factors: RiskFactor[];
  mitigations: string[];
  autoApprovalEligible: boolean;
}

export interface RiskFactor {
  name: string;
  score: number;
  weight: number;
  description: string;
  category: 'data_sensitivity' | 'external_impact' | 'reversibility' | 'compliance' | 'cost';
}

export interface AuditEntry {
  id: string;
  timestamp: Date;
  event: AuditEvent;
  actor: string;
  details: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export interface ActionQueue {
  id: string;
  name: string;
  type: QueueType;
  priority: number;
  maxConcurrency: number;
  actions: string[]; // Action IDs
  processors: string[]; // Processor IDs
  config: QueueConfig;
  metrics: QueueMetrics;
}

export interface QueueConfig {
  retryPolicy: RetryPolicy;
  timeoutPolicy: TimeoutPolicy;
  approvalPolicy: ApprovalPolicy;
  priorityWeights: PriorityWeights;
}

export interface RetryPolicy {
  maxRetries: number;
  backoffStrategy: 'linear' | 'exponential' | 'fixed';
  baseDelay: number;
  maxDelay: number;
  retryableErrors: string[];
}

export interface TimeoutPolicy {
  defaultTimeout: number;
  timeoutByActionType: Record<ActionType, number>;
  escalationTimeout: number;
}

export interface ApprovalPolicy {
  autoApprovalThreshold: number;
  requiredApprovers: number;
  approverRoles: string[];
  escalationRules: EscalationRule[];
}

export interface EscalationRule {
  condition: string;
  delay: number;
  escalateTo: string[];
  action: 'notify' | 'auto_approve' | 'auto_reject';
}

export interface PriorityWeights {
  urgent: number;
  high: number;
  medium: number;
  low: number;
}

export interface QueueMetrics {
  totalProcessed: number;
  successRate: number;
  averageExecutionTime: number;
  averageWaitTime: number;
  currentQueueSize: number;
  processingRate: number;
  errorRate: number;
}

export interface WritingStyleProfile {
  agentId: string;
  name: string;
  characteristics: StyleCharacteristics;
  examples: WritingExample[];
  lastUpdated: Date;
  confidence: number;
}

export interface StyleCharacteristics {
  tone: 'formal' | 'casual' | 'friendly' | 'professional' | 'empathetic';
  formality: number; // 0-1 scale
  verbosity: number; // 0-1 scale
  personalTouch: number; // 0-1 scale
  technicalLevel: number; // 0-1 scale
  commonPhrases: string[];
  signatureElements: string[];
  greetingStyle: string;
  closingStyle: string;
}

export interface WritingExample {
  id: string;
  type: 'email' | 'note' | 'message';
  content: string;
  context: string;
  timestamp: Date;
  confidence: number;
}

// Enums
export type ActionType = 
  | 'send_email'
  | 'make_call'
  | 'schedule_meeting'
  | 'update_crm'
  | 'create_task'
  | 'generate_document'
  | 'send_notification'
  | 'analyze_data'
  | 'fetch_data'
  | 'validate_data'
  | 'custom';

export type ActionStatus = 
  | 'pending'
  | 'queued'
  | 'waiting_approval'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export type ActionPriority = 'low' | 'medium' | 'high' | 'urgent';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type ApprovalType = 
  | 'automatic'
  | 'manual'
  | 'escalated'
  | 'conditional';

export type AuditEvent = 
  | 'action_created'
  | 'action_queued'
  | 'action_started'
  | 'action_completed'
  | 'action_failed'
  | 'action_cancelled'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_denied'
  | 'action_escalated'
  | 'action_retried'
  | 'risk_assessed'
  | 'style_analyzed';

export type QueueType = 
  | 'high_priority'
  | 'standard'
  | 'low_priority'
  | 'approval_required'
  | 'background';

export interface ActionExecutionMetrics {
  totalActions: number;
  successRate: number;
  averageExecutionTime: number;
  actionsByType: Record<ActionType, number>;
  actionsByStatus: Record<ActionStatus, number>;
  riskDistribution: Record<RiskLevel, number>;
  approvalRate: number;
  autoApprovalRate: number;
  escalationRate: number;
  retryRate: number;
  timeoutRate: number;
}