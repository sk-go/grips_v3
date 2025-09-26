import { DatabaseService } from '../services/database';
import { MigrationService } from '../services/migrationService';
import { logger } from './logger';

export interface MigrationStatus {
  isReady: boolean;
  hasAdminUser: boolean;
  hasLocalAuth: boolean;
  totalUsers: number;
  issues: string[];
  recommendations: string[];
}

export class MigrationValidator {
  
  /**
   * Check if the system is ready for local authentication
   */
  static async checkMigrationStatus(): Promise<MigrationStatus> {
    const status: MigrationStatus = {
      isReady: false,
      hasAdminUser: false,
      hasLocalAuth: false,
      totalUsers: 0,
      issues: [],
      recommendations: []
    };

    try {
      // Run validation
      const validation = await MigrationService.validateMigration();
      
      status.hasAdminUser = validation.adminUserExists;
      status.totalUsers = validation.totalUsers;
      status.hasLocalAuth = validation.usersWithPasswords > 0;
      status.issues = [...validation.issues];

      // Determine if system is ready
      status.isReady = validation.isValid && status.hasAdminUser && status.hasLocalAuth;

      // Generate recommendations
      if (!status.hasAdminUser) {
        status.recommendations.push('Run migration to create default admin user: npm run migrate:default-admin');
      }

      if (!status.hasLocalAuth) {
        status.recommendations.push('Create users with local authentication: npm run migrate:default-admin');
      }



      if (status.totalUsers === 0) {
        status.recommendations.push('Create initial users or run complete migration: npm run migrate:complete');
      }

      return status;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      status.issues.push(`Migration status check failed: ${errorMessage}`);
      logger.error('Migration status check failed:', error);
      return status;
    }
  }

  /**
   * Check if local authentication is properly configured
   */
  static async checkAuthConfiguration(): Promise<boolean> {
    try {
      // Check if required database schema exists
      const schemaChecks = [
        'SELECT 1 FROM users WHERE password_hash IS NOT NULL LIMIT 1',
        'SELECT 1 FROM password_reset_tokens LIMIT 1'
      ];

      for (const check of schemaChecks) {
        try {
          await DatabaseService.query(check);
        } catch (error) {
          logger.error(`Schema check failed: ${check}`, error);
          return false;
        }
      }

      // Check if at least one user can authenticate locally
      const localAuthUsers = await DatabaseService.query(
        'SELECT COUNT(*) as count FROM users WHERE password_hash IS NOT NULL AND is_active = true'
      );

      const count = parseInt(localAuthUsers.rows[0].count);
      return count > 0;

    } catch (error) {
      logger.error('Auth configuration check failed:', error);
      return false;
    }
  }

  /**
   * Generate migration report
   */
  static async generateMigrationReport(): Promise<string> {
    try {
      const status = await this.checkMigrationStatus();
      const authConfigured = await this.checkAuthConfiguration();

      let report = '# Migration Status Report\n\n';
      
      report += `**Overall Status:** ${status.isReady ? '✅ Ready' : '❌ Not Ready'}\n`;
      report += `**Authentication Configured:** ${authConfigured ? '✅ Yes' : '❌ No'}\n\n`;

      report += '## System Overview\n';
      report += `- Total Active Users: ${status.totalUsers}\n`;
      report += `- Admin User Exists: ${status.hasAdminUser ? '✅' : '❌'}\n`;
      report += `- Local Authentication Available: ${status.hasLocalAuth ? '✅' : '❌'}\n\n`;

      if (status.issues.length > 0) {
        report += '## Issues Found\n';
        status.issues.forEach((issue, index) => {
          report += `${index + 1}. ${issue}\n`;
        });
        report += '\n';
      }

      if (status.recommendations.length > 0) {
        report += '## Recommendations\n';
        status.recommendations.forEach((rec, index) => {
          report += `${index + 1}. ${rec}\n`;
        });
        report += '\n';
      }

      report += '## Next Steps\n';
      if (status.isReady) {
        report += '- ✅ System is ready for local authentication\n';
        report += '- System is using direct authentication (Keycloak has been removed)\n';
        report += '- Test login functionality with existing users\n';
      } else {
        report += '- Run complete migration: `npm run migrate:complete`\n';
        report += '- Validate migration: `npm run migrate:validate`\n';
        report += '- Check logs for any errors during migration\n';
      }

      return report;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return `# Migration Report Generation Failed\n\nError: ${errorMessage}`;
    }
  }

  /**
   * Pre-flight check before starting migration
   */
  static async preFlightCheck(): Promise<{ canProceed: boolean; issues: string[] }> {
    const result = { canProceed: true, issues: [] as string[] };

    try {
      // Check database connection
      try {
        await DatabaseService.query('SELECT 1');
      } catch (error) {
        result.canProceed = false;
        result.issues.push('Database connection failed');
      }

      // Check if migrations have been run
      try {
        await DatabaseService.query('SELECT 1 FROM users LIMIT 1');
      } catch (error) {
        result.canProceed = false;
        result.issues.push('Users table does not exist - run database migrations first');
      }

      // Check if password reset table exists
      try {
        await DatabaseService.query('SELECT 1 FROM password_reset_tokens LIMIT 1');
      } catch (error) {
        result.canProceed = false;
        result.issues.push('Password reset tokens table does not exist - run migration 010');
      }

      // Check for required environment variables
      const requiredEnvVars = ['JWT_SECRET'];
      for (const envVar of requiredEnvVars) {
        if (!process.env[envVar]) {
          result.canProceed = false;
          result.issues.push(`Missing required environment variable: ${envVar}`);
        }
      }

      return result;

    } catch (error) {
      result.canProceed = false;
      result.issues.push(`Pre-flight check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return result;
    }
  }
}

export default MigrationValidator;