-- Migration 014: Security Lockdowns Table
-- Add table for tracking security lockdowns and IP blocks

-- Security lockdowns table
CREATE TABLE IF NOT EXISTS security_lockdowns (
    id VARCHAR(255) PRIMARY KEY,
    breach_type VARCHAR(100) NOT NULL,
    metadata JSONB DEFAULT '{}',
    ip_address INET,
    user_id VARCHAR(255),
    triggered_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by VARCHAR(255),
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_security_lockdowns_breach_type ON security_lockdowns(breach_type);
CREATE INDEX IF NOT EXISTS idx_security_lockdowns_ip_address ON security_lockdowns(ip_address);
CREATE INDEX IF NOT EXISTS idx_security_lockdowns_user_id ON security_lockdowns(user_id);
CREATE INDEX IF NOT EXISTS idx_security_lockdowns_triggered_at ON security_lockdowns(triggered_at);
CREATE INDEX IF NOT EXISTS idx_security_lockdowns_active ON security_lockdowns(active);

-- Add user locking fields to users table if they don't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'locked') THEN
        ALTER TABLE users ADD COLUMN locked BOOLEAN DEFAULT false;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'locked_at') THEN
        ALTER TABLE users ADD COLUMN locked_at TIMESTAMP WITH TIME ZONE;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'locked_reason') THEN
        ALTER TABLE users ADD COLUMN locked_reason TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'notification_preferences') THEN
        ALTER TABLE users ADD COLUMN notification_preferences JSONB DEFAULT '{"email": true, "sms": false}';
    END IF;
END $$;

-- Add indexes for user locking
CREATE INDEX IF NOT EXISTS idx_users_locked ON users(locked) WHERE locked = true;

-- IP reputation cache table for external reputation data
CREATE TABLE IF NOT EXISTS ip_reputation_cache (
    ip_address INET PRIMARY KEY,
    reputation VARCHAR(20) NOT NULL CHECK (reputation IN ('good', 'suspicious', 'malicious', 'unknown')),
    score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
    sources TEXT[] DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    last_checked TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Registration patterns tracking table
CREATE TABLE IF NOT EXISTS registration_patterns (
    id SERIAL PRIMARY KEY,
    ip_address INET NOT NULL,
    email_pattern VARCHAR(255) NOT NULL,
    registration_count INTEGER DEFAULT 1,
    time_window_minutes INTEGER DEFAULT 60,
    first_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    suspicious_score INTEGER DEFAULT 0 CHECK (suspicious_score >= 0 AND suspicious_score <= 100),
    flagged BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for registration patterns
CREATE INDEX IF NOT EXISTS idx_registration_patterns_ip_address ON registration_patterns(ip_address);
CREATE INDEX IF NOT EXISTS idx_registration_patterns_email_pattern ON registration_patterns(email_pattern);
CREATE INDEX IF NOT EXISTS idx_registration_patterns_flagged ON registration_patterns(flagged) WHERE flagged = true;
CREATE INDEX IF NOT EXISTS idx_registration_patterns_suspicious_score ON registration_patterns(suspicious_score);

-- Function to clean up old security data
CREATE OR REPLACE FUNCTION cleanup_security_data()
RETURNS void AS $$
BEGIN
    -- Clean up old resolved security alerts (older than 90 days)
    DELETE FROM security_alerts 
    WHERE resolved = true 
    AND resolved_at < CURRENT_TIMESTAMP - INTERVAL '90 days';
    
    -- Clean up old IP reputation cache (older than 7 days)
    DELETE FROM ip_reputation_cache 
    WHERE last_checked < CURRENT_TIMESTAMP - INTERVAL '7 days';
    
    -- Clean up old registration patterns (older than 30 days and not flagged)
    DELETE FROM registration_patterns 
    WHERE flagged = false 
    AND last_seen < CURRENT_TIMESTAMP - INTERVAL '30 days';
    
    -- Clean up resolved lockdowns (older than 30 days)
    DELETE FROM security_lockdowns 
    WHERE active = false 
    AND resolved_at < CURRENT_TIMESTAMP - INTERVAL '30 days';
    
    RAISE NOTICE 'Security data cleanup completed';
END;
$$ LANGUAGE plpgsql;

-- Function to get security dashboard data
CREATE OR REPLACE FUNCTION get_security_dashboard_data()
RETURNS jsonb AS $$
DECLARE
    result jsonb;
BEGIN
    SELECT jsonb_build_object(
        'alerts', (
            SELECT jsonb_build_object(
                'total', COUNT(*),
                'unresolved', COUNT(*) FILTER (WHERE resolved = false),
                'critical', COUNT(*) FILTER (WHERE severity = 'critical' AND resolved = false),
                'high', COUNT(*) FILTER (WHERE severity = 'high' AND resolved = false),
                'medium', COUNT(*) FILTER (WHERE severity = 'medium' AND resolved = false),
                'low', COUNT(*) FILTER (WHERE severity = 'low' AND resolved = false)
            )
            FROM security_alerts
            WHERE timestamp >= CURRENT_TIMESTAMP - INTERVAL '7 days'
        ),
        'lockdowns', (
            SELECT jsonb_build_object(
                'active', COUNT(*) FILTER (WHERE active = true),
                'total_today', COUNT(*) FILTER (WHERE triggered_at >= CURRENT_DATE),
                'total_week', COUNT(*) FILTER (WHERE triggered_at >= CURRENT_TIMESTAMP - INTERVAL '7 days')
            )
            FROM security_lockdowns
        ),
        'patterns', (
            SELECT jsonb_build_object(
                'flagged', COUNT(*) FILTER (WHERE flagged = true),
                'high_score', COUNT(*) FILTER (WHERE suspicious_score >= 70),
                'recent', COUNT(*) FILTER (WHERE last_seen >= CURRENT_TIMESTAMP - INTERVAL '24 hours')
            )
            FROM registration_patterns
        ),
        'ip_reputation', (
            SELECT jsonb_build_object(
                'malicious', COUNT(*) FILTER (WHERE reputation = 'malicious'),
                'suspicious', COUNT(*) FILTER (WHERE reputation = 'suspicious'),
                'cached_entries', COUNT(*)
            )
            FROM ip_reputation_cache
        )
    ) INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Update timestamp trigger for security_lockdowns
CREATE OR REPLACE FUNCTION update_security_lockdowns_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER security_lockdowns_update_timestamp
    BEFORE UPDATE ON security_lockdowns
    FOR EACH ROW
    EXECUTE FUNCTION update_security_lockdowns_timestamp();

-- Update timestamp trigger for ip_reputation_cache
CREATE OR REPLACE FUNCTION update_ip_reputation_cache_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ip_reputation_cache_update_timestamp
    BEFORE UPDATE ON ip_reputation_cache
    FOR EACH ROW
    EXECUTE FUNCTION update_ip_reputation_cache_timestamp();

-- Update timestamp trigger for registration_patterns
CREATE OR REPLACE FUNCTION update_registration_patterns_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER registration_patterns_update_timestamp
    BEFORE UPDATE ON registration_patterns
    FOR EACH ROW
    EXECUTE FUNCTION update_registration_patterns_timestamp();