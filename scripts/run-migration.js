const { DatabaseService } = require('../dist/services/database');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    console.log('Initializing database service...');
    await DatabaseService.initialize();
    
    const migrationPath = path.join(__dirname, '../src/database/migrations/014_security_lockdowns.sql');
    console.log('Reading migration file:', migrationPath);
    
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }
    
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    console.log('Running migration 014_security_lockdowns.sql...');
    console.log('Migration SQL length:', migrationSQL.length, 'characters');
    
    // Split the migration into individual statements
    const statements = migrationSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    console.log('Executing', statements.length, 'statements...');
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.trim()) {
        console.log(`Executing statement ${i + 1}/${statements.length}...`);
        try {
          await DatabaseService.query(statement);
        } catch (error) {
          console.error(`Error in statement ${i + 1}:`, error.message);
          console.error('Statement:', statement.substring(0, 200) + '...');
          throw error;
        }
      }
    }
    
    console.log('Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

runMigration();