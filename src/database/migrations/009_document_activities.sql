-- Document Activities Migration
-- Creates table for tracking document workflow activities

-- Document activities table for audit trail
CREATE TABLE IF NOT EXISTS document_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES generated_documents(id) ON DELETE CASCADE,
    activity_type VARCHAR(50) NOT NULL,
    activity_data JSONB DEFAULT '{}'::jsonb,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_document_activities_document_id ON document_activities(document_id);
CREATE INDEX IF NOT EXISTS idx_document_activities_type ON document_activities(activity_type);
CREATE INDEX IF NOT EXISTS idx_document_activities_created_at ON document_activities(created_at);
CREATE INDEX IF NOT EXISTS idx_document_activities_created_by ON document_activities(created_by);

-- Add some sample activity types as comments for reference
COMMENT ON TABLE document_activities IS 'Tracks all document workflow activities including generation, approval, export, and CRM uploads';
COMMENT ON COLUMN document_activities.activity_type IS 'Activity types: generation, approval, email_export, crm_upload, download, document_cleanup, etc.';
COMMENT ON COLUMN document_activities.activity_data IS 'JSON data specific to the activity type (recipients, CRM info, etc.)';

-- Create a view for recent document activities
CREATE OR REPLACE VIEW recent_document_activities AS
SELECT 
    da.id,
    da.document_id,
    gd.title as document_title,
    da.activity_type,
    da.activity_data,
    da.created_by,
    da.created_at
FROM document_activities da
LEFT JOIN generated_documents gd ON da.document_id = gd.id
WHERE da.created_at >= NOW() - INTERVAL '30 days'
ORDER BY da.created_at DESC;