# Supabase Production Deployment Guide

This guide walks you through deploying the Relationship Care Platform to production using Supabase as your PostgreSQL database provider.

## Why Supabase?

- ✅ Managed PostgreSQL with automatic backups
- ✅ Built-in connection pooling and performance optimization
- ✅ SSL/TLS encryption by default
- ✅ Real-time capabilities and dashboard
- ✅ Generous free tier, scales with your business

## Prerequisites

- Supabase account (free at [supabase.com](https://supabase.com))
- Production hosting platform (Vercel, Railway, Heroku, etc.)
- Domain name (optional but recommended)

## Step 1: Create Supabase Project

1. **Sign up/Login** to [Supabase](https://supabase.com)
2. **Create New Project**:
   - Project name: `relationship-care-platform`
   - Database password: Generate a strong password (save it!)
   - Region: Choose closest to your users
3. **Wait for setup** (usually 2-3 minutes)

## Step 2: Get Connection Details

1. **Go to Settings** → **Database**
2. **Copy Connection String**:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@[PROJECT-REF].pooler.supabase.com:5432/postgres
   ```
3. **Note the details**:
   - Host: `[PROJECT-REF].pooler.supabase.com`
   - Port: `5432`
   - Database: `postgres`
   - User: `postgres`
   - Password: [Your chosen password]

## Step 3: Configure Environment Variables

### Option A: Using Connection String (Recommended)
```bash
NODE_ENV=production
DATABASE_TYPE=postgresql
SUPABASE_DB_URL=postgresql://postgres:[YOUR-PASSWORD]@[PROJECT-REF].pooler.supabase.com:5432/postgres
```

### Option B: Individual Variables
```bash
NODE_ENV=production
DATABASE_TYPE=postgresql
DB_HOST=[PROJECT-REF].pooler.supabase.com
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=[YOUR-PASSWORD]
DB_SSL=true
DB_POOL_MAX=20
```

## Step 4: Deploy Application

### Vercel Deployment
1. **Connect Repository** to Vercel
2. **Add Environment Variables** in Vercel dashboard
3. **Deploy**: Vercel will build and deploy automatically
4. **Verify**: Check deployment logs for successful migration

### Railway Deployment
1. **Connect Repository** to Railway
2. **Add Environment Variables** in Railway dashboard
3. **Deploy**: Railway will build and deploy automatically
4. **Verify**: Check deployment logs for successful migration

### Heroku Deployment
1. **Create Heroku App**:
   ```bash
   heroku create your-app-name
   ```
2. **Set Environment Variables**:
   ```bash
   heroku config:set NODE_ENV=production
   heroku config:set SUPABASE_DB_URL="postgresql://postgres:[PASSWORD]@[PROJECT-REF].pooler.supabase.com:5432/postgres"
   ```
3. **Deploy**:
   ```bash
   git push heroku main
   ```

### Docker Deployment
```dockerfile
# Use production environment variables
ENV NODE_ENV=production
ENV SUPABASE_DB_URL=postgresql://postgres:[PASSWORD]@[PROJECT-REF].pooler.supabase.com:5432/postgres
```

## Step 5: Verify Deployment

1. **Check Health Endpoint**:
   ```bash
   curl https://your-app.com/health
   ```

2. **Verify Database Connection**:
   ```bash
   curl https://your-app.com/api/db/status
   ```

3. **Check Supabase Dashboard**:
   - Go to Supabase project dashboard
   - Check **Database** → **Tables** for migrated schema
   - Verify **Logs** for connection activity

## Step 6: Data Migration (If Needed)

### From SQLite Development Database
```bash
# Export development data
npm run db:export

# Set production environment
export SUPABASE_DB_URL="postgresql://..."

# Import to production
npm run db:import
```

### From Another PostgreSQL Database
```bash
# Use pg_dump and pg_restore
pg_dump source_db | psql $SUPABASE_DB_URL
```

## Security Configuration

### SSL/TLS (Automatic)
Supabase enforces SSL by default. No additional configuration needed.

### Connection Pooling
```bash
# Optimize for production load
DB_POOL_MAX=20
DB_IDLE_TIMEOUT=30000
DB_CONNECTION_TIMEOUT=2000
```

### Environment Security
- ✅ Never commit `.env` files to git
- ✅ Use platform-specific secret management
- ✅ Rotate database passwords regularly
- ✅ Monitor connection logs in Supabase dashboard

## Performance Optimization

### Connection Pooling
Supabase provides built-in connection pooling. Use the pooler endpoint:
```
[PROJECT-REF].pooler.supabase.com
```

### Query Optimization
1. **Monitor Slow Queries** in Supabase dashboard
2. **Add Indexes** for frequently queried columns
3. **Use EXPLAIN ANALYZE** for query optimization

### Caching Strategy
```bash
# Enable Redis caching for production
REDIS_URL=redis://your-redis-provider.com
CACHE_TTL=3600
```

## Monitoring and Maintenance

### Supabase Dashboard
- **Database Health**: Monitor CPU, memory, connections
- **Query Performance**: Identify slow queries
- **Logs**: Real-time database logs
- **Backups**: Automatic daily backups (paid plans)

### Application Monitoring
```bash
# Add health check endpoints
GET /health
GET /api/db/status
GET /api/db/migrations
```

### Backup Strategy
1. **Automatic Backups**: Enabled on Supabase Pro plans
2. **Manual Backups**: Use pg_dump for critical data
3. **Point-in-Time Recovery**: Available on paid plans

## Scaling Considerations

### Database Scaling
- **Vertical Scaling**: Upgrade Supabase plan for more resources
- **Read Replicas**: Available on higher-tier plans
- **Connection Limits**: Monitor and adjust pool size

### Application Scaling
- **Horizontal Scaling**: Deploy multiple app instances
- **Load Balancing**: Use platform load balancers
- **CDN**: Cache static assets

## Troubleshooting

### Connection Issues
```bash
# Test connection directly
psql "postgresql://postgres:[PASSWORD]@[PROJECT-REF].pooler.supabase.com:5432/postgres"
```

### Migration Failures
1. **Check Logs**: Review deployment logs for migration errors
2. **Manual Migration**: Run migrations manually if needed
3. **Schema Conflicts**: Resolve conflicts in Supabase dashboard

### Performance Issues
1. **Monitor Queries**: Use Supabase query analyzer
2. **Check Indexes**: Ensure proper indexing
3. **Connection Pool**: Adjust pool size for load

## Cost Optimization

### Free Tier Limits
- 500MB database size
- 2GB bandwidth per month
- 50MB file uploads

### Paid Plan Benefits
- Larger database size
- Automatic backups
- Point-in-time recovery
- Priority support

### Monitoring Usage
- Check Supabase dashboard for usage metrics
- Set up billing alerts
- Optimize queries to reduce resource usage

## Support and Resources

- **Supabase Documentation**: [docs.supabase.com](https://docs.supabase.com)
- **Community Support**: [github.com/supabase/supabase](https://github.com/supabase/supabase)
- **Status Page**: [status.supabase.com](https://status.supabase.com)
- **Discord Community**: Active community support

## Next Steps

1. **Set up monitoring** and alerting
2. **Configure backups** and disaster recovery
3. **Implement CI/CD** for automated deployments
4. **Set up staging environment** for testing
5. **Monitor performance** and optimize as needed