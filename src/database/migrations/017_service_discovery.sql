-- Service Discovery Tables
-- Migration: 017_service_discovery.sql

-- Service registrations table
CREATE TABLE IF NOT EXISTS service_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL,
    host VARCHAR(255) NOT NULL,
    port INTEGER NOT NULL,
    protocol VARCHAR(10) NOT NULL CHECK (protocol IN ('http', 'https')),
    endpoints JSONB NOT NULL DEFAULT '[]',
    metadata JSONB NOT NULL DEFAULT '{}',
    registered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_heartbeat TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    status VARCHAR(20) NOT NULL DEFAULT 'starting' CHECK (status IN ('healthy', 'unhealthy', 'starting', 'stopping', 'unknown')),
    tags JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Health check results table
CREATE TABLE IF NOT EXISTS service_health_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID NOT NULL REFERENCES service_registrations(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('healthy', 'unhealthy', 'starting', 'stopping', 'unknown')),
    response_time INTEGER NOT NULL, -- in milliseconds
    details JSONB NOT NULL DEFAULT '{}',
    errors JSONB DEFAULT NULL,
    checked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_service_registrations_name ON service_registrations(name);
CREATE INDEX IF NOT EXISTS idx_service_registrations_status ON service_registrations(status);
CREATE INDEX IF NOT EXISTS idx_service_registrations_last_heartbeat ON service_registrations(last_heartbeat);
CREATE INDEX IF NOT EXISTS idx_service_registrations_tags ON service_registrations USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_service_registrations_metadata ON service_registrations USING GIN(metadata);

CREATE INDEX IF NOT EXISTS idx_service_health_checks_service_id ON service_health_checks(service_id);
CREATE INDEX IF NOT EXISTS idx_service_health_checks_status ON service_health_checks(status);
CREATE INDEX IF NOT EXISTS idx_service_health_checks_checked_at ON service_health_checks(checked_at);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_service_registrations_name_status ON service_registrations(name, status);
CREATE INDEX IF NOT EXISTS idx_service_registrations_status_heartbeat ON service_registrations(status, last_heartbeat);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_service_registrations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
DROP TRIGGER IF EXISTS trigger_update_service_registrations_updated_at ON service_registrations;
CREATE TRIGGER trigger_update_service_registrations_updated_at
    BEFORE UPDATE ON service_registrations
    FOR EACH ROW
    EXECUTE FUNCTION update_service_registrations_updated_at();

-- Function to clean up old health check records (keep last 100 per service)
CREATE OR REPLACE FUNCTION cleanup_old_health_checks()
RETURNS void AS $$
BEGIN
    DELETE FROM service_health_checks
    WHERE id NOT IN (
        SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY service_id ORDER BY checked_at DESC) as rn
            FROM service_health_checks
        ) ranked
        WHERE rn <= 100
    );
END;
$$ LANGUAGE plpgsql;

-- Create a view for service health summary
CREATE OR REPLACE VIEW service_health_summary AS
SELECT 
    sr.id,
    sr.name,
    sr.version,
    sr.host,
    sr.port,
    sr.protocol,
    sr.status as registration_status,
    sr.last_heartbeat,
    sr.tags,
    sr.metadata,
    shc.status as health_status,
    shc.response_time as last_response_time,
    shc.checked_at as last_health_check,
    shc.details as health_details,
    shc.errors as health_errors
FROM service_registrations sr
LEFT JOIN LATERAL (
    SELECT status, response_time, checked_at, details, errors
    FROM service_health_checks
    WHERE service_id = sr.id
    ORDER BY checked_at DESC
    LIMIT 1
) shc ON true;

-- Grant permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON service_registrations TO your_app_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON service_health_checks TO your_app_user;
-- GRANT SELECT ON service_health_summary TO your_app_user;