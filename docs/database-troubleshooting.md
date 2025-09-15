# Database Troubleshooting Guide

This guide helps you diagnose and resolve common database issues with the Relationship Care Platform.

## Quick Diagnostics

### Check Database Status
```bash
# Check current database configuration and health
npm run db:status

# Validate configuration
npm run db:validate

# Test database connection
npm run db:test-connection
```

### Health Check Endpoints
```bash
# Application health
curl http://localhost:3001/health

# Database-specific health
curl http://localhost:3001/api/db/status

# Migration status
curl http://localhost:3001/api/db/migrations
```

## SQLite Issues

### Database File Not Created

**Symptoms:**
- Application fails to start
- Error: "SQLITE_CANTOPEN: unable to open database file"

**Solutions:**
```bash
# 1. Check directory permissions
mkdir -p ./data
chmod 755 ./data

# 2. Check disk space
df -h .

# 3. Try different location
SQLITE_FILENAME=./app.db npm run dev

# 4. Use in-memory for testing
SQLITE_FILENAME=:memory: npm run dev
```

### Database Locked

**Symptoms:**
- Error: "SQLITE_BUSY: database is locked"
- Slow queries or timeouts

**Solutions:**
```bash
# 1. Enable WAL mode (recommended)
SQLITE_WAL=true

# 2. Check for zombie processes
ps aux | grep node
kill -9 [process-id]

# 3. Remove lock files
rm ./data/development.db-wal
rm ./data/development.db-shm

# 4. Restart application
npm run dev
```

### Corruption Issues

**Symptoms:**
- Error: "SQLITE_CORRUPT: database disk image is malformed"
- Unexpected query results

**Solutions:**
```bash
# 1. Check database integrity
sqlite3 ./data/development.db "PRAGMA integrity_check;"

# 2. Attempt repair
sqlite3 ./data/development.db ".recover" | sqlite3 ./data/recovered.db

# 3. Restore from backup (if available)
cp ./data/backup.db ./data/development.db

# 4. Reset database (loses data)
rm ./data/development.db
npm run dev  # Will recreate with migrations
```

### Permission Denied

**Symptoms:**
- Error: "EACCES: permission denied"
- Cannot create database file

**Solutions:**
```bash
# 1. Fix directory permissions
sudo chown -R $USER:$USER ./data
chmod 755 ./data

# 2. Check parent directory permissions
ls -la ./

# 3. Use different location
SQLITE_FILENAME=/tmp/app.db npm run dev

# 4. Run with appropriate user
sudo -u www-data npm run dev  # For production
```

## PostgreSQL Issues

### Connection Refused

**Symptoms:**
- Error: "ECONNREFUSED" or "Connection refused"
- Cannot connect to database

**Solutions:**
```bash
# 1. Check if PostgreSQL is running
pg_isready -h localhost -p 5432

# 2. Start PostgreSQL service
sudo systemctl start postgresql  # Linux
brew services start postgresql   # macOS

# 3. Check connection parameters
psql -h localhost -p 5432 -U postgres -d postgres

# 4. Verify firewall settings
sudo ufw allow 5432  # Linux
```

### Authentication Failed

**Symptoms:**
- Error: "password authentication failed"
- Error: "role does not exist"

**Solutions:**
```bash
# 1. Verify credentials
psql -h localhost -U postgres -d postgres

# 2. Reset password
sudo -u postgres psql
ALTER USER postgres PASSWORD 'newpassword';

# 3. Check pg_hba.conf authentication method
sudo nano /etc/postgresql/*/main/pg_hba.conf

# 4. Create user if missing
sudo -u postgres createuser --interactive
```

### SSL Connection Issues

**Symptoms:**
- Error: "SSL connection required"
- Error: "SSL certificate verification failed"

**Solutions:**
```bash
# 1. Disable SSL for local development
DB_SSL=false

# 2. Enable SSL for production
DB_SSL=true

# 3. Skip SSL verification (development only)
DB_SSL_REJECT_UNAUTHORIZED=false

# 4. Provide SSL certificate
DB_SSL_CA=/path/to/ca-certificate.crt
```

## Supabase Issues

### Invalid Connection String

**Symptoms:**
- Error: "Invalid connection string"
- Error: "Connection timeout"

**Solutions:**
```bash
# 1. Verify connection string format
SUPABASE_DB_URL=postgresql://postgres:[PASSWORD]@[PROJECT-REF].pooler.supabase.com:5432/postgres

# 2. Check for special characters in password
# URL encode special characters: @ = %40, # = %23, etc.

# 3. Test connection directly
psql "postgresql://postgres:[PASSWORD]@[PROJECT-REF].pooler.supabase.com:5432/postgres"

# 4. Use individual parameters instead
DB_HOST=[PROJECT-REF].pooler.supabase.com
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=[PASSWORD]
```

### Project Not Found

**Symptoms:**
- Error: "Project not found"
- Error: "Invalid project reference"

**Solutions:**
```bash
# 1. Verify project reference in Supabase dashboard
# Should be format: [PROJECT-REF].pooler.supabase.com

# 2. Check project status in Supabase
# Ensure project is active and not paused

# 3. Verify region
# Use correct regional endpoint if specified

# 4. Check API keys and permissions
# Ensure service role key has database access
```

### Rate Limiting

**Symptoms:**
- Error: "Too many connections"
- Slow response times

**Solutions:**
```bash
# 1. Reduce connection pool size
DB_POOL_MAX=10

# 2. Implement connection retry logic
DB_CONNECTION_TIMEOUT=5000

# 3. Use connection pooling endpoint
# [PROJECT-REF].pooler.supabase.com instead of direct connection

# 4. Upgrade Supabase plan for higher limits
```

## Migration Issues

### Migration Failures

**Symptoms:**
- Error: "Migration failed"
- Schema inconsistencies

**Solutions:**
```bash
# 1. Check migration status
npm run db:migrations:status

# 2. Run migrations manually
npm run db:migrations:run

# 3. Rollback problematic migration
npm run db:migrations:rollback

# 4. Reset and re-run all migrations
npm run db:reset
npm run db:migrations:run
```

### SQL Compatibility Issues

**Symptoms:**
- Error: "Syntax error" when switching databases
- Features work in one database but not another

**Solutions:**
```bash
# 1. Check SQL compatibility layer logs
DEBUG=sql-compatibility npm run dev

# 2. Review migration files for database-specific syntax
# PostgreSQL: JSONB, UUID, arrays
# SQLite: TEXT, custom UUID functions

# 3. Update migrations for compatibility
# Use database-agnostic SQL where possible

# 4. Test migrations on both databases
DATABASE_TYPE=sqlite npm run db:migrations:test
DATABASE_TYPE=postgresql npm run db:migrations:test
```

### Schema Drift

**Symptoms:**
- Different schemas between environments
- Migration conflicts

**Solutions:**
```bash
# 1. Compare schemas
npm run db:schema:compare

# 2. Generate schema diff
npm run db:schema:diff

# 3. Create corrective migration
npm run db:migrations:generate fix-schema-drift

# 4. Synchronize environments
npm run db:schema:sync
```

## Performance Issues

### Slow Queries

**Symptoms:**
- High response times
- Database timeouts

**Solutions:**
```bash
# 1. Enable query logging
DEBUG=database:query npm run dev

# 2. Analyze slow queries
# PostgreSQL: Check pg_stat_statements
# SQLite: Use EXPLAIN QUERY PLAN

# 3. Add missing indexes
CREATE INDEX idx_table_column ON table_name(column_name);

# 4. Optimize query patterns
# Use LIMIT, avoid SELECT *, use proper JOINs
```

### Connection Pool Exhaustion

**Symptoms:**
- Error: "Connection pool exhausted"
- Increasing response times

**Solutions:**
```bash
# 1. Increase pool size
DB_POOL_MAX=30

# 2. Reduce idle timeout
DB_IDLE_TIMEOUT=10000

# 3. Check for connection leaks
# Ensure all queries properly release connections

# 4. Monitor connection usage
npm run db:pool:status
```

### Memory Issues

**Symptoms:**
- Out of memory errors
- Application crashes

**Solutions:**
```bash
# 1. Increase Node.js memory limit
node --max-old-space-size=4096 src/server.js

# 2. Optimize query result sizes
# Use LIMIT, pagination, streaming for large datasets

# 3. Check for memory leaks
# Monitor memory usage over time

# 4. Use connection pooling
# Prevent excessive connection creation
```

## Environment-Specific Issues

### Development Environment

**Common Issues:**
- Port conflicts
- File permissions
- Missing dependencies

**Solutions:**
```bash
# 1. Use different ports
PORT=3002 npm run dev

# 2. Clean install
rm -rf node_modules package-lock.json
npm install

# 3. Reset development database
rm ./data/development.db
npm run dev
```

### Production Environment

**Common Issues:**
- Environment variable configuration
- SSL/TLS issues
- Resource limits

**Solutions:**
```bash
# 1. Verify environment variables
printenv | grep DB_

# 2. Check SSL configuration
openssl s_client -connect [host]:5432

# 3. Monitor resource usage
# CPU, memory, disk space, connections

# 4. Review application logs
tail -f /var/log/app.log
```

### Testing Environment

**Common Issues:**
- Test database conflicts
- Cleanup between tests
- Parallel test execution

**Solutions:**
```bash
# 1. Use separate test database
NODE_ENV=test SQLITE_FILENAME=:memory: npm test

# 2. Clean database between tests
beforeEach(() => resetDatabase())

# 3. Run tests sequentially if needed
npm test -- --runInBand

# 4. Use test-specific configuration
cp .env.test .env.local
```

## Monitoring and Logging

### Enable Debug Logging
```bash
# Database operations
DEBUG=database:* npm run dev

# SQL queries
DEBUG=database:query npm run dev

# Connection pool
DEBUG=database:pool npm run dev

# All database debug info
DEBUG=database:*,sql-compatibility npm run dev
```

### Log Analysis
```bash
# Search for database errors
grep -i "database\|sql\|connection" logs/error.log

# Monitor connection patterns
grep "connection" logs/combined.log | tail -f

# Check migration logs
grep "migration" logs/combined.log
```

### Health Monitoring
```bash
# Continuous health check
watch -n 5 'curl -s http://localhost:3001/health | jq'

# Database connection monitoring
watch -n 10 'curl -s http://localhost:3001/api/db/status'
```

## Getting Help

### Collect Diagnostic Information
```bash
# System information
node --version
npm --version
uname -a

# Database configuration
npm run db:config

# Recent logs
tail -n 100 logs/error.log

# Environment variables (sanitized)
printenv | grep -E '^(NODE_ENV|DATABASE_TYPE|DB_|SQLITE_)' | sed 's/=.*/=***/'
```

### Support Channels
1. **Check Documentation**: Review setup guides and API docs
2. **Search Issues**: Look for similar problems in project issues
3. **Community Forums**: Ask questions in community channels
4. **Create Issue**: Provide diagnostic information when reporting bugs

### Emergency Recovery
```bash
# 1. Stop application
pkill -f "node.*server"

# 2. Backup current state
cp -r ./data ./data.backup.$(date +%Y%m%d_%H%M%S)

# 3. Reset to known good state
git checkout HEAD -- src/database/migrations/
rm ./data/development.db

# 4. Restart with clean database
npm run dev
```