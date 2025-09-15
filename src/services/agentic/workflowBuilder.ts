import { 
  AgenticWorkflow, 
  WorkflowStep, 
  WorkflowTemplate, 
  WorkflowContext, 
  WorkflowConfig,
  StepAction,
  WorkflowCategory
} from '../../types/agentic';
import { ExtractedTask } from '../../types/nlp';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class WorkflowBuilder {
  private templates: Map<string, WorkflowTemplate> = new Map();

  constructor() {
    this.initializeDefaultTemplates();
  }

  buildWorkflowFromTasks(
    tasks: ExtractedTask[],
    context: WorkflowContext,
    config?: Partial<WorkflowConfig>
  ): AgenticWorkflow {
    logger.debug('Building workflow from tasks', { 
      taskCount: tasks.length,
      sessionId: context.sessionId 
    });

    const workflowId = uuidv4();
    const steps: WorkflowStep[] = [];
    let stepOrder = 0;

    // Group tasks by type and create workflow steps
    const taskGroups = this.groupTasksByType(tasks);

    for (const [taskType, taskList] of taskGroups.entries()) {
      const stepGroup = this.createStepsForTaskType(taskType, taskList, stepOrder);
      steps.push(...stepGroup);
      stepOrder += stepGroup.length;
    }

    // Add validation and approval steps
    if (steps.some(s => s.riskLevel === 'high' || s.riskLevel === 'critical')) {
      steps.push(this.createValidationStep(stepOrder++, steps));
    }

    const workflow: AgenticWorkflow = {
      id: workflowId,
      name: `Dynamic Workflow - ${new Date().toISOString()}`,
      description: `Generated workflow for ${tasks.length} tasks`,
      steps,
      status: 'pending',
      priority: this.determinePriority(tasks),
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        generatedFrom: 'tasks',
        originalTaskCount: tasks.length,
        taskTypes: Array.from(taskGroups.keys())
      },
      context,
      config: this.mergeConfig(this.getDefaultConfig(), config)
    };

    // Optimize for latency if required
    if (workflow.config.latencyOptimization.enabled) {
      this.optimizeForLatency(workflow);
    }

    return workflow;
  }

  buildWorkflowFromTemplate(
    templateId: string,
    context: WorkflowContext,
    parameters: Record<string, any> = {},
    config?: Partial<WorkflowConfig>
  ): AgenticWorkflow {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Workflow template not found: ${templateId}`);
    }

    logger.debug('Building workflow from template', { 
      templateId, 
      templateName: template.name 
    });

    const workflowId = uuidv4();
    const steps: WorkflowStep[] = [];

    // Create steps from template
    for (let i = 0; i < template.steps.length; i++) {
      const stepTemplate = template.steps[i];
      const step: WorkflowStep = {
        id: uuidv4(),
        name: stepTemplate.name,
        type: stepTemplate.type,
        description: stepTemplate.description,
        status: 'pending',
        order: i,
        dependencies: stepTemplate.dependencies,
        parallelGroup: stepTemplate.parallelGroup,
        action: this.parameterizeAction(stepTemplate.action, parameters),
        retryCount: 0,
        maxRetries: 3,
        timeout: stepTemplate.timeout,
        riskLevel: stepTemplate.riskLevel,
        requiresApproval: stepTemplate.requiresApproval
      };
      steps.push(step);
    }

    const workflow: AgenticWorkflow = {
      id: workflowId,
      name: template.name,
      description: template.description,
      steps,
      status: 'pending',
      priority: 'medium',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        templateId,
        templateName: template.name,
        category: template.category,
        parameters
      },
      context,
      config: this.mergeConfig(template.defaultConfig, config)
    };

    return workflow;
  }

  private groupTasksByType(tasks: ExtractedTask[]): Map<string, ExtractedTask[]> {
    const groups = new Map<string, ExtractedTask[]>();
    
    for (const task of tasks) {
      const existing = groups.get(task.type) || [];
      existing.push(task);
      groups.set(task.type, existing);
    }
    
    return groups;
  }

  private createStepsForTaskType(
    taskType: string, 
    tasks: ExtractedTask[], 
    startOrder: number
  ): WorkflowStep[] {
    const steps: WorkflowStep[] = [];
    
    switch (taskType) {
      case 'email':
        steps.push(...this.createEmailSteps(tasks, startOrder));
        break;
      case 'call':
        steps.push(...this.createCallSteps(tasks, startOrder));
        break;
      case 'meeting':
        steps.push(...this.createMeetingSteps(tasks, startOrder));
        break;
      case 'crm_update':
        steps.push(...this.createCRMUpdateSteps(tasks, startOrder));
        break;
      case 'document_generation':
        steps.push(...this.createDocumentSteps(tasks, startOrder));
        break;
      case 'follow_up':
        steps.push(...this.createFollowUpSteps(tasks, startOrder));
        break;
      default:
        steps.push(...this.createGenericSteps(tasks, startOrder));
    }
    
    return steps;
  }

  private createEmailSteps(tasks: ExtractedTask[], startOrder: number): WorkflowStep[] {
    const steps: WorkflowStep[] = [];
    
    // Data preparation step
    steps.push({
      id: uuidv4(),
      name: 'Prepare Email Data',
      type: 'data_fetch',
      description: 'Fetch client data and prepare email content',
      status: 'pending',
      order: startOrder,
      dependencies: [],
      parallelGroup: 'email_prep',
      action: {
        type: 'fetch_crm_data',
        parameters: {
          clientIds: tasks.map(t => t.clientId).filter(Boolean),
          fields: ['name', 'email', 'preferences', 'history']
        }
      },
      retryCount: 0,
      maxRetries: 3,
      timeout: 5000,
      riskLevel: 'low',
      requiresApproval: false
    });

    // Email composition step
    steps.push({
      id: uuidv4(),
      name: 'Compose Email',
      type: 'ai_processing',
      description: 'Generate email content using AI',
      status: 'pending',
      order: startOrder + 1,
      dependencies: [steps[0].id],
      action: {
        type: 'generate_document',
        parameters: {
          type: 'email',
          tasks: tasks,
          template: 'professional_email'
        }
      },
      retryCount: 0,
      maxRetries: 2,
      timeout: 3000,
      riskLevel: 'medium',
      requiresApproval: true
    });

    // Email sending step
    steps.push({
      id: uuidv4(),
      name: 'Send Email',
      type: 'communication',
      description: 'Send composed email to recipients',
      status: 'pending',
      order: startOrder + 2,
      dependencies: [steps[1].id],
      action: {
        type: 'send_email',
        parameters: {
          tasks: tasks
        }
      },
      retryCount: 0,
      maxRetries: 3,
      timeout: 10000,
      riskLevel: 'high',
      requiresApproval: true
    });

    return steps;
  }

  private createCallSteps(tasks: ExtractedTask[], startOrder: number): WorkflowStep[] {
    const steps: WorkflowStep[] = [];
    
    // Call preparation
    steps.push({
      id: uuidv4(),
      name: 'Prepare Call Information',
      type: 'data_fetch',
      description: 'Gather client information for call',
      status: 'pending',
      order: startOrder,
      dependencies: [],
      action: {
        type: 'fetch_crm_data',
        parameters: {
          clientIds: tasks.map(t => t.clientId).filter(Boolean),
          fields: ['phone', 'preferences', 'call_history', 'notes']
        }
      },
      retryCount: 0,
      maxRetries: 2,
      timeout: 3000,
      riskLevel: 'low',
      requiresApproval: false
    });

    // Schedule or initiate call
    steps.push({
      id: uuidv4(),
      name: 'Initiate Call',
      type: 'communication',
      description: 'Make call to client',
      status: 'pending',
      order: startOrder + 1,
      dependencies: [steps[0].id],
      action: {
        type: 'make_call',
        parameters: {
          tasks: tasks
        }
      },
      retryCount: 0,
      maxRetries: 1,
      timeout: 30000,
      riskLevel: 'medium',
      requiresApproval: false
    });

    return steps;
  }

  private createMeetingSteps(tasks: ExtractedTask[], startOrder: number): WorkflowStep[] {
    const steps: WorkflowStep[] = [];
    
    steps.push({
      id: uuidv4(),
      name: 'Schedule Meeting',
      type: 'communication',
      description: 'Schedule meeting with client',
      status: 'pending',
      order: startOrder,
      dependencies: [],
      action: {
        type: 'schedule_meeting',
        parameters: {
          tasks: tasks
        }
      },
      retryCount: 0,
      maxRetries: 3,
      timeout: 15000,
      riskLevel: 'medium',
      requiresApproval: true
    });

    return steps;
  }

  private createCRMUpdateSteps(tasks: ExtractedTask[], startOrder: number): WorkflowStep[] {
    const steps: WorkflowStep[] = [];
    
    steps.push({
      id: uuidv4(),
      name: 'Update CRM Records',
      type: 'crm_update',
      description: 'Update client records in CRM',
      status: 'pending',
      order: startOrder,
      dependencies: [],
      action: {
        type: 'update_crm_record',
        parameters: {
          tasks: tasks
        }
      },
      retryCount: 0,
      maxRetries: 3,
      timeout: 8000,
      riskLevel: 'low',
      requiresApproval: false
    });

    return steps;
  }

  private createDocumentSteps(tasks: ExtractedTask[], startOrder: number): WorkflowStep[] {
    const steps: WorkflowStep[] = [];
    
    // Data gathering
    steps.push({
      id: uuidv4(),
      name: 'Gather Document Data',
      type: 'data_fetch',
      description: 'Collect data for document generation',
      status: 'pending',
      order: startOrder,
      dependencies: [],
      parallelGroup: 'doc_prep',
      action: {
        type: 'fetch_crm_data',
        parameters: {
          clientIds: tasks.map(t => t.clientId).filter(Boolean),
          fields: ['all']
        }
      },
      retryCount: 0,
      maxRetries: 2,
      timeout: 5000,
      riskLevel: 'low',
      requiresApproval: false
    });

    // Document generation
    steps.push({
      id: uuidv4(),
      name: 'Generate Document',
      type: 'document_generation',
      description: 'Create document from template',
      status: 'pending',
      order: startOrder + 1,
      dependencies: [steps[0].id],
      action: {
        type: 'generate_document',
        parameters: {
          tasks: tasks
        }
      },
      retryCount: 0,
      maxRetries: 2,
      timeout: 10000,
      riskLevel: 'medium',
      requiresApproval: true
    });

    return steps;
  }

  private createFollowUpSteps(tasks: ExtractedTask[], startOrder: number): WorkflowStep[] {
    const steps: WorkflowStep[] = [];
    
    steps.push({
      id: uuidv4(),
      name: 'Create Follow-up Task',
      type: 'notification',
      description: 'Schedule follow-up reminder',
      status: 'pending',
      order: startOrder,
      dependencies: [],
      action: {
        type: 'send_notification',
        parameters: {
          tasks: tasks,
          type: 'follow_up_reminder'
        }
      },
      retryCount: 0,
      maxRetries: 2,
      timeout: 3000,
      riskLevel: 'low',
      requiresApproval: false
    });

    return steps;
  }

  private createGenericSteps(tasks: ExtractedTask[], startOrder: number): WorkflowStep[] {
    const steps: WorkflowStep[] = [];
    
    steps.push({
      id: uuidv4(),
      name: 'Execute Generic Task',
      type: 'custom',
      description: 'Execute custom task action',
      status: 'pending',
      order: startOrder,
      dependencies: [],
      action: {
        type: 'custom_action',
        parameters: {
          tasks: tasks
        }
      },
      retryCount: 0,
      maxRetries: 2,
      timeout: 5000,
      riskLevel: 'medium',
      requiresApproval: true
    });

    return steps;
  }

  private createValidationStep(order: number, existingSteps: WorkflowStep[]): WorkflowStep {
    return {
      id: uuidv4(),
      name: 'Validate Workflow Results',
      type: 'validation',
      description: 'Validate all workflow step results',
      status: 'pending',
      order,
      dependencies: existingSteps.map(s => s.id),
      action: {
        type: 'validate_data',
        parameters: {
          validationRules: [
            { field: 'success', type: 'required', message: 'All steps must complete successfully' }
          ]
        }
      },
      retryCount: 0,
      maxRetries: 1,
      timeout: 2000,
      riskLevel: 'low',
      requiresApproval: false
    };
  }

  private determinePriority(tasks: ExtractedTask[]): AgenticWorkflow['priority'] {
    const priorities = tasks.map(t => t.priority);
    
    if (priorities.includes('urgent')) return 'urgent';
    if (priorities.includes('high')) return 'high';
    if (priorities.includes('medium')) return 'medium';
    return 'low';
  }

  private optimizeForLatency(workflow: AgenticWorkflow): void {
    const config = workflow.config.latencyOptimization;
    
    if (!config.enabled) return;

    // Identify steps that can run in parallel
    const parallelizableSteps = workflow.steps.filter(step => 
      step.riskLevel === 'low' && 
      !step.requiresApproval &&
      step.dependencies.length === 0
    );

    // Group independent steps for parallel execution
    let groupCounter = 0;
    for (let i = 0; i < parallelizableSteps.length; i += 2) {
      const group = `parallel_group_${groupCounter++}`;
      parallelizableSteps[i].parallelGroup = group;
      if (parallelizableSteps[i + 1]) {
        parallelizableSteps[i + 1].parallelGroup = group;
      }
    }

    // Reduce timeouts for low-risk steps
    workflow.steps.forEach(step => {
      if (step.riskLevel === 'low') {
        step.timeout = Math.min(step.timeout, 3000);
      }
    });

    logger.debug('Workflow optimized for latency', {
      workflowId: workflow.id,
      parallelGroups: groupCounter,
      totalSteps: workflow.steps.length
    });
  }

  private parameterizeAction(action: StepAction, parameters: Record<string, any>): StepAction {
    const parameterizedAction = { ...action };
    
    // Replace parameter placeholders in action parameters
    for (const [key, value] of Object.entries(parameterizedAction.parameters)) {
      if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
        const paramName = value.slice(2, -1);
        if (parameters[paramName] !== undefined) {
          parameterizedAction.parameters[key] = parameters[paramName];
        }
      }
    }
    
    return parameterizedAction;
  }

  private getDefaultConfig(): WorkflowConfig {
    return {
      maxParallelSteps: 3,
      totalTimeout: 30000,
      enableRollback: true,
      autoApproveThreshold: 0.8,
      latencyOptimization: {
        enabled: true,
        maxLatency: 1500,
        parallelExecution: true,
        caching: true,
        precomputation: false,
        streamingResponse: true
      }
    };
  }

  private mergeConfig(defaultConfig: WorkflowConfig, override?: Partial<WorkflowConfig>): WorkflowConfig {
    if (!override) return defaultConfig;
    
    return {
      ...defaultConfig,
      ...override,
      latencyOptimization: {
        ...defaultConfig.latencyOptimization,
        ...(override.latencyOptimization || {})
      }
    };
  }

  private initializeDefaultTemplates(): void {
    // Email workflow template
    this.templates.set('email_workflow', {
      id: 'email_workflow',
      name: 'Email Communication Workflow',
      description: 'Standard workflow for email communications',
      category: 'client_communication',
      steps: [
        {
          name: 'Fetch Client Data',
          type: 'data_fetch',
          description: 'Retrieve client information from CRM',
          dependencies: [],
          riskLevel: 'low',
          requiresApproval: false,
          timeout: 5000,
          action: {
            type: 'fetch_crm_data',
            parameters: {
              clientId: '${clientId}',
              fields: ['name', 'email', 'preferences']
            }
          }
        },
        {
          name: 'Compose Email',
          type: 'ai_processing',
          description: 'Generate email content',
          dependencies: ['Fetch Client Data'],
          riskLevel: 'medium',
          requiresApproval: true,
          timeout: 8000,
          action: {
            type: 'generate_document',
            parameters: {
              template: '${emailTemplate}',
              subject: '${subject}'
            }
          }
        },
        {
          name: 'Send Email',
          type: 'communication',
          description: 'Send the composed email',
          dependencies: ['Compose Email'],
          riskLevel: 'high',
          requiresApproval: true,
          timeout: 10000,
          action: {
            type: 'send_email',
            parameters: {
              to: '${recipientEmail}',
              priority: '${priority}'
            }
          }
        }
      ],
      defaultConfig: this.getDefaultConfig(),
      requiredContext: ['clientId', 'agentId'],
      estimatedLatency: 15000
    });

    // CRM Update workflow template
    this.templates.set('crm_update_workflow', {
      id: 'crm_update_workflow',
      name: 'CRM Update Workflow',
      description: 'Standard workflow for updating CRM records',
      category: 'crm_operations',
      steps: [
        {
          name: 'Validate Update Data',
          type: 'validation',
          description: 'Validate the data to be updated',
          dependencies: [],
          riskLevel: 'low',
          requiresApproval: false,
          timeout: 3000,
          action: {
            type: 'validate_data',
            parameters: {
              data: '${updateData}',
              schema: '${validationSchema}'
            }
          }
        },
        {
          name: 'Update CRM Record',
          type: 'crm_update',
          description: 'Update the CRM record',
          dependencies: ['Validate Update Data'],
          riskLevel: 'medium',
          requiresApproval: false,
          timeout: 8000,
          action: {
            type: 'update_crm_record',
            parameters: {
              recordId: '${recordId}',
              updates: '${updateData}'
            }
          }
        }
      ],
      defaultConfig: this.getDefaultConfig(),
      requiredContext: ['recordId', 'agentId'],
      estimatedLatency: 8000
    });
  }

  public getTemplate(templateId: string): WorkflowTemplate | undefined {
    return this.templates.get(templateId);
  }

  public getAllTemplates(): WorkflowTemplate[] {
    return Array.from(this.templates.values());
  }

  public registerTemplate(template: WorkflowTemplate): void {
    this.templates.set(template.id, template);
    logger.info('Workflow template registered', { 
      templateId: template.id, 
      templateName: template.name 
    });
  }
}