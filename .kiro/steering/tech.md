# Technology Stack

## Backend Architecture

### Core Framework
- **Runtime**: Node.js 18+
- **Framework**: Express.js with TypeScript
- **Language**: TypeScript (strict mode enabled)
- **Build System**: TypeScript compiler (tsc)

### Database & Storage
- **Primary Database**: Supabase (PostgreSQL 17+) - Cloud-hosted with automatic scaling
- **Connection Methods**: 
  - Supabase Client (URL + API Key) - Recommended for ease of use
  - Direct PostgreSQL connection - For full SQL compatibility
- **Caching**: Redis 6+ (session management, real-time data)
- **File Storage**: Local filesystem with planned cloud migration

### Key Libraries & Services
- **Authentication**: JWT with bcryptjs
- **Real-time**: WebSocket (ws) + Socket.IO
- **Voice Processing**: Browser SpeechRecognition + AssemblyAI fallback
- **AI/NLP**: LangChain, Grok API integration
- **Document Generation**: Jinja2 templates + WeasyPrint (PDF)
- **Communication**: 
  - Email: IMAP/SMTP with OAuth (Gmail, Outlook, Exchange)
  - SMS/WhatsApp/Voice: Twilio integration
- **CRM Integration**: REST APIs for Zoho, Salesforce, HubSpot, AgencyBloc

### Security & Compliance
- **Encryption**: AES-256 at rest, TLS 1.3 in transit
- **Security Headers**: Helmet.js
- **Rate Limiting**: express-rate-limit
- **Input Validation**: Joi schemas
- **Logging**: Winston with structured logging

## Frontend Architecture

### Core Framework
- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **Icons**: Heroicons
- **State Management**: React Context API

### Real-time Features
- **WebSocket Client**: Socket.IO Client
- **Authentication**: JWT with localStorage
- **Connection Management**: Automatic reconnection with exponential backoff

## Development Tools

### Code Quality
- **Linting**: ESLint with TypeScript rules
- **Testing**: Jest with ts-jest
- **Type Checking**: TypeScript strict mode

### Development Workflow
- **Dev Server**: nodemon for backend hot reload
- **Frontend Dev**: Next.js with Turbopack
- **Environment**: dotenv for configuration

## Common Commands

### Backend Development
```bash
# Development
npm run dev              # Start development server with hot reload
npm run build           # Build TypeScript to JavaScript
npm start              # Start production server

# Testing & Quality
npm test               # Run Jest tests
npm run test:watch     # Run tests in watch mode
npm run lint           # Run ESLint
npm run lint:fix       # Fix ESLint issues automatically
```

### Frontend Development
```bash
# Navigate to frontend directory first
cd frontend

# Development
npm run dev            # Start Next.js dev server with Turbopack
npm run build          # Build for production
npm start             # Start production server
npm run lint          # Run ESLint
```

### Database & Infrastructure
```bash
# Start local services (Redis only - Supabase is cloud-hosted)
docker-compose up -d redis   # Start Redis only

# Supabase setup (no local database needed)
# 1. Create Supabase project at https://supabase.com
# 2. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
# 3. Migrations run automatically on server start
```

## Environment Configuration

### Required Environment Variables
- **Supabase Configuration** (choose one):
  - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (recommended)
  - `SUPABASE_DB_URL` (direct PostgreSQL connection)
- `REDIS_URL`: Redis connection string  
- `JWT_SECRET`: JWT signing secret
- `GROK_API_KEY`: AI service API key
- Email OAuth credentials (Gmail, Outlook, Exchange)
- Twilio credentials for SMS/voice
- CRM API credentials

### Performance Targets
- UI Response: <500ms (including CRM API calls)
- Voice Processing: <1.5s end-to-end latency
- Concurrent Users: 100 agents
- Uptime: >99.9%

## Architecture Patterns

### Service-Oriented Design
- Modular services with clear boundaries
- Dependency injection for testability
- Event-driven communication between services

### Caching Strategy
- Redis for session data and real-time context
- In-memory caching for frequently accessed CRM data
- Cache invalidation on CRM updates

### Error Handling
- Centralized error middleware
- Structured logging with correlation IDs
- Graceful degradation for external service failures