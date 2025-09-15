# Design Document

## Overview

This design implements a flexible database abstraction layer that supports both SQLite for local development and PostgreSQL/Supabase for production. The solution maintains backward compatibility with existing code while eliminating PostgreSQL setup friction for developers.

## Architecture

### Database Adapter Pattern

The core architecture uses an adapter pattern to abstract database operations:

```
Application Layer
       ↓
Database Service (Facade)
       ↓
Database Adapter Interface
       ↓
┌─────────────────┬─────────────────┐
│  SQLite Adapter │ PostgreSQL Adapter │
└─────────────────┴─────────────────┘
```

### Configuration Strategy

Environment-based configuration with explicit overrides:
- `NODE_ENV=development` → SQLite (default)
- `NODE_ENV=production` → PostgreSQL/Supabase (default)
- `DATABASE_TYPE` environment variable overrides defaults

## Components and Interfaces

### 1. Database Adapter Interface

```typescript
interface DatabaseAdapter {
  initialize(): Promise<void>;
  query(text: string, params?: any[]): Promise<QueryResult>;
  getClient(): Promise<DatabaseClient>;
  close(): Promise<void>;
  runMigrations(): Promise<void>;
}
```

### 2. SQLite Adapter

**Key Features:**
- File-based database (`./data/development.db`)
- Automatic database creation
- Migration compatibility layer
- No authentication required

**Dependencies:**
- `sqlite3` - Core SQLite driver
- `better-sqlite3` - Performance-optimized alternative

### 3. PostgreSQL Adapter

**Key Features:**
- Connection pooling (existing implementation)
- Supabase connection string support
- SSL handling for production
- Migration execution

**Dependencies:**
- `pg` - Existing PostgreSQL driver

### 4. Migration Compatibility Layer

**SQL Translation Rules:**
- `UUID` → `TEXT` (SQLite doesn't have native UUID)
- `gen_random_uuid()` → Custom UUID generation
- `JSONB` → `TEXT` with JSON validation
- `TIMESTAMP WITH TIME ZONE` → `DATETIME`
- Array types → JSON serialization

## Data Models

### Configuration Schema

```typescript
interface DatabaseConfig {
  type: 'sqlite' | 'postgresql';
  sqlite?: {
    filename: string;
    enableWAL?: boolean;
  };
  postgresql?: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl?: boolean;
  };
}
```

### Migration Metadata

```typescript
interface MigrationRecord {
  id: string;
  filename: string;
  executed_at: Date;
  checksum: string;
}
```

## Error Handling

### Connection Failures
- SQLite: File permission errors, disk space issues
- PostgreSQL: Network connectivity, authentication failures
- Supabase: API key validation, SSL certificate issues

### Migration Errors
- Syntax incompatibility detection
- Rollback strategies for failed migrations
- Clear error messages with suggested fixes

### Fallback Strategies
- Development: Fall back to in-memory SQLite if file creation fails
- Production: Retry connection with exponential backoff
- Configuration validation with helpful error messages

## Testing Strategy

### Unit Tests
- Database adapter implementations
- SQL translation layer
- Configuration parsing and validation
- Migration execution logic

### Integration Tests
- End-to-end database operations
- Migration compatibility across databases
- Connection pooling and cleanup
- Error handling scenarios

### Development Workflow Tests
- Fresh project setup with SQLite
- Migration from SQLite to PostgreSQL
- Supabase deployment scenarios

## Implementation Phases

### Phase 1: Core Abstraction
1. Create database adapter interface
2. Implement SQLite adapter
3. Refactor existing PostgreSQL adapter
4. Update database service facade

### Phase 2: Migration Compatibility
1. Implement SQL translation layer
2. Create migration runner
3. Test existing migrations with SQLite
4. Handle edge cases and incompatibilities

### Phase 3: Configuration & Environment
1. Environment-based configuration
2. Supabase connection support
3. Development tooling improvements
4. Documentation and examples

### Phase 4: Production Readiness
1. Performance optimization
2. Monitoring and logging
3. Deployment guides
4. Migration tools for existing data

## Security Considerations

### SQLite Security
- File permissions for database files
- No network exposure by default
- Local development isolation

### PostgreSQL/Supabase Security
- SSL/TLS encryption in transit
- Connection string security
- Environment variable protection
- Audit logging preservation

## Performance Implications

### SQLite Performance
- Single-writer limitation (acceptable for development)
- WAL mode for better concurrency
- In-memory option for testing

### PostgreSQL Performance
- Existing connection pooling maintained
- Query optimization unchanged
- Supabase managed performance benefits

## Migration Strategy

### Existing Data
- Export utility for SQLite → PostgreSQL
- Schema validation tools
- Data integrity verification

### Development Workflow
- Automatic SQLite setup for new developers
- Clear migration path to production
- Rollback procedures for issues