/**
 * Database abstraction layer exports
 */

export { DatabaseService } from './DatabaseService';
export { DatabaseConfigManager } from './config';
export { BaseAdapter } from './adapters/BaseAdapter';

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