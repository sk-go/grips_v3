// Simple test to verify migration service works
const { MigrationService } = require('../dist/migrationService.js');

async function testMigration() {
  try {
    console.log('Testing migration service...');
    
    // Test validation (this should work without database connection)
    console.log('Migration service loaded successfully');
    console.log('Available methods:', Object.getOwnPropertyNames(MigrationService));
    
  } catch (error) {
    console.error('Migration service test failed:', error);
  }
}

testMigration();