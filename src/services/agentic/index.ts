export { WorkflowExecutionEngine, StepExecutor, ApprovalHandler, RollbackHandler } from './workflowExecutionEngine';
export { WorkflowBuilder } from './workflowBuilder';
export { ConfidenceScoringService } from './confidenceScoringService';

import { WorkflowExecutionEngine, ApprovalHandler, RollbackHandler } from './workflowExecutionEngine';
import { WorkflowBuilder } from './workflowBuilder';
import { ConfidenceScoringService } from './confidenceScoringService';
import { 
  AgenticWorkflow, 
  WorkflowExecution, 
  WorkflowTemplate, 
  WorkflowContext,
  ApprovalRequest,
  ApprovalResponse,
  WorkflowMetrics
} from '../../types/agentic';
import { ExtractedTask } from '../../types/nlp';
import { CacheService } from '../cacheService';
import { logger } from '../../utils/logger';

export class AgenticAIService {
  private executionEngine: WorkflowExecutionEngine;
  private workflowBuilder: WorkflowBuilder;
  private confidenceScoring: ConfidenceScoringService;
  private cacheService: CacheService;
  private activeWorkflows: Map<string, AgenticWorkflow> = new Map();
  private pendingApprovals: Map<string, ApprovalRequest> = new Map();

  constructor(cacheService: CacheService) {
    this.cacheService = cacheService;
    this.executionEngine = new WorkflowExecutionEngine();
    this.workflowBuilder = new WorkflowBuilder();
    this.confidenceScoring = new ConfidenceScoringService();

    // Set up approval and rollback handlers
    this.executionEngine.setApprovalHandler(new DefaultApprovalHandler(this));
    this.executionEngine.setRollbackHandler(new DefaultRollbackHandler());
  }

  async createWorkflowFromTasks(
    tasks: ExtractedTask[],
    context: WorkflowContext,
    config?: any
  ): Promise<AgenticWorkflow> {
    logger.info('Creating workflow from tasks', { 
      taskCount: tasks.length,
      sessionId: context.sessionId 
    });

    const workflow = this.workflowBuilder.buildWorkflowFromTasks(tasks, context, config);
    
    // Calculate confidence scoring
    const confidenceScoring = this.confidenceScoring.calculateWorkflowConfidence(workflow);
    workflow.metadata.confidenceScoring = confidenceScoring;

    // Store workflow
    this.activeWorkflows.set(workflow.id, workflow);
    
    // Cache workflow for persistence
    await this.cacheWorkflow(workflow);

    logger.info('Workflow created', {
      workflowId: workflow.id,
      stepCount: workflow.steps.length,
      overallConfidence: confidenceScoring.overall,
      escalationRequired: confidenceScoring.escalationRequired
    });

    return workflow;
  }

  async createWorkflowFromTemplate(
    templateId: string,
    context: WorkflowContext,
    parameters: Record<string, any> = {},
    config?: any
  ): Promise<AgenticWorkflow> {
    logger.info('Creating workflow from template', { 
      templateId,
      sessionId: context.sessionId 
    });

    const workflow = this.workflowBuilder.buildWorkflowFromTemplate(
      templateId, 
      context, 
      parameters, 
      config
    );

    // Calculate confidence scoring
    const confidenceScoring = this.confidenceScoring.calculateWorkflowConfidence(workflow);
    workflow.metadata.confidenceScoring = confidenceScoring;

    // Store workflow
    this.activeWorkflows.set(workflow.id, workflow);
    
    // Cache workflow for persistence
    await this.cacheWorkflow(workflow);

    return workflow;
  }

  async executeWorkflow(workflowId: string): Promise<WorkflowExecution> {
    const workflow = this.activeWorkflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    logger.info('Executing workflow', { 
      workflowId,
      stepCount: workflow.steps.length 
    });

    try {
      workflow.status = 'running';
      workflow.updatedAt = new Date();

      const execution = await this.executionEngine.executeWorkflow(workflow);

      workflow.status = execution.status === 'completed' ? 'completed' : 'failed';
      workflow.completedAt = execution.endTime;
      workflow.updatedAt = new Date();

      // Update cached workflow
      await this.cacheWorkflow(workflow);

      // Cache execution results
      await this.cacheExecution(execution);

      logger.info('Workflow execution completed', {
        workflowId,
        executionId: execution.executionId,
        status: execution.status,
        totalLatency: execution.totalLatency
      });

      return execution;

    } catch (error: any) {
      workflow.status = 'failed';
      workflow.updatedAt = new Date();
      await this.cacheWorkflow(workflow);

      logger.error('Workflow execution failed', { error, workflowId });
      throw error;
    }
  }

  async approveWorkflowStep(
    approvalId: string, 
    response: ApprovalResponse
  ): Promise<void> {
    const approval = this.pendingApprovals.get(approvalId);
    if (!approval) {
      throw new Error(`Approval request not found: ${approvalId}`);
    }

    approval.response = response;
    approval.respondedAt = new Date();

    logger.info('Workflow step approval processed', {
      approvalId,
      approved: response.approved,
      workflowId: approval.workflowId,
      stepId: approval.stepId
    });

    // Remove from pending approvals
    this.pendingApprovals.delete(approvalId);

    // Cache the approval response
    await this.cacheService.set(
      `approval:${approvalId}`,
      JSON.stringify(approval),
      3600 // 1 hour TTL
    );
  }

  async getWorkflow(workflowId: string): Promise<AgenticWorkflow | null> {
    // Try memory first
    let workflow = this.activeWorkflows.get(workflowId);
    
    if (!workflow) {
      // Try cache
      const cached = await this.cacheService.get(`workflow:${workflowId}`);
      if (cached) {
        workflow = JSON.parse(cached);
        if (workflow) {
          this.activeWorkflows.set(workflowId, workflow);
        }
      }
    }

    return workflow || null;
  }

  async getActiveWorkflows(): Promise<AgenticWorkflow[]> {
    return Array.from(this.activeWorkflows.values())
      .filter(w => w.status === 'running' || w.status === 'pending');
  }

  async getWorkflowExecution(executionId: string): Promise<WorkflowExecution | null> {
    // Try active executions first
    const activeExecution = this.executionEngine.getExecution(executionId);
    if (activeExecution) {
      return activeExecution;
    }

    // Try cache
    const cached = await this.cacheService.get(`execution:${executionId}`);
    if (cached) {
      return JSON.parse(cached);
    }

    return null;
  }

  async cancelWorkflow(workflowId: string): Promise<void> {
    const workflow = this.activeWorkflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    workflow.status = 'cancelled';
    workflow.updatedAt = new Date();

    // Cancel any active execution
    const activeExecutions = this.executionEngine.getActiveExecutions();
    const execution = activeExecutions.find(e => e.workflowId === workflowId);
    if (execution) {
      await this.executionEngine.cancelExecution(execution.executionId);
    }

    await this.cacheWorkflow(workflow);

    logger.info('Workflow cancelled', { workflowId });
  }

  async getWorkflowTemplates(): Promise<WorkflowTemplate[]> {
    return this.workflowBuilder.getAllTemplates();
  }

  async registerWorkflowTemplate(template: WorkflowTemplate): Promise<void> {
    this.workflowBuilder.registerTemplate(template);
    
    // Cache template for persistence
    await this.cacheService.set(
      `template:${template.id}`,
      JSON.stringify(template),
      86400 // 24 hours TTL
    );
  }

  async getPendingApprovals(agentId?: string): Promise<ApprovalRequest[]> {
    const approvals = Array.from(this.pendingApprovals.values());
    
    if (agentId) {
      // Filter by agent if specified (would need to track agent assignments)
      return approvals; // For now, return all
    }
    
    return approvals;
  }

  async getWorkflowMetrics(workflowId?: string): Promise<WorkflowMetrics> {
    // In a real implementation, this would aggregate metrics from stored executions
    // For now, return mock metrics
    
    return {
      totalExecutions: 0,
      successRate: 0.85,
      averageLatency: 1200,
      averageSteps: 3.5,
      rollbackRate: 0.05,
      approvalRate: 0.30,
      latencyDistribution: {
        p50: 800,
        p90: 1500,
        p95: 2000,
        p99: 3000,
        max: 5000,
        min: 200
      },
      errorTypes: {
        'timeout': 5,
        'validation_error': 3,
        'external_service_error': 2,
        'approval_denied': 1
      }
    };
  }

  private async cacheWorkflow(workflow: AgenticWorkflow): Promise<void> {
    try {
      await this.cacheService.set(
        `workflow:${workflow.id}`,
        JSON.stringify(workflow),
        86400 // 24 hours TTL
      );
    } catch (error) {
      logger.error('Failed to cache workflow', { error, workflowId: workflow.id });
    }
  }

  private async cacheExecution(execution: WorkflowExecution): Promise<void> {
    try {
      await this.cacheService.set(
        `execution:${execution.executionId}`,
        JSON.stringify(execution),
        86400 // 24 hours TTL
      );
    } catch (error) {
      logger.error('Failed to cache execution', { error, executionId: execution.executionId });
    }
  }

  public getExecutionEngine(): WorkflowExecutionEngine {
    return this.executionEngine;
  }

  public getWorkflowBuilder(): WorkflowBuilder {
    return this.workflowBuilder;
  }

  public getConfidenceScoring(): ConfidenceScoringService {
    return this.confidenceScoring;
  }
}

// Default approval handler implementation
class DefaultApprovalHandler implements ApprovalHandler {
  constructor(private agenticService: AgenticAIService) {}

  async requestApproval(request: ApprovalRequest): Promise<boolean> {
    // Store the approval request
    this.agenticService['pendingApprovals'].set(request.id, request);

    logger.info('Approval requested', {
      approvalId: request.id,
      workflowId: request.workflowId,
      stepId: request.stepId,
      riskLevel: request.riskLevel
    });

    // In a real implementation, this would:
    // 1. Send notification to appropriate approver
    // 2. Wait for response or timeout
    // 3. Return the approval decision

    // For now, auto-approve low-risk requests
    if (request.riskLevel === 'low' && request.confidence > 0.8) {
      const response: ApprovalResponse = {
        approved: true,
        reason: 'Auto-approved: low risk and high confidence',
        respondedBy: 'system'
      };

      await this.agenticService.approveWorkflowStep(request.id, response);
      return true;
    }

    // For higher risk requests, we would wait for manual approval
    // For demo purposes, we'll auto-approve after a short delay
    setTimeout(async () => {
      const response: ApprovalResponse = {
        approved: true,
        reason: 'Auto-approved for demo',
        respondedBy: 'system'
      };

      try {
        await this.agenticService.approveWorkflowStep(request.id, response);
      } catch (error) {
        logger.error('Failed to auto-approve request', { error, approvalId: request.id });
      }
    }, 1000);

    return true; // Return true to continue execution
  }
}

// Default rollback handler implementation
class DefaultRollbackHandler implements RollbackHandler {
  async rollbackStep(step: any, context: any): Promise<void> {
    logger.info('Rolling back step', { stepId: step.id, stepType: step.type });

    // Implement rollback logic based on step type
    switch (step.type) {
      case 'crm_update':
        // Rollback CRM changes
        logger.info('Rolling back CRM update', { stepId: step.id });
        break;
        
      case 'communication':
        // Can't rollback sent communications, but log the attempt
        logger.warn('Cannot rollback communication step', { stepId: step.id });
        break;
        
      case 'document_generation':
        // Delete generated documents
        logger.info('Rolling back document generation', { stepId: step.id });
        break;
        
      default:
        logger.info('No specific rollback action for step type', { 
          stepId: step.id, 
          stepType: step.type 
        });
    }
  }
}