-- Audit and Compliance System Migration
-- Creates immutable audit logging, RBAC, and compliance validation tables

-- Immutable audit log for all system actions
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    user_id UUID REFERENCES users(id),
    session_id VARCHAR(255),
    action_type VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100) NOT NULL,
    resource_id VARCHAR(255),
    details JSONB NOT NULL DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    chain_id UUID, -- For agentic workflow chains
    step_number INTEGER, -- Position in agentic chain
    confidence_score DECIMAL(3,2), -- AI confidence level
    risk_level VARCHAR(20) CHECK (risk_level IN ('low', 'medium', 'high')),
    compliance_flags JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create immutable audit log (prevent updates/deletes)
CREATE OR REPLACE RULE audit_logs_no_update AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE OR REPLACE RULE audit_logs_no_delete AS ON DELETE TO audit_logs DO INSTEAD NOTHING;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_chain_id ON audit_logs(chain_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_compliance ON audit_logs USING GIN(compliance_flags);

-- Role-based access control
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    permissions JSONB NOT NULL DEFAULT '{}',
    is_system_role BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- User role assignments
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES users(id),
    assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(user_id, role_id)
);

-- Multi-factor authentication
CREATE TABLE IF NOT EXISTS mfa_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    is_enabled BOOLEAN DEFAULT FALSE,
    secret_key VARCHAR(255), -- Encrypted TOTP secret
    backup_codes JSONB, -- Encrypted backup codes
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- MFA verification attempts
CREATE TABLE IF NOT EXISTS mfa_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    attempt_type VARCHAR(20) CHECK (attempt_type IN ('totp', 'backup_code')),
    success BOOLEAN NOT NULL,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Sensitive data detection patterns
CREATE TABLE IF NOT EXISTS sensitive_data_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    pattern TEXT NOT NULL, -- Regex pattern
    data_type VARCHAR(50) NOT NULL, -- SSN, credit_card, health_info, etc.
    severity VARCHAR(20) CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    compliance_type VARCHAR(50), -- HIPAA, GDPR, PCI, etc.
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Compliance violations and incidents
CREATE TABLE IF NOT EXISTS compliance_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    description TEXT NOT NULL,
    detected_data TEXT, -- Sanitized version of detected content
    user_id UUID REFERENCES users(id),
    session_id VARCHAR(255),
    chain_id UUID, -- If part of agentic workflow
    action_taken VARCHAR(100), -- halt_chain, notify_admin, etc.
    status VARCHAR(20) CHECK (status IN ('open', 'investigating', 'resolved', 'false_positive')),
    resolved_by UUID REFERENCES users(id),
    resolved_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- GDPR/HIPAA compliance tracking
CREATE TABLE IF NOT EXISTS compliance_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    client_id UUID, -- External CRM client reference
    consent_type VARCHAR(50) NOT NULL, -- data_processing, marketing, etc.
    compliance_framework VARCHAR(20) CHECK (compliance_framework IN ('GDPR', 'HIPAA', 'CCPA')),
    granted BOOLEAN NOT NULL,
    consent_text TEXT,
    ip_address INET,
    user_agent TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    withdrawn_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Insert default roles
INSERT INTO roles (name, description, permissions, is_system_role) VALUES
('agent', 'Insurance Agent', '{"communications": ["read", "write"], "clients": ["read", "write"], "documents": ["read", "write", "generate"], "ai": ["interact"]}', TRUE),
('admin', 'System Administrator', '{"*": ["*"]}', TRUE),
('auditor', 'Compliance Auditor', '{"audit_logs": ["read"], "compliance": ["read"], "reports": ["read"]}', TRUE)
ON CONFLICT (name) DO NOTHING;

-- Insert default sensitive data patterns
INSERT INTO sensitive_data_patterns (name, pattern, data_type, severity, compliance_type) VALUES
('US SSN', '\b\d{3}-?\d{2}-?\d{4}\b', 'ssn', 'critical', 'HIPAA'),
('Credit Card', '\b(?:\d{4}[-\s]?){3}\d{4}\b', 'credit_card', 'high', 'PCI'),
('Email Address', '\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', 'email', 'medium', 'GDPR'),
('Phone Number', '\b\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})\b', 'phone', 'medium', 'GDPR'),
('Medical Record Number', '\bMRN:?\s*\d{6,10}\b', 'medical_record', 'critical', 'HIPAA'),
('Date of Birth', '\b(0[1-9]|1[0-2])/(0[1-9]|[12][0-9]|3[01])/\d{4}\b', 'date_of_birth', 'high', 'HIPAA')
ON CONFLICT (name) DO NOTHING;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_active ON user_roles(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_mfa_attempts_user_id ON mfa_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_compliance_incidents_severity ON compliance_incidents(severity);
CREATE INDEX IF NOT EXISTS idx_compliance_incidents_status ON compliance_incidents(status);
CREATE INDEX IF NOT EXISTS idx_compliance_consents_user_id ON compliance_consents(user_id);