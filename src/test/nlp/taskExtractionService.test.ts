import { TaskExtractionService } from '../../services/nlp/taskExtractionService';
import { Entity } from '../../types/nlp';

describe('TaskExtractionService', () => {
  let service: TaskExtractionService;

  beforeEach(() => {
    service = new TaskExtractionService();
  });

  describe('extractTasks', () => {
    it('should extract email tasks', () => {
      const text = 'Send an email to John about the policy renewal';
      const entities: Entity[] = [
        {
          type: 'person',
          value: 'John',
          confidence: 0.8,
          startIndex: 15,
          endIndex: 19
        }
      ];

      const tasks = service.extractTasks(text, entities);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].type).toBe('email');
      expect(tasks[0].parameters.target).toBe('John');
      expect(tasks[0].parameters.subject).toBe('the policy renewal');
      expect(tasks[0].requiresApproval).toBe(true);
    });

    it('should extract call tasks', () => {
      const text = 'Call Sarah tomorrow morning';
      const entities: Entity[] = [
        {
          type: 'person',
          value: 'Sarah',
          confidence: 0.9,
          startIndex: 5,
          endIndex: 10
        }
      ];

      const tasks = service.extractTasks(text, entities);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].type).toBe('call');
      expect(tasks[0].parameters.target).toBe('Sarah');
      expect(tasks[0].priority).toBe('high');
    });

    it('should extract meeting tasks', () => {
      const text = 'Schedule a meeting with the client next week';
      const entities: Entity[] = [];

      const tasks = service.extractTasks(text, entities);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].type).toBe('meeting');
      expect(tasks[0].parameters.target).toBe('the client');
      expect(tasks[0].requiresApproval).toBe(true);
    });

    it('should extract follow-up tasks', () => {
      const text = 'Follow up with Mr. Johnson about his claim';
      const entities: Entity[] = [
        {
          type: 'person',
          value: 'Mr. Johnson',
          confidence: 0.85,
          startIndex: 16,
          endIndex: 27
        }
      ];

      const tasks = service.extractTasks(text, entities);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].type).toBe('follow_up');
      expect(tasks[0].parameters.target).toBe('Mr. Johnson');
      expect(tasks[0].priority).toBe('low');
    });

    it('should extract document generation tasks', () => {
      const text = 'Generate a policy summary document for the client';
      const entities: Entity[] = [];

      const tasks = service.extractTasks(text, entities);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].type).toBe('document_generation');
      expect(tasks[0].parameters.target).toBe('a policy summary');
      expect(tasks[0].requiresApproval).toBe(true);
    });

    it('should extract CRM update tasks', () => {
      const text = 'Update the client record in CRM with new address';
      const entities: Entity[] = [];

      const tasks = service.extractTasks(text, entities);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].type).toBe('crm_update');
      expect(tasks[0].parameters.target).toBe('the client record');
    });

    it('should handle urgent tasks', () => {
      const text = 'URGENT: Call the client immediately about the emergency claim';
      const entities: Entity[] = [];

      const tasks = service.extractTasks(text, entities);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].type).toBe('call');
      expect(tasks[0].priority).toBe('high');
    });

    it('should extract multiple tasks from complex text', () => {
      const text = 'Send an email to John, then call Sarah, and schedule a meeting with the team';
      const entities: Entity[] = [
        {
          type: 'person',
          value: 'John',
          confidence: 0.8,
          startIndex: 15,
          endIndex: 19
        },
        {
          type: 'person',
          value: 'Sarah',
          confidence: 0.8,
          startIndex: 35,
          endIndex: 40
        }
      ];

      const tasks = service.extractTasks(text, entities);

      expect(tasks.length).toBeGreaterThanOrEqual(2);
      
      const emailTask = tasks.find(t => t.type === 'email');
      const callTask = tasks.find(t => t.type === 'call');
      const meetingTask = tasks.find(t => t.type === 'meeting');

      expect(emailTask).toBeDefined();
      expect(callTask).toBeDefined();
      expect(meetingTask).toBeDefined();
    });

    it('should deduplicate similar tasks', () => {
      const text = 'Call John. Please call John about the policy.';
      const entities: Entity[] = [
        {
          type: 'person',
          value: 'John',
          confidence: 0.8,
          startIndex: 5,
          endIndex: 9
        }
      ];

      const tasks = service.extractTasks(text, entities);

      // Should only have one call task, not two
      const callTasks = tasks.filter(t => t.type === 'call');
      expect(callTasks).toHaveLength(1);
    });

    it('should handle empty text', () => {
      const tasks = service.extractTasks('', []);
      expect(tasks).toHaveLength(0);
    });

    it('should handle text with no tasks', () => {
      const text = 'The weather is nice today. I like coffee.';
      const tasks = service.extractTasks(text, []);
      expect(tasks).toHaveLength(0);
    });

    it('should include entity information in task parameters', () => {
      const text = 'Email client@example.com about policy POL123456';
      const entities: Entity[] = [
        {
          type: 'email',
          value: 'client@example.com',
          confidence: 0.95,
          startIndex: 6,
          endIndex: 23
        },
        {
          type: 'policy_number',
          value: 'POL123456',
          confidence: 0.9,
          startIndex: 37,
          endIndex: 46
        }
      ];

      const tasks = service.extractTasks(text, entities);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].type).toBe('email');
      expect(tasks[0].parameters.email).toBe('client@example.com');
    });
  });
});