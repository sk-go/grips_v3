-- Security monitoring and alerts table
CREATE TABLE IF NOT EXISTS security_alerts (
    id VARCHAR(255) PRIMARY KEY,
    type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    metadata JSONB,
    ip_address INET,
    user_agent TEXT,
    email VARCHAR(255),
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved BOOLEAN NOT NULL DEFAULT false,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_security_alerts_type ON security_alerts(type);
CREATE INDEX IF NOT EXISTS idx_security_alerts_severity ON security_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_security_alerts_resolved ON security_alerts(resolved);
CREATE INDEX IF NOT EXISTS idx_security_alerts_timestamp ON security_alerts(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_security_alerts_ip_address ON security_alerts(ip_address);
CREATE INDEX IF NOT EXISTS idx_security_alerts_email ON security_alerts(email);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_security_alerts_unresolved ON security_alerts(resolved, timestamp DESC) WHERE resolved = false;
CREATE INDEX IF NOT EXISTS idx_security_alerts_type_severity ON security_alerts(type, severity, timestamp DESC);

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_security_alerts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_security_alerts_updated_at
    BEFORE UPDATE ON security_alerts
    FOR EACH ROW
    EXECUTE FUNCTION update_security_alerts_updated_at();

-- Security monitoring statistics view
CREATE OR REPLACE VIEW security_monitoring_stats AS
SELECT 
    type,
    severity,
    COUNT(*) as total_alerts,
    COUNT(*) FILTER (WHERE resolved = false) as unresolved_alerts,
    COUNT(*) FILTER (WHERE timestamp >= CURRENT_TIMESTAMP - INTERVAL '24 hours') as alerts_24h,
    COUNT(*) FILTER (WHERE timestamp >= CURRENT_TIMESTAMP - INTERVAL '7 days') as alerts_7d,
    COUNT(*) FILTER (WHERE timestamp >= CURRENT_TIMESTAMP - INTERVAL '30 days') as alerts_30d,
    MIN(timestamp) as first_alert,
    MAX(timestamp) as latest_alert
FROM security_alerts
GROUP BY type, severity
ORDER BY severity DESC, total_alerts DESC;

-- IP reputation tracking table
CREATE TABLE IF NOT EXISTS ip_reputation_cache (
    ip_address INET PRIMARY KEY,
    reputation VARCHAR(20) NOT NULL CHECK (reputation IN ('good', 'suspicious', 'malicious', 'unknown')),
    score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
    sources TEXT[],
    metadata JSONB,
    last_checked TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for IP reputation
CREATE INDEX IF NOT EXISTS idx_ip_reputation_reputation ON ip_reputation_cache(reputation);
CREATE INDEX IF NOT EXISTS idx_ip_reputation_score ON ip_reputation_cache(score DESC);
CREATE INDEX IF NOT EXISTS idx_ip_reputation_last_checked ON ip_reputation_cache(last_checked);

-- Update trigger for IP reputation
CREATE OR REPLACE FUNCTION update_ip_reputation_cache_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_ip_reputation_cache_updated_at
    BEFORE UPDATE ON ip_reputation_cache
    FOR EACH ROW
    EXECUTE FUNCTION update_ip_reputation_cache_updated_at();

-- Registration pattern tracking table
CREATE TABLE IF NOT EXISTS registration_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip_address INET NOT NULL,
    email_pattern VARCHAR(255),
    user_agent_hash VARCHAR(64), -- Hash of user agent for privacy
    registration_count INTEGER NOT NULL DEFAULT 1,
    time_window_minutes INTEGER NOT NULL,
    first_seen TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    suspicious_score INTEGER NOT NULL DEFAULT 0 CHECK (suspicious_score >= 0 AND suspicious_score <= 100),
    flagged BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for registration patterns
CREATE INDEX IF NOT EXISTS idx_registration_patterns_ip ON registration_patterns(ip_address);
CREATE INDEX IF NOT EXISTS idx_registration_patterns_email_pattern ON registration_patterns(email_pattern);
CREATE INDEX IF NOT EXISTS idx_registration_patterns_flagged ON registration_patterns(flagged);
CREATE INDEX IF NOT EXISTS idx_registration_patterns_score ON registration_patterns(suspicious_score DESC);
CREATE INDEX IF NOT EXISTS idx_registration_patterns_time_window ON registration_patterns(last_seen DESC);

-- Composite index for pattern detection
CREATE INDEX IF NOT EXISTS idx_registration_patterns_detection 
ON registration_patterns(ip_address, email_pattern, last_seen DESC);

-- Update trigger for registration patterns
CREATE OR REPLACE FUNCTION update_registration_patterns_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_registration_patterns_updated_at
    BEFORE UPDATE ON registration_patterns
    FOR EACH ROW
    EXECUTE FUNCTION update_registration_patterns_updated_at();

-- Function to clean up old security data
CREATE OR REPLACE FUNCTION cleanup_security_data()
RETURNS void AS $$
BEGIN
    -- Clean up resolved alerts older than 90 days
    DELETE FROM security_alerts 
    WHERE resolved = true 
    AND resolved_at < CURRENT_TIMESTAMP - INTERVAL '90 days';
    
    -- Clean up old IP reputation cache (older than 7 days)
    DELETE FROM ip_reputation_cache 
    WHERE last_checked < CURRENT_TIMESTAMP - INTERVAL '7 days';
    
    -- Clean up old registration patterns (older than 30 days)
    DELETE FROM registration_patterns 
    WHERE last_seen < CURRENT_TIMESTAMP - INTERVAL '30 days';
    
    -- Log cleanup
    RAISE NOTICE 'Security data cleanup completed at %', CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- Create a function to get security dashboard data
CREATE OR REPLACE FUNCTION get_security_dashboard_data()
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'alerts', json_build_object(
            'total', (SELECT COUNT(*) FROM security_alerts),
            'unresolved', (SELECT COUNT(*) FROM security_alerts WHERE resolved = false),
            'critical', (SELECT COUNT(*) FROM security_alerts WHERE severity = 'critical' AND resolved = false),
            'high', (SELECT COUNT(*) FROM security_alerts WHERE severity = 'high' AND resolved = false),
            'last_24h', (SELECT COUNT(*) FROM security_alerts WHERE timestamp >= CURRENT_TIMESTAMP - INTERVAL '24 hours')
        ),
        'patterns', json_build_object(
            'flagged_ips', (SELECT COUNT(DISTINCT ip_address) FROM registration_patterns WHERE flagged = true),
            'suspicious_patterns', (SELECT COUNT(*) FROM registration_patterns WHERE suspicious_score >= 50),
            'high_risk_patterns', (SELECT COUNT(*) FROM registration_patterns WHERE suspicious_score >= 80)
        ),
        'reputation', json_build_object(
            'malicious_ips', (SELECT COUNT(*) FROM ip_reputation_cache WHERE reputation = 'malicious'),
            'suspicious_ips', (SELECT COUNT(*) FROM ip_reputation_cache WHERE reputation = 'suspicious'),
            'cached_ips', (SELECT COUNT(*) FROM ip_reputation_cache)
        )
    ) INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;