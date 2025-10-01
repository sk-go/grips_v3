-- Performance optimization indexes for 100 concurrent agents and <500ms response time
-- Migration: 016_performance_indexes.sql

-- Communications table indexes for timeline queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_communications_client_timestamp 
ON communications (client_id, timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_communications_type_direction 
ON communications (type, direction);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_communications_urgent_timestamp 
ON communications (is_urgent, timestamp DESC) WHERE is_urgent = true;

-- AI Actions table indexes for queue processing
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_actions_status_created 
ON ai_actions (status, created_at) WHERE status IN ('pending', 'in_progress');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_actions_chain_step 
ON ai_actions (chain_id, step_number) WHERE chain_id IS NOT NULL;

-- Client profiles indexes for CRM lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_client_profiles_crm_lookup 
ON client_profiles (crm_system, crm_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_client_profiles_last_sync 
ON client_profiles (last_crm_sync) WHERE last_crm_sync < NOW() - INTERVAL '1 hour';

-- Email messages indexes for account timeline
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_messages_account_received 
ON email_messages (account_id, received_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_messages_client_received 
ON email_messages (client_id, received_at DESC) WHERE client_id IS NOT NULL;

-- Twilio messages indexes for phone history
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_twilio_messages_phone_created 
ON twilio_messages (phone_number, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_twilio_messages_client_created 
ON twilio_messages (client_id, created_at DESC) WHERE client_id IS NOT NULL;

-- Document templates indexes for generation
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_templates_type_default 
ON document_templates (type, is_default);

-- Audit logs indexes for compliance queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_user_timestamp 
ON audit_logs (user_id, timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_action_timestamp 
ON audit_logs (action, timestamp DESC);

-- Users table indexes for authentication
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_active 
ON users (email) WHERE active = true;

-- Conversation summaries indexes for relationship insights
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversation_summaries_client_date 
ON conversation_summaries (client_id, summary_date DESC);

-- Email accounts indexes for sync operations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_accounts_user_active 
ON email_accounts (user_id, is_active) WHERE is_active = true;

-- Twilio phone numbers indexes for routing
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_twilio_phone_numbers_user_active 
ON twilio_phone_numbers (user_id, is_active) WHERE is_active = true;

-- Office hours indexes for call routing
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_office_hours_user_day 
ON office_hours (user_id, day_of_week);

-- Document activities indexes for workflow tracking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_activities_doc_timestamp 
ON document_activities (document_id, timestamp DESC);

-- Onboarding progress indexes for user experience
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_onboarding_progress_user_step 
ON onboarding_progress (user_id, current_step);

-- Security lockdowns indexes for monitoring
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_security_lockdowns_user_active 
ON security_lockdowns (user_id, is_active) WHERE is_active = true;

-- Add partial indexes for common query patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_communications_unread 
ON communications (client_id, timestamp DESC) WHERE is_read = false;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_actions_high_risk 
ON ai_actions (created_at DESC) WHERE risk_level = 'high' AND status = 'pending';

-- Add composite indexes for complex queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_messages_search 
ON email_messages (account_id, is_read, received_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_twilio_messages_search 
ON twilio_messages (phone_number, direction, created_at DESC);

-- Performance monitoring table (if it doesn't exist)
CREATE TABLE IF NOT EXISTS performance_metrics (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    response_time INTEGER NOT NULL,
    memory_usage_mb INTEGER NOT NULL,
    active_connections INTEGER NOT NULL,
    cache_hit_rate DECIMAL(5,2) NOT NULL,
    db_query_time INTEGER NOT NULL,
    concurrent_users INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for performance metrics
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_performance_metrics_timestamp 
ON performance_metrics (timestamp DESC);

-- Update table statistics for better query planning
ANALYZE communications;
ANALYZE ai_actions;
ANALYZE client_profiles;
ANALYZE email_messages;
ANALYZE twilio_messages;
ANALYZE document_templates;
ANALYZE audit_logs;
ANALYZE users;

-- Add comments for documentation
COMMENT ON INDEX idx_communications_client_timestamp IS 'Optimizes client communication timeline queries';
COMMENT ON INDEX idx_ai_actions_status_created IS 'Optimizes AI action queue processing';
COMMENT ON INDEX idx_client_profiles_crm_lookup IS 'Optimizes CRM data synchronization';
COMMENT ON INDEX idx_email_messages_account_received IS 'Optimizes email timeline queries';
COMMENT ON INDEX idx_twilio_messages_phone_created IS 'Optimizes SMS/call history queries';