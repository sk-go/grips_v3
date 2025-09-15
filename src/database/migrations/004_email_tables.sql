-- Email accounts table
CREATE TABLE IF NOT EXISTS email_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    provider VARCHAR(50) NOT NULL CHECK (provider IN ('gmail', 'outlook', 'exchange', 'imap')),
    imap_config JSONB NOT NULL,
    smtp_config JSONB NOT NULL,
    is_active BOOLEAN DEFAULT true,
    last_sync_at TIMESTAMP WITH TIME ZONE,
    sync_state JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, email)
);

-- Email messages table
CREATE TABLE IF NOT EXISTS email_messages (
    id VARCHAR(255) PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
    message_id VARCHAR(255) NOT NULL,
    uid INTEGER NOT NULL,
    thread_id VARCHAR(255),
    folder VARCHAR(255) NOT NULL,
    from_addresses JSONB NOT NULL,
    to_addresses JSONB NOT NULL,
    cc_addresses JSONB,
    bcc_addresses JSONB,
    subject TEXT,
    body_text TEXT,
    body_html TEXT,
    attachments JSONB,
    date TIMESTAMP WITH TIME ZONE NOT NULL,
    flags JSONB DEFAULT '[]'::jsonb,
    is_read BOOLEAN DEFAULT false,
    is_important BOOLEAN DEFAULT false,
    labels JSONB,
    client_id UUID REFERENCES clients(id),
    tags JSONB DEFAULT '[]'::jsonb,
    sentiment DECIMAL(3,2),
    extracted_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(account_id, uid, folder)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_email_messages_account_id ON email_messages(account_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_client_id ON email_messages(client_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_date ON email_messages(date DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_folder ON email_messages(folder);
CREATE INDEX IF NOT EXISTS idx_email_messages_is_read ON email_messages(is_read);
CREATE INDEX IF NOT EXISTS idx_email_messages_tags ON email_messages USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_email_messages_subject ON email_messages USING GIN(to_tsvector('english', subject));
CREATE INDEX IF NOT EXISTS idx_email_messages_body_text ON email_messages USING GIN(to_tsvector('english', body_text));
CREATE INDEX IF NOT EXISTS idx_email_messages_from ON email_messages USING GIN(from_addresses);

-- Email sync logs table for debugging
CREATE TABLE IF NOT EXISTS email_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
    sync_started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    sync_completed_at TIMESTAMP WITH TIME ZONE,
    new_messages INTEGER DEFAULT 0,
    updated_messages INTEGER DEFAULT 0,
    errors JSONB DEFAULT '[]'::jsonb,
    sync_duration INTEGER, -- milliseconds
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_sync_logs_account_id ON email_sync_logs(account_id);
CREATE INDEX IF NOT EXISTS idx_email_sync_logs_started_at ON email_sync_logs(sync_started_at DESC);

-- Update trigger for email_accounts
CREATE OR REPLACE FUNCTION update_email_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_email_accounts_updated_at
    BEFORE UPDATE ON email_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_email_accounts_updated_at();

-- Update trigger for email_messages
CREATE OR REPLACE FUNCTION update_email_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_email_messages_updated_at
    BEFORE UPDATE ON email_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_email_messages_updated_at();