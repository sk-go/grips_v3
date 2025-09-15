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
        WHEN transcription IS NOT NULL THEN CONCAT('Call - ', LEFT(transcription, 100))
        ELSE CONCAT('Call - Duration: ', COALESCE(duration::text, 'Unknown'))
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
    CONCAT('SMS - ', LEFT(body, 50)) as subject,
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

-- Full-text search indexes for communications
CREATE INDEX IF NOT EXISTS idx_email_messages_fulltext ON email_messages USING GIN(to_tsvector('english', COALESCE(subject, '') || ' ' || COALESCE(body_text, '')));
CREATE INDEX IF NOT EXISTS idx_phone_calls_fulltext ON phone_calls USING GIN(to_tsvector('english', COALESCE(transcription, '')));
CREATE INDEX IF NOT EXISTS idx_sms_messages_fulltext ON sms_messages USING GIN(to_tsvector('english', body));

-- Communication statistics materialized view for dashboard
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
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY communication_stats;
END;
$$ LANGUAGE plpgsql;

-- Update trigger for auto_tag_rules
CREATE OR REPLACE FUNCTION update_auto_tag_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_auto_tag_rules_updated_at
    BEFORE UPDATE ON auto_tag_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_auto_tag_rules_updated_at();

-- Function to automatically apply tags to new communications
CREATE OR REPLACE FUNCTION apply_auto_tags()
RETURNS TRIGGER AS $$
DECLARE
    rule_record RECORD;
    condition_record JSONB;
    action_record JSONB;
    field_value TEXT;
    matches BOOLEAN;
BEGIN
    -- Get all active auto tag rules for the user (assuming we can determine user from communication)
    FOR rule_record IN 
        SELECT * FROM auto_tag_rules 
        WHERE is_active = true 
        ORDER BY priority DESC
    LOOP
        matches := true;
        
        -- Check all conditions for this rule
        FOR condition_record IN SELECT * FROM jsonb_array_elements(rule_record.conditions)
        LOOP
            -- This is a simplified version - in practice, you'd implement full condition evaluation
            -- For now, we'll just check basic string matching
            CASE condition_record->>'field'
                WHEN 'subject' THEN
                    field_value := COALESCE(NEW.subject, '');
                WHEN 'content' THEN
                    field_value := NEW.content;
                ELSE
                    field_value := '';
            END CASE;
            
            -- Simple contains check (extend this for other operators)
            IF condition_record->>'operator' = 'contains' THEN
                IF NOT (field_value ILIKE '%' || (condition_record->>'value') || '%') THEN
                    matches := false;
                    EXIT;
                END IF;
            END IF;
        END LOOP;
        
        -- If all conditions match, apply actions
        IF matches THEN
            FOR action_record IN SELECT * FROM jsonb_array_elements(rule_record.actions)
            LOOP
                CASE action_record->>'type'
                    WHEN 'add_tag' THEN
                        -- Add tag to the tags array
                        NEW.tags := NEW.tags || jsonb_build_array(action_record->>'value');
                    WHEN 'set_urgent' THEN
                        NEW.is_urgent := (action_record->>'value')::boolean;
                END CASE;
            END LOOP;
        END IF;
    END LOOP;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Note: Triggers for auto-tagging would be applied to each communication table
-- This is commented out as it would need to be customized per table structure
-- CREATE TRIGGER trigger_apply_auto_tags_email
--     BEFORE INSERT ON email_messages
--     FOR EACH ROW
--     EXECUTE FUNCTION apply_auto_tags();

-- Create a function to get communication timeline with pagination
CREATE OR REPLACE FUNCTION get_communication_timeline(
    p_user_id UUID DEFAULT NULL,
    p_client_id UUID DEFAULT NULL,
    p_limit INTEGER DEFAULT 20,
    p_offset INTEGER DEFAULT 0,
    p_search_term TEXT DEFAULT NULL
)
RETURNS TABLE (
    type TEXT,
    id UUID,
    from_address TEXT,
    to_address TEXT,
    subject TEXT,
    content TEXT,
    timestamp TIMESTAMP WITH TIME ZONE,
    client_id UUID,
    tags JSONB,
    is_urgent BOOLEAN,
    is_read BOOLEAN,
    sentiment DECIMAL,
    direction TEXT,
    rank REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        uc.type,
        uc.id,
        uc.from_address,
        uc.to_address,
        uc.subject,
        uc.content,
        uc.timestamp,
        uc.client_id,
        uc.tags,
        uc.is_urgent,
        uc.is_read,
        uc.sentiment,
        uc.direction,
        CASE 
            WHEN p_search_term IS NOT NULL THEN
                ts_rank(
                    to_tsvector('english', COALESCE(uc.subject, '') || ' ' || uc.content),
                    plainto_tsquery('english', p_search_term)
                )
            ELSE 0.0
        END as rank
    FROM unified_communications uc
    WHERE 
        (p_client_id IS NULL OR uc.client_id = p_client_id)
        AND (
            p_search_term IS NULL 
            OR to_tsvector('english', COALESCE(uc.subject, '') || ' ' || uc.content) @@ plainto_tsquery('english', p_search_term)
        )
    ORDER BY 
        CASE WHEN p_search_term IS NOT NULL THEN rank END DESC,
        uc.timestamp DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;