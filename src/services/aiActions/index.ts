export { ActionQueueService } from './actionQueueService';
export { ApprovalWorkflowService } from './approvalWorkflowService';
export { WritingStyleService } from './writingStyleService';

import { ActionQueueService } from './actionQueueService';
import { ApprovalWorkflowService } from './approvalWorkflowService';
import { WritingStyleService } from './writingStyleService';
import { 
  AIAction, 
  ActionContext, 
  ActionParameters, 
  ActionResult, 
  ActionStatus,
  ActionType,
  ActionPriority,
  RiskLevel,
  AuditEntry,
  AuditEvent,
  ActionExecutionMetrics
} from '../../types/aiActions';
import { CacheService } from '../cacheService';
import { logger } from '../../utils/logger';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

export class AIActionExecutionService extends EventEmitter {
  private queueService: ActionQueueService;
  private approvalService: ApprovalWorkflowService;
  private writingStyleService: WritingStyleService;
  private cacheService: CacheService;
  private actionExecutors: Map<ActionType, ActionExecutor> = new Map();
  private auditLogger: AuditLogger;

  constructor(cacheService: CacheService) {
    super();
    this.cacheService = cacheService;
    this.queueService = new ActionQueueService(cacheService);
    this.approvalService = new ApprovalWorkflowService(cacheService);
    this.writingStyleService = new WritingStyleService(cacheService);
    this.auditLogger = new AuditLogger(cacheService);

    this.initializeActionExecutors();
    this.setupEventHandlers();
  }

  async createAction(
    type: ActionType,
    parameters: ActionParameters,
    context: ActionContext,
    options: {
      priority?: ActionPriority;
      requiresApproval?: boolean;
      timeout?: number;
    } = {}
  ): Promise<AIAction> {
    const actionId = uuidv4();
    
    const action: AIAction = {
      id: actionId,
      type,
      description: this.generateActionDescription(type, parameters),
      status: 'pending',
      priority: options.priority || 'medium',
      riskLevel: this.assessInitialRisk(type, parameters),
      confidence: this.calculateInitialConfidence(type, parameters, context),
      requiresApproval: options.requiresApproval ?? this.shouldRequireApproval(type, parameters),
      createdAt: new Date(),
      updatedAt: new Date(),
      parameters,
      context,
      auditTrail: [],
      retryCount: 0,
      maxRetries: 3,
      timeout: options.timeout || this.getDefaultTimeout(type)
    };

    // Log action creation
    await this.auditLogger.logEvent(action, 'action_created', context.agentId, {
      type,
      parameters: this.sanitizeParameters(parameters)
    });

    logger.info('AI action created', {
      actionId,
      type,
      priority: action.priority,
      riskLevel: action.riskLevel,
      requiresApproval: action.requiresApproval
    });

    this.emit('action_created', { action });

    return action;
  }

  async executeAction(actionId: string): Promise<ActionResult> {
    const action = await this.queueService['getAction'](actionId);
    if (!action) {
      throw new Error(`Action not found: ${actionId}`);
    }

    logger.info('Starting action execution', {
      actionId,
      type: action.type,
      status: action.status
    });

    try {
      // Check if action requires approval
      if (action.requiresApproval && action.status !== 'approved') {
        await this.requestApproval(action);
        return {
          success: false,
          error: 'Action requires approval',
          executionTime: 0,
          confidence: action.confidence,
          metadata: { status: 'waiting_approval' }
        };
      }

      // Execute the action
      const result = await this.performExecution(action);

      // Update action with result
      action.result = result;
      action.status = result.success ? 'completed' : 'failed';
      action.updatedAt = new Date();

      // Log execution result
      await this.auditLogger.logEvent(action, result.success ? 'action_completed' : 'action_failed', 
        action.context.agentId, {
          result: this.sanitizeResult(result)
        });

      logger.info('Action execution completed', {
        actionId,
        success: result.success,
        executionTime: result.executionTime
      });

      this.emit('action_executed', { action, result });

      return result;

    } catch (error: any) {
      // Handle execution error
      const errorResult: ActionResult = {
        success: false,
        error: error.message,
        executionTime: 0,
        confidence: 0,
        metadata: { error: error.name }
      };

      action.result = errorResult;
      action.status = 'failed';
      action.updatedAt = new Date();

      await this.auditLogger.logEvent(action, 'action_failed', action.context.agentId, {
        error: error.message
      });

      logger.error('Action execution failed', {
        error,
        actionId,
        type: action.type
      });

      this.emit('action_failed', { action, error });

      return errorResult;
    }
  }

  async queueAction(action: AIAction, queueId?: string): Promise<void> {
    await this.queueService.enqueueAction(action, queueId);
    
    await this.auditLogger.logEvent(action, 'action_queued', action.context.agentId, {
      queueId: queueId || 'auto-selected'
    });

    this.emit('action_queued', { action, queueId });
  }

  private async requestApproval(action: AIAction): Promise<void> {
    const approvalRequest = await this.approvalService.requestApproval(action);
    
    await this.auditLogger.logEvent(action, 'approval_requested', action.context.agentId, {
      approvalId: approvalRequest.id,
      riskLevel: approvalRequest.riskAssessment.level
    });

    this.emit('approval_requested', { action, approvalRequest });
  }

  private async performExecution(action: AIAction): Promise<ActionResult> {
    const startTime = Date.now();
    
    // Get appropriate executor
    const executor = this.actionExecutors.get(action.type);
    if (!executor) {
      throw new Error(`No executor found for action type: ${action.type}`);
    }

    // Apply writing style if applicable
    if (this.isWritingAction(action.type)) {
      await this.applyWritingStyle(action);
    }

    // Execute with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Action execution timed out after ${action.timeout}ms`));
      }, action.timeout);
    });

    const executionPromise = executor.execute(action);

    try {
      const result = await Promise.race([executionPromise, timeoutPromise]);
      result.executionTime = Date.now() - startTime;
      return result;
    } catch (error) {
      // Handle retry logic
      if (action.retryCount < action.maxRetries && this.isRetryableError(error)) {
        action.retryCount++;
        
        await this.auditLogger.logEvent(action, 'action_retried', action.context.agentId, {
          retryCount: action.retryCount,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        logger.info(`Retrying action ${action.id}, attempt ${action.retryCount}/${action.maxRetries}`);
        
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, action.retryCount - 1), 30000);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        return this.performExecution(action);
      }
      
      throw error;
    }
  }

  private async applyWritingStyle(action: AIAction): Promise<void> {
    if (!action.parameters.content && !action.parameters.message) {
      return; // No content to style
    }

    const agentId = action.context.agentId;
    const content = action.parameters.content || action.parameters.message;
    const contentType = this.getContentType(action.type);

    try {
      const styledContent = await this.writingStyleService.mimicWritingStyle(
        agentId,
        content,
        contentType
      );

      // Update the action parameters with styled content
      if (action.parameters.content) {
        action.parameters.content = styledContent;
      } else if (action.parameters.message) {
        action.parameters.message = styledContent;
      }

      await this.auditLogger.logEvent(action, 'style_analyzed', agentId, {
        originalLength: content.length,
        styledLength: styledContent.length
      });

    } catch (error) {
      logger.warn('Failed to apply writing style', { error, actionId: action.id });
      // Continue with original content
    }
  }

  private isWritingAction(type: ActionType): boolean {
    return ['send_email', 'send_notification'].includes(type);
  }

  private getContentType(type: ActionType): 'email' | 'note' | 'message' {
    switch (type) {
      case 'send_email':
        return 'email';
      case 'send_notification':
        return 'message';
      default:
        return 'note';
    }
  }

  private generateActionDescription(type: ActionType, parameters: ActionParameters): string {
    const descriptions = {
      send_email: `Send email to ${parameters.to || 'recipient'}`,
      make_call: `Make call to ${parameters.to || 'recipient'}`,
      schedule_meeting: `Schedule meeting: ${parameters.subject || 'Meeting'}`,
      update_crm: `Update CRM record for ${parameters.clientId || 'client'}`,
      create_task: `Create task: ${parameters.title || 'Task'}`,
      generate_document: `Generate ${parameters.type || 'document'}`,
      send_notification: `Send notification: ${parameters.message || 'Notification'}`,
      analyze_data: `Analyze data for ${parameters.clientId || 'analysis'}`,
      fetch_data: `Fetch data from ${parameters.source || 'source'}`,
      validate_data: `Validate data for ${parameters.clientId || 'validation'}`,
      custom: parameters.description || 'Custom action'
    };

    return descriptions[type] || `Execute ${type} action`;
  }

  private assessInitialRisk(type: ActionType, parameters: ActionParameters): RiskLevel {
    // Basic risk assessment based on action type
    const riskLevels: Record<ActionType, RiskLevel> = {
      send_email: 'medium',
      make_call: 'high',
      schedule_meeting: 'medium',
      update_crm: 'low',
      create_task: 'low',
      generate_document: 'low',
      send_notification: 'medium',
      analyze_data: 'low',
      fetch_data: 'low',
      validate_data: 'low',
      custom: 'medium'
    };

    let baseRisk = riskLevels[type];

    // Adjust based on parameters
    if (parameters.bulk || (parameters.recipients && Array.isArray(parameters.recipients) && parameters.recipients.length > 10)) {
      baseRisk = baseRisk === 'low' ? 'medium' : 'high';
    }

    return baseRisk;
  }

  private calculateInitialConfidence(
    type: ActionType, 
    parameters: ActionParameters, 
    context: ActionContext
  ): number {
    let confidence = 0.7; // Base confidence

    // Adjust based on available context
    if (context.clientId) confidence += 0.1;
    if (context.crmData) confidence += 0.1;
    if (context.extractedIntent) confidence += 0.05;

    // Adjust based on parameter completeness
    const requiredParams = this.getRequiredParameters(type);
    const providedParams = Object.keys(parameters).filter(key => 
      parameters[key] !== undefined && parameters[key] !== null
    );
    
    if (requiredParams.length > 0) {
      const completeness = providedParams.length / requiredParams.length;
      confidence += completeness * 0.05;
    }

    return Math.min(1.0, confidence);
  }

  private shouldRequireApproval(type: ActionType, parameters: ActionParameters): boolean {
    const highRiskActions: ActionType[] = ['send_email', 'make_call', 'schedule_meeting'];
    
    if (highRiskActions.includes(type)) {
      return true;
    }

    // Require approval for bulk operations
    if (parameters.bulk || (parameters.recipients && Array.isArray(parameters.recipients) && parameters.recipients.length > 5)) {
      return true;
    }

    return false;
  }

  private getDefaultTimeout(type: ActionType): number {
    const timeouts: Record<ActionType, number> = {
      send_email: 15000,
      make_call: 60000,
      schedule_meeting: 20000,
      update_crm: 10000,
      create_task: 5000,
      generate_document: 30000,
      send_notification: 5000,
      analyze_data: 45000,
      fetch_data: 15000,
      validate_data: 10000,
      custom: 30000
    };

    return timeouts[type] || 30000;
  }

  private getRequiredParameters(type: ActionType): string[] {
    const requiredParams: Record<ActionType, string[]> = {
      send_email: ['to', 'subject', 'content'],
      make_call: ['to'],
      schedule_meeting: ['attendees', 'subject', 'startTime'],
      update_crm: ['clientId', 'data'],
      create_task: ['title', 'description'],
      generate_document: ['type', 'clientId'],
      send_notification: ['message', 'recipient'],
      analyze_data: ['data'],
      fetch_data: ['source'],
      validate_data: ['data'],
      custom: []
    };

    return requiredParams[type] || [];
  }

  private isRetryableError(error: any): boolean {
    const retryableErrors = [
      'timeout',
      'network_error',
      'temporary_failure',
      'rate_limit',
      'service_unavailable'
    ];

    return retryableErrors.some(errorType => 
      error.message?.toLowerCase().includes(errorType) ||
      error.name?.toLowerCase().includes(errorType)
    );
  }

  private sanitizeParameters(parameters: ActionParameters): Record<string, any> {
    const sanitized = { ...parameters };
    
    // Remove sensitive information
    const sensitiveFields = ['password', 'token', 'key', 'secret'];
    
    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  private sanitizeResult(result: ActionResult): Record<string, any> {
    const sanitized = { ...result };
    
    // Remove sensitive data from result
    if (sanitized.data && typeof sanitized.data === 'object') {
      sanitized.data = { ...sanitized.data };
      const sensitiveFields = ['password', 'token', 'key', 'secret'];
      
      for (const field of sensitiveFields) {
        if (sanitized.data[field]) {
          sanitized.data[field] = '[REDACTED]';
        }
      }
    }

    return sanitized;
  }

  private initializeActionExecutors(): void {
    // Register default action executors
    this.actionExecutors.set('send_email', new EmailActionExecutor());
    this.actionExecutors.set('make_call', new CallActionExecutor());
    this.actionExecutors.set('schedule_meeting', new MeetingActionExecutor());
    this.actionExecutors.set('update_crm', new CRMActionExecutor());
    this.actionExecutors.set('create_task', new TaskActionExecutor());
    this.actionExecutors.set('generate_document', new DocumentActionExecutor());
    this.actionExecutors.set('send_notification', new NotificationActionExecutor());
    this.actionExecutors.set('analyze_data', new AnalysisActionExecutor());
    this.actionExecutors.set('fetch_data', new FetchActionExecutor());
    this.actionExecutors.set('validate_data', new ValidationActionExecutor());
  }

  private setupEventHandlers(): void {
    // Handle queue events
    this.queueService.on('action_ready', async ({ action }) => {
      try {
        await this.executeAction(action.id);
      } catch (error) {
        logger.error('Failed to execute queued action', { error, actionId: action.id });
      }
    });

    // Handle approval events
    this.approvalService.on('approval_responded', async ({ approvalRequest, response }) => {
      if (response.approved) {
        const action = await this.queueService['getAction'](approvalRequest.actionId);
        if (action) {
          action.status = 'approved';
          action.approvedAt = new Date();
          await this.queueAction(action);
        }
      }
    });
  }

  // Public API methods
  async getAction(actionId: string): Promise<AIAction | null> {
    return this.queueService['getAction'](actionId);
  }

  async getActionsByStatus(status: ActionStatus): Promise<AIAction[]> {
    // This would typically query a database
    // For now, return empty array
    return [];
  }

  async cancelAction(actionId: string): Promise<void> {
    await this.queueService.updateActionStatus(actionId, 'cancelled');
    
    const action = await this.getAction(actionId);
    if (action) {
      await this.auditLogger.logEvent(action, 'action_cancelled', action.context.agentId, {});
    }
  }

  async getExecutionMetrics(): Promise<ActionExecutionMetrics> {
    // In a real implementation, this would aggregate metrics from stored actions
    return {
      totalActions: 0,
      successRate: 0.85,
      averageExecutionTime: 2500,
      actionsByType: {
        send_email: 45,
        make_call: 12,
        schedule_meeting: 8,
        update_crm: 67,
        create_task: 23,
        generate_document: 15,
        send_notification: 34,
        analyze_data: 9,
        fetch_data: 56,
        validate_data: 78,
        custom: 5
      },
      actionsByStatus: {
        pending: 12,
        queued: 8,
        waiting_approval: 5,
        approved: 3,
        rejected: 1,
        executing: 4,
        completed: 234,
        failed: 18,
        cancelled: 7,
        timeout: 2
      },
      riskDistribution: {
        low: 156,
        medium: 89,
        high: 34,
        critical: 5
      },
      approvalRate: 0.32,
      autoApprovalRate: 0.68,
      escalationRate: 0.05,
      retryRate: 0.12,
      timeoutRate: 0.02
    };
  }

  // Service accessors
  getQueueService(): ActionQueueService {
    return this.queueService;
  }

  getApprovalService(): ApprovalWorkflowService {
    return this.approvalService;
  }

  getWritingStyleService(): WritingStyleService {
    return this.writingStyleService;
  }

  async shutdown(): Promise<void> {
    await this.queueService.shutdown();
    await this.approvalService.shutdown();
    logger.info('AI Action Execution Service shutdown complete');
  }
}

// Abstract base class for action executors
export abstract class ActionExecutor {
  abstract execute(action: AIAction): Promise<ActionResult>;
}

// Audit logger class
class AuditLogger {
  constructor(private cacheService: CacheService) {}

  async logEvent(
    action: AIAction,
    event: AuditEvent,
    actor: string,
    details: Record<string, any>
  ): Promise<void> {
    const auditEntry: AuditEntry = {
      id: uuidv4(),
      timestamp: new Date(),
      event,
      actor,
      details,
      ipAddress: details.ipAddress,
      userAgent: details.userAgent
    };

    action.auditTrail.push(auditEntry);

    // Cache audit entry
    try {
      await this.cacheService.set(
        `audit:${auditEntry.id}`,
        JSON.stringify(auditEntry),
        86400 * 30 // 30 days TTL
      );
    } catch (error) {
      logger.error('Failed to cache audit entry', { error, auditId: auditEntry.id });
    }

    logger.debug('Audit event logged', {
      actionId: action.id,
      event,
      actor,
      auditId: auditEntry.id
    });
  }
}

// Basic action executor implementations (placeholders)
class EmailActionExecutor extends ActionExecutor {
  async execute(action: AIAction): Promise<ActionResult> {
    // Placeholder implementation
    return {
      success: true,
      data: { messageId: 'email-123', sent: true },
      executionTime: 1500,
      confidence: 0.9,
      metadata: { provider: 'smtp' }
    };
  }
}

class CallActionExecutor extends ActionExecutor {
  async execute(action: AIAction): Promise<ActionResult> {
    return {
      success: true,
      data: { callId: 'call-123', duration: 0 },
      executionTime: 2000,
      confidence: 0.8,
      metadata: { provider: 'twilio' }
    };
  }
}

class MeetingActionExecutor extends ActionExecutor {
  async execute(action: AIAction): Promise<ActionResult> {
    return {
      success: true,
      data: { meetingId: 'meeting-123', scheduled: true },
      executionTime: 1200,
      confidence: 0.85,
      metadata: { provider: 'calendar' }
    };
  }
}

class CRMActionExecutor extends ActionExecutor {
  async execute(action: AIAction): Promise<ActionResult> {
    return {
      success: true,
      data: { recordId: action.parameters.clientId, updated: true },
      executionTime: 800,
      confidence: 0.95,
      metadata: { provider: 'crm' }
    };
  }
}

class TaskActionExecutor extends ActionExecutor {
  async execute(action: AIAction): Promise<ActionResult> {
    return {
      success: true,
      data: { taskId: 'task-123', created: true },
      executionTime: 500,
      confidence: 0.9,
      metadata: { provider: 'task_manager' }
    };
  }
}

class DocumentActionExecutor extends ActionExecutor {
  async execute(action: AIAction): Promise<ActionResult> {
    return {
      success: true,
      data: { documentId: 'doc-123', generated: true },
      executionTime: 3000,
      confidence: 0.85,
      metadata: { provider: 'document_generator' }
    };
  }
}

class NotificationActionExecutor extends ActionExecutor {
  async execute(action: AIAction): Promise<ActionResult> {
    return {
      success: true,
      data: { notificationId: 'notif-123', sent: true },
      executionTime: 600,
      confidence: 0.9,
      metadata: { provider: 'notification_service' }
    };
  }
}

class AnalysisActionExecutor extends ActionExecutor {
  async execute(action: AIAction): Promise<ActionResult> {
    return {
      success: true,
      data: { analysisId: 'analysis-123', results: {} },
      executionTime: 4000,
      confidence: 0.8,
      metadata: { provider: 'analytics' }
    };
  }
}

class FetchActionExecutor extends ActionExecutor {
  async execute(action: AIAction): Promise<ActionResult> {
    return {
      success: true,
      data: { records: [], count: 0 },
      executionTime: 1000,
      confidence: 0.95,
      metadata: { provider: 'data_source' }
    };
  }
}

class ValidationActionExecutor extends ActionExecutor {
  async execute(action: AIAction): Promise<ActionResult> {
    return {
      success: true,
      data: { valid: true, errors: [] },
      executionTime: 300,
      confidence: 1.0,
      metadata: { provider: 'validator' }
    };
  }
}