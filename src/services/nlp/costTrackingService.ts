import { DatabaseService } from '../database/DatabaseService';
import { logger } from '../../utils/logger';

export interface AIRequestRecord {
  id?: string;
  agentId: string;
  sessionId?: string;
  requestType: string;
  modelUsed: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  processingTime: number;
  success: boolean;
  errorMessage?: string;
  requestData?: any;
  responseData?: any;
}

export interface AgentCostBudget {
  agentId: string;
  dailyBudget: number;
  monthlyBudget: number;
  costThresholdWarning: number;
  costThresholdApproval: number;
  budgetAlertsEnabled: boolean;
}

export interface CostApprovalRequest {
  id?: string;
  agentId: string;
  estimatedCost: number;
  requestType: string;
  requestDescription?: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  approvedBy?: string;
  approvalReason?: string;
  expiresAt: Date;
}

export interface DailyCostSummary {
  agentId: string;
  date: string;
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  averageCostPerRequest: number;
}

export interface CostThresholdCheck {
  exceedsWarning: boolean;
  exceedsApproval: boolean;
  currentCost: number;
  warningThreshold: number;
  approvalThreshold: number;
  dailySpent: number;
  dailyBudget: number;
  monthlySpent: number;
  monthlyBudget: number;
}

export class CostTrackingService {
  private db = DatabaseService;

  /**
   * Record an AI request with cost tracking
   */
  async recordAIRequest(request: AIRequestRecord): Promise<string> {
    try {
      const query = `
        INSERT INTO ai_requests (
          agent_id, session_id, request_type, model_used,
          prompt_tokens, completion_tokens, total_tokens,
          cost, processing_time, success, error_message,
          request_data, response_data
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id
      `;

      const values = [
        request.agentId,
        request.sessionId,
        request.requestType,
        request.modelUsed,
        request.promptTokens,
        request.completionTokens,
        request.totalTokens,
        request.cost,
        request.processingTime,
        request.success,
        request.errorMessage,
        request.requestData ? JSON.stringify(request.requestData) : null,
        request.responseData ? JSON.stringify(request.responseData) : null
      ];

      const result = await this.db.query(query, values);
      const requestId = result.rows[0].id;

      logger.debug('AI request recorded', {
        requestId,
        agentId: request.agentId,
        cost: request.cost,
        tokens: request.totalTokens
      });

      return requestId;

    } catch (error) {
      logger.error('Failed to record AI request', { error, request });
      throw error;
    }
  }

  /**
   * Get or create cost budget for an agent
   */
  async getAgentCostBudget(agentId: string): Promise<AgentCostBudget> {
    try {
      let query = `
        SELECT agent_id, daily_budget, monthly_budget, 
               cost_threshold_warning, cost_threshold_approval, budget_alerts_enabled
        FROM agent_cost_budgets 
        WHERE agent_id = $1
      `;

      let result = await this.db.query(query, [agentId]);

      if (result.rows.length === 0) {
        // Create default budget for new agent
        const insertQuery = `
          INSERT INTO agent_cost_budgets (
            agent_id, daily_budget, monthly_budget, 
            cost_threshold_warning, cost_threshold_approval
          ) VALUES ($1, $2, $3, $4, $5)
          RETURNING agent_id, daily_budget, monthly_budget, 
                    cost_threshold_warning, cost_threshold_approval, budget_alerts_enabled
        `;

        result = await this.db.query(insertQuery, [
          agentId,
          10.00, // $10 daily budget
          300.00, // $300 monthly budget
          0.10, // $0.10 warning threshold
          0.50  // $0.50 approval threshold
        ]);

        logger.info('Created default cost budget for agent', { agentId });
      }

      const row = result.rows[0];
      return {
        agentId: row.agent_id,
        dailyBudget: parseFloat(row.daily_budget),
        monthlyBudget: parseFloat(row.monthly_budget),
        costThresholdWarning: parseFloat(row.cost_threshold_warning),
        costThresholdApproval: parseFloat(row.cost_threshold_approval),
        budgetAlertsEnabled: row.budget_alerts_enabled
      };

    } catch (error) {
      logger.error('Failed to get agent cost budget', { error, agentId });
      throw error;
    }
  }

  /**
   * Check if a request would exceed cost thresholds
   */
  async checkCostThresholds(agentId: string, estimatedCost: number): Promise<CostThresholdCheck> {
    try {
      const budget = await this.getAgentCostBudget(agentId);
      
      // Get today's spending
      const todayQuery = `
        SELECT COALESCE(total_cost, 0) as daily_spent
        FROM agent_daily_costs 
        WHERE agent_id = $1 AND date = CURRENT_DATE
      `;
      const todayResult = await this.db.query(todayQuery, [agentId]);
      const dailySpent = parseFloat(todayResult.rows[0]?.daily_spent || '0');

      // Get this month's spending
      const monthQuery = `
        SELECT COALESCE(SUM(total_cost), 0) as monthly_spent
        FROM agent_daily_costs 
        WHERE agent_id = $1 
          AND date >= DATE_TRUNC('month', CURRENT_DATE)
          AND date < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
      `;
      const monthResult = await this.db.query(monthQuery, [agentId]);
      const monthlySpent = parseFloat(monthResult.rows[0]?.monthly_spent || '0');

      return {
        exceedsWarning: estimatedCost > budget.costThresholdWarning,
        exceedsApproval: estimatedCost > budget.costThresholdApproval,
        currentCost: estimatedCost,
        warningThreshold: budget.costThresholdWarning,
        approvalThreshold: budget.costThresholdApproval,
        dailySpent,
        dailyBudget: budget.dailyBudget,
        monthlySpent,
        monthlyBudget: budget.monthlyBudget
      };

    } catch (error) {
      logger.error('Failed to check cost thresholds', { error, agentId, estimatedCost });
      throw error;
    }
  }

  /**
   * Create a cost approval request
   */
  async createApprovalRequest(request: Omit<CostApprovalRequest, 'id' | 'status'>): Promise<string> {
    try {
      const query = `
        INSERT INTO cost_approval_requests (
          agent_id, estimated_cost, request_type, request_description, expires_at
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `;

      const result = await this.db.query(query, [
        request.agentId,
        request.estimatedCost,
        request.requestType,
        request.requestDescription,
        request.expiresAt
      ]);

      const approvalId = result.rows[0].id;

      logger.info('Cost approval request created', {
        approvalId,
        agentId: request.agentId,
        estimatedCost: request.estimatedCost
      });

      return approvalId;

    } catch (error) {
      logger.error('Failed to create approval request', { error, request });
      throw error;
    }
  }

  /**
   * Check if there's a pending or approved request for this cost
   */
  async checkApprovalStatus(agentId: string, estimatedCost: number): Promise<CostApprovalRequest | null> {
    try {
      const query = `
        SELECT id, agent_id, estimated_cost, request_type, request_description,
               status, approved_by, approval_reason, expires_at, created_at
        FROM cost_approval_requests 
        WHERE agent_id = $1 
          AND estimated_cost >= $2 
          AND status IN ('pending', 'approved')
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const result = await this.db.query(query, [agentId, estimatedCost]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        agentId: row.agent_id,
        estimatedCost: parseFloat(row.estimated_cost),
        requestType: row.request_type,
        requestDescription: row.request_description,
        status: row.status,
        approvedBy: row.approved_by,
        approvalReason: row.approval_reason,
        expiresAt: row.expires_at
      };

    } catch (error) {
      logger.error('Failed to check approval status', { error, agentId, estimatedCost });
      throw error;
    }
  }

  /**
   * Get daily cost summary for an agent
   */
  async getDailyCostSummary(agentId: string, date?: string): Promise<DailyCostSummary | null> {
    try {
      const targetDate = date || new Date().toISOString().split('T')[0];
      
      const query = `
        SELECT agent_id, date, total_requests, total_tokens, total_cost, average_cost_per_request
        FROM agent_daily_costs 
        WHERE agent_id = $1 AND date = $2
      `;

      const result = await this.db.query(query, [agentId, targetDate]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        agentId: row.agent_id,
        date: row.date,
        totalRequests: parseInt(row.total_requests),
        totalTokens: parseInt(row.total_tokens),
        totalCost: parseFloat(row.total_cost),
        averageCostPerRequest: parseFloat(row.average_cost_per_request)
      };

    } catch (error) {
      logger.error('Failed to get daily cost summary', { error, agentId, date });
      throw error;
    }
  }

  /**
   * Get cost statistics for reporting
   */
  async getCostStatistics(agentId: string, days: number = 30): Promise<{
    totalRequests: number;
    totalCost: number;
    averageCostPerRequest: number;
    dailySummaries: DailyCostSummary[];
  }> {
    try {
      const query = `
        SELECT agent_id, date, total_requests, total_tokens, total_cost, average_cost_per_request
        FROM agent_daily_costs 
        WHERE agent_id = $1 
          AND date >= CURRENT_DATE - INTERVAL '${days} days'
        ORDER BY date DESC
      `;

      const result = await this.db.query(query, [agentId]);

      const dailySummaries: DailyCostSummary[] = result.rows.map(row => ({
        agentId: row.agent_id,
        date: row.date,
        totalRequests: parseInt(row.total_requests),
        totalTokens: parseInt(row.total_tokens),
        totalCost: parseFloat(row.total_cost),
        averageCostPerRequest: parseFloat(row.average_cost_per_request)
      }));

      const totalRequests = dailySummaries.reduce((sum, day) => sum + day.totalRequests, 0);
      const totalCost = dailySummaries.reduce((sum, day) => sum + day.totalCost, 0);
      const averageCostPerRequest = totalRequests > 0 ? totalCost / totalRequests : 0;

      return {
        totalRequests,
        totalCost,
        averageCostPerRequest,
        dailySummaries
      };

    } catch (error) {
      logger.error('Failed to get cost statistics', { error, agentId, days });
      throw error;
    }
  }

  /**
   * Update agent cost budget
   */
  async updateAgentCostBudget(agentId: string, updates: Partial<AgentCostBudget>): Promise<void> {
    try {
      const setClause = [];
      const values: any[] = [agentId];
      let paramIndex = 2;

      if (updates.dailyBudget !== undefined) {
        setClause.push(`daily_budget = $${paramIndex++}`);
        values.push(updates.dailyBudget);
      }
      if (updates.monthlyBudget !== undefined) {
        setClause.push(`monthly_budget = $${paramIndex++}`);
        values.push(updates.monthlyBudget);
      }
      if (updates.costThresholdWarning !== undefined) {
        setClause.push(`cost_threshold_warning = $${paramIndex++}`);
        values.push(updates.costThresholdWarning);
      }
      if (updates.costThresholdApproval !== undefined) {
        setClause.push(`cost_threshold_approval = $${paramIndex++}`);
        values.push(updates.costThresholdApproval);
      }
      if (updates.budgetAlertsEnabled !== undefined) {
        setClause.push(`budget_alerts_enabled = $${paramIndex++}`);
        values.push(updates.budgetAlertsEnabled);
      }

      if (setClause.length === 0) {
        return;
      }

      setClause.push(`updated_at = NOW()`);

      const query = `
        UPDATE agent_cost_budgets 
        SET ${setClause.join(', ')}
        WHERE agent_id = $1
      `;

      await this.db.query(query, values);

      logger.info('Agent cost budget updated', { agentId, updates });

    } catch (error) {
      logger.error('Failed to update agent cost budget', { error, agentId, updates });
      throw error;
    }
  }

  /**
   * Clean up expired approval requests
   */
  async cleanupExpiredApprovals(): Promise<number> {
    try {
      const query = `
        UPDATE cost_approval_requests 
        SET status = 'expired', updated_at = NOW()
        WHERE status = 'pending' AND expires_at < NOW()
        RETURNING id
      `;

      const result = await this.db.query(query);
      const expiredCount = result.rows.length;

      if (expiredCount > 0) {
        logger.info('Cleaned up expired approval requests', { count: expiredCount });
      }

      return expiredCount;

    } catch (error) {
      logger.error('Failed to cleanup expired approvals', error);
      throw error;
    }
  }
}