#!/usr/bin/env node

/**
 * Cleanup script for expired password reset tokens
 * This script can be run manually or scheduled as a cron job
 */

import { PasswordResetService } from '../services/passwordResetService';
import { DatabaseService } from '../services/database';
import { logger } from '../utils/logger';

async function cleanupExpiredTokens(): Promise<void> {
  try {
    logger.info('Starting password reset token cleanup...');
    
    // Initialize database connection
    await DatabaseService.initialize();
    
    // Get statistics before cleanup
    const statsBefore = await PasswordResetService.getTokenStatistics();
    logger.info('Token statistics before cleanup', statsBefore);
    
    // Perform cleanup
    const deletedCount = await PasswordResetService.cleanupExpiredTokens();
    
    // Get statistics after cleanup
    const statsAfter = await PasswordResetService.getTokenStatistics();
    logger.info('Token statistics after cleanup', statsAfter);
    
    logger.info('Password reset token cleanup completed', {
      deletedCount,
      remainingActive: statsAfter.totalActive,
      remainingUsed: statsAfter.totalUsed
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Password reset token cleanup failed', { error: errorMessage });
    process.exit(1);
  } finally {
    // Close database connection
    await DatabaseService.close();
  }
}

// Run cleanup if this script is executed directly
if (require.main === module) {
  cleanupExpiredTokens()
    .then(() => {
      logger.info('Cleanup script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Cleanup script failed', { error: error.message });
      process.exit(1);
    });
}

export { cleanupExpiredTokens };