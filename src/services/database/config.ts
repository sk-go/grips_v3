import { DatabaseConfig } from '../../types/database';
import { logger } from '../../utils/logger';

export class DatabaseConfigManager {
  private static config: DatabaseConfig | null = null;

  /**
   * Get database configuration based on environment variables
   * Only supports PostgreSQL/Supabase configuration
   */
  static getConfig(): DatabaseConfig {
    if (this.config) {
      return this.config;
    }

    // Check for Supabase client configuration first (URL + API Key)
    const supabaseProjectUrl = process.env.SUPABASE_URL;
    const supabaseApiKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (supabaseProjectUrl && supabaseApiKey) {
      this.config = {
        type: 'supabase',
        supabase: {
          url: supabaseProjectUrl,
          apiKey: supabaseApiKey,
          schema: process.env.SUPABASE_SCHEMA || 'public'
        }
      };
    } else {
      // Check for Supabase connection string
      const supabaseUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
      
      if (supabaseUrl) {
        this.config = {
          type: 'postgresql',
          postgresql: this.parseSupabaseConnectionString(supabaseUrl)
        };
      } else {
        // Fallback to individual PostgreSQL environment variables
        this.config = {
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

    this.validateConfig(this.config);
    logger.info('Database configuration loaded', { 
      type: this.config.type,
      host: this.config.postgresql?.host || this.config.supabase?.url,
      database: this.config.postgresql?.database || 'supabase',
      ssl: this.config.postgresql?.ssl || true
    });
    
    return this.config;
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
   * Validate database configuration (PostgreSQL or Supabase client)
   */
  private static validateConfig(config: DatabaseConfig): void {
    if (config.type === 'supabase') {
      const supabase = config.supabase;
      
      if (!supabase) {
        throw new Error('Database configuration invalid: Supabase configuration is missing');
      }
      
      if (!supabase.url || !supabase.url.trim()) {
        throw new Error('Database configuration invalid: Supabase URL is required');
      }
      
      if (!supabase.apiKey || !supabase.apiKey.trim()) {
        throw new Error('Database configuration invalid: Supabase API key is required');
      }
      
      // Validate URL format
      try {
        new URL(supabase.url);
      } catch {
        throw new Error('Database configuration invalid: Supabase URL must be a valid URL');
      }
      
    } else if (config.type === 'postgresql') {
      const pg = config.postgresql;
      
      if (!pg) {
        throw new Error('Database configuration invalid: PostgreSQL configuration is missing');
      }
      
      // Validate port format
      if (pg.port && (pg.port < 1 || pg.port > 65535 || isNaN(pg.port) || pg.port % 1 !== 0)) {
        throw new Error('Database configuration invalid: PostgreSQL port must be a valid integer between 1 and 65535');
      }

      // Validate Supabase-specific requirements
      if (pg.host?.includes('supabase')) {
        if (!pg.ssl) {
          logger.warn('Supabase connections should use SSL. SSL has been automatically enabled.');
          pg.ssl = true; // Auto-correct for Supabase
        }
        
        if (!pg.password || pg.password.trim() === '') {
          throw new Error('Supabase connections require a password. Check your SUPABASE_DB_URL or set DB_PASSWORD.');
        }
      }
    } else {
      throw new Error(`Database configuration invalid: Unsupported database type '${config.type}'`);
    }
  }

  /**
   * Reset configuration (useful for testing)
   */
  static resetConfig(): void {
    this.config = null;
  }

  /**
   * Get helpful setup instructions for Supabase configuration
   */
  static getSetupInstructions(): string {
    try {
      const config = this.getConfig();
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
        `.trim();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return `
Database Configuration Error: ${errorMessage}

Supabase Setup Instructions:
1. Create a Supabase project at https://supabase.com
2. Get your connection string from Settings > Database
3. Set: SUPABASE_DB_URL=postgresql://postgres:[password]@[project-ref].pooler.supabase.com:5432/postgres

Alternative PostgreSQL Setup:
DB_HOST=your_host
DB_NAME=your_database
DB_USER=your_user
DB_PASSWORD=your_password
DB_SSL=true

Check your .env file and ensure all required variables are set.
      `.trim();
    }
  }

  /**
   * Validate PostgreSQL/Supabase environment setup and provide specific guidance
   */
  static validateEnvironmentSetup(): { isValid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const config = this.getConfig();
      
      // Check NODE_ENV
      const nodeEnv = process.env.NODE_ENV;
      if (!nodeEnv) {
        warnings.push('NODE_ENV is not set.');
      }

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
          warnings.push('Supabase connections should use SSL. SSL will be automatically enabled.');
        }
        
        if (pg.port !== 5432) {
          warnings.push(`Supabase typically uses port 5432, but ${pg.port} is configured.`);
        }
      } else {
        // Non-Supabase PostgreSQL warnings
        if (!pg?.ssl && nodeEnv === 'production') {
          warnings.push('SSL is disabled for PostgreSQL in production. Consider enabling SSL for security.');
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
        validation: {
          isValid: validation.isValid,
          errorCount: validation.errors.length,
          warningCount: validation.warnings.length
        },
        config: {
          host: config.postgresql?.host,
          port: config.postgresql?.port,
          database: config.postgresql?.database,
          user: config.postgresql?.user,
          ssl: config.postgresql?.ssl,
          isSupabase: config.postgresql?.host?.includes('supabase') || false,
          poolSize: config.postgresql?.max
        }
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
        environment: process.env.NODE_ENV || 'not set'
      };
    }
  }
}