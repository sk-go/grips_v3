/**
 * Database abstraction layer exports - Supabase/PostgreSQL only
 */

export { DatabaseService } from './DatabaseService';
export { DatabaseConfigManager } from './config';
export { BaseAdapter } from './adapters/BaseAdapter';
export { PostgreSQLAdapter } from './adapters/PostgreSQLAdapter';
// export { SupabaseAdapter } from './adapters/SupabaseAdapter'; // Temporarily disabled
export { MigrationRunner } from './MigrationRunner';

// Types
export type {
  DatabaseAdapter,
  DatabaseClient,
  QueryResult,
  DatabaseConfig,
  DatabaseType,
  MigrationRecord,
  DatabaseError
} from '../../types/database';