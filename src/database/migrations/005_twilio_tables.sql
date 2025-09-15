-- Office hours table
CREATE TABLE IF NOT EXISTS office_hours (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    timezone VARCHAR(100) NOT NULL DEFAULT 'America/New_York',
    monday JSONB NOT NULL,
    tuesday JSONB NOT NULL,
    wednesday JSONB NOT NULL,
    thursday JSONB NOT NULL,
    friday JSONB NOT NULL,
    saturday JSONB NOT NULL,
    sunday JSONB NOT NULL,
    holidays JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Phone calls table
CREATE TABLE IF NOT EXISTS phone_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    twilio_call_sid VARCHAR(255) UNIQUE NOT NULL,
    from_number VARCHAR(20) NOT NULL,
    to_number VARCHAR(20) NOT NULL,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    status VARCHAR(20) NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    duration INTEGER, -- seconds
    recording_url TEXT,
    transcription TEXT,
    transcription_accuracy DECIMAL(3,2),
    client_id UUID REFERENCES clients(id),
    tags JSONB DEFAULT '[]'::jsonb,
    is_off_hours BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- SMS messages table
CREATE TABLE IF NOT EXISTS sms_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    twilio_message_sid VARCHAR(255) UNIQUE NOT NULL,
    from_number VARCHAR(20) NOT NULL,
    to_number VARCHAR(20) NOT NULL,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    body TEXT NOT NULL,
    status VARCHAR(20) NOT NULL,
    media_urls JSONB DEFAULT '[]'::jsonb,
    date_sent TIMESTAMP WITH TIME ZONE,
    client_id UUID REFERENCES clients(id),
    tags JSONB DEFAULT '[]'::jsonb,
    is_off_hours BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_office_hours_user_id ON office_hours(user_id);
CREATE INDEX IF NOT EXISTS idx_office_hours_active ON office_hours(is_active);

CREATE INDEX IF NOT EXISTS idx_phone_calls_twilio_sid ON phone_calls(twilio_call_sid);
CREATE INDEX IF NOT EXISTS idx_phone_calls_from_number ON phone_calls(from_number);
CREATE INDEX IF NOT EXISTS idx_phone_calls_to_number ON phone_calls(to_number);
CREATE INDEX IF NOT EXISTS idx_phone_calls_client_id ON phone_calls(client_id);
CREATE INDEX IF NOT EXISTS idx_phone_calls_created_at ON phone_calls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_phone_calls_direction ON phone_calls(direction);
CREATE INDEX IF NOT EXISTS idx_phone_calls_status ON phone_calls(status);
CREATE INDEX IF NOT EXISTS idx_phone_calls_off_hours ON phone_calls(is_off_hours);

CREATE INDEX IF NOT EXISTS idx_sms_messages_twilio_sid ON sms_messages(twilio_message_sid);
CREATE INDEX IF NOT EXISTS idx_sms_messages_from_number ON sms_messages(from_number);
CREATE INDEX IF NOT EXISTS idx_sms_messages_to_number ON sms_messages(to_number);
CREATE INDEX IF NOT EXISTS idx_sms_messages_client_id ON sms_messages(client_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_created_at ON sms_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_messages_direction ON sms_messages(direction);
CREATE INDEX IF NOT EXISTS idx_sms_messages_status ON sms_messages(status);
CREATE INDEX IF NOT EXISTS idx_sms_messages_off_hours ON sms_messages(is_off_hours);
CREATE INDEX IF NOT EXISTS idx_sms_messages_body ON sms_messages USING GIN(to_tsvector('english', body));

-- Update triggers
CREATE OR REPLACE FUNCTION update_office_hours_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_office_hours_updated_at
    BEFORE UPDATE ON office_hours
    FOR EACH ROW
    EXECUTE FUNCTION update_office_hours_updated_at();

CREATE OR REPLACE FUNCTION update_phone_calls_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_phone_calls_updated_at
    BEFORE UPDATE ON phone_calls
    FOR EACH ROW
    EXECUTE FUNCTION update_phone_calls_updated_at();

CREATE OR REPLACE FUNCTION update_sms_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_sms_messages_updated_at
    BEFORE UPDATE ON sms_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_sms_messages_updated_at();