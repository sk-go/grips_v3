import { CommunicationCenterService, UnifiedCommunication, AutoTagRule } from '../../services/communication/communicationCenterService';
import { DatabaseService } from '../../services/database';
import { CacheService } from '../../services/cacheService';

// Mock dependencies
jest.mock('../../services/database', () => ({
  DatabaseService: {
    query: jest.fn(),
    initialize: jest.fn(),
    close: jest.fn(),
    getClient: jest.fn(),
  },
}));

jest.mock('../../services/cacheService');

describe('CommunicationCenterService', () => {
  let communicationService: CommunicationCenterService;
  const mockDbService = DatabaseService as jest.Mocked<typeof DatabaseService>;
  let mockCacheService: jest.Mocked<CacheService>;

  const mockCommunication: UnifiedCommunication = {
    id: 'test-comm-id',
    type: 'email',
    direction: 'inbound',
    from: 'client@example.com',
    to: 'agent@company.com',
    subject: 'Test Subject',
    content: 'Test email content',
    timestamp: new Date('2023-12-01T10:00:00Z'),
    clientId: 'test-client-id',
    tags: ['test'],
    isUrgent: false,
    isRead: false,
    sentiment: 0.5,
    metadata: {},
    originalData: {} as any,
  };

  const mockAutoTagRule: AutoTagRule = {
    id: 'test-rule-id',
    userId: 'test-user-id',
    name: 'Urgent Keywords',
    description: 'Tag messages with urgent keywords',
    conditions: [
      {
        field: 'subject',
        operator: 'contains',
        value: 'urgent',
        caseSensitive: false,
      },
    ],
    actions: [
      {
        type: 'add_tag',
        value: 'urgent',
      },
      {
        type: 'set_urgent',
        value: true,
      },
    ],
    isActive: true,
    priority: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockCacheService = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn(),
    } as jest.Mocked<CacheService>;

    communicationService = new CommunicationCenterService(mockDbService, mockCacheService);

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('getUnifiedCommunications', () => {
    it('should return unified communications with pagination', async () => {
      const mockRows = [
        {
          type: 'email',
          id: 'email-1',
          from_address: 'client@example.com',
          to_address: 'agent@company.com',
          subject: 'Test Email',
          content: 'Email content',
          timestamp: new Date(),
          client_id: 'client-1',
          tags: ['test'],
          is_urgent: false,
          is_read: false,
          sentiment: 0.5,
          created_at: new Date(),
          direction: 'inbound',
        },
        {
          type: 'sms',
          id: 'sms-1',
          from_address: '+1234567890',
          to_address: '+0987654321',
          subject: 'SMS - Hello',
          content: 'Hello there',
          timestamp: new Date(),
          client_id: 'client-1',
          tags: [],
          is_urgent: false,
          is_read: true,
          sentiment: null,
          created_at: new Date(),
          direction: 'inbound',
        },
      ];

      // Mock the main query
      mockDbService.query.mockResolvedValueOnce({ rows: mockRows });
      
      // Mock the count query
      mockDbService.query.mockResolvedValueOnce({ rows: [{ total: '2' }] });

      const query = {
        userId: 'test-user-id',
        limit: 20,
        offset: 0,
      };

      const result = await communicationService.getUnifiedCommunications(query);

      expect(result.communications).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
      expect(result.communications[0].type).toBe('email');
      expect(result.communications[1].type).toBe('sms');
    });

    it('should handle client ID filter', async () => {
      mockDbService.query.mockResolvedValueOnce({ rows: [] });
      mockDbService.query.mockResolvedValueOnce({ rows: [{ total: '0' }] });

      const query = {
        userId: 'test-user-id',
        clientId: 'specific-client-id',
        limit: 20,
        offset: 0,
      };

      await communicationService.getUnifiedCommunications(query);

      expect(mockDbService.query).toHaveBeenCalledWith(
        expect.stringContaining('client_id = $1'),
        expect.arrayContaining(['specific-client-id'])
      );
    });

    it('should handle date range filters', async () => {
      mockDbService.query.mockResolvedValueOnce({ rows: [] });
      mockDbService.query.mockResolvedValueOnce({ rows: [{ total: '0' }] });

      const dateFrom = new Date('2023-01-01');
      const dateTo = new Date('2023-12-31');

      const query = {
        userId: 'test-user-id',
        dateFrom,
        dateTo,
        limit: 20,
        offset: 0,
      };

      await communicationService.getUnifiedCommunications(query);

      expect(mockDbService.query).toHaveBeenCalledWith(
        expect.stringContaining('date >= $1'),
        expect.arrayContaining([dateFrom, dateTo])
      );
    });

    it('should handle tags filter', async () => {
      mockDbService.query.mockResolvedValueOnce({ rows: [] });
      mockDbService.query.mockResolvedValueOnce({ rows: [{ total: '0' }] });

      const query = {
        userId: 'test-user-id',
        tags: ['urgent', 'client-related'],
        limit: 20,
        offset: 0,
      };

      await communicationService.getUnifiedCommunications(query);

      expect(mockDbService.query).toHaveBeenCalledWith(
        expect.stringContaining('tags::jsonb ?|'),
        expect.arrayContaining([['urgent', 'client-related']])
      );
    });
  });

  describe('searchCommunications', () => {
    it('should perform full-text search across all communication types', async () => {
      const mockRows = [
        {
          type: 'email',
          id: 'email-1',
          from_address: 'client@example.com',
          to_address: 'agent@company.com',
          subject: 'Insurance policy question',
          content: 'I have a question about my policy',
          timestamp: new Date(),
          client_id: 'client-1',
          tags: [],
          is_urgent: false,
          is_read: false,
          sentiment: 0,
          created_at: new Date(),
          direction: 'inbound',
          rank: 0.8,
        },
      ];

      mockDbService.query.mockResolvedValue({ rows: mockRows });

      const result = await communicationService.searchCommunications('policy', {
        userId: 'test-user-id',
        limit: 10,
        offset: 0,
      });

      expect(result).toHaveLength(1);
      expect(result[0].subject).toContain('policy');
      expect(mockDbService.query).toHaveBeenCalledWith(
        expect.stringContaining('plainto_tsquery'),
        expect.arrayContaining(['policy', 10, 0])
      );
    });

    it('should return empty array for no matches', async () => {
      mockDbService.query.mockResolvedValue({ rows: [] });

      const result = await communicationService.searchCommunications('nonexistent', {
        userId: 'test-user-id',
      });

      expect(result).toHaveLength(0);
    });
  });

  describe('getAutoTagRules', () => {
    it('should return active auto tag rules for user', async () => {
      const mockRows = [
        {
          id: mockAutoTagRule.id,
          user_id: mockAutoTagRule.userId,
          name: mockAutoTagRule.name,
          description: mockAutoTagRule.description,
          conditions: mockAutoTagRule.conditions,
          actions: mockAutoTagRule.actions,
          is_active: mockAutoTagRule.isActive,
          priority: mockAutoTagRule.priority,
          created_at: mockAutoTagRule.createdAt,
          updated_at: mockAutoTagRule.updatedAt,
        },
      ];

      mockDbService.query.mockResolvedValue({ rows: mockRows });

      const result = await communicationService.getAutoTagRules('test-user-id');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: mockAutoTagRule.id,
        name: mockAutoTagRule.name,
        isActive: true,
      });

      expect(mockDbService.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = $1 AND is_active = true'),
        ['test-user-id']
      );
    });

    it('should return empty array if no rules found', async () => {
      mockDbService.query.mockResolvedValue({ rows: [] });

      const result = await communicationService.getAutoTagRules('test-user-id');

      expect(result).toHaveLength(0);
    });
  });

  describe('createAutoTagRule', () => {
    it('should create new auto tag rule', async () => {
      const mockRow = {
        id: 'new-rule-id',
        user_id: 'test-user-id',
        name: 'New Rule',
        description: 'Test rule',
        conditions: [{ field: 'subject', operator: 'contains', value: 'test' }],
        actions: [{ type: 'add_tag', value: 'test' }],
        is_active: true,
        priority: 5,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockDbService.query.mockResolvedValue({ rows: [mockRow] });

      const ruleData = {
        name: 'New Rule',
        description: 'Test rule',
        conditions: [{ field: 'subject' as const, operator: 'contains' as const, value: 'test' }],
        actions: [{ type: 'add_tag' as const, value: 'test' }],
        isActive: true,
        priority: 5,
      };

      const result = await communicationService.createAutoTagRule('test-user-id', ruleData);

      expect(result).toMatchObject({
        id: 'new-rule-id',
        name: 'New Rule',
        userId: 'test-user-id',
      });

      expect(mockDbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO auto_tag_rules'),
        expect.arrayContaining(['test-user-id', 'New Rule', 'Test rule'])
      );
    });
  });

  describe('applyAutoTagRules', () => {
    beforeEach(() => {
      // Mock getAutoTagRules to return our test rule
      const mockRows = [
        {
          id: mockAutoTagRule.id,
          user_id: mockAutoTagRule.userId,
          name: mockAutoTagRule.name,
          description: mockAutoTagRule.description,
          conditions: mockAutoTagRule.conditions,
          actions: mockAutoTagRule.actions,
          is_active: mockAutoTagRule.isActive,
          priority: mockAutoTagRule.priority,
          created_at: mockAutoTagRule.createdAt,
          updated_at: mockAutoTagRule.updatedAt,
        },
      ];

      mockDbService.query.mockResolvedValue({ rows: mockRows });
    });

    it('should apply matching auto tag rules', async () => {
      const communication = {
        ...mockCommunication,
        subject: 'URGENT: Policy question',
        tags: [],
        isUrgent: false,
      };

      const result = await communicationService.applyAutoTagRules(communication, 'test-user-id');

      expect(result.tags).toContain('urgent');
      expect(result.isUrgent).toBe(true);
    });

    it('should not apply non-matching rules', async () => {
      const communication = {
        ...mockCommunication,
        subject: 'Regular policy question',
        tags: [],
        isUrgent: false,
      };

      const result = await communicationService.applyAutoTagRules(communication, 'test-user-id');

      expect(result.tags).not.toContain('urgent');
      expect(result.isUrgent).toBe(false);
    });

    it('should handle multiple conditions', async () => {
      // Mock a rule with multiple conditions
      const multiConditionRule = {
        ...mockAutoTagRule,
        conditions: [
          { field: 'subject' as const, operator: 'contains' as const, value: 'urgent' },
          { field: 'from' as const, operator: 'contains' as const, value: 'client' },
        ],
      };

      mockDbService.query.mockResolvedValue({
        rows: [{
          ...multiConditionRule,
          user_id: multiConditionRule.userId,
          is_active: multiConditionRule.isActive,
          created_at: multiConditionRule.createdAt,
          updated_at: multiConditionRule.updatedAt,
        }],
      });

      const communication = {
        ...mockCommunication,
        subject: 'URGENT: Policy question',
        from: 'client@example.com',
        tags: [],
        isUrgent: false,
      };

      const result = await communicationService.applyAutoTagRules(communication, 'test-user-id');

      expect(result.tags).toContain('urgent');
      expect(result.isUrgent).toBe(true);
    });

    it('should handle case insensitive matching', async () => {
      const communication = {
        ...mockCommunication,
        subject: 'urgent: policy question', // lowercase
        tags: [],
        isUrgent: false,
      };

      const result = await communicationService.applyAutoTagRules(communication, 'test-user-id');

      expect(result.tags).toContain('urgent');
      expect(result.isUrgent).toBe(true);
    });
  });

  describe('broadcastNewCommunication', () => {
    it('should emit newCommunication event', async () => {
      const eventSpy = jest.fn();
      communicationService.on('newCommunication', eventSpy);

      await communicationService.broadcastNewCommunication(mockCommunication);

      expect(eventSpy).toHaveBeenCalledWith(mockCommunication);
    });

    it('should handle missing WebSocket server gracefully', async () => {
      // Should not throw error even without WebSocket server
      await expect(
        communicationService.broadcastNewCommunication(mockCommunication)
      ).resolves.not.toThrow();
    });
  });
});