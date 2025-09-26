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
  getPool?(): any; // Optional method for PostgreSQL adapter compatibility
}

export type DatabaseType = 'postgresql' | 'supabase';

export interface DatabaseConfig {
  type: DatabaseType;
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
  supabase?: {
    url: string;
    apiKey: string;
    schema?: string;
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