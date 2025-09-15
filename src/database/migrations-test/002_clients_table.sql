-- Clients table for CRM overlay data
CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    crm_id VARCHAR(255) NOT NULL,
    crm_system VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    photo_url TEXT,
    personal_details JSONB DEFAULT '{}',
    relationship_health JSONB DEFAULT '{}',
    last_crm_sync TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(crm_system, crm_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_clients_crm_system_id ON clients(crm_system, crm_id);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);