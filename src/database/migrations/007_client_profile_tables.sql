-- Client Profile Enhancement Tables
-- These tables support the relationship enhancement overlay functionality

-- Main clients table for overlay data (minimal storage, references CRM)
CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    crm_id VARCHAR(255) NOT NULL,
    crm_system VARCHAR(50) NOT NULL CHECK (crm_system IN ('zoho', 'salesforce', 'hubspot', 'agencybloc')),
    
    -- Core data fetched from CRM
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    photo_url TEXT,
    
    -- Relationship health metrics
    relationship_score INTEGER DEFAULT 50 CHECK (relationship_score >= 0 AND relationship_score <= 100),
    last_interaction TIMESTAMP WITH TIME ZONE,
    sentiment_trend VARCHAR(20) DEFAULT 'neutral' CHECK (sentiment_trend IN ('positive', 'neutral', 'negative')),
    interaction_frequency DECIMAL(5,2) DEFAULT 0, -- interactions per month
    response_time_hours DECIMAL(8,2) DEFAULT 0, -- average response time in hours
    
    -- Sync tracking
    last_crm_sync TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    sync_status VARCHAR(20) DEFAULT 'pending' CHECK (sync_status IN ('pending', 'success', 'partial', 'failed')),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint on CRM system + CRM ID
    UNIQUE(crm_system, crm_id)
);

-- Family members and connections
CREATE TABLE IF NOT EXISTS family_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    relationship VARCHAR(100) NOT NULL, -- 'spouse', 'child', 'parent', etc.
    age INTEGER,
    notes TEXT,
    crm_contact_id VARCHAR(255), -- Reference to CRM contact if exists
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Important dates for clients
CREATE TABLE IF NOT EXISTS important_dates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN ('birthday', 'anniversary', 'policy_renewal', 'custom')),
    date_value DATE NOT NULL,
    description TEXT NOT NULL,
    recurring BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Client preferences and hobbies (JSON storage for flexibility)
CREATE TABLE IF NOT EXISTS client_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    category VARCHAR(100) NOT NULL, -- 'hobbies', 'communication_preferences', 'interests', etc.
    preferences JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint on client + category
    UNIQUE(client_id, category)
);

-- Relationship connections between clients (for graph visualization)
CREATE TABLE IF NOT EXISTS client_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    related_client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    relationship_type VARCHAR(100) NOT NULL, -- 'family', 'business_partner', 'referral', etc.
    strength INTEGER DEFAULT 1 CHECK (strength >= 1 AND strength <= 5), -- 1-5 scale
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Prevent self-relationships and duplicates
    CHECK (client_id != related_client_id),
    UNIQUE(client_id, related_client_id, relationship_type)
);

-- Conversation summaries for relationship insights
CREATE TABLE IF NOT EXISTS conversation_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    communication_id UUID, -- Reference to communication if exists
    summary TEXT NOT NULL,
    sentiment_score DECIMAL(3,2) CHECK (sentiment_score >= -1 AND sentiment_score <= 1), -- -1 to 1 scale
    key_topics TEXT[], -- Array of extracted topics
    action_items TEXT[], -- Array of action items mentioned
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Meeting briefs and preparation notes
CREATE TABLE IF NOT EXISTS meeting_briefs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    meeting_date TIMESTAMP WITH TIME ZONE,
    brief_content TEXT NOT NULL,
    key_points TEXT[], -- Array of key discussion points
    follow_up_items TEXT[], -- Array of follow-up actions
    generated_by VARCHAR(20) DEFAULT 'ai' CHECK (generated_by IN ('ai', 'agent')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_clients_crm_lookup ON clients(crm_system, crm_id);
CREATE INDEX IF NOT EXISTS idx_clients_last_interaction ON clients(last_interaction DESC);
CREATE INDEX IF NOT EXISTS idx_clients_relationship_score ON clients(relationship_score DESC);
CREATE INDEX IF NOT EXISTS idx_family_members_client ON family_members(client_id);
CREATE INDEX IF NOT EXISTS idx_important_dates_client ON important_dates(client_id);
CREATE INDEX IF NOT EXISTS idx_important_dates_date ON important_dates(date_value);
CREATE INDEX IF NOT EXISTS idx_client_preferences_client ON client_preferences(client_id);
CREATE INDEX IF NOT EXISTS idx_client_relationships_client ON client_relationships(client_id);
CREATE INDEX IF NOT EXISTS idx_client_relationships_related ON client_relationships(related_client_id);
CREATE INDEX IF NOT EXISTS idx_conversation_summaries_client_date ON conversation_summaries(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meeting_briefs_client ON meeting_briefs(client_id);
CREATE INDEX IF NOT EXISTS idx_meeting_briefs_date ON meeting_briefs(meeting_date DESC);

-- Update trigger for clients table
CREATE OR REPLACE FUNCTION update_clients_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_clients_updated_at
    BEFORE UPDATE ON clients
    FOR EACH ROW
    EXECUTE FUNCTION update_clients_updated_at();

-- Similar triggers for other tables
CREATE TRIGGER trigger_family_members_updated_at
    BEFORE UPDATE ON family_members
    FOR EACH ROW
    EXECUTE FUNCTION update_clients_updated_at();

CREATE TRIGGER trigger_important_dates_updated_at
    BEFORE UPDATE ON important_dates
    FOR EACH ROW
    EXECUTE FUNCTION update_clients_updated_at();

CREATE TRIGGER trigger_client_preferences_updated_at
    BEFORE UPDATE ON client_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_clients_updated_at();

CREATE TRIGGER trigger_client_relationships_updated_at
    BEFORE UPDATE ON client_relationships
    FOR EACH ROW
    EXECUTE FUNCTION update_clients_updated_at();

CREATE TRIGGER trigger_meeting_briefs_updated_at
    BEFORE UPDATE ON meeting_briefs
    FOR EACH ROW
    EXECUTE FUNCTION update_clients_updated_at();