-- AI Cost Tracking Tables
-- This migration creates tables for tracking AI API usage and costs per agent

-- AI requests tracking table
CREATE TABLE IF NOT EXISTS ai_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL,
    session_id VARCHAR(255),
    request_type VARCHAR(50) NOT NULL, -- 'text_generation', 'embedding', 'analysis', etc.
    model_used VARCHAR(100) NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cost DECIMAL(10,6) NOT NULL DEFAULT 0, -- Cost in USD with 6 decimal precision
    processing_time INTEGER NOT NULL DEFAULT 0, -- Processing time in milliseconds
    success BOOLEAN NOT NULL DEFAULT true,
    error_message TEXT,
    request_data JSONB, -- Store request parameters for analysis
    response_data JSONB, -- Store response metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Daily cost aggregation per agent
CREATE TABLE IF NOT EXISTS agent_daily_costs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL,
    date DATE NOT NULL,
    total_requests INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost DECIMAL(10,6) NOT NULL DEFAULT 0,
    average_cost_per_request DECIMAL(10,6) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(agent_id, date)
);

-- Cost budgets and limits per agent
CREATE TABLE IF NOT EXISTS agent_cost_budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL UNIQUE,
    daily_budget DECIMAL(10,6) NOT NULL DEFAULT 10.00, -- Default $10/day
    monthly_budget DECIMAL(10,6) NOT NULL DEFAULT 300.00, -- Default $300/month
    cost_threshold_warning DECIMAL(10,6) NOT NULL DEFAULT 0.10, -- Warn at $0.10 per request
    cost_threshold_approval DECIMAL(10,6) NOT NULL DEFAULT 0.50, -- Require approval at $0.50 per request
    budget_alerts_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Cost approval requests
CREATE TABLE IF NOT EXISTS cost_approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL,
    estimated_cost DECIMAL(10,6) NOT NULL,
    request_type VARCHAR(50) NOT NULL,
    request_description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'expired'
    approved_by UUID, -- Admin user who approved/rejected
    approval_reason TEXT,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ai_requests_agent_date ON ai_requests(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_requests_cost ON ai_requests(cost DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_requests_model ON ai_requests(model_used, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_requests_session ON ai_requests(session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_daily_costs_agent_date ON agent_daily_costs(agent_id, date);
CREATE INDEX IF NOT EXISTS idx_agent_daily_costs_date ON agent_daily_costs(date);

CREATE INDEX IF NOT EXISTS idx_cost_approval_status ON cost_approval_requests(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_cost_approval_agent ON cost_approval_requests(agent_id, created_at);

-- Function to update daily cost aggregation
CREATE OR REPLACE FUNCTION update_agent_daily_costs()
RETURNS TRIGGER AS $$
BEGIN
    -- Insert or update daily cost aggregation
    INSERT INTO agent_daily_costs (agent_id, date, total_requests, total_tokens, total_cost, average_cost_per_request)
    VALUES (
        NEW.agent_id,
        DATE(NEW.created_at),
        1,
        NEW.total_tokens,
        NEW.cost,
        NEW.cost
    )
    ON CONFLICT (agent_id, date)
    DO UPDATE SET
        total_requests = agent_daily_costs.total_requests + 1,
        total_tokens = agent_daily_costs.total_tokens + NEW.total_tokens,
        total_cost = agent_daily_costs.total_cost + NEW.cost,
        average_cost_per_request = (agent_daily_costs.total_cost + NEW.cost) / (agent_daily_costs.total_requests + 1),
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update daily costs when new AI request is inserted
CREATE TRIGGER trigger_update_agent_daily_costs
    AFTER INSERT ON ai_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_agent_daily_costs();

-- Function to clean up expired approval requests
CREATE OR REPLACE FUNCTION cleanup_expired_approvals()
RETURNS void AS $$
BEGIN
    UPDATE cost_approval_requests 
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'pending' AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Insert default cost budgets for existing users (if any)
INSERT INTO agent_cost_budgets (agent_id, daily_budget, monthly_budget, cost_threshold_warning, cost_threshold_approval)
SELECT 
    id as agent_id,
    10.00 as daily_budget,
    300.00 as monthly_budget,
    0.10 as cost_threshold_warning,
    0.50 as cost_threshold_approval
FROM users 
WHERE NOT EXISTS (
    SELECT 1 FROM agent_cost_budgets WHERE agent_cost_budgets.agent_id = users.id
);

-- Comments for documentation
COMMENT ON TABLE ai_requests IS 'Tracks all AI API requests with cost and performance metrics';
COMMENT ON TABLE agent_daily_costs IS 'Daily aggregated cost data per agent for reporting and budgeting';
COMMENT ON TABLE agent_cost_budgets IS 'Cost budgets and thresholds per agent';
COMMENT ON TABLE cost_approval_requests IS 'Requests for approval of high-cost AI operations';

COMMENT ON COLUMN ai_requests.cost IS 'Cost in USD with 6 decimal precision for accurate tracking';
COMMENT ON COLUMN ai_requests.processing_time IS 'Processing time in milliseconds for performance monitoring';
COMMENT ON COLUMN agent_cost_budgets.cost_threshold_warning IS 'Cost threshold that triggers a warning to the user';
COMMENT ON COLUMN agent_cost_budgets.cost_threshold_approval IS 'Cost threshold that requires admin approval';