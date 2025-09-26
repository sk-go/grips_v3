#!/usr/bin/env node

/**
 * Migration Script for Direct Login System
 * 
 * This script handles the migration from Keycloak authentication to local authentication.
 * It creates default admin users, migrates existing Keycloak users, and validates the migration.
 */

import { DatabaseService } from '../services/database';
import { MigrationService, CreateUserData } from '../services/migrationService';
import { MigrationValidator } from '../utils/migrationValidator';
import { logger } from '../utils/logger';

interface MigrationOptions {
  createDefaultAdmin?: boolean;
  createCustomAdmin?: CreateUserData;
  migrateKeycloak?: boolean;
  validate?: boolean;
  runComplete?: boolean;
}

class MigrationRunner {
  
  static async initialize(): Promise<void> {
    try {
      logger.info('Initializing database connection...');
      await DatabaseService.initialize();
      logger.info('Database connection established');
    } catch (error) {
      logger.error('Failed to initialize database:', error);
      throw error;
    }
  }

  static async runMigration(options: MigrationOptions = {}): Promise<void> {
    try {
      await this.initialize();

      // Run pre-flight check
      const preFlightCheck = await MigrationValidator.preFlightCheck();
      if (!preFlightCheck.canProceed) {
        console.log('\n❌ Pre-flight check failed:');
        preFlightCheck.issues.forEach((issue, index) => {
          console.log(`  ${index + 1}. ${issue}`);
        });
        throw new Error('Pre-flight check failed');
      }

      if (options.runComplete) {
        logger.info('Running complete migration process...');
        const result = await MigrationService.runCompleteMigration();
        this.logMigrationResult('Complete Migration', result);
        return;
      }

      if (options.createDefaultAdmin) {
        logger.info('Creating default admin user...');
        const result = await MigrationService.createDefaultAdminUser();
        this.logMigrationResult('Default Admin Creation', result);
      }

      if (options.createCustomAdmin) {
        logger.info('Creating custom admin user...');
        const result = await MigrationService.createAdminUser(options.createCustomAdmin);
        this.logMigrationResult('Custom Admin Creation', result);
      }

      if (options.migrateKeycloak) {
        logger.info('Migrating Keycloak users...');
        const result = await MigrationService.migrateFromKeycloak();
        this.logMigrationResult('Keycloak Migration', result);
      }

      if (options.validate) {
        logger.info('Validating migration...');
        const result = await MigrationService.validateMigration();
        this.logValidationResult(result);
      }

    } catch (error) {
      logger.error('Migration failed:', error);
      throw error;
    }
  }

  private static logMigrationResult(operation: string, result: any): void {
    console.log(`\n=== ${operation} Results ===`);
    console.log(`Success: ${result.success}`);
    console.log(`Message: ${result.message}`);
    
    if (result.usersCreated > 0) {
      console.log(`Users Created: ${result.usersCreated}`);
    }
    
    if (result.usersMigrated > 0) {
      console.log(`Users Migrated: ${result.usersMigrated}`);
    }
    
    if (result.errors && result.errors.length > 0) {
      console.log(`Errors (${result.errors.length}):`);
      result.errors.forEach((error: string, index: number) => {
        console.log(`  ${index + 1}. ${error}`);
      });
    }
    console.log('');
  }

  private static logValidationResult(result: any): void {
    console.log('\n=== Migration Validation Results ===');
    console.log(`Overall Valid: ${result.isValid}`);
    console.log(`Total Users: ${result.totalUsers}`);
    console.log(`Admin User Exists: ${result.adminUserExists}`);
    console.log(`Users with Passwords: ${result.usersWithPasswords}`);
    console.log(`Users with Keycloak ID: ${result.usersWithKeycloakId}`);
    
    if (result.issues && result.issues.length > 0) {
      console.log(`Issues Found (${result.issues.length}):`);
      result.issues.forEach((issue: string, index: number) => {
        console.log(`  ${index + 1}. ${issue}`);
      });
    } else {
      console.log('No issues found!');
    }
    console.log('');
  }
}

// CLI Interface
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Usage: npm run migrate [command]

Commands:
  default-admin     Create default admin user (admin@localhost)
  custom-admin      Create custom admin user (interactive)
  keycloak          Migrate existing Keycloak users
  validate          Validate migration state
  complete          Run complete migration process
  cleanup-tokens    Clean up expired password reset tokens
  status            Check current migration status
  report            Generate detailed migration report
  preflight         Run pre-flight checks

Examples:
  npm run migrate default-admin
  npm run migrate complete
  npm run migrate validate
  npm run migrate status
`);
    return;
  }

  const command = args[0];

  try {
    switch (command) {
      case 'default-admin':
        await MigrationRunner.runMigration({ createDefaultAdmin: true });
        break;

      case 'custom-admin':
        // Interactive admin creation
        const readline = require('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });

        const question = (prompt: string): Promise<string> => {
          return new Promise((resolve) => {
            rl.question(prompt, resolve);
          });
        };

        try {
          const email = await question('Admin email: ');
          const password = await question('Admin password: ');
          const firstName = await question('First name: ');
          const lastName = await question('Last name: ');

          const customAdmin: CreateUserData = {
            email,
            password,
            firstName,
            lastName,
            role: 'admin'
          };

          await MigrationRunner.runMigration({ createCustomAdmin: customAdmin });
        } finally {
          rl.close();
        }
        break;

      case 'keycloak':
        await MigrationRunner.runMigration({ migrateKeycloak: true });
        break;

      case 'validate':
        await MigrationRunner.runMigration({ validate: true });
        break;

      case 'complete':
        await MigrationRunner.runMigration({ runComplete: true });
        break;

      case 'cleanup-tokens':
        await MigrationRunner.initialize();
        const deletedCount = await MigrationService.cleanupExpiredTokens();
        console.log(`Cleaned up ${deletedCount} expired password reset tokens`);
        break;

      case 'status':
        await MigrationRunner.initialize();
        const status = await MigrationValidator.checkMigrationStatus();
        console.log('\n=== Migration Status ===');
        console.log(`Ready for Local Auth: ${status.isReady ? '✅' : '❌'}`);
        console.log(`Admin User Exists: ${status.hasAdminUser ? '✅' : '❌'}`);
        console.log(`Local Auth Available: ${status.hasLocalAuth ? '✅' : '❌'}`);
        console.log(`Total Users: ${status.totalUsers}`);
        
        if (status.issues.length > 0) {
          console.log('\nIssues:');
          status.issues.forEach((issue, index) => {
            console.log(`  ${index + 1}. ${issue}`);
          });
        }
        
        if (status.recommendations.length > 0) {
          console.log('\nRecommendations:');
          status.recommendations.forEach((rec, index) => {
            console.log(`  ${index + 1}. ${rec}`);
          });
        }
        break;

      case 'report':
        await MigrationRunner.initialize();
        const report = await MigrationValidator.generateMigrationReport();
        console.log(report);
        break;

      case 'preflight':
        await MigrationRunner.initialize();
        const preFlightResult = await MigrationValidator.preFlightCheck();
        console.log('\n=== Pre-flight Check ===');
        console.log(`Can Proceed: ${preFlightResult.canProceed ? '✅' : '❌'}`);
        
        if (preFlightResult.issues.length > 0) {
          console.log('\nIssues:');
          preFlightResult.issues.forEach((issue, index) => {
            console.log(`  ${index + 1}. ${issue}`);
          });
        } else {
          console.log('All checks passed!');
        }
        break;

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }

    console.log('Migration completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { MigrationRunner };