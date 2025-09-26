/**
 * Supabase Test Setup Utilities
 * Provides helper functions for setting up Supabase test environment
 */

export interface SupabaseTestConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

/**
 * Get Supabase test configuration from environment variables
 */
export function getSupabaseTestConfig(): SupabaseTestConfig | null {
  // Check for test database configuration
  if (process.env.TEST_DB_HOST || process.env.CI || process.env.SUPABASE_DB_URL) {
    return {
      host: process.env.TEST_DB_HOST || 'localhost',
      port: parseInt(process.env.TEST_DB_PORT || '5432'),
      database: process.env.TEST_DB_NAME || 'test_db',
      user: process.env.TEST_DB_USER || 'postgres',
      password: process.env.TEST_DB_PASSWORD || 'password',
      ssl: process.env.TEST_DB_SSL !== 'false'
    };
  }
  
  return null;
}

/**
 * Check if Supabase test environment is available
 */
export function isSupabaseTestAvailable(): boolean {
  return getSupabaseTestConfig() !== null;
}

/**
 * Skip test if Supabase test environment is not available
 */
export function skipIfNoSupabaseTest(): void {
  if (!isSupabaseTestAvailable()) {
    console.log('Skipping Supabase test - no test database configured');
    return;
  }
}

/**
 * Get Supabase connection string for testing
 */
export function getSupabaseTestConnectionString(): string | null {
  if (process.env.SUPABASE_DB_URL) {
    return process.env.SUPABASE_DB_URL;
  }
  
  const config = getSupabaseTestConfig();
  if (!config) {
    return null;
  }
  
  return `postgresql://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`;
}

/**
 * Setup environment variables for Supabase testing
 */
export function setupSupabaseTestEnvironment(): void {
  const connectionString = getSupabaseTestConnectionString();
  if (connectionString) {
    process.env.SUPABASE_DB_URL = connectionString;
  }
}

/**
 * Clean up test environment
 */
export function cleanupSupabaseTestEnvironment(): void {
  delete process.env.SUPABASE_DB_URL;
  delete process.env.DATABASE_URL;
}