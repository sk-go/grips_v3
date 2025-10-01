import { CostTrackingService, AIRequestRecord, AgentCostBudget } from '../../services/nlp/costTrackingService';
import { DatabaseService } from '../../services/database/DatabaseService';

// Mock the DatabaseService
jest.mock('../../services/database/DatabaseService', () => ({
  DatabaseService: {
    query: jest.fn()
  }
}));

describe('CostTrackingService', () => {
  let costTracker: CostTrackingService;
  let mockQuery: jest.MockedFunction<typeof DatabaseService.query>;

  // Helper function to create mock query results
  const mockQueryResult = (rows: any[]) => ({ rows, rowCount: rows.length });

  beforeEach(() => {
    costTracker = new CostTrackingService();
    mockQuery = DatabaseService.query as jest.MockedFunction<typeof DatabaseService.query>;
    jest.clearAllMocks();
  });

  describe('recordAIRequest', () => {
    it('should record an AI request successfully', async () => {
      const mockRequestId = 'req_123';
      mockQuery.mockResolvedValue(mockQueryResult([{ id: mockRequestId }]));

      const request: AIRequestRecord = {
        agentId: 'agent_123',
        sessionId: 'session_456',
        requestType: 'text_generation',
        modelUsed: 'claude-3-sonnet-20240229',
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cost: 0.05,
        processingTime: 1500,
        success: true,
        requestData: { temperature: 0.7 },
        responseData: { finishReason: 'stop' }
      };

      const result = await costTracker.recordAIRequest(request);

      expect(result).toBe(mockRequestId);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ai_requests'),
        [
          'agent_123',
          'session_456',
          'text_generation',
          'claude-3-sonnet-20240229',
          100,
          50,
          150,
          0.05,
          1500,
          true,
          undefined,
          JSON.stringify({ temperature: 0.7 }),
          JSON.stringify({ finishReason: 'stop' })
        ]
      );
    });

    it('should handle failed AI request recording', async () => {
      mockQuery.mockRejectedValue(new Error('Database error'));

      const request: AIRequestRecord = {
        agentId: 'agent_123',
        requestType: 'text_generation',
        modelUsed: 'claude-3-sonnet-20240229',
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cost: 0.05,
        processingTime: 1500,
        success: false,
        errorMessage: 'API error'
      };

      await expect(costTracker.recordAIRequest(request)).rejects.toThrow('Database error');
    });
  });

  describe('getAgentCostBudget', () => {
    it('should return existing budget for agent', async () => {
      const mockBudget = {
        agent_id: 'agent_123',
        daily_budget: '10.00',
        monthly_budget: '300.00',
        cost_threshold_warning: '0.10',
        cost_threshold_approval: '0.50',
        budget_alerts_enabled: true
      };

      mockQuery.mockResolvedValue(mockQueryResult([mockBudget]));

      const result = await costTracker.getAgentCostBudget('agent_123');

      expect(result).toEqual({
        agentId: 'agent_123',
        dailyBudget: 10.00,
        monthlyBudget: 300.00,
        costThresholdWarning: 0.10,
        costThresholdApproval: 0.50,
        budgetAlertsEnabled: true
      });
    });

    it('should create default budget for new agent', async () => {
      // First call returns empty (no existing budget)
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));
      
      // Second call returns the created budget
      const mockCreatedBudget = {
        agent_id: 'agent_new',
        daily_budget: '10.00',
        monthly_budget: '300.00',
        cost_threshold_warning: '0.10',
        cost_threshold_approval: '0.50',
        budget_alerts_enabled: true
      };
      mockQuery.mockResolvedValueOnce(mockQueryResult([mockCreatedBudget]));

      const result = await costTracker.getAgentCostBudget('agent_new');

      expect(result.agentId).toBe('agent_new');
      expect(result.dailyBudget).toBe(10.00);
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenNthCalledWith(2, 
        expect.stringContaining('INSERT INTO agent_cost_budgets'),
        ['agent_new', 10.00, 300.00, 0.10, 0.50]
      );
    });
  });

  describe('checkCostThresholds', () => {
    it('should check cost thresholds correctly', async () => {
      // Mock budget query
      const mockBudget = {
        agent_id: 'agent_123',
        daily_budget: '10.00',
        monthly_budget: '300.00',
        cost_threshold_warning: '0.10',
        cost_threshold_approval: '0.50',
        budget_alerts_enabled: true
      };
      mockQuery.mockResolvedValueOnce(mockQueryResult([mockBudget]));

      // Mock daily spending query
      mockQuery.mockResolvedValueOnce(mockQueryResult([{ daily_spent: '5.50' }]));

      // Mock monthly spending query
      mockQuery.mockResolvedValueOnce(mockQueryResult([{ monthly_spent: '150.75' }]));

      const result = await costTracker.checkCostThresholds('agent_123', 0.75);

      expect(result).toEqual({
        exceedsWarning: true,
        exceedsApproval: true,
        currentCost: 0.75,
        warningThreshold: 0.10,
        approvalThreshold: 0.50,
        dailySpent: 5.50,
        dailyBudget: 10.00,
        monthlySpent: 150.75,
        monthlyBudget: 300.00
      });
    });

    it('should handle missing spending data', async () => {
      // Mock budget query
      const mockBudget = {
        agent_id: 'agent_123',
        daily_budget: '10.00',
        monthly_budget: '300.00',
        cost_threshold_warning: '0.10',
        cost_threshold_approval: '0.50',
        budget_alerts_enabled: true
      };
      mockQuery.mockResolvedValueOnce(mockQueryResult([mockBudget]));

      // Mock empty spending queries
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      const result = await costTracker.checkCostThresholds('agent_123', 0.05);

      expect(result.dailySpent).toBe(0);
      expect(result.monthlySpent).toBe(0);
      expect(result.exceedsWarning).toBe(false);
      expect(result.exceedsApproval).toBe(false);
    });
  });

  describe('createApprovalRequest', () => {
    it('should create approval request successfully', async () => {
      const mockApprovalId = 'approval_123';
      mockQuery.mockResolvedValue(mockQueryResult([{ id: mockApprovalId }]));

      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1);

      const result = await costTracker.createApprovalRequest({
        agentId: 'agent_123',
        estimatedCost: 0.75,
        requestType: 'text_generation',
        requestDescription: 'Complex analysis request',
        expiresAt
      });

      expect(result).toBe(mockApprovalId);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO cost_approval_requests'),
        ['agent_123', 0.75, 'text_generation', 'Complex analysis request', expiresAt]
      );
    });
  });

  describe('checkApprovalStatus', () => {
    it('should return existing approval', async () => {
      const mockApproval = {
        id: 'approval_123',
        agent_id: 'agent_123',
        estimated_cost: '0.75',
        request_type: 'text_generation',
        request_description: 'Test request',
        status: 'approved',
        approved_by: 'admin_123',
        approval_reason: 'Approved for testing',
        expires_at: new Date(),
        created_at: new Date()
      };

      mockQuery.mockResolvedValue(mockQueryResult([mockApproval]));

      const result = await costTracker.checkApprovalStatus('agent_123', 0.75);

      expect(result).toEqual({
        id: 'approval_123',
        agentId: 'agent_123',
        estimatedCost: 0.75,
        requestType: 'text_generation',
        requestDescription: 'Test request',
        status: 'approved',
        approvedBy: 'admin_123',
        approvalReason: 'Approved for testing',
        expiresAt: mockApproval.expires_at
      });
    });

    it('should return null when no approval exists', async () => {
      mockQuery.mockResolvedValue(mockQueryResult([]));

      const result = await costTracker.checkApprovalStatus('agent_123', 0.75);

      expect(result).toBeNull();
    });
  });

  describe('getDailyCostSummary', () => {
    it('should return daily cost summary', async () => {
      const mockSummary = {
        agent_id: 'agent_123',
        date: '2024-01-15',
        total_requests: '25',
        total_tokens: '5000',
        total_cost: '2.50',
        average_cost_per_request: '0.10'
      };

      mockQuery.mockResolvedValue(mockQueryResult([mockSummary]));

      const result = await costTracker.getDailyCostSummary('agent_123', '2024-01-15');

      expect(result).toEqual({
        agentId: 'agent_123',
        date: '2024-01-15',
        totalRequests: 25,
        totalTokens: 5000,
        totalCost: 2.50,
        averageCostPerRequest: 0.10
      });
    });

    it('should return null when no data exists', async () => {
      mockQuery.mockResolvedValue(mockQueryResult([]));

      const result = await costTracker.getDailyCostSummary('agent_123', '2024-01-15');

      expect(result).toBeNull();
    });
  });

  describe('getCostStatistics', () => {
    it('should return cost statistics', async () => {
      const mockDailySummaries = [
        {
          agent_id: 'agent_123',
          date: '2024-01-15',
          total_requests: '10',
          total_tokens: '2000',
          total_cost: '1.00',
          average_cost_per_request: '0.10'
        },
        {
          agent_id: 'agent_123',
          date: '2024-01-14',
          total_requests: '15',
          total_tokens: '3000',
          total_cost: '1.50',
          average_cost_per_request: '0.10'
        }
      ];

      mockQuery.mockResolvedValue(mockQueryResult(mockDailySummaries));

      const result = await costTracker.getCostStatistics('agent_123', 30);

      expect(result).toEqual({
        totalRequests: 25,
        totalCost: 2.50,
        averageCostPerRequest: 0.10,
        dailySummaries: [
          {
            agentId: 'agent_123',
            date: '2024-01-15',
            totalRequests: 10,
            totalTokens: 2000,
            totalCost: 1.00,
            averageCostPerRequest: 0.10
          },
          {
            agentId: 'agent_123',
            date: '2024-01-14',
            totalRequests: 15,
            totalTokens: 3000,
            totalCost: 1.50,
            averageCostPerRequest: 0.10
          }
        ]
      });
    });
  });

  describe('updateAgentCostBudget', () => {
    it('should update agent cost budget', async () => {
      mockQuery.mockResolvedValue(mockQueryResult([]));

      const updates = {
        dailyBudget: 15.00,
        costThresholdWarning: 0.15
      };

      await costTracker.updateAgentCostBudget('agent_123', updates);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE agent_cost_budgets'),
        ['agent_123', 15.00, 0.15]
      );
    });

    it('should handle empty updates', async () => {
      await costTracker.updateAgentCostBudget('agent_123', {});

      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('cleanupExpiredApprovals', () => {
    it('should cleanup expired approvals', async () => {
      const mockExpiredApprovals = [
        { id: 'approval_1' },
        { id: 'approval_2' }
      ];

      mockQuery.mockResolvedValue(mockQueryResult(mockExpiredApprovals));

      const result = await costTracker.cleanupExpiredApprovals();

      expect(result).toBe(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE cost_approval_requests')
      );
    });

    it('should return 0 when no expired approvals', async () => {
      mockQuery.mockResolvedValue(mockQueryResult([]));

      const result = await costTracker.cleanupExpiredApprovals();

      expect(result).toBe(0);
    });
  });
});