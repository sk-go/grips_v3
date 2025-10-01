import { readFileSync } from 'fs';
import { join } from 'path';

describe('Migration 011: Email Verification System', () => {
  let migrationContent: string;

  beforeAll(() => {
    const migrationPath = join(__dirname, '../../database/migrations/011_email_verification_system.sql');
    migrationContent = readFileSync(migrationPath, 'utf8');
  });

  describe('Table Creation', () => {
    test('should create email_verification_tokens table', () => {
      expect(migrationContent).toContain('CREATE TABLE IF NOT EXISTS email_verification_tokens');
      expect(migrationContent).toContain('id UUID PRIMARY KEY DEFAULT gen_random_uuid()');
      expect(migrationContent).toContain('user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE');
      expect(migrationContent).toContain('token VARCHAR(255) UNIQUE NOT NULL');
      expect(migrationContent).toContain('expires_at TIMESTAMP WITH TIME ZONE NOT NULL');
      expect(migrationContent).toContain('used_at TIMESTAMP WITH TIME ZONE');
    });

    test('should create registration_audit_log table', () => {
      expect(migrationContent).toContain('CREATE TABLE IF NOT EXISTS registration_audit_log');
      expect(migrationContent).toContain('event_type VARCHAR(50) NOT NULL');
      expect(migrationContent).toContain('event_data JSONB');
      expect(migrationContent).toContain('ip_address INET');
      expect(migrationContent).toContain('user_agent TEXT');
      expect(migrationContent).toContain('admin_id UUID REFERENCES users(id) ON DELETE SET NULL');
    });

    test('should create registration_settings table', () => {
      expect(migrationContent).toContain('CREATE TABLE IF NOT EXISTS registration_settings');
      expect(migrationContent).toContain('require_admin_approval BOOLEAN NOT NULL DEFAULT false');
      expect(migrationContent).toContain('allowed_email_domains TEXT[]');
      expect(migrationContent).toContain('max_registrations_per_day INTEGER DEFAULT 100');
      expect(migrationContent).toContain('verification_token_expiry_hours INTEGER DEFAULT 24');
    });
  });

  describe('Indexes', () => {
    test('should create indexes for email_verification_tokens', () => {
      expect(migrationContent).toContain('idx_email_verification_tokens_user_id');
      expect(migrationContent).toContain('idx_email_verification_tokens_token');
      expect(migrationContent).toContain('idx_email_verification_tokens_expires_at');
      expect(migrationContent).toContain('idx_email_verification_tokens_used_at');
    });

    test('should create indexes for registration_audit_log', () => {
      expect(migrationContent).toContain('idx_registration_audit_log_user_id');
      expect(migrationContent).toContain('idx_registration_audit_log_event_type');
      expect(migrationContent).toContain('idx_registration_audit_log_created_at');
      expect(migrationContent).toContain('idx_registration_audit_log_ip_address');
    });

    test('should create indexes for registration_settings', () => {
      expect(migrationContent).toContain('idx_registration_settings_updated_at');
    });
  });

  describe('Functions and Triggers', () => {
    test('should create cleanup function for expired tokens', () => {
      expect(migrationContent).toContain('cleanup_expired_email_verification_tokens()');
      expect(migrationContent).toContain('DELETE FROM email_verification_tokens');
      expect(migrationContent).toContain('WHERE expires_at < CURRENT_TIMESTAMP');
    });

    test('should create function to invalidate verification tokens', () => {
      expect(migrationContent).toContain('invalidate_user_verification_tokens()');
      expect(migrationContent).toContain('UPDATE email_verification_tokens');
      expect(migrationContent).toContain('SET used_at = CURRENT_TIMESTAMP');
    });

    test('should create trigger for email verification', () => {
      expect(migrationContent).toContain('invalidate_verification_tokens_on_email_verified');
      expect(migrationContent).toContain('BEFORE UPDATE ON users');
    });

    test('should create trigger for registration settings updated_at', () => {
      expect(migrationContent).toContain('update_registration_settings_updated_at');
      expect(migrationContent).toContain('BEFORE UPDATE ON registration_settings');
    });
  });

  describe('Constraints', () => {
    test('should add constraint for event_type validation', () => {
      expect(migrationContent).toContain('check_event_type');
      expect(migrationContent).toContain("event_type IN ('registration', 'verification', 'approval', 'rejection', 'login_attempt', 'password_reset')");
    });

    test('should add constraint for verification expiry hours', () => {
      expect(migrationContent).toContain('check_verification_expiry_hours');
      expect(migrationContent).toContain('verification_token_expiry_hours > 0 AND verification_token_expiry_hours <= 168');
    });

    test('should add constraint for max registrations per day', () => {
      expect(migrationContent).toContain('check_max_registrations_per_day');
      expect(migrationContent).toContain('max_registrations_per_day > 0 AND max_registrations_per_day <= 10000');
    });
  });

  describe('Default Data', () => {
    test('should insert default registration settings', () => {
      expect(migrationContent).toContain('INSERT INTO registration_settings');
      expect(migrationContent).toContain('ON CONFLICT DO NOTHING');
    });
  });

  describe('PostgreSQL Compatibility', () => {
    test('should use PostgreSQL-specific features correctly', () => {
      expect(migrationContent).toContain('UUID');
      expect(migrationContent).toContain('gen_random_uuid()');
      expect(migrationContent).toContain('TIMESTAMP WITH TIME ZONE');
      expect(migrationContent).toContain('JSONB');
      expect(migrationContent).toContain('INET');
      expect(migrationContent).toContain('TEXT[]');
    });

    test('should use IF NOT EXISTS for safe execution', () => {
      expect(migrationContent).toContain('CREATE TABLE IF NOT EXISTS');
      expect(migrationContent).toContain('CREATE INDEX IF NOT EXISTS');
    });
  });
});