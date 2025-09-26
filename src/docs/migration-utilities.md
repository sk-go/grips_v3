# Migration Utilities Documentation

This document describes the migration utilities created for transitioning from Keycloak authentication to local authentication in the direct login system.

## Overview

The migration system provides comprehensive tools for:
- Creating default and custom admin users
- Migrating existing Keycloak users to local authentication
- Validating migration success
- Monitoring system readiness for local authentication

## Components

### MigrationService

The core service that handles all migration operations.

#### Key Methods

- `createDefaultAdminUser()` - Creates a default admin user with email `admin@localhost`
- `createAdminUser(userData)` - Creates a custom admin user with provided credentials
- `migrateFromKeycloak()` - Migrates existing Keycloak users to local authentication
- `validateMigration()` - Validates the current migration state
- `runCompleteMigration()` - Runs the complete migration process
- `cleanupExpiredTokens()` - Removes expired password reset tokens

### MigrationValidator

Utility class for checking migration status and system readiness.

#### Key Methods

- `checkMigrationStatus()` - Returns current migration status with recommendations
- `checkAuthConfiguration()` - Verifies local authentication is properly configured
- `generateMigrationReport()` - Creates a detailed migration report
- `preFlightCheck()` - Validates system prerequisites before migration

### Migration Script

Command-line interface for running migration operations.

## Usage

### Command Line Interface

```bash
# Run complete migration (recommended for first-time setup)
npm run migrate:complete

# Create default admin user
npm run migrate:default-admin

# Create custom admin user (interactive)
npm run migrate:custom-admin

# Migrate existing Keycloak users
npm run migrate:keycloak

# Validate current migration state
npm run migrate:validate

# Check migration status
npm run migrate:status

# Generate detailed report
npm run migrate:report

# Run pre-flight checks
npm run migrate:preflight

# Clean up expired password reset tokens
npm run migrate:cleanup-tokens
```

### Programmatic Usage

```typescript
import { MigrationService } from '../services/migrationService';
import { MigrationValidator } from '../utils/migrationValidator';

// Create default admin user
const result = await MigrationService.createDefaultAdminUser();
console.log(result.message);

// Check migration status
const status = await MigrationValidator.checkMigrationStatus();
console.log(`System ready: ${status.isReady}`);

// Run complete migration
const migrationResult = await MigrationService.runCompleteMigration();
console.log(`Created ${migrationResult.usersCreated} users`);
```

## Migration Process

### Phase 1: Pre-flight Checks

Before running any migration, the system performs pre-flight checks:

1. **Database Connection** - Verifies database connectivity
2. **Schema Validation** - Ensures required tables exist
3. **Environment Variables** - Checks for required configuration
4. **Migration Status** - Verifies database migrations are up to date

### Phase 2: User Creation

The migration process handles user creation in this order:

1. **Default Admin User** - Creates `admin@localhost` if no admin exists
2. **Custom Admin Users** - Creates additional admin users as needed
3. **Keycloak Migration** - Migrates existing Keycloak users

### Phase 3: Validation

After migration, the system validates:

1. **Admin User Exists** - At least one admin user is present
2. **Local Authentication** - Users have password hashes
3. **Database Integrity** - All required tables and constraints exist
4. **Authentication Methods** - No users without authentication methods

## Default Admin User

The system creates a default admin user with these credentials:

- **Email**: `admin@localhost`
- **Password**: `admin123!`
- **Role**: `admin`
- **Status**: Active and email verified

⚠️ **Security Warning**: Change the default admin password immediately after first login.

## Keycloak User Migration

When migrating Keycloak users:

1. **Identification** - Finds users with `keycloak_id` but no `password_hash`
2. **Temporary Passwords** - Generates secure temporary passwords
3. **Password Hashing** - Stores bcrypt-hashed passwords
4. **Email Verification** - Marks users as requiring email verification
5. **Notification** - Logs temporary passwords (in production, send emails)

### Migration Strategy

The migration preserves backward compatibility:

- Users with `keycloak_id` remain functional
- New `password_hash` column enables local authentication
- Database constraint ensures users have at least one authentication method
- Gradual migration without service interruption

## Validation and Monitoring

### Migration Status

The system provides detailed status information:

```typescript
interface MigrationStatus {
  isReady: boolean;           // Overall readiness for local auth
  hasAdminUser: boolean;      // Admin user exists
  hasLocalAuth: boolean;      // Local authentication available
  totalUsers: number;         // Total active users
  issues: string[];           // Problems found
  recommendations: string[];  // Suggested actions
}
```

### Validation Checks

The validation process verifies:

- **Admin User Presence** - At least one admin user exists
- **Authentication Coverage** - All users have authentication methods
- **Database Schema** - Required tables and constraints exist
- **Password Security** - Password hashes are properly formatted
- **Token Management** - Password reset system is functional

## Error Handling

The migration system includes comprehensive error handling:

### Graceful Failures

- **Partial Migration** - Continues processing even if individual users fail
- **Rollback Safety** - No destructive operations without confirmation
- **Detailed Logging** - Comprehensive error reporting and logging
- **Recovery Options** - Clear guidance for resolving issues

### Common Issues and Solutions

1. **Email Already Exists**
   - Solution: Use different email or update existing user
   - Command: Check with `npm run migrate:status`

2. **Database Connection Failed**
   - Solution: Verify database configuration and connectivity
   - Command: Test with `npm run db:health`

3. **Missing Schema**
   - Solution: Run database migrations
   - Command: `npm run db:migrate`

4. **No Admin User**
   - Solution: Create default admin user
   - Command: `npm run migrate:default-admin`

## Security Considerations

### Password Security

- **Bcrypt Hashing** - Uses bcrypt with 12 salt rounds
- **Temporary Passwords** - Secure random generation for migrated users
- **Password Validation** - Enforces minimum length and complexity
- **Reset Tokens** - Cryptographically secure reset tokens

### Data Protection

- **Minimal Data** - Only stores essential authentication data
- **Audit Logging** - Comprehensive logging of all operations
- **Error Sanitization** - Prevents information leakage in error messages
- **Token Cleanup** - Automatic cleanup of expired reset tokens

## Testing

The migration system includes comprehensive tests:

### Unit Tests

- **Service Methods** - All MigrationService methods
- **Validation Logic** - MigrationValidator functionality
- **Error Handling** - Edge cases and error conditions
- **Security Features** - Password hashing and validation

### Integration Tests

- **Database Operations** - Real database interactions
- **Complete Workflows** - End-to-end migration processes
- **Schema Validation** - Database constraint verification
- **Token Management** - Password reset token lifecycle

### Running Tests

```bash
# Run all migration tests
npm test -- --testPathPattern=migration

# Run specific test suites
npm test src/test/services/migrationService.test.ts
npm test src/test/integration/migrationService.integration.test.ts
```

## Monitoring and Maintenance

### Regular Maintenance

1. **Token Cleanup** - Run `npm run migrate:cleanup-tokens` periodically
2. **Status Monitoring** - Check `npm run migrate:status` regularly
3. **Log Review** - Monitor application logs for migration issues
4. **Validation Checks** - Run `npm run migrate:validate` after changes

### Performance Considerations

- **Batch Processing** - Handles large user migrations efficiently
- **Connection Pooling** - Uses database connection pooling
- **Memory Management** - Processes users in batches to avoid memory issues
- **Timeout Handling** - Includes appropriate timeouts for operations

## Troubleshooting

### Debug Mode

Enable detailed logging by setting environment variable:

```bash
LOG_LEVEL=debug npm run migrate:complete
```

### Common Commands for Troubleshooting

```bash
# Check overall system status
npm run migrate:status

# Generate detailed report
npm run migrate:report

# Validate database schema
npm run db:verify-migrations

# Test database connection
npm run db:health

# Check pre-flight requirements
npm run migrate:preflight
```

### Recovery Procedures

If migration fails:

1. **Check Logs** - Review application logs for specific errors
2. **Validate Schema** - Ensure database migrations are complete
3. **Check Connectivity** - Verify database and service connections
4. **Run Validation** - Use `npm run migrate:validate` to identify issues
5. **Incremental Recovery** - Run individual migration steps as needed

## Future Enhancements

Planned improvements to the migration system:

1. **Email Notifications** - Send password reset emails during migration
2. **Bulk Operations** - Enhanced batch processing for large datasets
3. **Migration Rollback** - Safe rollback procedures for failed migrations
4. **Advanced Validation** - Additional security and integrity checks
5. **Monitoring Dashboard** - Web interface for migration status monitoring

## Support

For issues with the migration system:

1. **Check Documentation** - Review this guide and related docs
2. **Run Diagnostics** - Use built-in diagnostic commands
3. **Review Logs** - Check application and database logs
4. **Test Environment** - Verify in development environment first
5. **Incremental Approach** - Run migration steps individually if needed