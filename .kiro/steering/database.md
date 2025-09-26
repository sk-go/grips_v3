---
inclusion: always
---

# Database Architecture Guidelines

## Current Architecture: Supabase-Only

The application has been migrated to use **Supabase exclusively** for all database operations. This provides:

- ✅ **Cloud-hosted PostgreSQL** with automatic scaling
- ✅ **Built-in SSL/TLS** security
- ✅ **Connection pooling** and performance optimization
- ✅ **Automatic backups** and point-in-time recovery
- ✅ **Real-time subscriptions** (future feature)

## Connection Methods

### Recommended: Supabase Client
```typescript
// Environment variables
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

// Usage in code
import { DatabaseService } from './services/database';
await DatabaseService.initialize();
```

### Alternative: Direct PostgreSQL
```typescript
// Environment variables  
SUPABASE_DB_URL=postgresql://postgres:password@db.project-ref.supabase.co:5432/postgres

// Automatic SSL configuration for Supabase connections
```

## Migration System

### Current Status
- ✅ **10 migrations** successfully applied
- ✅ **PostgreSQL-only syntax** (no SQLite dependencies)
- ✅ **Automatic execution** on application startup
- ✅ **Schema validation** and integrity checks

### Migration Files
1. `001_users_table.sql` - User authentication and profiles
2. `004_email_tables.sql` - Email integration tables
3. `005_twilio_tables.sql` - SMS and voice communication
4. `006_communication_center_tables.sql` - Unified communications
5. `006_communication_center_tables_fixed.sql` - Communication fixes
6. `007_client_profile_tables.sql` - Relationship enhancement
7. `008_document_templates.sql` - Document generation system
8. `009_document_activities.sql` - Document workflow tracking
9. `010_local_authentication_schema.sql` - Direct login support

## Database Service Architecture

### Service Layer
```typescript
// Unified interface for all database operations
DatabaseService.initialize()
DatabaseService.query(sql, params)
DatabaseService.getClient()
DatabaseService.healthCheck()
```

### Adapter Pattern
- **PostgreSQLAdapter**: Direct connection with full SQL support
- **SupabaseAdapter**: Client-based connection with REST API
- **BaseAdapter**: Common interface and functionality

## Development Guidelines

### When Adding New Features
1. **Create migrations** for schema changes
2. **Use DatabaseService** for all database operations
3. **Test with both connection methods** if possible
4. **Follow PostgreSQL best practices** (indexes, constraints, etc.)

### Performance Considerations
- **Connection pooling** is handled automatically
- **SSL connections** are required and configured
- **Query logging** is enabled for debugging
- **Health checks** monitor connection status

## Troubleshooting

### Common Issues
- **SSL Certificate Errors**: Automatically handled with `rejectUnauthorized: false`
- **Authentication Failures**: Check Supabase dashboard for correct credentials
- **Connection Timeouts**: Verify network connectivity and Supabase project status
- **Migration Failures**: Check PostgreSQL syntax compatibility

### Debugging Tools
- `npm run db:health-check` - Test database connectivity
- `npm run db:verify-migrations` - Validate migration status
- Database logs available in application output
- Supabase dashboard for real-time monitoring

## Security

### Connection Security
- **TLS 1.3** encryption for all connections
- **Service Role Key** authentication for backend operations
- **IP allowlisting** available in Supabase settings
- **Connection pooling** with secure credential management

### Data Protection
- **Row Level Security** available (not currently used)
- **Audit logging** for all database operations
- **Encrypted backups** provided by Supabase
- **GDPR/HIPAA compliance** features available