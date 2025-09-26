# Docker Setup Guide

This guide explains how to use Docker with the Relationship Care Platform for development services.

## Overview

The application uses Supabase for database operations and Docker for supporting services:
- **Supabase** (database): Managed PostgreSQL service, no Docker container needed
- **Redis** (required): Docker container for caching and sessions

## Quick Start

### Development Setup
```bash
# Start Redis for caching
docker-compose up redis

# Or start in background
docker-compose up -d redis
```

Configure your Supabase connection:
```bash
SUPABASE_DB_URL=postgresql://postgres:[password]@[project-ref].pooler.supabase.com:5432/postgres
```

Then start your application:
```bash
npm run dev
```

## Docker Services

### Available Services

1. **Redis** (required): Caching and session storage
   ```bash
   docker-compose up redis
   ```

### Usage Examples

```bash
# Development setup
docker-compose up -d redis
SUPABASE_DB_URL=your-supabase-url npm run dev

# Testing environment
docker-compose up -d redis
npm test

# Background services
docker-compose up -d
```

## Environment-Specific Configurations

### Development Environment
```bash
# Use development-specific compose file
docker-compose -f docker-compose.dev.yml up

# With PostgreSQL
docker-compose -f docker-compose.dev.yml --profile postgres up

# Background mode
docker-compose -f docker-compose.dev.yml --profile postgres up -d
```

### Testing Environment
```bash
# Minimal setup for testing (Redis only)
docker-compose up redis

# Full setup for integration tests
docker-compose --profile full up -d
npm test
```

## Service Details

### Redis Service
- **Image**: redis:7-alpine
- **Port**: 6379
- **Volume**: Persistent data storage
- **Health Check**: Built-in ping check
- **Required**: Yes, for caching and sessions

### Database Service
- **Supabase**: Managed PostgreSQL service
- **Connection**: Via SUPABASE_DB_URL environment variable
- **No Docker**: Database runs on Supabase infrastructure
- **Migration Support**: Auto-runs migrations on application startup

## Database Configuration

### Supabase Configuration
The application uses Supabase for all database operations:

```bash
# Primary configuration (recommended)
SUPABASE_DB_URL=postgresql://postgres:[password]@[project-ref].pooler.supabase.com:5432/postgres

# Alternative individual variables
DB_HOST=[project-ref].pooler.supabase.com
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=[your-password]
DB_SSL=true
```

### Environment-Specific Configuration
```bash
# Development
SUPABASE_DB_URL=postgresql://postgres:[dev-password]@[dev-project].pooler.supabase.com:5432/postgres

# Testing
SUPABASE_DB_URL=postgresql://postgres:[test-password]@[test-project].pooler.supabase.com:5432/postgres

# Production
SUPABASE_DB_URL=postgresql://postgres:[prod-password]@[prod-project].pooler.supabase.com:5432/postgres
```

## Common Workflows

### New Developer Setup
```bash
# 1. Clone repository
git clone <repo-url>
cd relationship-care-platform

# 2. Install dependencies
npm install

# 3. Set up environment
cp .env.example .env
# Edit .env with your Supabase configuration

# 4. Start Redis
docker-compose up -d redis

# 5. Start application
npm run dev
```

### Supabase Connection Testing
```bash
# 1. Configure Supabase
export SUPABASE_DB_URL=postgresql://postgres:[password]@[project-ref].pooler.supabase.com:5432/postgres

# 2. Start Redis
docker-compose up -d redis

# 3. Start application
npm run dev

# 4. Verify database connection
curl http://localhost:3001/health/database
```

### Environment Switching
```bash
# Switch to different Supabase project
export SUPABASE_DB_URL=postgresql://postgres:[new-password]@[new-project].pooler.supabase.com:5432/postgres
npm run dev

# Use different environment file
docker-compose --env-file .env.test up -d redis
npm run dev
```

## Troubleshooting

### Supabase Connection Issues
```bash
# Test Supabase connection
psql "postgresql://postgres:[password]@[project-ref].pooler.supabase.com:5432/postgres"

# Check application database configuration
npm run db:status

# Test database connection
npm run db:test-connection
```

### Redis Connection Issues
```bash
# Check Redis status
docker-compose ps redis

# Check Redis logs
docker-compose logs redis

# Test Redis connection
docker-compose exec redis redis-cli ping
```

### Redis Port Conflicts
```bash
# Use different Redis port if needed
# Edit docker-compose.yml:
ports:
  - "6380:6379"  # Redis on 6380

# Update application config accordingly
REDIS_URL=redis://localhost:6380
```

## Performance Optimization

### Development Performance
```bash
# Use SQLite for fastest development
docker-compose up -d redis  # Only Redis needed
npm run dev

# Use tmpfs for PostgreSQL (faster, non-persistent)
docker-compose -f docker-compose.dev.yml up -d
# Add to docker-compose.dev.yml:
# tmpfs:
#   - /var/lib/postgresql/data
```

### Resource Management
```bash
# Limit resource usage
docker-compose up --scale postgres=1 --scale redis=1

# Monitor resource usage
docker stats

# Clean up unused resources
docker system prune
docker volume prune
```

## Production Considerations

### Don't Use Docker PostgreSQL in Production
- Use managed PostgreSQL (Supabase, AWS RDS, etc.)
- Docker PostgreSQL is for development only
- See [Supabase Production Deployment](./supabase-deployment.md)

### Redis in Production
```bash
# Use Redis Cloud or managed Redis
REDIS_URL=redis://your-production-redis.com

# Or configure production Redis container with:
# - Persistent volumes
# - Memory limits
# - Security configuration
# - Backup strategies
```

## Docker Compose Reference

### Available Commands
```bash
# Start services
docker-compose up                    # Default (Redis only)
docker-compose --profile postgres up # Redis + PostgreSQL
docker-compose --profile full up     # All services

# Background mode
docker-compose up -d
docker-compose --profile postgres up -d

# Stop services
docker-compose down                  # Stop all
docker-compose stop postgres        # Stop specific service

# View logs
docker-compose logs                  # All services
docker-compose logs postgres        # Specific service
docker-compose logs -f redis        # Follow logs

# Service management
docker-compose ps                    # List services
docker-compose restart redis        # Restart service
docker-compose exec postgres psql -U postgres  # Execute commands
```

### Environment Files
```bash
# Use different environment files
docker-compose --env-file .env.local up
docker-compose --env-file .env.test --profile postgres up
```

This flexible Docker setup allows developers to choose the right database backend for their needs while maintaining consistency across environments.