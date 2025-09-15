import { Router, Request, Response } from 'express';
import { DatabaseService } from '../services/database';
import { RedisService } from '../services/redis';
import { asyncHandler } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();

// Basic health check
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
}));

// Detailed health check with dependencies
router.get('/detailed', asyncHandler(async (_req: Request, res: Response) => {
  const healthChecks = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    services: {
      database: { status: 'unknown', responseTime: 0, type: 'unknown' },
      redis: { status: 'unknown', responseTime: 0 }
    }
  };

  // Check database connection with type detection
  try {
    const dbStart = Date.now();
    await DatabaseService.query('SELECT 1');
    const dbType = DatabaseService.getDatabaseType();
    healthChecks.services.database = {
      status: 'healthy',
      responseTime: Date.now() - dbStart,
      type: dbType
    };
  } catch (error: any) {
    logger.error('Database health check failed', { error: error.message });
    const dbType = DatabaseService.getDatabaseType();
    healthChecks.services.database = {
      status: 'unhealthy',
      responseTime: 0,
      type: dbType,
      error: error.message
    } as any;
    healthChecks.status = 'degraded';
  }

  // Check Redis connection
  try {
    const redisStart = Date.now();
    await RedisService.getClient().ping();
    healthChecks.services.redis = {
      status: 'healthy',
      responseTime: Date.now() - redisStart
    };
  } catch (error: any) {
    logger.error('Redis health check failed', { error: error.message });
    healthChecks.services.redis = {
      status: 'unhealthy',
      responseTime: 0,
      error: error.message
    } as any;
    healthChecks.status = 'degraded';
  }

  // Determine overall status
  const hasUnhealthyService = Object.values(healthChecks.services)
    .some(service => service.status === 'unhealthy');
  
  if (hasUnhealthyService) {
    healthChecks.status = 'unhealthy';
  }

  const statusCode = healthChecks.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(healthChecks);
}));

// Readiness probe (for Kubernetes)
router.get('/ready', asyncHandler(async (_req: Request, res: Response) => {
  try {
    // Check if essential services are ready
    await DatabaseService.query('SELECT 1');
    await RedisService.getClient().ping();
    
    res.json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      database: {
        type: DatabaseService.getDatabaseType()
      }
    });
  } catch (error: any) {
    logger.error('Readiness check failed', { error: error.message });
    res.status(503).json({
      status: 'not ready',
      timestamp: new Date().toISOString(),
      error: error.message,
      database: {
        type: DatabaseService.getDatabaseType()
      }
    });
  }
}));

// Liveness probe (for Kubernetes)
router.get('/live', asyncHandler(async (_req: Request, res: Response) => {
  res.json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
}));

// Database configuration and validation endpoint
router.get('/database', asyncHandler(async (_req: Request, res: Response) => {
  try {
    const configSummary = DatabaseService.getConfigSummary();
    const validation = DatabaseService.validateConfiguration();
    const dbHealth = await DatabaseService.healthCheck();
    const dbType = DatabaseService.getDatabaseType();
    
    res.json({
      type: dbType,
      configuration: configSummary,
      validation: validation,
      health: dbHealth,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    logger.error('Database configuration check failed', { error: error.message });
    
    // Still try to get setup instructions even if config fails
    let setupInstructions = '';
    let dbType = 'unknown';
    try {
      setupInstructions = DatabaseService.getSetupInstructions();
      dbType = DatabaseService.getDatabaseType();
    } catch (e) {
      setupInstructions = 'Unable to generate setup instructions';
    }
    
    res.status(500).json({
      type: dbType,
      error: error.message,
      setupInstructions: setupInstructions,
      timestamp: new Date().toISOString()
    });
  }
}));

// Comprehensive database health check endpoint
router.get('/database/detailed', asyncHandler(async (_req: Request, res: Response) => {
  try {
    const healthResult = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: {
        type: '',
        connected: false,
        version: '',
        size: ''
      },
      migrations: {
        applied: 0,
        pending: 0,
        latest: ''
      },
      tables: {
        count: 0,
        details: [] as Array<{ name: string; rows: number; size?: string }>
      },
      performance: {
        connectionTime: 0,
        queryTime: 0
      },
      issues: [] as string[],
      recommendations: [] as string[]
    };

    // Get database configuration
    const config = DatabaseService.getConfigSummary() as any;
    healthResult.database.type = config.type;

    // Test connection and get basic info
    const connectionStart = Date.now();
    const client = await DatabaseService.getClient();
    healthResult.performance.connectionTime = Date.now() - connectionStart;
    healthResult.database.connected = true;

    try {
      // Get database version and size
      if (config.type === 'sqlite') {
        const versionResult = await client.query('SELECT sqlite_version() as version');
        healthResult.database.version = `SQLite ${versionResult.rows[0].version}`;
        
        // Get database file size if applicable
        const sqliteConfig = config.sqlite;
        if (sqliteConfig?.filename && sqliteConfig.filename !== ':memory:') {
          const fs = require('fs');
          if (fs.existsSync(sqliteConfig.filename)) {
            const stats = fs.statSync(sqliteConfig.filename);
            healthResult.database.size = `${(stats.size / 1024 / 1024).toFixed(2)} MB`;
          }
        }
      } else {
        const versionResult = await client.query('SELECT version()');
        const version = versionResult.rows[0].version;
        healthResult.database.version = version.split(' ')[0] + ' ' + version.split(' ')[1];
        
        const sizeResult = await client.query(`
          SELECT pg_size_pretty(pg_database_size(current_database())) as size
        `);
        healthResult.database.size = sizeResult.rows[0].size;
      }

      // Check migrations
      let migrationTableQuery: string;
      if (config.type === 'sqlite') {
        migrationTableQuery = `
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name='schema_migrations'
        `;
      } else {
        migrationTableQuery = `
          SELECT tablename FROM pg_tables 
          WHERE tablename = 'schema_migrations'
        `;
      }
      
      const migrationTableResult = await client.query(migrationTableQuery);
      if (migrationTableResult.rows.length > 0) {
        const migrationsResult = await client.query(`
          SELECT COUNT(*) as count, MAX(filename) as latest 
          FROM schema_migrations
        `);
        healthResult.migrations.applied = parseInt(migrationsResult.rows[0].count, 10);
        healthResult.migrations.latest = migrationsResult.rows[0].latest;
        
        // Count available migration files
        const fs = require('fs');
        const migrationDir = './src/database/migrations';
        if (fs.existsSync(migrationDir)) {
          const files = fs.readdirSync(migrationDir);
          const totalMigrations = files.filter((f: string) => f.endsWith('.sql')).length;
          healthResult.migrations.pending = Math.max(0, totalMigrations - healthResult.migrations.applied);
        }
      }

      // Get table information
      let tableQuery: string;
      if (config.type === 'sqlite') {
        tableQuery = `
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `;
      } else {
        tableQuery = `
          SELECT tablename as name FROM pg_tables 
          WHERE schemaname = 'public'
          ORDER BY tablename
        `;
      }
      
      const tablesResult = await client.query(tableQuery);
      healthResult.tables.count = tablesResult.rows.length;

      // Get row counts for each table
      for (const table of tablesResult.rows) {
        try {
          const countResult = await client.query(`SELECT COUNT(*) as count FROM ${table.name}`);
          const rowCount = parseInt(countResult.rows[0].count, 10);
          
          let size: string | undefined;
          if (config.type === 'postgresql') {
            const sizeResult = await client.query(`
              SELECT pg_size_pretty(pg_total_relation_size($1)) as size
            `, [table.name]);
            size = sizeResult.rows[0].size;
          }
          
          healthResult.tables.details.push({
            name: table.name,
            rows: rowCount,
            size
          });
        } catch (error) {
          // Skip tables that can't be queried
          healthResult.tables.details.push({
            name: table.name,
            rows: -1,
            size: 'Error'
          });
        }
      }

      // Performance test
      const queryStart = Date.now();
      await client.query('SELECT 1');
      healthResult.performance.queryTime = Date.now() - queryStart;

      // Analyze results and generate issues/recommendations
      if (healthResult.migrations.pending > 0) {
        healthResult.status = 'warning';
        healthResult.issues.push(`${healthResult.migrations.pending} pending migrations`);
        healthResult.recommendations.push('Run database migrations: npm run db:migrate');
      }
      
      if (healthResult.tables.count === 0) {
        healthResult.status = 'warning';
        healthResult.issues.push('No tables found in database');
        healthResult.recommendations.push('Initialize database: npm run db:init');
      }
      
      if (healthResult.performance.connectionTime > 5000) {
        healthResult.status = 'warning';
        healthResult.issues.push('Slow database connection (>5s)');
        healthResult.recommendations.push('Check network connectivity and database server performance');
      }
      
      if (healthResult.performance.queryTime > 1000) {
        healthResult.status = 'warning';
        healthResult.issues.push('Slow query performance (>1s)');
        healthResult.recommendations.push('Consider database optimization or check server resources');
      }

    } finally {
      if (client.release) {
        client.release();
      }
    }

    const statusCode = healthResult.status === 'healthy' ? 200 : 
                      healthResult.status === 'warning' ? 200 : 503;
    res.status(statusCode).json(healthResult);

  } catch (error: any) {
    logger.error('Detailed database health check failed', { error: error.message });
    const dbType = DatabaseService.getDatabaseType();
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message,
      database: {
        type: dbType,
        connected: false
      },
      recommendations: [
        'Check database configuration',
        'Ensure database server is running',
        'Verify connection credentials'
      ]
    });
  }
}));

export { router as healthRoutes };