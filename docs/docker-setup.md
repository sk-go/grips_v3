# Docker Setup Guide

This guide explains how to use Docker with the Relationship Care Platform, including the new optional PostgreSQL configuration.

## Overview

The application now supports flexible database backends:
- **SQLite** (default): No Docker services needed for database
- **PostgreSQL** (optional): Use Docker when you need PostgreSQL for testing or development
- **Redis** (required): Always needed for caching and sessions

## Quick Start

### SQLite Development (Recommended)
```bash
# Start only Redis (SQLite is file-based, no container needed)
docker-compose up redis

# Or start in background
docker-compose up -d redis
```

The application will automatically use SQLite at `./data/development.db`.

### PostgreSQL Development
```bash
# Start Redis + PostgreSQL
docker-compose --profile postgres up

# Or start in background
docker-compose --profile postgres up -d

# Alternative: use the full profile
docker-compose --profile full up -d
```

Then set your environment to use PostgreSQL:
```bash
DATABASE_TYPE=postgresql
DB_HOST=localhost
DB_PORT=5432
DB_NAME=relationship_care_platform
DB_USER=postgres
DB_PASSWORD=password
```

## Docker Compose Profiles

### Available Profiles

1. **Default** (no profile): Only Redis
   ```bash
   docker-compose up
   ```

2. **postgres**: Redis + PostgreSQL
   ```bash
   docker-compose --profile postgres up
   ```

3. **full**: All services (Redis + PostgreSQL)
   ```bash
   docker-compose --profile full up
   ```

### Profile Usage Examples

```bash
# Development with SQLite (minimal Docker usage)
docker-compose up redis
npm run dev

# Development with PostgreSQL
docker-compose --profile postgres up -d
DATABASE_TYPE=postgresql npm run dev

# Full development environment
docker-compose --profile full up -d
npm run dev

# Production-like testing
docker-compose --profile full up
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
- **Always Required**: Yes

### PostgreSQL Service (Optional)
- **Image**: postgres:15
- **Port**: 5432
- **Database**: relationship_care_platform
- **User**: postgres
- **Password**: password (dev), password123 (dev.yml)
- **Volume**: Persistent data storage
- **Health Check**: pg_isready
- **Migration Support**: Auto-loads migrations on startup

## Database Configuration

### Automatic Detection
The application automatically detects which database to use:

```bash
# SQLite (default for development)
NODE_ENV=development
# No additional config needed

# PostgreSQL (when Docker is running)
DATABASE_TYPE=postgresql
DB_HOST=localhost
DB_PORT=5432
DB_NAME=relationship_care_platform
DB_USER=postgres
DB_PASSWORD=password
```

### Manual Override
```bash
# Force SQLite even in production
DATABASE_TYPE=sqlite
SQLITE_FILENAME=./data/production.db

# Force PostgreSQL even in development
DATABASE_TYPE=postgresql
DB_HOST=localhost
DB_PORT=5432
# ... other DB config
```

## Common Workflows

### New Developer Setup
```bash
# 1. Clone repository
git clone <repo-url>
cd relationship-care-platform

# 2. Install dependencies
npm install

# 3. Start minimal Docker services
docker-compose up -d redis

# 4. Start application (uses SQLite automatically)
npm run dev
```

### PostgreSQL Testing
```bash
# 1. Start PostgreSQL
docker-compose --profile postgres up -d

# 2. Configure environment
export DATABASE_TYPE=postgresql
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=relationship_care_platform
export DB_USER=postgres
export DB_PASSWORD=password

# 3. Start application
npm run dev

# 4. Verify database type
curl http://localhost:3001/health/database
```

### Switching Between Databases
```bash
# Switch to SQLite
docker-compose down postgres  # Stop PostgreSQL
unset DATABASE_TYPE           # Use default (SQLite)
npm run dev

# Switch to PostgreSQL
docker-compose --profile postgres up -d
export DATABASE_TYPE=postgresql
npm run dev
```

## Troubleshooting

### PostgreSQL Won't Start
```bash
# Check if port is in use
lsof -i :5432

# Check Docker logs
docker-compose logs postgres

# Reset PostgreSQL data
docker-compose down
docker volume rm relationship-care-platform_postgres_data
docker-compose --profile postgres up
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

### Database Connection Errors
```bash
# Check application database configuration
npm run db:status

# Test database connection
npm run db:test-connection

# Check Docker service health
docker-compose ps
```

### Port Conflicts
```bash
# Use different ports if needed
# Edit docker-compose.yml:
ports:
  - "5433:5432"  # PostgreSQL on 5433
  - "6380:6379"  # Redis on 6380

# Update application config accordingly
DB_PORT=5433
REDIS_PORT=6380
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