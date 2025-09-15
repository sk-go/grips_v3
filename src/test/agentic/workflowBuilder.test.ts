import { WorkflowBuilder } from '../../services/agentic/workflowBuilder';
import { ExtractedTask } from '../../types/nlp';
import { WorkflowContext } from '../../types/agentic';

describe('WorkflowBuilder', () => {
  let builder: WorkflowBuilder;
  let mockContext: WorkflowContext;

  beforeEach(() => {
    builder = new WorkflowBuilder();
    mockContext = {
      sessionId: 'test-session',
      agentId: 'test-agent',
      clientId: 'test-client',
      originalRequest: 'Send email to client',
      extractedIntent: 'email_request',
      entities: [],
      variables: {}
    };
  });

  describe('buildWorkflowFromTasks', () => {
    it('should create workflow from email tasks', () => {
      const tasks: ExtractedTask[] = [
        {
          id: 'task-1',
          type: 'email',
          description: 'Send email to client',
          priority: 'medium',
          parameters: { target: 'client@example.com' },
          confidence: 0.8,
          requiresApproval: true
        }
      ];

      const workflow = builder.buildWorkflowFromTasks(tasks, mockContext);

      expect(workflow).toBeDefined();
      expect(workflow.steps.length).toBeGreaterThan(0);
      expect(workflow.status).toBe('pending');
      expect(workflow.context).toEqual(mockContext);
      
      // Should have email-related steps
      const emailSteps = workflow.steps.filter(s => 
        s.name.toLowerCase().includes('email') || 
        s.type === 'communication'
      );
      expect(emailSteps.length).toBeGreaterThan(0);
    });

    it('should create workflow from multiple task types', () => {
      const tasks: ExtractedTask[] = [
        {
          id: 'task-1',
          type: 'email',
          description: 'Send email',
          priority: 'medium',
          parameters: {},
          confidence: 0.8,
          requiresApproval: true
        },
        {
          id: 'task-2',
          type: 'crm_update',
          description: 'Update CRM',
          priority: 'low',
          parameters: {},
          confidence: 0.9,
          requiresApproval: false
        }
      ];

      const workflow = builder.buildWorkflowFromTasks(tasks, mockContext);

      expect(workflow.steps.length).toBeGreaterThan(2);
      
      // Should have steps for both task types
      const hasEmailSteps = workflow.steps.some(s => 
        s.type === 'communication' || s.name.toLowerCase().includes('email')
      );
      const hasCrmSteps = workflow.steps.some(s => 
        s.type === 'crm_update' || s.name.toLowerCase().includes('crm')
      );
      
      expect(hasEmailSteps).toBe(true);
      expect(hasCrmSteps).toBe(true);
    });

    it('should set correct workflow priority based on tasks', () => {
      const urgentTasks: ExtractedTask[] = [
        {
          id: 'task-1',
          type: 'call',
          description: 'Urgent call',
          priority: 'urgent',
          parameters: {},
          confidence: 0.9,
          requiresApproval: false
        }
      ];

      const workflow = builder.buildWorkflowFromTasks(urgentTasks, mockContext);
      expect(workflow.priority).toBe('urgent');
    });

    it('should add validation step for high-risk workflows', () => {
      const highRiskTasks: ExtractedTask[] = [
        {
          id: 'task-1',
          type: 'email',
          description: 'Send important email',
          priority: 'high',
          parameters: {},
          confidence: 0.6, // Lower confidence
          requiresApproval: true
        }
      ];

      const workflow = builder.buildWorkflowFromTasks(highRiskTasks, mockContext);
      
      const validationSteps = workflow.steps.filter(s => s.type === 'validation');
      expect(validationSteps.length).toBeGreaterThan(0);
    });

    it('should optimize for latency when enabled', () => {
      const tasks: ExtractedTask[] = [
        {
          id: 'task-1',
          type: 'crm_update',
          description: 'Update CRM',
          priority: 'low',
          parameters: {},
          confidence: 0.9,
          requiresApproval: false
        },
        {
          id: 'task-2',
          type: 'follow_up',
          description: 'Schedule follow-up',
          priority: 'low',
          parameters: {},
          confidence: 0.8,
          requiresApproval: false
        }
      ];

      const config = {
        latencyOptimization: {
          enabled: true,
          maxLatency: 1500,
          parallelExecution: true,
          caching: true,
          precomputation: false,
          streamingResponse: true
        }
      };

      const workflow = builder.buildWorkflowFromTasks(tasks, mockContext, config);
      
      // Should have parallel groups for low-risk steps
      const parallelSteps = workflow.steps.filter(s => s.parallelGroup);
      expect(parallelSteps.length).toBeGreaterThan(0);
    });
  });

  describe('buildWorkflowFromTemplate', () => {
    it('should create workflow from email template', () => {
      const parameters = {
        clientId: 'client-123',
        emailTemplate: 'professional',
        subject: 'Policy Update',
        recipientEmail: 'client@example.com'
      };

      const workflow = builder.buildWorkflowFromTemplate(
        'email_workflow',
        mockContext,
        parameters
      );

      expect(workflow).toBeDefined();
      expect(workflow.name).toBe('Email Communication Workflow');
      expect(workflow.steps.length).toBe(3); // Fetch, Compose, Send
      
      // Parameters should be applied to steps
      const composeStep = workflow.steps.find(s => s.name === 'Compose Email');
      expect(composeStep?.action.parameters.template).toBe('professional');
    });

    it('should throw error for non-existent template', () => {
      expect(() => {
        builder.buildWorkflowFromTemplate('non_existent', mockContext);
      }).toThrow('Workflow template not found');
    });

    it('should apply custom configuration', () => {
      const customConfig = {
        maxParallelSteps: 5,
        totalTimeout: 60000
      };

      const workflow = builder.buildWorkflowFromTemplate(
        'email_workflow',
        mockContext,
        {},
        customConfig
      );

      expect(workflow.config.maxParallelSteps).toBe(5);
      expect(workflow.config.totalTimeout).toBe(60000);
    });
  });

  describe('template management', () => {
    it('should return all available templates', () => {
      const templates = builder.getAllTemplates();
      
      expect(templates.length).toBeGreaterThan(0);
      expect(templates.some(t => t.id === 'email_workflow')).toBe(true);
      expect(templates.some(t => t.id === 'crm_update_workflow')).toBe(true);
    });

    it('should get specific template by ID', () => {
      const template = builder.getTemplate('email_workflow');
      
      expect(template).toBeDefined();
      expect(template?.name).toBe('Email Communication Workflow');
      expect(template?.steps.length).toBe(3);
    });

    it('should register new template', () => {
      const newTemplate = {
        id: 'test_template',
        name: 'Test Template',
        description: 'A test template',
        category: 'custom' as const,
        steps: [
          {
            name: 'Test Step',
            type: 'validation' as const,
            description: 'A test step',
            dependencies: [],
            riskLevel: 'low' as const,
            requiresApproval: false,
            timeout: 5000,
            action: {
              type: 'validate_data' as const,
              parameters: {}
            }
          }
        ],
        defaultConfig: {
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
        },
        requiredContext: ['agentId'],
        estimatedLatency: 5000
      };

      builder.registerTemplate(newTemplate);
      
      const retrieved = builder.getTemplate('test_template');
      expect(retrieved).toEqual(newTemplate);
    });
  });
});