#!/usr/bin/env node

/**
 * Development Database Setup Script - Supabase Only
 * 
 * This script helps developers set up their Supabase database environment
 * and validates the configuration.
 */

const fs = require('fs');
const path = require('path');

console.log('🚀 Setting up Supabase development environment...\n');

// Check if .env file exists
const envPath = path.join(process.cwd(), '.env');
const envExamplePath = path.join(process.cwd(), '.env.example');

if (!fs.existsSync(envPath)) {
  if (fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
    console.log('✅ Created .env file from .env.example');
  } else {
    console.log('⚠️  .env.example not found, creating basic .env file');
    const basicEnv = `# Supabase development configuration
NODE_ENV=development
PORT=3000

# Supabase Database Configuration
SUPABASE_DB_URL=postgresql://postgres:[your-password]@[your-project-ref].pooler.supabase.com:5432/postgres

# Authentication
JWT_SECRET=dev-secret-change-in-production

# Redis (for local development)
REDIS_URL=redis://localhost:6379
`;
    fs.writeFileSync(envPath, basicEnv);
    console.log('✅ Created basic .env file with Supabase configuration');
  }
} else {
  console.log('✅ .env file already exists');
}

// Load environment variables
require('dotenv').config();

// Validate Supabase configuration
console.log('\n📋 Supabase Configuration:');
console.log('- NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('- SUPABASE_DB_URL:', process.env.SUPABASE_DB_URL ? '✅ Configured' : '❌ Missing');
console.log('- REDIS_URL:', process.env.REDIS_URL || 'redis://localhost:6379');

// Validate Supabase URL format
if (process.env.SUPABASE_DB_URL) {
  const url = process.env.SUPABASE_DB_URL;
  if (url.includes('supabase.com') && url.startsWith('postgresql://')) {
    console.log('✅ Supabase URL format looks correct');
  } else {
    console.log('⚠️  Supabase URL format may be incorrect');
    console.log('   Expected format: postgresql://postgres:[password]@[project-ref].pooler.supabase.com:5432/postgres');
  }
} else {
  console.log('❌ SUPABASE_DB_URL is required for development');
  console.log('   Please add your Supabase connection string to .env');
}

console.log('\n🎉 Supabase development environment setup complete!');
console.log('\nNext steps:');
console.log('1. Configure your Supabase project and update SUPABASE_DB_URL in .env');
console.log('2. Run: npm install');
console.log('3. Run: npm run docker:dev:redis-only (for Redis only)');
console.log('4. Run: npm run dev');
console.log('5. The application will automatically connect to Supabase and run migrations');

console.log('\n📚 For more information, see: docs/supabase-deployment.md');