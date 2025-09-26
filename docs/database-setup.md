# Database Setup Guide

This guide explains how to set up Supabase database for the Relationship Care Platform in different environments.

## Quick Start (Development)

The application uses Supabase for all environments. To get started:

1. **Create a Supabase project** at [supabase.com](https://supabase.com)
2. **Clone the repository**
3. **Install dependencies**: `npm install`
4. **Configure environment**: Copy `.env.example` to `.env` and add your Supabase URL
5. **Start the application**: `npm run dev`

The application will automatically:
- Connect to your Supabase database
- Run all migrations to set up the schema
- Be ready for development

📖 **See [Supabase Production Deployment Guide](./supabase-deployment.md) for detailed setup instructions.**

## Database Configuration

### Supabase Configuration

The system uses Supabase (PostgreSQL) for all environments:

- **Development**: Supabase development project
- **Testing**: Supabase test project or separate database
- **Production**: Supabase production project

### Connection Configuration

Configure your Supabase connection using environment variables:

```bash
# Primary method (recommended)
SUPABASE_DB_URL=postgresql://postgres:[password]@[project-ref].pooler.supabase.com:5432/postgres

# Alternative individual variables
DB_HOST=[project-ref].pooler.supabase.com
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=[your-password]
DB_SSL=true
```

## Supabase Configuration (All Environments)

### Development Setup
```bash
# Development project
SUPABASE_DB_URL=postgresql://postgres:[dev-password]@[dev-project-ref].pooler.supabase.com:5432/postgres
NODE_ENV=development
```

### Testing Setup
```bash
# Test project or separate database
SUPABASE_DB_URL=postgresql://postgres:[test-password]@[test-project-ref].pooler.supabase.com:5432/postgres
NODE_ENV=test
```

### Supabase Benefits
- ✅ Managed PostgreSQL service
- ✅ Built-in real-time features
- ✅ Automatic backups and scaling
- ✅ Production-ready from day one
- ✅ Consistent across all environments

## Production Configuration

### Supabase Production Setup
```bash
# Production project with optimized settings
SUPABASE_DB_URL=postgresql://postgres:[prod-password]@[prod-project-ref].pooler.supabase.com:5432/postgres
NODE_ENV=production
```

📖 **See [Supabase Production Deployment Guide](./supabase-deployment.md) for complete production setup instructions.**

### Connection Pooling
```bash
DB_POOL_MAX=20
DB_IDLE_TIMEOUT=30000
DB_CONNECTION_TIMEOUT=10000
DB_SSL=true
```

### Performance Optimization
```bash
# Use Supabase connection pooler for better performance
# Connection string should include .pooler.supabase.com
SUPABASE_DB_URL=postgresql://postgres:[password]@[project-ref].pooler.supabase.com:5432/postgres
```

## Environment Migration

### Development to Production Migration

1. **Set up production Supabase project**
2. **Update environment variables**:
   ```bash
   SUPABASE_DB_URL=postgresql://postgres:[prod-password]@[prod-project-ref].pooler.supabase.com:5432/postgres
   ```
3. **Restart application**:
   - Migrations run automatically
   - Schema is created if needed

### Switching Between Environments

Switch between different Supabase projects:

1. **Update SUPABASE_DB_URL** to target project
2. **Restart the application**
3. **Migrations run automatically**

### Data Migration Between Projects
```bash
# Export data from source project
pg_dump "postgresql://postgres:[src-password]@[src-project].pooler.supabase.com:5432/postgres" > backup.sql

# Import to target project
psql "postgresql://postgres:[dest-password]@[dest-project].pooler.supabase.com:5432/postgres" < backup.sql
```

## Troubleshooting

For detailed troubleshooting instructions, see the **[Database Troubleshooting Guide](./database-troubleshooting.md)**.

### Quick Fixes

**Supabase Connection Issues**:
```bash
# Test connection directly
psql "postgresql://postgres:[password]@[project-ref].pooler.supabase.com:5432/postgres"

# Check project status in Supabase dashboard
# Verify password and project reference

# Enable SSL (required for Supabase)
DB_SSL=true
```

**Configuration Validation**:
```bash
# Check current configuration
npm run db:status

# Validate configuration
npm run db:validate
```

📖 **For comprehensive troubleshooting, see [Database Troubleshooting Guide](./database-troubleshooting.md)**

## Environment Examples

### Local Development (.env.local)
```bash
NODE_ENV=development
SUPABASE_DB_URL=postgresql://postgres:[dev-password]@[dev-project-ref].pooler.supabase.com:5432/postgres
```

### Testing (.env.test)
```bash
NODE_ENV=test
SUPABASE_DB_URL=postgresql://postgres:[test-password]@[test-project-ref].pooler.supabase.com:5432/postgres
```

### Production (.env.production)
```bash
NODE_ENV=production
SUPABASE_DB_URL=postgresql://postgres:[prod-password]@[prod-project-ref].pooler.supabase.com:5432/postgres
```

## Database Schema

The application uses PostgreSQL schema optimized for Supabase:
- Native PostgreSQL SQL in all migrations
- Optimized for Supabase features and performance
- Consistent schema across all environments

### Schema Files
- `src/database/migrations/`: SQL migration files
- Migrations run automatically on startup
- Schema is created if it doesn't exist

## Performance Considerations

### Supabase (All Environments)
- Full concurrent access across all environments
- Built-in connection pooling via pooler.supabase.com
- Automatic scaling and optimization
- Real-time features for enhanced performance

## Security Notes

### Supabase Security
- SSL/TLS encryption enforced by default
- Row Level Security (RLS) policies available
- Built-in authentication and authorization
- Audit logging and monitoring included
- Production-ready security features across all environments