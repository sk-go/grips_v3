# Design Document

## Overview

This design outlines the migration from a dual-database architecture (SQLite + PostgreSQL/Supabase) to a Supabase-only architecture. The goal is to simplify the codebase by removing SQLite dependencies and standardizing on Supabase for all environments including development, testing, and production.

## Architecture

### Current Architecture (Before Migration)

```
Application Layer
       ↓
DatabaseService (Facade)
       ↓
┌─────────────────┬─────────────────┐
│  SQLite Adapter │ PostgreSQL Adapter │
│  (Development)  │   (Production)    │
└─────────────────┴─────────────────┘
       ↓                    ↓
   SQLite File         Supabase Cloud
```

### Target Architecture (After Migration)

```
Application Layer
       ↓
DatabaseService (Simplified)
       ↓
PostgreSQL Adapter (Only)
       ↓
   Supabase Cloud
```

## Components and Interfaces

### 1. Simplified DatabaseService

The DatabaseService will be refactored to remove adapter selection logic and directly use the PostgreSQL adapter:

```typescript
export class DatabaseService {
  private static adapter: PostgreSQLAdapter | null = null;
  
  static async initialize(): Promise<void> {
    const config = DatabaseConfigManager.getConfig();
    this.adapter = new PostgreSQLAdapter(config.postgresql!);
    await this.adapter.initialize();
    await this.adapter.runMigrations();
  }
  
  // Direct delegation to PostgreSQL adapter
  static async query(text: string, params?: any[]): Promise<QueryResult> {
    return this.adapter!.query(text, params);
  }
}
```

### 2. Simplified Configuration Management

The DatabaseConfigManager will be streamlined to only handle Supabase/PostgreSQL configuration:

```typescript
export class DatabaseConfigManager {
  static getConfig(): DatabaseConfig {
    // Only PostgreSQL configuration logic
    const supabaseUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
    
    if (supabaseUrl) {
      return {
        type: 'postgresql',
        postgresql: this.parseSupabaseConnectionString(supabaseUrl)
      };
    }
    
    // Fallback to individual PostgreSQL environment variables
    return {
      type: 'postgresql',
      postgresql: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'relationship_care',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        ssl: process.env.DB_SSL !== 'false', // Default to true for Supabase
        max: parseInt(process.env.DB_POOL_MAX || '20'),
        idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
        connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '10000')
      }
    };
  }
}
```

### 3. Updated Type Definitions

The database types will be simplified to remove SQLite-specific interfaces:

```typescript
export interface DatabaseConfig {
  type: 'postgresql'; // Only PostgreSQL supported
  postgresql: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl: boolean;
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
  };
}

export type DatabaseType = 'postgresql'; // Simplified enum
```

## Data Models

### Environment Configuration

The application will use these environment variables for Supabase connection:

**Primary Configuration (Recommended):**
```bash
SUPABASE_DB_URL=postgresql://postgres:[password]@[project-ref].pooler.supabase.com:5432/postgres
```

**Alternative Configuration:**
```bash
DB_HOST=[project-ref].pooler.supabase.com
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=[your-password]
DB_SSL=true
```

**Development Environment:**
```bash
# Use Supabase development project
SUPABASE_DB_URL=postgresql://postgres:[dev-password]@[dev-project-ref].pooler.supabase.com:5432/postgres
NODE_ENV=development
```

**Test Environment:**
```bash
# Use separate Supabase test project or database
SUPABASE_DB_URL=postgresql://postgres:[test-password]@[test-project-ref].pooler.supabase.com:5432/postgres
NODE_ENV=test
```

## Error Handling

### Connection Error Management

Enhanced error handling for Supabase-specific issues:

```typescript
private async validateConnection(): Promise<void> {
  try {
    const client = await this.pool.connect();
    await client.query('SELECT NOW()');
    client.release();
  } catch (error) {
    const err = error as any;
    
    // Supabase-specific error handling
    if (err.code === 'ENOTFOUND' && this.config.host?.includes('supabase')) {
      throw new Error(`Supabase project not found. Check your SUPABASE_DB_URL project reference.`);
    }
    
    if (err.code === '28P01' && this.config.host?.includes('supabase')) {
      throw new Error(`Supabase authentication failed. Verify your database password in SUPABASE_DB_URL.`);
    }
    
    throw error;
  }
}
```

### Migration Error Handling

All migrations will be validated for PostgreSQL compatibility:

```typescript
async executeMigrationSQL(migrationSQL: string): Promise<void> {
  // Remove SQLite compatibility layer
  // Execute PostgreSQL SQL directly
  const statements = migrationSQL
    .split(';')
    .map(stmt => stmt.trim())
    .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
  
  for (const statement of statements) {
    await this.pool.query(statement);
  }
}
```

## Testing Strategy

### Test Database Setup

Tests will use a dedicated Supabase test project or database:

```typescript
// Test configuration
beforeAll(async () => {
  process.env.SUPABASE_DB_URL = 'postgresql://postgres:[test-password]@[test-project].pooler.supabase.com:5432/postgres';
  await DatabaseService.initialize();
});

afterAll(async () => {
  await DatabaseService.close();
});

beforeEach(async () => {
  // Clean test data
  await DatabaseService.query('TRUNCATE TABLE users, clients, communications, tasks, ai_actions, audit_logs CASCADE');
});
```

### Migration Testing

All existing migrations will be tested against Supabase:

```typescript
describe('Migration Compatibility', () => {
  test('all migrations run successfully on Supabase', async () => {
    await DatabaseService.runMigrations();
    
    // Verify schema exists
    const tables = await DatabaseService.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    expect(tables.rows.length).toBeGreaterThan(0);
  });
});
```

## Implementation Plan

### Phase 1: Remove SQLite Dependencies

1. **Remove SQLite packages from package.json**
   - Remove `better-sqlite3` and `@types/better-sqlite3`
   - Update package scripts to remove SQLite references

2. **Delete SQLite-related files**
   - Remove `src/services/database/adapters/SQLiteAdapter.ts`
   - Remove `src/services/database/adapters/SQLCompatibilityLayer.ts`
   - Remove SQLite-specific test files

### Phase 2: Simplify Database Configuration

1. **Update DatabaseConfigManager**
   - Remove SQLite configuration logic
   - Remove environment-based database type detection
   - Simplify to PostgreSQL/Supabase only

2. **Update DatabaseService**
   - Remove adapter selection logic
   - Direct instantiation of PostgreSQL adapter
   - Remove SQLite-specific methods

### Phase 3: Update Type Definitions

1. **Simplify database types**
   - Remove SQLite from DatabaseType enum
   - Remove sqlite configuration from DatabaseConfig
   - Update all type references

### Phase 4: Update Documentation and Scripts

1. **Update environment configuration**
   - Modify `.env.example` to show only Supabase configuration
   - Update README.md to remove SQLite references
   - Update setup scripts

2. **Update database scripts**
   - Remove `exportSQLiteData.ts` script
   - Update health check to remove SQLite logic
   - Modify Docker configurations

### Phase 5: Test Migration

1. **Update all tests**
   - Configure tests to use Supabase test database
   - Remove SQLite-specific test cases
   - Verify all integration tests pass

2. **Validate migrations**
   - Ensure all existing migrations work with PostgreSQL
   - Test schema creation and data operations
   - Verify performance and connection pooling

## Migration Considerations

### Data Migration

For existing SQLite databases, provide a one-time migration script:

```typescript
// Migration utility (temporary)
export async function migrateSQLiteToSupabase(
  sqliteFile: string, 
  supabaseUrl: string
): Promise<void> {
  // Read SQLite data
  // Transform to PostgreSQL format
  // Insert into Supabase
  // Verify data integrity
}
```

### Rollback Strategy

If issues arise, the rollback process involves:

1. Restore SQLite adapter files from git history
2. Restore SQLite dependencies in package.json
3. Update configuration to re-enable SQLite for development
4. Restore environment-based database selection

### Performance Considerations

- **Connection Pooling**: Supabase handles connection pooling automatically
- **SSL Overhead**: Minimal impact with modern TLS implementations
- **Network Latency**: Consider Supabase region selection for optimal performance
- **Connection Limits**: Monitor Supabase connection usage and adjust pool size

## Security Implications

### Connection Security

- All connections to Supabase use SSL/TLS encryption
- Database passwords stored in environment variables only
- No local database files to secure

### Access Control

- Leverage Supabase Row Level Security (RLS) policies
- Use Supabase service role for backend operations
- Implement proper user authentication through Supabase Auth (future enhancement)

## Monitoring and Observability

### Health Checks

Simplified health check focusing on Supabase connectivity:

```typescript
static async healthCheck(): Promise<HealthStatus> {
  try {
    const result = await this.query('SELECT NOW() as timestamp, version() as version');
    return {
      status: 'healthy',
      database: {
        type: 'postgresql',
        host: this.config.postgresql.host,
        connected: true,
        version: result.rows[0].version,
        timestamp: result.rows[0].timestamp
      }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message
    };
  }
}
```

### Logging

Enhanced logging for Supabase operations:

```typescript
logger.info('Supabase connection established', {
  project: this.config.postgresql.host.split('.')[0],
  database: this.config.postgresql.database,
  ssl: this.config.postgresql.ssl,
  poolSize: this.config.postgresql.max
});
```