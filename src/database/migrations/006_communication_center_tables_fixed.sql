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
CREATE VIEW IF NOT EXISTS unified_communications AS
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
        WHEN transcription IS NOT NULL THEN 'Call - ' || SUBSTR(transcription, 1, 100)
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
    'SMS - ' || SUBSTR(body, 1, 50) as subject,
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

-- Communication statistics view for dashboard (simplified for SQLite compatibility)
CREATE VIEW IF NOT EXISTS communication_stats AS
SELECT 
    DATE(timestamp) as date,
    type,
    direction,
    COUNT(*) as count,
    COUNT(CASE WHEN is_urgent THEN 1 END) as urgent_count,
    COUNT(CASE WHEN is_read = 0 THEN 1 END) as unread_count,
    AVG(sentiment) as avg_sentiment
FROM unified_communications
WHERE timestamp >= DATE('now', '-30 days')
GROUP BY DATE(timestamp), type, direction
ORDER BY date DESC, type, direction;

-- Simple trigger for auto_tag_rules updated_at (SQLite compatible)
CREATE TRIGGER IF NOT EXISTS trigger_update_auto_tag_rules_updated_at
    AFTER UPDATE ON auto_tag_rules
    FOR EACH ROW
BEGIN
    UPDATE auto_tag_rules SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Note: Complex PostgreSQL functions for auto-tagging and timeline pagination
-- are not included in this SQLite-compatible version. These would need to be
-- implemented at the application level for SQLite deployments.