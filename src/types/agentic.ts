export interface AgenticWorkflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  status: WorkflowStatus;
  priority: WorkflowPriority;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  metadata: Record<string, any>;
  context: WorkflowContext;
  config: WorkflowConfig;
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: StepType;
  description: string;
  status: StepStatus;
  order: number;
  dependencies: string[]; // Step IDs that must complete first
  parallelGroup?: string; // Steps with same group can run in parallel
  action: StepAction;
  result?: StepResult;
  startTime?: Date;
  endTime?: Date;
  retryCount: number;
  maxRetries: number;
  timeout: number; // milliseconds
  riskLevel: RiskLevel;
  requiresApproval: boolean;
}

export interface StepAction {
  type: ActionType;
  parameters: Record<string, any>;
  tool?: string;
  prompt?: string;
  validation?: ValidationRule[];
}

export interface StepResult {
  success: boolean;
  data?: any;
  error?: string;
  confidence: number;
  executionTime: number;
  metadata: Record<string, any>;
}

export interface WorkflowContext {
  sessionId: string;
  agentId: string;
  clientId?: string;
  originalRequest: string;
  extractedIntent: string;
  entities: any[];
  crmData?: any;
  communicationHistory?: any[];
  variables: Record<string, any>;
}

export interface WorkflowConfig {
  maxParallelSteps: number;
  totalTimeout: number; // milliseconds
  enableRollback: boolean;
  autoApproveThreshold: number; // confidence threshold for auto-approval
  latencyOptimization: LatencyConfig;
}

export interface LatencyConfig {
  enabled: boolean;
  maxLatency: number; // milliseconds (1.5s requirement)
  parallelExecution: boolean;
  caching: boolean;
  precomputation: boolean;
  streamingResponse: boolean;
}

export interface ValidationRule {
  field: string;
  type: 'required' | 'format' | 'range' | 'custom';
  value?: any;
  message: string;
}

export interface WorkflowExecution {
  workflowId: string;
  executionId: string;
  status: ExecutionStatus;
  startTime: Date;
  endTime?: Date;
  totalLatency: number;
  stepExecutions: StepExecution[];
  rollbackSteps: RollbackStep[];
  approvals: ApprovalRequest[];
}

export interface StepExecution {
  stepId: string;
  executionId: string;
  status: ExecutionStatus;
  startTime: Date;
  endTime?: Date;
  latency: number;
  result?: StepResult;
  parallelGroup?: string;
}

export interface RollbackStep {
  stepId: string;
  rollbackAction: StepAction;
  reason: string;
  timestamp: Date;
  success: boolean;
}

export interface ApprovalRequest {
  id: string;
  workflowId: string;
  stepId: string;
  type: 'step_approval' | 'risk_approval' | 'data_approval';
  description: string;
  riskLevel: RiskLevel;
  confidence: number;
  requestedAt: Date;
  respondedAt?: Date;
  response?: ApprovalResponse;
  timeout: number;
  metadata: Record<string, any>;
}

export interface ApprovalResponse {
  approved: boolean;
  reason?: string;
  modifications?: Record<string, any>;
  respondedBy: string;
}

export interface ConfidenceScoring {
  overall: number;
  stepScores: Record<string, number>;
  factors: ConfidenceFactor[];
  threshold: number;
  escalationRequired: boolean;
}

export interface ConfidenceFactor {
  name: string;
  score: number;
  weight: number;
  description: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: WorkflowCategory;
  steps: WorkflowStepTemplate[];
  defaultConfig: WorkflowConfig;
  requiredContext: string[];
  estimatedLatency: number;
}

export interface WorkflowStepTemplate {
  name: string;
  type: StepType;
  description: string;
  action: StepAction;
  dependencies: string[];
  parallelGroup?: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  timeout: number;
}

// Enums
export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting_approval';
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';
export type WorkflowPriority = 'low' | 'medium' | 'high' | 'urgent';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type StepType = 
  | 'data_fetch' 
  | 'data_transform' 
  | 'ai_processing' 
  | 'crm_update' 
  | 'communication' 
  | 'document_generation' 
  | 'validation' 
  | 'approval_gate' 
  | 'notification'
  | 'custom';

export type ActionType = 
  | 'fetch_crm_data'
  | 'update_crm_record'
  | 'send_email'
  | 'make_call'
  | 'schedule_meeting'
  | 'generate_document'
  | 'analyze_sentiment'
  | 'extract_entities'
  | 'validate_data'
  | 'request_approval'
  | 'send_notification'
  | 'execute_query'
  | 'transform_data'
  | 'custom_action';

export type WorkflowCategory = 
  | 'client_communication'
  | 'data_processing'
  | 'document_management'
  | 'crm_operations'
  | 'compliance'
  | 'analytics'
  | 'custom';

export interface WorkflowMetrics {
  totalExecutions: number;
  successRate: number;
  averageLatency: number;
  averageSteps: number;
  rollbackRate: number;
  approvalRate: number;
  latencyDistribution: LatencyDistribution;
  errorTypes: Record<string, number>;
}

export interface LatencyDistribution {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  min: number;
}