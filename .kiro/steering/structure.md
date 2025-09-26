# Project Structure

## Repository Organization

This is a monorepo containing both backend (Node.js/Express) and frontend (Next.js) applications with shared configuration and documentation.

## Root Directory Structure

```
├── src/                    # Backend source code
├── frontend/              # Next.js frontend application
├── dist/                  # Compiled backend JavaScript (build output)
├── logs/                  # Application logs
├── node_modules/          # Backend dependencies
├── .kiro/                 # Kiro AI assistant configuration
├── .vscode/               # VS Code workspace settings
├── docker-compose.yml     # Local development services
├── package.json           # Backend dependencies and scripts
├── tsconfig.json          # Backend TypeScript configuration
└── README.md              # Project documentation
```

## Backend Structure (`src/`)

### Core Application Files
- `server.ts` - Main application entry point and server setup
- `types/` - TypeScript type definitions and interfaces

### Feature-Based Organization
```
src/
├── components/            # Reusable UI components (charts, visualizations)
├── database/             # Database migrations and schema
├── docs/                 # Technical documentation
├── examples/             # Demo scripts and usage examples
├── middleware/           # Express middleware (auth, error handling, rate limiting)
├── routes/               # API route handlers organized by feature
├── scripts/              # Utility and maintenance scripts
├── services/             # Business logic services
├── test/                 # Test files (unit, integration)
├── types/                # TypeScript definitions
└── utils/                # Shared utility functions
```

### Services Architecture
Services are organized by domain with clear separation of concerns:

```
services/
├── aiActions/            # AI-powered action execution and workflows
├── agentic/              # Multi-step AI workflow orchestration
├── auth.ts               # Authentication service
├── cacheService.ts       # Redis caching abstraction
├── clientProfile/        # Client relationship management
├── communication/        # Unified communication center
├── crm/                  # CRM integration connectors
├── database/             # Database service with Supabase support
├── documents/            # Document generation and templates
├── email/                # Email integration (IMAP/SMTP/OAuth)
├── nlp/                  # Natural language processing
├── redis.ts              # Redis connection service
├── twilio/               # SMS and voice communication
└── voice/                # Voice processing and WebSocket handling
```

## Frontend Structure (`frontend/`)

### Next.js App Router Structure
```
frontend/
├── src/
│   ├── app/              # Next.js App Router pages
│   │   ├── layout.tsx    # Root layout with providers
│   │   ├── page.tsx      # Dashboard/home page
│   │   ├── ai/           # AI assistant interface
│   │   ├── communications/ # Communication center
│   │   ├── clients/      # Client management
│   │   ├── documents/    # Document generation
│   │   └── settings/     # System configuration
│   ├── components/       # Reusable React components
│   │   ├── Layout.tsx    # Main application layout
│   │   ├── Navigation.tsx # Sidebar navigation
│   │   ├── ai/           # AI-specific components
│   │   ├── clients/      # Client-related components
│   │   └── communications/ # Communication components
│   ├── contexts/         # React Context providers
│   │   ├── AuthContext.tsx # Authentication state
│   │   └── WebSocketContext.tsx # Real-time connection
│   ├── lib/              # Utility libraries
│   │   ├── auth.ts       # Authentication helpers
│   │   ├── websocket.ts  # WebSocket client
│   │   └── utils.ts      # Shared utilities
│   └── types/            # Frontend TypeScript definitions
├── public/               # Static assets
├── package.json          # Frontend dependencies
├── next.config.ts        # Next.js configuration
├── tailwind.config.js    # Tailwind CSS configuration
└── tsconfig.json         # Frontend TypeScript configuration
```

## Configuration Files

### Development & Build
- `nodemon.json` - Backend development server configuration
- `jest.config.js` - Test runner configuration
- `.eslintrc.js` - Code linting rules
- `.env.example` - Environment variable template

### Kiro AI Assistant
- `.kiro/steering/` - AI assistant guidance documents
- `.kiro/specs/` - Feature specifications and requirements

## Naming Conventions

### Files & Directories
- **Services**: camelCase (e.g., `emailIntegrationService.ts`)
- **Components**: PascalCase (e.g., `CommunicationCenter.tsx`)
- **Routes**: kebab-case for URLs, camelCase for files
- **Types**: PascalCase interfaces, camelCase for type files
- **Tests**: Match source file name with `.test.ts` suffix

### Code Organization
- **Barrel Exports**: Use `index.ts` files for clean imports
- **Feature Grouping**: Group related functionality in directories
- **Separation of Concerns**: Keep business logic in services, UI logic in components
- **Type Safety**: Comprehensive TypeScript coverage with strict mode

## Import Patterns

### Backend
```typescript
// Absolute imports from src root
import { DatabaseService } from './services/database';
import { AuthMiddleware } from './middleware/auth';
import type { CommunicationMessage } from './types/communication';
```

### Frontend
```typescript
// Relative imports for local components
import { AuthContext } from '../contexts/AuthContext';
import type { ClientProfile } from '../types/client';
```

## Testing Structure

Tests mirror the source structure with dedicated test directories:
- Unit tests alongside source files
- Integration tests in `src/test/integration/`
- Component tests in `frontend/src/components/__tests__/`
- Mock implementations in `src/services/*/mocks/`

## Database Organization

- **Migrations**: Sequential numbered SQL files in `src/database/migrations/`
- **Schema**: Auto-generated from migrations on application startup
- **Adapters**: Support for both Supabase client and direct PostgreSQL connections
- **Configuration**: Automatic Supabase detection and SSL handling
- **Seeding**: Example data and demos in `src/examples/`