import { DatabaseConfig, DatabaseType } from '../../types/database';
import { logger } from '../../utils/logger';

export class DatabaseConfigManager {
  private static config: DatabaseConfig | null = null;

  /**
   * Get database configuration based on environment variables
   */
  static getConfig(): DatabaseConfig {
    if (this.config) {
      return this.config;
    }

    const databaseType = this.determineDatabaseType();
    
    if (databaseType === 'sqlite') {
      let filename = process.env.SQLITE_FILENAME;
      const nodeEnv = process.env.NODE_ENV;
      
      // Only provide default in development/test environments
      if (filename === undefined && (nodeEnv === 'development' || nodeEnv === 'test')) {
        filename = './data/development.db';
      }
      
      this.config = {
        type: 'sqlite',
        sqlite: {
          filename: filename || '',
          enableWAL: process.env.SQLITE_WAL === 'true'
        }
      };
    } else {
  // Check for Supabase connection string first
  const supabaseUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  
      if (supabaseUrl) {
        this.config = {
          type: 'postgresql',
          postgresql: this.parseSupabaseConnectionString(supabaseUrl)
        };
      } else {
        this.config = {
          type: 'postgresql',
          postgresql: {
            host: process.env.DB_HOST || '',
            port: parseInt(process.env.DB_PORT || '5432'),
            database: process.env.DB_NAME || '',
            user: process.env.DB_USER || '',
            password: process.env.DB_PASSWORD || '',
            ssl: process.env.DB_SSL === 'true',
            max: parseInt(process.env.DB_POOL_MAX || '20'),
            idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
            connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '2000')
          }
        };
      }
    }

    if (!this.config) {
      throw new Error('Failed to create database configuration');
    }

    this.validateConfig(this.config);
    logger.info('Database configuration loaded', { type: this.config.type });
    
    return this.config;
  }

  /**
   * Determine database type based on environment variables and defaults
   */
  private static determineDatabaseType(): DatabaseType {
    // Explicit override
    const explicitType = process.env.DATABASE_TYPE as DatabaseType;
    if (explicitType) {
      if (!['sqlite', 'postgresql'].includes(explicitType)) {
        throw new Error(`Unsupported database type: ${explicitType}`);
      }
      return explicitType;
    }

    // Environment-based defaults
    const nodeEnv = process.env.NODE_ENV;
    
    if (nodeEnv === 'development' || nodeEnv === 'test') {
      return 'sqlite';
    }
    
    if (nodeEnv === 'production') {
      return 'postgresql';
    }

    // Default fallback
    return 'sqlite';
  }

  /**
   * Parse Supabase connection string into PostgreSQL configuration
   */
  private static parseSupabaseConnectionString(connectionString: string): DatabaseConfig['postgresql'] {
    try {
      const url = new URL(connectionString);
      
      // Validate that this looks like a Supabase URL
      if (!url.hostname.includes('supabase') && !url.hostname.includes('pooler.supabase')) {
        logger.warn('Connection string does not appear to be from Supabase, but will attempt to parse');
      }

      const config: DatabaseConfig['postgresql'] = {
        host: url.hostname,
        port: parseInt(url.port) || 5432,
        database: url.pathname.slice(1), // Remove leading slash
        user: url.username,
        password: url.password,
        ssl: true, // Supabase always uses SSL
        max: parseInt(process.env.DB_POOL_MAX || '20'),
        idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
        connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '10000') // Longer timeout for Supabase
      };

      // Parse additional query parameters if present
      const searchParams = url.searchParams;
      if (searchParams.has('sslmode')) {
        config.ssl = searchParams.get('sslmode') !== 'disable';
      }

      logger.info('Parsed Supabase connection string', {
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        ssl: config.ssl
      });

      return config;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to parse Supabase connection string', { error: errorMessage });
      throw new Error(`Invalid Supabase connection string: ${errorMessage}`);
    }
  }

  /**
   * Validate database configuration format (not required fields)
   */
  private static validateConfig(config: DatabaseConfig): void {
    if (config.type === 'sqlite') {
      // No required field checks here; moved to validateEnvironmentSetup
      // Could add format validation if needed (e.g., check if filename is a valid path)
    } else if (config.type === 'postgresql') {
      const pg = config.postgresql;
      
      if (!pg) {
        throw new Error('Database configuration invalid: PostgreSQL configuration is missing');
      }
      
      // Only validate format and validity of provided values
      if (pg.port && (pg.port < 1 || pg.port > 65535 || isNaN(pg.port) || pg.port % 1 !== 0)) {
        throw new Error('Database configuration invalid: PostgreSQL port must be a valid integer between 1 and 65535');
      }

      // Validate Supabase-specific requirements (warn only for SSL)
      if (pg.host?.includes('supabase')) {
        if (!pg.ssl) {
          logger.warn('Supabase connections should use SSL. Consider setting ssl: true.');
        }
      }
    } else {
      throw new Error(`Database configuration invalid: Unsupported database type: ${config.type}`);
    }
  }

  /**
   * Reset configuration (useful for testing)
   */
  static resetConfig(): void {
    this.config = null;
  }

  /**
   * Get helpful setup instructions based on current configuration
   */
  static getSetupInstructions(): string {
    try {
      const config = this.getConfig();
      
      if (config.type === 'sqlite') {
        return `
SQLite Configuration (Current):
- Database file: ${config.sqlite?.filename}
- WAL mode: ${config.sqlite?.enableWAL ? 'enabled' : 'disabled'}
- Environment: ${process.env.NODE_ENV || 'not set'}

Quick Setup for SQLite Development:
1. Ensure the data directory exists: mkdir -p ./data
2. Set environment variables (optional):
   SQLITE_FILENAME=./data/development.db
   SQLITE_WAL=true

To switch to PostgreSQL, set:
DATABASE_TYPE=postgresql
DB_HOST=your_host
DB_NAME=your_database
DB_USER=your_user
DB_PASSWORD=your_password

For Supabase (recommended for production):
SUPABASE_DB_URL=postgresql://postgres:[password]@[project-ref].pooler.supabase.com:5432/postgres
        `.trim();
      } else {
        const isSupabase = config.postgresql?.host?.includes('supabase') || false;
        
        const troubleshooting = `
Common Issues:
- Connection timeout: Check network connectivity and firewall settings
- Authentication failed: Verify username and password
- SSL errors: For Supabase, SSL is required (automatically enabled)
- Pool exhaustion: Increase DB_POOL_MAX if needed (current: ${config.postgresql?.max || 20})
`;

        const supabaseSection = isSupabase ? `
Supabase Setup (Current Configuration):
1. Go to your Supabase project dashboard
2. Navigate to Settings > Database  
3. Copy the connection string under "Connection pooling"
4. Set SUPABASE_DB_URL environment variable
5. Ensure your IP is whitelisted in Supabase settings

Current Supabase Settings:
- Project: ${config.postgresql?.host?.split('.')[0] || 'unknown'}
- SSL: ${config.postgresql?.ssl ? 'enabled ✓' : 'disabled ⚠️'}
- Pool size: ${config.postgresql?.max || 20}

` : `
For Supabase deployment (recommended):
1. Create a Supabase project at https://supabase.com
2. Get your connection string from Settings > Database
3. Set: SUPABASE_DB_URL=postgresql://postgres:[password]@[project-ref].pooler.supabase.com:5432/postgres

`;

        return `
PostgreSQL Configuration${isSupabase ? ' (Supabase)' : ''}:
- Host: ${config.postgresql?.host}:${config.postgresql?.port}
- Database: ${config.postgresql?.database}
- User: ${config.postgresql?.user}
- SSL: ${config.postgresql?.ssl ? 'enabled ✓' : 'disabled'}
- Pool size: ${config.postgresql?.max || 20}
- Environment: ${process.env.NODE_ENV || 'not set'}

${supabaseSection}${troubleshooting}

To use SQLite for development instead:
DATABASE_TYPE=sqlite
SQLITE_FILENAME=./data/development.db
        `.trim();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return `
Database Configuration Error: ${errorMessage}

Basic Setup Instructions:
1. For development (SQLite):
   NODE_ENV=development
   DATABASE_TYPE=sqlite
   SQLITE_FILENAME=./data/development.db

2. For production (PostgreSQL):
   NODE_ENV=production
   DATABASE_TYPE=postgresql
   DB_HOST=your_host
   DB_NAME=your_database
   DB_USER=your_user
   DB_PASSWORD=your_password

3. For Supabase (recommended):
   SUPABASE_DB_URL=postgresql://postgres:[password]@[project-ref].pooler.supabase.com:5432/postgres

Check your .env file and ensure all required variables are set.
      `.trim();
    }
  }

  /**
   * Validate environment setup and provide specific guidance
   */
  static validateEnvironmentSetup(): { isValid: boolean; errors: string[]; warnings: string[] } {
    return this.validateEnvironmentSetupNew();
  }

  /**
   * New validation method to test if caching is the issue
   */
  static validateEnvironmentSetupNew(): { isValid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const config = this.getConfig();
      
      // Check NODE_ENV
      const nodeEnv = process.env.NODE_ENV;
      if (!nodeEnv) {
        warnings.push('NODE_ENV is not set. Defaulting to SQLite.');
      }

      if (config.type === 'sqlite') {
        // SQLite-specific validation - check actual environment variable
        const envFilename = process.env.SQLITE_FILENAME;
        if (!envFilename || envFilename.trim() === '') {
          errors.push('SQLite filename is required but not provided.');
        } else if (config.sqlite?.filename) {
          // Check if directory exists
          const path = require('path');
          const fs = require('fs');
          const dir = path.dirname(config.sqlite.filename);
          
          try {
            if (!fs.existsSync(dir)) {
              warnings.push(`SQLite directory ${dir} does not exist. It will be created automatically.`);
            }
          } catch (e) {
            warnings.push(`Cannot check SQLite directory: ${e instanceof Error ? e.message : 'Unknown error'}`);
          }
        }

        if (nodeEnv === 'production') {
          warnings.push('Using SQLite in production. Consider PostgreSQL/Supabase for better performance and reliability.');
        }
      } else {
        // PostgreSQL-specific validation
        const hasConnectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
        
        if (!hasConnectionString) {
          if (!process.env.DB_HOST || process.env.DB_HOST.trim() === '') {
            errors.push('PostgreSQL host is required. Set DB_HOST or use SUPABASE_DB_URL.');
          }
          
          if (!process.env.DB_NAME || process.env.DB_NAME.trim() === '') {
            errors.push('PostgreSQL database name is required. Set DB_NAME or use SUPABASE_DB_URL.');
          }
          
          if (!process.env.DB_USER || process.env.DB_USER.trim() === '') {
            errors.push('PostgreSQL user is required. Set DB_USER or use SUPABASE_DB_URL.');
          }

          if (!process.env.DB_PASSWORD || process.env.DB_PASSWORD.trim() === '') {
            errors.push('PostgreSQL password is required. Set DB_PASSWORD or use SUPABASE_DB_URL.');
          }
        }

        const pg = config.postgresql;
        
        // Supabase-specific checks
        if (pg?.host?.includes('supabase')) {
          if (!pg.password || pg.password.trim() === '') {
            errors.push('Supabase connections require a password. Check your SUPABASE_DB_URL or set DB_PASSWORD.');
          }
          
          if (!pg.ssl) {
            errors.push('Supabase connections require SSL. This should be automatically enabled.');
          }
          
          if (pg.port !== 5432) {
            warnings.push(`Supabase typically uses port 5432, but ${pg.port} is configured.`);
          }
        }

        if (nodeEnv === 'development' && !process.env.DATABASE_TYPE) {
          warnings.push('Using PostgreSQL in development. Consider SQLite for easier setup (set DATABASE_TYPE=sqlite).');
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        isValid: false,
        errors: [`Configuration validation failed: ${errorMessage}`],
        warnings: []
      };
    }
  }

  /**
   * Get configuration summary for debugging
   */
  static getConfigSummary(): object {
    try {
      const config = this.getConfig();
      const validation = this.validateEnvironmentSetup();
      
      return {
        type: config.type,
        environment: process.env.NODE_ENV || 'not set',
        explicitType: process.env.DATABASE_TYPE || 'not set',
        validation: {
          isValid: validation.isValid,
          errorCount: validation.errors.length,
          warningCount: validation.warnings.length
        },
        config: config.type === 'sqlite' ? {
          filename: config.sqlite?.filename,
          enableWAL: config.sqlite?.enableWAL
        } : {
          host: config.postgresql?.host,
          port: config.postgresql?.port,
          database: config.postgresql?.database,
          user: config.postgresql?.user,
          ssl: config.postgresql?.ssl,
          isSupabase: config.postgresql?.host?.includes('supabase') || false
        }
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
        environment: process.env.NODE_ENV || 'not set',
        explicitType: process.env.DATABASE_TYPE || 'not set'
      };
    }
  }
}