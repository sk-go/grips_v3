/**
 * Database adapter interface and base types for the database abstraction layer
 */

export interface QueryResult {
  rows: any[];
  rowCount: number;
  fields?: any[];
}

export interface DatabaseClient {
  query(text: string, params?: any[]): Promise<QueryResult>;
  release?(): void;
}

export interface DatabaseAdapter {
  initialize(): Promise<void>;
  query(text: string, params?: any[]): Promise<QueryResult>;
  getClient(): Promise<DatabaseClient>;
  close(): Promise<void>;
  runMigrations(): Promise<void>;
}

export type DatabaseType = 'sqlite' | 'postgresql';

export interface DatabaseConfig {
  type: DatabaseType;
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
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
  };
}

export interface MigrationRecord {
  id: string;
  filename: string;
  executed_at: Date;
  checksum: string;
}

export interface DatabaseError extends Error {
  code?: string;
  detail?: string;
  constraint?: string;
}