-- Auto tag rules table
CREATE TABLE IF NOT EXISTS auto_tag_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    conditions JSONB NOT NULL,
    actions JSONB NOT NULL,
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Communication timeline view for unified access
CREATE OR REPLACE VIEW unified_communications AS
SELECT 
    'email' as type,
    id,
    from_addresses->0->>'address' as from_address,
    to_addresses->0->>'address' as to_address,
    subject,
    COALESCE(body_text, body_html) as content,
    date as timestamp,
    client_id,
    tags,
    is_important as is_urgent,
    is_read,
    sentiment,
    created_at,
    'inbound' as direction
FROM email_messages

UNION ALL

SELECT 
    'call' as type,
    id,
    from_number as from_address,
    to_number as to_address,
    CASE 
        WHEN transcription IS NOT NULL THEN 'Call - ' || SUBSTRING(transcription, 1, 100)
        ELSE 'Call - Duration: ' || COALESCE(CAST(duration AS TEXT), 'Unknown')
    END as subject,
    COALESCE(transcription, 'No transcription available') as content,
    COALESCE(start_time, created_at) as timestamp,
    client_id,
    tags,
    false as is_urgent,
    true as is_read,
    null as sentiment,
    created_at,
    direction
FROM phone_calls

UNION ALL

SELECT 
    'sms' as type,
    id,
    from_number as from_address,
    to_number as to_address,
    'SMS - ' || SUBSTRING(body, 1, 50) as subject,
    body as content,
    COALESCE(date_sent, created_at) as timestamp,
    client_id,
    tags,
    false as is_urgent,
    true as is_read,
    null as sentiment,
    created_at,
    direction
FROM sms_messages;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_auto_tag_rules_user_id ON auto_tag_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_auto_tag_rules_active ON auto_tag_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_auto_tag_rules_priority ON auto_tag_rules(priority DESC);

-- Communication statistics view for dashboard
CREATE MATERIALIZED VIEW IF NOT EXISTS communication_stats AS
SELECT 
    DATE_TRUNC('day', timestamp) as date,
    type,
    direction,
    COUNT(*) as count,
    COUNT(CASE WHEN is_urgent THEN 1 END) as urgent_count,
    COUNT(CASE WHEN is_read = false THEN 1 END) as unread_count,
    AVG(sentiment) as avg_sentiment
FROM unified_communications
WHERE timestamp >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', timestamp), type, direction
ORDER BY date DESC, type, direction;

-- Index for the materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_communication_stats_unique ON communication_stats(date, type, direction);

-- Function to refresh communication stats
CREATE OR REPLACE FUNCTION refresh_communication_stats()
RETURNS void AS $
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY communication_stats;
END;
$ LANGUAGE plpgsql;

-- Update trigger for auto_tag_rules
CREATE OR REPLACE FUNCTION update_auto_tag_rules_updated_at()
RETURNS TRIGGER AS $
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_auto_tag_rules_updated_at
    BEFORE UPDATE ON auto_tag_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_auto_tag_rules_updated_at();