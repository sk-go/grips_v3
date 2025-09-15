# Keycloak Integration Setup Guide

## Overview

Your Relationship Care Platform now uses Keycloak for authentication instead of the traditional JWT system. Users are managed in Keycloak but synced to your local PostgreSQL database for relationship data.

## Current Setup

### Backend Changes
- **New Service**: `KeycloakAuthService` handles OIDC token verification and user sync
- **Updated Middleware**: Auth middleware now verifies Keycloak JWT tokens
- **New Routes**: `/api/keycloak-auth/*` endpoints for OAuth flow
- **Database**: Users table includes `keycloak_id` for linking

### Frontend Changes
- **Updated AuthService**: Now handles OAuth redirect flow instead of password login
- **New Callback Page**: `/auth/callback` processes OAuth returns
- **Updated LoginForm**: Single button that redirects to Keycloak

## Keycloak Configuration Required

### 1. Create Realm
1. Access Keycloak admin console at `http://localhost:8080`
2. Create a new realm called `relationship-care-platform`

### 2. Create Client
1. In your realm, create a new client:
   - **Client ID**: `rcp-client`
   - **Client Type**: `OpenID Connect`
   - **Client authentication**: `On` (confidential)
2. Configure client settings:
   - **Valid redirect URIs**: `http://localhost:3001/auth/callback`
   - **Web origins**: `http://localhost:3001`
   - **Root URL**: `http://localhost:3001`

### 3. Get Client Secret
1. Go to client's **Credentials** tab
2. Copy the **Client Secret**
3. Add to your `.env` file:
   ```
   KEYCLOAK_CLIENT_SECRET=your-copied-secret-here
   ```

### 4. Create Roles
1. Go to **Realm roles**
2. Create roles:
   - `admin` - Full system access
   - `agent` - Standard user access

### 5. Create Test User
1. Go to **Users** → **Add user**
2. Set username and email
3. Go to **Credentials** tab, set password
4. Go to **Role mapping** tab, assign `agent` or `admin` role

## Environment Variables

Add these to your `.env` file:

```bash
# Keycloak Configuration
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=relationship-care-platform
KEYCLOAK_CLIENT_ID=rcp-client
KEYCLOAK_CLIENT_SECRET=your-keycloak-client-secret
```

## Database Migration

Run the users table migration:

```bash
# The migration file is already created at:
# src/database/migrations/001_users_table.sql

# Apply it to your database
psql -d relationship_care_platform -f src/database/migrations/001_users_table.sql
```

## Testing the Integration

1. **Start your services**:
   ```bash
   # Backend
   npm run dev

   # Frontend (in separate terminal)
   cd frontend && npm run dev
   ```

2. **Test login flow**:
   - Visit `http://localhost:3001/login`
   - Click "Sign in with Keycloak"
   - Should redirect to Keycloak login
   - After login, should redirect back to your app

3. **Verify user sync**:
   - Check your PostgreSQL `users` table
   - Should see user created with `keycloak_id`

## User Management

### How Users Are Stored
- **Keycloak**: Primary user store (credentials, profile, roles)
- **PostgreSQL**: Synced user data for relationship management
- **Sync Process**: Automatic on login/token refresh

### User Roles
- Keycloak roles are mapped to local roles:
  - `admin` → `admin` (full access)
  - `agent` → `agent` (standard access)
  - No role → `agent` (default)

### Adding New Users
1. Create user in Keycloak admin console
2. Assign appropriate role
3. User will be synced to local DB on first login

## Troubleshooting

### Common Issues

1. **"Invalid or expired token"**
   - Check Keycloak is running on port 8080
   - Verify client secret in `.env`
   - Check realm name matches

2. **"User not found"**
   - User may not have synced yet
   - Check database connection
   - Verify user has active status in Keycloak

3. **Redirect loops**
   - Check redirect URIs in Keycloak client config
   - Verify frontend URL in CORS settings

### Debug Mode
Enable debug logging by setting:
```bash
LOG_LEVEL=debug
```

## Migration from Old Auth System

If you have existing users in the old system:

1. **Export user data** from current users table
2. **Import users** into Keycloak (or create manually)
3. **Update user records** to include `keycloak_id`
4. **Test login** for each migrated user

## Security Notes

- Tokens are verified using Keycloak's public keys (JWKS)
- Refresh tokens are handled by Keycloak
- Local database only stores non-sensitive user data
- All authentication flows go through Keycloak

## Next Steps

1. Configure your Keycloak realm as described above
2. Update your `.env` file with the client secret
3. Run the database migration
4. Test the login flow
5. Create your first admin user in Keycloak

The system is now ready to use Keycloak for authentication while maintaining all your existing relationship management features!