import { 
  AgenticWorkflow, 
  WorkflowStep, 
  WorkflowExecution, 
  StepExecution, 
  StepResult,
  ExecutionStatus,
  ApprovalRequest,
  RollbackStep,
  LatencyConfig
} from '../../types/agentic';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class WorkflowExecutionEngine {
  private activeExecutions: Map<string, WorkflowExecution> = new Map();
  private stepExecutors: Map<string, StepExecutor> = new Map();
  private approvalHandler?: ApprovalHandler;
  private rollbackHandler?: RollbackHandler;

  constructor() {
    this.initializeStepExecutors();
  }

  async executeWorkflow(workflow: AgenticWorkflow): Promise<WorkflowExecution> {
    const executionId = uuidv4();
    const startTime = new Date();

    logger.info('Starting workflow execution', { 
      workflowId: workflow.id, 
      executionId,
      stepCount: workflow.steps.length 
    });

    const execution: WorkflowExecution = {
      workflowId: workflow.id,
      executionId,
      status: 'running',
      startTime,
      totalLatency: 0,
      stepExecutions: [],
      rollbackSteps: [],
      approvals: []
    };

    this.activeExecutions.set(executionId, execution);

    try {
      // Validate workflow before execution
      this.validateWorkflow(workflow);

      // Execute workflow with latency optimization
      if (workflow.config.latencyOptimization.enabled) {
        await this.executeWithLatencyOptimization(workflow, execution);
      } else {
        await this.executeSequentially(workflow, execution);
      }

      execution.status = 'completed';
      execution.endTime = new Date();
      execution.totalLatency = execution.endTime.getTime() - execution.startTime.getTime();

      logger.info('Workflow execution completed', {
        workflowId: workflow.id,
        executionId,
        totalLatency: execution.totalLatency,
        stepCount: execution.stepExecutions.length
      });

    } catch (error: any) {
      logger.error('Workflow execution failed', { 
        error, 
        workflowId: workflow.id, 
        executionId 
      });

      execution.status = 'failed';
      execution.endTime = new Date();
      execution.totalLatency = execution.endTime.getTime() - execution.startTime.getTime();

      // Attempt rollback if enabled
      if (workflow.config.enableRollback) {
        await this.rollbackWorkflow(workflow, execution);
      }

      throw error;
    } finally {
      this.activeExecutions.delete(executionId);
    }

    return execution;
  }

  private async executeWithLatencyOptimization(
    workflow: AgenticWorkflow, 
    execution: WorkflowExecution
  ): Promise<void> {
    const latencyConfig = workflow.config.latencyOptimization;
    const maxLatency = latencyConfig.maxLatency || 1500; // 1.5s default

    // Group steps by parallel execution groups
    const parallelGroups = this.groupStepsForParallelExecution(workflow.steps);
    
    for (const group of parallelGroups) {
      const groupStartTime = Date.now();
      
      if (group.length === 1) {
        // Single step execution
        await this.executeStep(workflow, group[0], execution);
      } else {
        // Parallel execution
        await this.executeStepsInParallel(workflow, group, execution, maxLatency);
      }

      const groupLatency = Date.now() - groupStartTime;
      
      // Check if we're approaching the latency limit
      if (execution.totalLatency + groupLatency > maxLatency * 0.8) {
        logger.warn('Approaching latency limit', {
          workflowId: workflow.id,
          executionId: execution.executionId,
          currentLatency: execution.totalLatency + groupLatency,
          maxLatency
        });
      }
    }
  }

  private async executeSequentially(
    workflow: AgenticWorkflow, 
    execution: WorkflowExecution
  ): Promise<void> {
    // Sort steps by order and dependencies
    const sortedSteps = this.topologicalSort(workflow.steps);

    for (const step of sortedSteps) {
      await this.executeStep(workflow, step, execution);
    }
  }

  private async executeStep(
    workflow: AgenticWorkflow,
    step: WorkflowStep,
    execution: WorkflowExecution
  ): Promise<StepResult> {
    const stepStartTime = new Date();
    const stepExecutionId = uuidv4();

    logger.debug('Executing workflow step', {
      workflowId: workflow.id,
      stepId: step.id,
      stepType: step.type,
      stepExecutionId
    });

    const stepExecution: StepExecution = {
      stepId: step.id,
      executionId: stepExecutionId,
      status: 'running',
      startTime: stepStartTime,
      latency: 0,
      parallelGroup: step.parallelGroup
    };

    execution.stepExecutions.push(stepExecution);

    try {
      // Check if step requires approval
      if (step.requiresApproval) {
        const approved = await this.requestApproval(workflow, step, execution);
        if (!approved) {
          stepExecution.status = 'failed';
          throw new Error(`Step ${step.id} was not approved`);
        }
      }

      // Execute the step with timeout
      const result = await this.executeStepWithTimeout(workflow, step, execution);

      stepExecution.status = 'completed';
      stepExecution.endTime = new Date();
      stepExecution.latency = stepExecution.endTime.getTime() - stepExecution.startTime.getTime();
      stepExecution.result = result;

      // Update step status
      step.status = 'completed';
      step.result = result;
      step.endTime = stepExecution.endTime;

      logger.debug('Step execution completed', {
        stepId: step.id,
        latency: stepExecution.latency,
        success: result.success
      });

      return result;

    } catch (error: any) {
      stepExecution.status = 'failed';
      stepExecution.endTime = new Date();
      stepExecution.latency = stepExecution.endTime.getTime() - stepExecution.startTime.getTime();

      step.status = 'failed';
      step.endTime = stepExecution.endTime;

      logger.error('Step execution failed', {
        error,
        stepId: step.id,
        workflowId: workflow.id
      });

      throw error;
    }
  }

  private async executeStepWithTimeout(
    workflow: AgenticWorkflow,
    step: WorkflowStep,
    execution: WorkflowExecution
  ): Promise<StepResult> {
    const executor = this.stepExecutors.get(step.type);
    if (!executor) {
      throw new Error(`No executor found for step type: ${step.type}`);
    }

    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Step ${step.id} timed out after ${step.timeout}ms`));
      }, step.timeout);
    });

    // Execute step with timeout
    const executionPromise = executor.execute(step, workflow.context, execution);

    try {
      return await Promise.race([executionPromise, timeoutPromise]);
    } catch (error) {
      // Handle retry logic
      if (step.retryCount < step.maxRetries) {
        step.retryCount++;
        logger.info(`Retrying step ${step.id}, attempt ${step.retryCount}/${step.maxRetries}`);
        return this.executeStepWithTimeout(workflow, step, execution);
      }
      throw error;
    }
  }

  private async executeStepsInParallel(
    workflow: AgenticWorkflow,
    steps: WorkflowStep[],
    execution: WorkflowExecution,
    maxLatency: number
  ): Promise<void> {
    const maxParallel = Math.min(
      steps.length,
      workflow.config.maxParallelSteps || 3
    );

    // Execute steps in batches to respect parallel limits
    for (let i = 0; i < steps.length; i += maxParallel) {
      const batch = steps.slice(i, i + maxParallel);
      const batchStartTime = Date.now();

      const promises = batch.map(step => this.executeStep(workflow, step, execution));
      
      try {
        await Promise.all(promises);
      } catch (error) {
        // If any step fails, we might need to handle partial success
        logger.error('Parallel step execution failed', { error, batchSize: batch.length });
        throw error;
      }

      const batchLatency = Date.now() - batchStartTime;
      
      // Check latency constraints
      if (batchLatency > maxLatency / 2) {
        logger.warn('Parallel batch exceeded latency budget', {
          batchLatency,
          maxLatency,
          batchSize: batch.length
        });
      }
    }
  }

  private groupStepsForParallelExecution(steps: WorkflowStep[]): WorkflowStep[][] {
    const groups: WorkflowStep[][] = [];
    const processed = new Set<string>();
    const dependencyMap = this.buildDependencyMap(steps);

    // Sort steps by order first
    const sortedSteps = [...steps].sort((a, b) => a.order - b.order);

    for (const step of sortedSteps) {
      if (processed.has(step.id)) continue;

      // Check if step can run (all dependencies completed)
      const canRun = step.dependencies.every(depId => processed.has(depId));
      
      if (!canRun) {
        // Create single-step group for dependent steps
        groups.push([step]);
        processed.add(step.id);
        continue;
      }

      // Find all steps that can run in parallel with this step
      const parallelGroup = [step];
      processed.add(step.id);

      if (step.parallelGroup) {
        // Find other steps in the same parallel group
        for (const otherStep of sortedSteps) {
          if (
            !processed.has(otherStep.id) &&
            otherStep.parallelGroup === step.parallelGroup &&
            otherStep.dependencies.every(depId => processed.has(depId))
          ) {
            parallelGroup.push(otherStep);
            processed.add(otherStep.id);
          }
        }
      }

      groups.push(parallelGroup);
    }

    return groups;
  }

  private buildDependencyMap(steps: WorkflowStep[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const step of steps) {
      map.set(step.id, step.dependencies);
    }
    return map;
  }

  private topologicalSort(steps: WorkflowStep[]): WorkflowStep[] {
    const sorted: WorkflowStep[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const stepMap = new Map(steps.map(s => [s.id, s]));

    const visit = (stepId: string) => {
      if (visiting.has(stepId)) {
        throw new Error(`Circular dependency detected involving step: ${stepId}`);
      }
      if (visited.has(stepId)) return;

      visiting.add(stepId);
      
      const step = stepMap.get(stepId);
      if (step) {
        for (const depId of step.dependencies) {
          visit(depId);
        }
        visiting.delete(stepId);
        visited.add(stepId);
        sorted.push(step);
      }
    };

    for (const step of steps) {
      if (!visited.has(step.id)) {
        visit(step.id);
      }
    }

    return sorted;
  }

  private validateWorkflow(workflow: AgenticWorkflow): void {
    if (!workflow.steps || workflow.steps.length === 0) {
      throw new Error('Workflow must have at least one step');
    }

    // Validate step dependencies
    const stepIds = new Set(workflow.steps.map(s => s.id));
    for (const step of workflow.steps) {
      for (const depId of step.dependencies) {
        if (!stepIds.has(depId)) {
          throw new Error(`Step ${step.id} depends on non-existent step: ${depId}`);
        }
      }
    }

    // Check for circular dependencies
    try {
      this.topologicalSort(workflow.steps);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';
      throw new Error(`Workflow validation failed: ${errorMessage}`);
    }
  }

  private async requestApproval(
    workflow: AgenticWorkflow,
    step: WorkflowStep,
    execution: WorkflowExecution
  ): Promise<boolean> {
    if (!this.approvalHandler) {
      logger.warn('No approval handler configured, auto-approving step', { stepId: step.id });
      return true;
    }

    const approvalRequest: ApprovalRequest = {
      id: uuidv4(),
      workflowId: workflow.id,
      stepId: step.id,
      type: 'step_approval',
      description: `Approval required for step: ${step.name}`,
      riskLevel: step.riskLevel,
      confidence: step.result?.confidence || 0,
      requestedAt: new Date(),
      timeout: 30000, // 30 seconds default
      metadata: {
        stepType: step.type,
        action: step.action
      }
    };

    execution.approvals.push(approvalRequest);

    return this.approvalHandler.requestApproval(approvalRequest);
  }

  private async rollbackWorkflow(
    workflow: AgenticWorkflow,
    execution: WorkflowExecution
  ): Promise<void> {
    if (!this.rollbackHandler) {
      logger.warn('No rollback handler configured', { workflowId: workflow.id });
      return;
    }

    logger.info('Starting workflow rollback', { 
      workflowId: workflow.id,
      executionId: execution.executionId 
    });

    // Rollback completed steps in reverse order
    const completedSteps = execution.stepExecutions
      .filter(se => se.status === 'completed')
      .reverse();

    for (const stepExecution of completedSteps) {
      try {
        const step = workflow.steps.find(s => s.id === stepExecution.stepId);
        if (step) {
          await this.rollbackHandler.rollbackStep(step, workflow.context);
          
          const rollbackStep: RollbackStep = {
            stepId: step.id,
            rollbackAction: step.action,
            reason: 'Workflow rollback',
            timestamp: new Date(),
            success: true
          };
          
          execution.rollbackSteps.push(rollbackStep);
        }
      } catch (error) {
        logger.error('Step rollback failed', { 
          error, 
          stepId: stepExecution.stepId 
        });
        
        const rollbackStep: RollbackStep = {
          stepId: stepExecution.stepId,
          rollbackAction: { type: 'custom_action', parameters: {} },
          reason: `Rollback failed: ${error instanceof Error ? error.message : 'Unknown rollback error'}`,
          timestamp: new Date(),
          success: false
        };
        
        execution.rollbackSteps.push(rollbackStep);
      }
    }
  }

  private initializeStepExecutors(): void {
    // Initialize built-in step executors
    this.stepExecutors.set('data_fetch', new DataFetchExecutor());
    this.stepExecutors.set('ai_processing', new AIProcessingExecutor());
    this.stepExecutors.set('crm_update', new CRMUpdateExecutor());
    this.stepExecutors.set('communication', new CommunicationExecutor());
    this.stepExecutors.set('document_generation', new DocumentGenerationExecutor());
    this.stepExecutors.set('validation', new ValidationExecutor());
    this.stepExecutors.set('notification', new NotificationExecutor());
  }

  public registerStepExecutor(stepType: string, executor: StepExecutor): void {
    this.stepExecutors.set(stepType, executor);
  }

  public setApprovalHandler(handler: ApprovalHandler): void {
    this.approvalHandler = handler;
  }

  public setRollbackHandler(handler: RollbackHandler): void {
    this.rollbackHandler = handler;
  }

  public getActiveExecutions(): WorkflowExecution[] {
    return Array.from(this.activeExecutions.values());
  }

  public getExecution(executionId: string): WorkflowExecution | undefined {
    return this.activeExecutions.get(executionId);
  }

  public async cancelExecution(executionId: string): Promise<void> {
    const execution = this.activeExecutions.get(executionId);
    if (execution) {
      execution.status = 'cancelled';
      execution.endTime = new Date();
      this.activeExecutions.delete(executionId);
      
      logger.info('Workflow execution cancelled', { executionId });
    }
  }
}

// Abstract base class for step executors
export abstract class StepExecutor {
  abstract execute(
    step: WorkflowStep, 
    context: any, 
    execution: WorkflowExecution
  ): Promise<StepResult>;
}

// Interfaces for handlers
export interface ApprovalHandler {
  requestApproval(request: ApprovalRequest): Promise<boolean>;
}

export interface RollbackHandler {
  rollbackStep(step: WorkflowStep, context: any): Promise<void>;
}

// Basic step executor implementations
class DataFetchExecutor extends StepExecutor {
  async execute(step: WorkflowStep, context: any): Promise<StepResult> {
    // Placeholder implementation
    return {
      success: true,
      data: { fetched: true },
      confidence: 0.9,
      executionTime: 100,
      metadata: {}
    };
  }
}

class AIProcessingExecutor extends StepExecutor {
  async execute(step: WorkflowStep, context: any): Promise<StepResult> {
    // Placeholder implementation
    return {
      success: true,
      data: { processed: true },
      confidence: 0.8,
      executionTime: 200,
      metadata: {}
    };
  }
}

class CRMUpdateExecutor extends StepExecutor {
  async execute(step: WorkflowStep, context: any): Promise<StepResult> {
    // Placeholder implementation
    return {
      success: true,
      data: { updated: true },
      confidence: 0.95,
      executionTime: 150,
      metadata: {}
    };
  }
}

class CommunicationExecutor extends StepExecutor {
  async execute(step: WorkflowStep, context: any): Promise<StepResult> {
    // Placeholder implementation
    return {
      success: true,
      data: { sent: true },
      confidence: 0.9,
      executionTime: 300,
      metadata: {}
    };
  }
}

class DocumentGenerationExecutor extends StepExecutor {
  async execute(step: WorkflowStep, context: any): Promise<StepResult> {
    // Placeholder implementation
    return {
      success: true,
      data: { generated: true },
      confidence: 0.85,
      executionTime: 500,
      metadata: {}
    };
  }
}

class ValidationExecutor extends StepExecutor {
  async execute(step: WorkflowStep, context: any): Promise<StepResult> {
    // Placeholder implementation
    return {
      success: true,
      data: { valid: true },
      confidence: 1.0,
      executionTime: 50,
      metadata: {}
    };
  }
}

class NotificationExecutor extends StepExecutor {
  async execute(step: WorkflowStep, context: any): Promise<StepResult> {
    // Placeholder implementation
    return {
      success: true,
      data: { notified: true },
      confidence: 0.95,
      executionTime: 100,
      metadata: {}
    };
  }
}