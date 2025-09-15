# Quick Start Guide - SQLite Development

Get up and running with the Relationship Care Platform in under 2 minutes using SQLite for local development.

## Prerequisites

- Node.js 18+ installed
- Git installed

## 1. Clone and Install

```bash
git clone <repository-url>
cd relationship-care-platform
npm install
```

## 2. Start Development

```bash
npm run dev
```

That's it! The application will:
- ✅ Automatically create SQLite database at `./data/development.db`
- ✅ Run all migrations to set up the schema
- ✅ Start the backend server on http://localhost:3001
- ✅ Be ready for development

## 3. Verify Setup

Open your browser to http://localhost:3001/health to verify the application is running.

## What Just Happened?

The application automatically detected you're in development mode and:

1. **Created SQLite Database**: No PostgreSQL server needed
2. **Applied Schema**: All migrations ran automatically
3. **Ready for Development**: Full functionality available

## Next Steps

### Frontend Development
```bash
cd frontend
npm install
npm run dev
```
Frontend will be available at http://localhost:3000

### Database Inspection
```bash
# Check database status
npm run db:status

# View database contents (requires sqlite3 CLI)
sqlite3 ./data/development.db ".tables"
```

### Environment Customization
Create `.env.local` to customize settings:
```bash
# Optional: Custom database location
SQLITE_FILENAME=./my-custom-db.db

# Optional: Disable WAL mode if needed
SQLITE_WAL=false
```

## Troubleshooting

### Permission Issues
```bash
# Ensure data directory is writable
mkdir -p ./data
chmod 755 ./data
```

### Port Conflicts
```bash
# Use different port
PORT=3002 npm run dev
```

### Database Issues
```bash
# Reset database (deletes all data)
rm ./data/development.db
npm run dev  # Will recreate automatically
```

## Development Workflow

1. **Code Changes**: Edit files in `src/`
2. **Auto Restart**: Nodemon restarts server automatically
3. **Database Changes**: Add migrations to `src/database/migrations/`
4. **Testing**: Run `npm test` for unit tests

## Moving to Production

When ready for production deployment:
1. Set up Supabase account
2. Update environment variables for PostgreSQL
3. Deploy application
4. Migrations run automatically on first startup

See [Supabase Production Deployment](./supabase-deployment.md) for detailed production setup.