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

**Database**: The application automatically uses SQLite for development (no setup required) and PostgreSQL for production.

## Quick Start (Development)

1. Clone the repository:
```bash
git clone <repository-url>
cd relationship-care-platform
```

2. Set up development environment:
```bash
npm install
npm run setup:dev
```

3. Start the application:
```bash
npm run dev
```

That's it! The application will automatically:
- Create a SQLite database at `./data/development.db`
- Run all migrations to set up the schema
- Be ready for development at `http://localhost:3000`

## Production Setup

For production deployment, you'll need PostgreSQL:

1. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your PostgreSQL/Supabase configuration
```

2. Configure database:
```bash
# Option 1: Use Supabase (recommended)
SUPABASE_DB_URL=postgresql://postgres:[password]@[project-ref].pooler.supabase.com:5432/postgres

# Option 2: Use your own PostgreSQL
DATABASE_TYPE=postgresql
DB_HOST=your-host
DB_NAME=relationship_care_platform
DB_USER=your-user
DB_PASSWORD=your-password
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

The application supports flexible database backends:

### Development (SQLite)
- **Automatic**: Uses SQLite by default in development
- **No setup required**: Database file created automatically
- **Location**: `./data/development.db`
- **Benefits**: No server setup, no authentication, portable

### Production (PostgreSQL)
- **Supabase** (recommended): Managed PostgreSQL with built-in features
- **Self-hosted**: Your own PostgreSQL instance
- **Benefits**: Full concurrent access, production-ready, scalable

### Configuration Examples

**Development (automatic)**:
```bash
NODE_ENV=development
# SQLite used automatically, no additional config needed
```

**Production with Supabase**:
```bash
NODE_ENV=production
SUPABASE_DB_URL=postgresql://postgres:[password]@[project-ref].pooler.supabase.com:5432/postgres
```

**Production with PostgreSQL**:
```bash
NODE_ENV=production
DATABASE_TYPE=postgresql
DB_HOST=localhost
DB_NAME=relationship_care_platform
DB_USER=username
DB_PASSWORD=password
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

# Data Migration
npm run db:export           # Export SQLite data for migration

# Docker Services
npm run docker:dev          # Start Redis only (SQLite development)
npm run docker:dev:postgres # Start Redis + PostgreSQL
npm run docker:dev:full     # Start all services
npm run docker:stop         # Stop all Docker services
```

For detailed setup instructions, see [docs/database-setup.md](docs/database-setup.md).

## Docker Development

The application supports flexible Docker configurations:

### SQLite Development (Minimal Docker)
```bash
# Start only Redis (SQLite is file-based)
npm run docker:dev
# or
docker-compose up -d redis

npm run dev  # Uses SQLite automatically
```

### PostgreSQL Development
```bash
# Start Redis + PostgreSQL
npm run docker:dev:postgres
# or
docker-compose --profile postgres up -d

# Configure environment for PostgreSQL
export DATABASE_TYPE=postgresql
npm run dev
```

### Full Development Environment
```bash
# Start all services
npm run docker:dev:full
# or
docker-compose --profile full up -d

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
| `DATABASE_TYPE` | Database type (sqlite/postgresql) | Auto-detected |
| `SQLITE_FILENAME` | SQLite database file path | `./data/development.db` |
| `SQLITE_WAL` | Enable SQLite WAL mode | `true` |
| `SUPABASE_DB_URL` | Supabase connection string | - |
| `DB_HOST` | PostgreSQL host | `localhost` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_NAME` | PostgreSQL database name | - |
| `DB_USER` | PostgreSQL username | - |
| `DB_PASSWORD` | PostgreSQL password | - |

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