-- Migration 011: Email Verification System
-- Create tables for email verification tokens, registration audit log, and registration settings

-- Email verification tokens table
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    used_at TIMESTAMP WITH TIME ZONE
);

-- Registration audit log table
CREATE TABLE IF NOT EXISTS registration_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type VARCHAR(50) NOT NULL, -- 'registration', 'verification', 'approval', 'rejection'
    event_data JSONB,
    ip_address INET,
    user_agent TEXT,
    admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Registration settings table
CREATE TABLE IF NOT EXISTS registration_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    require_admin_approval BOOLEAN NOT NULL DEFAULT false,
    allowed_email_domains TEXT[], -- NULL means all domains allowed
    max_registrations_per_day INTEGER DEFAULT 100,
    verification_token_expiry_hours INTEGER DEFAULT 24,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for email_verification_tokens table
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id ON email_verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token ON email_verification_tokens(token);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_expires_at ON email_verification_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_used_at ON email_verification_tokens(used_at);

-- Indexes for registration_audit_log table
CREATE INDEX IF NOT EXISTS idx_registration_audit_log_user_id ON registration_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_registration_audit_log_event_type ON registration_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_registration_audit_log_created_at ON registration_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_registration_audit_log_ip_address ON registration_audit_log(ip_address);
CREATE INDEX IF NOT EXISTS idx_registration_audit_log_admin_id ON registration_audit_log(admin_id);

-- Indexes for registration_settings table
CREATE INDEX IF NOT EXISTS idx_registration_settings_updated_at ON registration_settings(updated_at);

-- Function to clean up expired email verification tokens
CREATE OR REPLACE FUNCTION cleanup_expired_email_verification_tokens()
RETURNS INTEGER AS $
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM email_verification_tokens 
    WHERE expires_at < CURRENT_TIMESTAMP 
    AND used_at IS NULL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$ LANGUAGE plpgsql;

-- Function to invalidate user's existing verification tokens when email is verified
CREATE OR REPLACE FUNCTION invalidate_user_verification_tokens()
RETURNS TRIGGER AS $
BEGIN
    -- If email_verified was changed to true, mark all unused verification tokens as used
    IF OLD.email_verified = false AND NEW.email_verified = true THEN
        UPDATE email_verification_tokens 
        SET used_at = CURRENT_TIMESTAMP 
        WHERE user_id = NEW.id 
        AND used_at IS NULL;
    END IF;
    
    RETURN NEW;
END;
$ LANGUAGE plpgsql;

-- Trigger to invalidate verification tokens when email is verified
CREATE TRIGGER invalidate_verification_tokens_on_email_verified
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION invalidate_user_verification_tokens();

-- Update trigger for registration_settings updated_at
CREATE TRIGGER update_registration_settings_updated_at 
    BEFORE UPDATE ON registration_settings 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Insert default registration settings
INSERT INTO registration_settings (
    require_admin_approval,
    allowed_email_domains,
    max_registrations_per_day,
    verification_token_expiry_hours
) VALUES (
    false,
    NULL, -- Allow all email domains by default
    100,
    24
) ON CONFLICT DO NOTHING;

-- Add constraint to ensure event_type is valid
ALTER TABLE registration_audit_log ADD CONSTRAINT check_event_type 
    CHECK (event_type IN ('registration', 'verification', 'approval', 'rejection', 'login_attempt', 'password_reset'));

-- Add constraint to ensure verification token expiry hours is reasonable
ALTER TABLE registration_settings ADD CONSTRAINT check_verification_expiry_hours 
    CHECK (verification_token_expiry_hours > 0 AND verification_token_expiry_hours <= 168); -- Max 1 week

-- Add constraint to ensure max registrations per day is reasonable
ALTER TABLE registration_settings ADD CONSTRAINT check_max_registrations_per_day 
    CHECK (max_registrations_per_day > 0 AND max_registrations_per_day <= 10000);