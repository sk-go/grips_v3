-- Migration 010: Local Authentication Schema Updates
-- Add password-related columns to users table and create password reset tokens table

-- First, make keycloak_id optional by removing NOT NULL constraint
ALTER TABLE users ALTER COLUMN keycloak_id DROP NOT NULL;

-- Add password-related columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITH TIME ZONE;

-- Create password reset tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for password reset tokens
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);

-- Index for email lookups (for login)
CREATE INDEX IF NOT EXISTS idx_users_email_active ON users(email) WHERE is_active = true;

-- Add constraint to ensure either keycloak_id or password_hash is present
ALTER TABLE users ADD CONSTRAINT check_auth_method 
    CHECK (keycloak_id IS NOT NULL OR password_hash IS NOT NULL);

-- Function to clean up expired password reset tokens
CREATE OR REPLACE FUNCTION cleanup_expired_password_reset_tokens()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM password_reset_tokens 
    WHERE expires_at < CURRENT_TIMESTAMP 
    AND used_at IS NULL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to invalidate user's existing reset tokens when password is changed
CREATE OR REPLACE FUNCTION invalidate_user_reset_tokens()
RETURNS TRIGGER AS $$
BEGIN
    -- If password_hash was updated, mark all unused reset tokens as used
    IF OLD.password_hash IS DISTINCT FROM NEW.password_hash THEN
        UPDATE password_reset_tokens 
        SET used_at = CURRENT_TIMESTAMP 
        WHERE user_id = NEW.id 
        AND used_at IS NULL;
    END IF;
    
    -- Reset failed login attempts on successful password change
    IF OLD.password_hash IS DISTINCT FROM NEW.password_hash THEN
        NEW.failed_login_attempts = 0;
        NEW.locked_until = NULL;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to invalidate reset tokens when password changes
CREATE TRIGGER invalidate_reset_tokens_on_password_change
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION invalidate_user_reset_tokens();