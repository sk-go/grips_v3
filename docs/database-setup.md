# Database Setup Guide

This guide explains how to set up the database for the Relationship Care Platform in different environments.

## Quick Start (Development)

The application automatically uses SQLite for development, so you can get started immediately:

1. **Clone the repository**
2. **Install dependencies**: `npm install`
3. **Start the application**: `npm run dev`

The application will automatically:
- Create a SQLite database at `./data/development.db`
- Run all migrations to set up the schema
- Be ready for development

No additional database setup required!

📖 **See [Quick Start Guide - SQLite Development](./quick-start-sqlite.md) for detailed setup instructions.**

## Database Configuration

### Automatic Environment Detection

The system automatically selects the appropriate database based on your environment:

- **Development** (`NODE_ENV=development`): SQLite (default)
- **Production** (`NODE_ENV=production`): PostgreSQL (default)

### Manual Override

You can override the automatic selection by setting `DATABASE_TYPE`:

```bash
# Force SQLite in any environment
DATABASE_TYPE=sqlite

# Force PostgreSQL in any environment  
DATABASE_TYPE=postgresql
```

## SQLite Configuration (Development)

### Default Setup
```bash
# File-based database (recommended for development)
SQLITE_FILENAME=./data/development.db
SQLITE_WAL=true
```

### Alternative Configurations
```bash
# In-memory database (for testing, data lost on restart)
SQLITE_FILENAME=:memory:

# Custom location
SQLITE_FILENAME=./my-custom-path/app.db

# Disable WAL mode (if you encounter issues)
SQLITE_WAL=false
```

### SQLite Benefits for Development
- ✅ No server setup required
- ✅ No authentication needed
- ✅ Portable database file
- ✅ Fast for development workloads
- ✅ Same SQL syntax as PostgreSQL (with compatibility layer)

## PostgreSQL Configuration (Production)

### Standard PostgreSQL
```bash
DATABASE_TYPE=postgresql
DB_HOST=localhost
DB_PORT=5432
DB_NAME=relationship_care_platform
DB_USER=your_username
DB_PASSWORD=your_password
DB_SSL=false
```

### Supabase (Recommended for Production)
```bash
# Use Supabase connection string (overrides individual DB_* variables)
SUPABASE_DB_URL=postgresql://postgres:[password]@[project-ref].pooler.supabase.com:5432/postgres
```

📖 **See [Supabase Production Deployment Guide](./supabase-deployment.md) for complete production setup instructions.**

### Connection Pooling
```bash
DB_POOL_MAX=20
DB_IDLE_TIMEOUT=30000
DB_CONNECTION_TIMEOUT=2000
```

## Migration Between Databases

### Development to Production Migration

1. **Export SQLite data** (when available):
   ```bash
   npm run db:export
   ```

2. **Set up PostgreSQL/Supabase**:
   - Update environment variables
   - Restart application
   - Migrations run automatically

3. **Import data** (when available):
   ```bash
   npm run db:import
   ```

### Switching Database Types

The application handles database switching automatically:

1. **Update environment variables**
2. **Restart the application**
3. **Migrations run automatically**

## Troubleshooting

For detailed troubleshooting instructions, see the **[Database Troubleshooting Guide](./database-troubleshooting.md)**.

### Quick Fixes

**SQLite Issues**:
```bash
# Ensure data directory exists and is writable
mkdir -p ./data
chmod 755 ./data

# Disable WAL mode if you encounter locking issues
SQLITE_WAL=false
```

**PostgreSQL Issues**:
```bash
# Test connection
psql -h localhost -p 5432 -U postgres -d postgres

# Disable SSL for local development
DB_SSL=false
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
DATABASE_TYPE=sqlite
SQLITE_FILENAME=./data/development.db
SQLITE_WAL=true
```

### Testing (.env.test)
```bash
NODE_ENV=test
DATABASE_TYPE=sqlite
SQLITE_FILENAME=:memory:
```

### Production (.env.production)
```bash
NODE_ENV=production
DATABASE_TYPE=postgresql
SUPABASE_DB_URL=postgresql://postgres:[password]@[project-ref].pooler.supabase.com:5432/postgres
```

## Database Schema

The application uses the same schema for both SQLite and PostgreSQL:
- Automatic SQL translation handles differences
- Migrations work on both database types
- Data types are converted automatically

### Schema Files
- `src/database/migrations/`: SQL migration files
- Migrations run automatically on startup
- Schema is created if it doesn't exist

## Performance Considerations

### SQLite (Development)
- Single-writer limitation (fine for development)
- WAL mode improves concurrent access
- In-memory option for fastest tests

### PostgreSQL (Production)
- Full concurrent access
- Connection pooling for scalability
- Optimized for production workloads

## Security Notes

### SQLite
- File-based: Secure file permissions important
- No network exposure by default
- Suitable for development only

### PostgreSQL
- Network-based: SSL/TLS encryption recommended
- User authentication required
- Audit logging available
- Production-ready security features