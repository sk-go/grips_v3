import { AIActionExecutionService } from '../../services/aiActions';
import { ActionContext, ActionParameters } from '../../types/aiActions';

// Mock the cache service
const mockCacheService = {
  set: jest.fn().mockResolvedValue(undefined),
  get: jest.fn().mockResolvedValue(null),
  delete: jest.fn().mockResolvedValue(undefined),
};

describe('AIActionExecutionService', () => {
  let service: AIActionExecutionService;
  let mockContext: ActionContext;

  beforeEach(() => {

    service = new AIActionExecutionService(mockCacheService as any);

    mockContext = {
      sessionId: 'test-session',
      agentId: 'test-agent',
      clientId: 'test-client',
      originalRequest: 'Send email to client',
      extractedIntent: 'email_request',
      entities: [],
      crmData: { name: 'Test Client' },
      communicationHistory: []
    };
  });

  describe('createAction', () => {
    it('should create an email action with correct properties', async () => {
      const parameters: ActionParameters = {
        to: 'client@example.com',
        subject: 'Test Email',
        content: 'Hello, this is a test email.'
      };

      const action = await service.createAction('send_email', parameters, mockContext);

      expect(action).toBeDefined();
      expect(action.type).toBe('send_email');
      expect(action.status).toBe('pending');
      expect(action.parameters).toEqual(parameters);
      expect(action.context).toEqual(mockContext);
      expect(action.requiresApproval).toBe(true); // Email actions require approval
      expect(action.riskLevel).toBe('medium');
      expect(action.confidence).toBeGreaterThan(0);
    });

    it('should create a CRM update action with low risk', async () => {
      const parameters: ActionParameters = {
        clientId: 'client-123',
        data: { status: 'active' }
      };

      const action = await service.createAction('update_crm', parameters, mockContext);

      expect(action.type).toBe('update_crm');
      expect(action.riskLevel).toBe('low');
      expect(action.requiresApproval).toBe(false); // CRM updates don't require approval by default
    });

    it('should set higher risk for bulk operations', async () => {
      const parameters: ActionParameters = {
        recipients: ['user1@example.com', 'user2@example.com', 'user3@example.com'],
        subject: 'Bulk Email',
        content: 'This is a bulk email.',
        bulk: true
      };

      const action = await service.createAction('send_email', parameters, mockContext);

      expect(action.riskLevel).toBe('high'); // Should be elevated due to bulk operation
      expect(action.requiresApproval).toBe(true);
    });

    it('should calculate confidence based on context completeness', async () => {
      const parametersWithContext: ActionParameters = {
        to: 'client@example.com',
        subject: 'Test',
        content: 'Test content'
      };

      const completeContext = {
        ...mockContext,
        extractedIntent: 'send_email',
        crmData: { name: 'Client Name', email: 'client@example.com' }
      };

      const action = await service.createAction('send_email', parametersWithContext, completeContext);

      expect(action.confidence).toBeGreaterThan(0.7); // Should have higher confidence with complete context
    });
  });

  describe('executeAction', () => {
    it('should execute a simple action successfully', async () => {
      const parameters: ActionParameters = {
        clientId: 'client-123',
        data: { status: 'updated' }
      };

      const action = await service.createAction('update_crm', parameters, mockContext);
      
      // Mock the cache to return the action
      mockCacheService.get.mockResolvedValueOnce(JSON.stringify(action));

      const result = await service.executeAction(action.id);

      expect(result.success).toBe(true);
      expect(result.executionTime).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should handle action requiring approval', async () => {
      const parameters: ActionParameters = {
        to: 'client@example.com',
        subject: 'Test Email',
        content: 'Test content'
      };

      const action = await service.createAction('send_email', parameters, mockContext, {
        requiresApproval: true
      });

      // Mock the cache to return the action
      mockCacheService.get.mockResolvedValueOnce(JSON.stringify(action));

      const result = await service.executeAction(action.id);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Action requires approval');
      expect(result.metadata?.status).toBe('waiting_approval');
    });

    it('should handle execution timeout', async () => {
      const parameters: ActionParameters = {
        data: { content: 'test data' }
      };

      const action = await service.createAction('analyze_data', parameters, mockContext, {
        timeout: 100 // Very short timeout
      });

      // Mock a slow execution by overriding the executor
      const slowExecutor = {
        execute: jest.fn().mockImplementation(() => 
          new Promise(resolve => setTimeout(resolve, 200))
        )
      };

      service['actionExecutors'].set('analyze_data', slowExecutor);
      mockCacheService.get.mockResolvedValueOnce(JSON.stringify(action));

      const result = await service.executeAction(action.id);

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });
  });

  describe('queueAction', () => {
    it('should queue an action successfully', async () => {
      const parameters: ActionParameters = {
        title: 'Test Task',
        description: 'This is a test task'
      };

      const action = await service.createAction('create_task', parameters, mockContext);

      // Mock queue service methods
      const queueService = service.getQueueService();
      jest.spyOn(queueService, 'enqueueAction').mockResolvedValue(undefined);

      await service.queueAction(action);

      expect(queueService.enqueueAction).toHaveBeenCalledWith(action, undefined);
    });

    it('should queue action to specific queue', async () => {
      const parameters: ActionParameters = {
        message: 'Urgent notification',
        recipient: 'admin@example.com'
      };

      const action = await service.createAction('send_notification', parameters, mockContext, {
        priority: 'urgent'
      });

      const queueService = service.getQueueService();
      jest.spyOn(queueService, 'enqueueAction').mockResolvedValue(undefined);

      await service.queueAction(action, 'high_priority');

      expect(queueService.enqueueAction).toHaveBeenCalledWith(action, 'high_priority');
    });
  });

  describe('action description generation', () => {
    it('should generate appropriate descriptions for different action types', async () => {
      const emailAction = await service.createAction('send_email', {
        to: 'test@example.com'
      }, mockContext);

      const callAction = await service.createAction('make_call', {
        to: '+1234567890'
      }, mockContext);

      const crmAction = await service.createAction('update_crm', {
        clientId: 'client-123'
      }, mockContext);

      expect(emailAction.description).toContain('Send email to test@example.com');
      expect(callAction.description).toContain('Make call to +1234567890');
      expect(crmAction.description).toContain('Update CRM record for client-123');
    });
  });

  describe('risk assessment', () => {
    it('should assess different risk levels correctly', async () => {
      const lowRiskAction = await service.createAction('create_task', {
        title: 'Simple task'
      }, mockContext);

      const mediumRiskAction = await service.createAction('send_email', {
        to: 'client@example.com'
      }, mockContext);

      const highRiskAction = await service.createAction('make_call', {
        to: '+1234567890'
      }, mockContext);

      expect(lowRiskAction.riskLevel).toBe('low');
      expect(mediumRiskAction.riskLevel).toBe('medium');
      expect(highRiskAction.riskLevel).toBe('high');
    });
  });

  describe('writing style integration', () => {
    it('should apply writing style to email actions', async () => {
      const writingStyleService = service.getWritingStyleService();
      jest.spyOn(writingStyleService, 'mimicWritingStyle').mockResolvedValue(
        'Hi there,\n\nThis is a styled email.\n\nBest regards'
      );

      const parameters: ActionParameters = {
        to: 'client@example.com',
        subject: 'Test',
        content: 'This is a plain email.'
      };

      const action = await service.createAction('send_email', parameters, mockContext);
      action.status = 'approved'; // Skip approval for this test

      mockCacheService.get.mockResolvedValueOnce(JSON.stringify(action));

      await service.executeAction(action.id);

      expect(writingStyleService.mimicWritingStyle).toHaveBeenCalledWith(
        mockContext.agentId,
        'This is a plain email.',
        'email'
      );
    });
  });

  describe('metrics', () => {
    it('should return execution metrics', async () => {
      const metrics = await service.getExecutionMetrics();

      expect(metrics).toHaveProperty('totalActions');
      expect(metrics).toHaveProperty('successRate');
      expect(metrics).toHaveProperty('averageExecutionTime');
      expect(metrics).toHaveProperty('actionsByType');
      expect(metrics).toHaveProperty('actionsByStatus');
      expect(metrics).toHaveProperty('riskDistribution');
      expect(metrics.successRate).toBeGreaterThan(0);
      expect(metrics.successRate).toBeLessThanOrEqual(1);
    });
  });

  describe('event handling', () => {
    it('should emit events for action lifecycle', async () => {
      const createdHandler = jest.fn();
      const queuedHandler = jest.fn();

      service.on('action_created', createdHandler);
      service.on('action_queued', queuedHandler);

      const action = await service.createAction('create_task', {
        title: 'Test Task'
      }, mockContext);

      expect(createdHandler).toHaveBeenCalledWith({ action });

      // Mock queue service
      const queueService = service.getQueueService();
      jest.spyOn(queueService, 'enqueueAction').mockResolvedValue(undefined);

      await service.queueAction(action);

      expect(queuedHandler).toHaveBeenCalledWith({ 
        action, 
        queueId: undefined 
      });
    });
  });
});