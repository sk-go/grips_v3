#!/usr/bin/env node

/**
 * Development Database Setup Script
 * 
 * This script helps developers set up their local database environment
 * and validates the configuration.
 */

const fs = require('fs');
const path = require('path');

console.log('🚀 Setting up development database environment...\n');

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log('✅ Created data directory:', dataDir);
} else {
  console.log('✅ Data directory exists:', dataDir);
}

// Check if .env file exists
const envPath = path.join(process.cwd(), '.env');
const envExamplePath = path.join(process.cwd(), '.env.example');

if (!fs.existsSync(envPath)) {
  if (fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
    console.log('✅ Created .env file from .env.example');
  } else {
    console.log('⚠️  .env.example not found, creating basic .env file');
    const basicEnv = `# Basic development configuration
NODE_ENV=development
PORT=3000
DATABASE_TYPE=sqlite
SQLITE_FILENAME=./data/development.db
SQLITE_WAL=true
JWT_SECRET=dev-secret-change-in-production
`;
    fs.writeFileSync(envPath, basicEnv);
    console.log('✅ Created basic .env file');
  }
} else {
  console.log('✅ .env file already exists');
}

// Load environment variables
require('dotenv').config();

// Validate development configuration
console.log('\n📋 Development Configuration:');
console.log('- NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('- DATABASE_TYPE:', process.env.DATABASE_TYPE || 'auto-detected');
console.log('- SQLITE_FILENAME:', process.env.SQLITE_FILENAME || './data/development.db');
console.log('- SQLITE_WAL:', process.env.SQLITE_WAL || 'true');

// Check database file permissions
const dbFile = process.env.SQLITE_FILENAME || './data/development.db';
if (dbFile !== ':memory:') {
  const dbPath = path.resolve(dbFile);
  const dbDir = path.dirname(dbPath);
  
  try {
    // Test write permissions
    fs.accessSync(dbDir, fs.constants.W_OK);
    console.log('✅ Database directory is writable:', dbDir);
  } catch (error) {
    console.log('❌ Database directory is not writable:', dbDir);
    console.log('   Please check permissions or create the directory');
  }
}

console.log('\n🎉 Development environment setup complete!');
console.log('\nNext steps:');
console.log('1. Run: npm install');
console.log('2. Run: npm run dev');
console.log('3. The application will automatically create and migrate the database');

console.log('\n📚 For more information, see: docs/database-setup.md');