# Relationship Care Platform

AI-powered relationship management platform for insurance agents that provides a unified communication center, AI interaction system, and CRM enhancement layer.

## Features

- **Unified Communication Center**: Aggregate emails, calls, and SMS from multiple channels
- **AI-Powered Assistant**: Real-time voice AI with context awareness and task automation
- **Relationship Enhancement**: CRM overlay with insights and relationship mapping
- **Document Generation**: Automated document creation using templates
- **Security & Compliance**: GDPR/HIPAA compliant with comprehensive audit logging

## Prerequisites

- Node.js 18+ 
- Redis 6+ (for caching and real-time features)
- npm or yarn
- Docker (optional, for PostgreSQL development)

**Database**: The application uses Supabase (PostgreSQL) for all environments including development, testing, and production.

## Quick Start (Development)

1. Clone the repository:
```bash
git clone <repository-url>
cd relationship-care-platform
```

2. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your Supabase configuration
```

3. Configure Supabase connection (choose one approach):

**Option A: Supabase Client (Recommended)**
```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

**Option B: Direct PostgreSQL Connection**
```bash
SUPABASE_DB_URL=postgresql://postgres:[password]@[project-ref].pooler.supabase.com:5432/postgres
```

4. Install dependencies and start:
```bash
npm install
npm run dev
```

The application will automatically:
- Connect to your Supabase database
- Run all migrations to set up the schema
- Be ready for development at `http://localhost:3000`

## Production Setup

For production deployment:

1. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your Supabase configuration
```

2. Configure Supabase database:
```bash
SUPABASE_DB_URL=postgresql://postgres:[password]@[project-ref].pooler.supabase.com:5432/postgres
```

3. Set up Redis:
```bash
# Make sure Redis is running on localhost:6379
# Or update REDIS_URL in .env
```

## Development

Start the development server:
```bash
npm run dev
```

The server will start on `http://localhost:3000` (or the port specified in your .env file).

## Database Configuration

The application uses Supabase (PostgreSQL) for all environments:

### Supabase Configuration
- **Managed PostgreSQL**: Built-in features and scalability
- **All Environments**: Development, testing, and production
- **Benefits**: Full concurrent access, production-ready, real-time features

### Configuration Examples

**Development with Supabase**:
```bash
NODE_ENV=development
SUPABASE_DB_URL=postgresql://postgres:[dev-password]@[dev-project-ref].pooler.supabase.com:5432/postgres
```

**Production with Supabase**:
```bash
NODE_ENV=production
SUPABASE_DB_URL=postgresql://postgres:[password]@[project-ref].pooler.supabase.com:5432/postgres
```

**Alternative PostgreSQL Configuration**:
```bash
DB_HOST=your-project-ref.pooler.supabase.com
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=your-password
DB_SSL=true
```

### Database Commands
```bash
# Setup and Configuration
npm run setup:dev           # Set up development environment
npm run db:status           # Check database configuration
npm run db:validate         # Validate current configuration
npm run db:test-connection  # Test database connection

# Database Management
npm run db:init             # Initialize database with schema
npm run db:reset            # Reset database (deletes all data)
npm run db:migrate          # Run pending migrations
npm run db:health           # Comprehensive health check

# Database Inspection
npm run db:inspect          # Full database inspection report
npm run db:inspect:table    # Inspect specific table (usage: npm run db:inspect:table users)
npm run db:inspect:json     # Get inspection data as JSON

# Data Management
npm run db:backup           # Backup database data

# Docker Services
npm run docker:dev          # Start Redis for development
npm run docker:stop         # Stop all Docker services
```

For detailed setup instructions, see [docs/database-setup.md](docs/database-setup.md).

## Docker Development

The application uses Docker for Redis caching:

### Development Setup
```bash
# Start Redis for caching
npm run docker:dev
# or
docker-compose up -d redis

# Configure Supabase connection
export SUPABASE_DB_URL=postgresql://postgres:[password]@[project-ref].pooler.supabase.com:5432/postgres

npm run dev
```

For detailed Docker setup instructions, see [docs/docker-setup.md](docs/docker-setup.md).

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout user
- `GET /api/auth/me` - Get current user profile
- `GET /api/auth/verify` - Verify token

### Health Checks
- `GET /api/health` - Basic health check
- `GET /api/health/detailed` - Detailed health check with dependencies
- `GET /api/health/ready` - Readiness probe
- `GET /api/health/live` - Liveness probe

## Environment Variables

### Core Configuration
| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment (development/production) | `development` |
| `JWT_SECRET` | JWT signing secret | - |
| `JWT_EXPIRES_IN` | JWT expiration time | `24h` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |

### Database Configuration
| Variable | Description | Default |
|----------|-------------|---------|
| `SUPABASE_DB_URL` | Supabase connection string | - |
| `DB_HOST` | PostgreSQL host | `localhost` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_NAME` | PostgreSQL database name | `postgres` |
| `DB_USER` | PostgreSQL username | `postgres` |
| `DB_PASSWORD` | PostgreSQL password | - |
| `DB_SSL` | Enable SSL connection | `true` |
| `DB_POOL_MAX` | Maximum connection pool size | `20` |

### Rate Limiting
| Variable | Description | Default |
|----------|-------------|---------|
| `RATE_LIMIT_WINDOW_MS` | Rate limit window | `900000` |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window | `100` |

## Testing

Run tests:
```bash
npm test
```

Run tests in watch mode:
```bash
npm run test:watch
```

## Linting

Run ESLint:
```bash
npm run lint
```

Fix linting issues:
```bash
npm run lint:fix
```

## Building

Build for production:
```bash
npm run build
```

Start production server:
```bash
npm start
```

## Architecture

The application follows a microservices-inspired architecture with:

- **Express.js** server with TypeScript
- **PostgreSQL** for structured data storage
- **Redis** for caching and session management
- **JWT** for authentication
- **WebSocket** for real-time AI interactions
- **Rate limiting** and security middleware

## Security Features

- JWT-based authentication with refresh tokens
- Rate limiting on all endpoints
- Input validation with Joi
- SQL injection prevention
- CORS protection
- Helmet security headers
- Comprehensive audit logging

## License

MIT License