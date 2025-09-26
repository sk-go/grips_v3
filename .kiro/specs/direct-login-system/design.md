# Design Document

## Overview

This design implements a direct login system that replaces the current Keycloak redirect flow with a local authentication system. Users will login directly on the application's login page using email and password credentials stored securely in the local database. The system maintains JWT-based authentication while removing external dependencies.

## Architecture

### Authentication Flow
```
1. User visits login page → Direct login form (no redirect)
2. User submits credentials → Backend validates against local database
3. Successful auth → JWT tokens generated and returned
4. Frontend stores tokens → User redirected to dashboard
5. API requests → JWT tokens validated locally
```

### Database Schema Changes
The existing users table will be modified to support local authentication:
- Add `password_hash` column for bcrypt-hashed passwords
- Add `password_reset_token` and `password_reset_expires` for password recovery
- Make `keycloak_id` optional for backward compatibility
- Add `email_verified` flag for future email verification

### Token Management
- **Access Tokens**: Short-lived (15 minutes), contain user claims
- **Refresh Tokens**: Long-lived (7 days), stored in Redis for revocation
- **Reset Tokens**: Single-use, expire in 1 hour, stored in database

## Components and Interfaces

### Backend Services

#### Enhanced AuthService
```typescript
interface AuthService {
  // Core authentication
  authenticateUser(email: string, password: string): Promise<AuthTokens>
  createUser(userData: CreateUserRequest): Promise<User>
  
  // Password management
  initiatePasswordReset(email: string): Promise<void>
  resetPassword(token: string, newPassword: string): Promise<void>
  changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void>
  
  // Token management
  refreshTokens(refreshToken: string): Promise<AuthTokens>
  revokeRefreshToken(userId: string): Promise<void>
  
  // User management
  getUserById(userId: string): Promise<User | null>
  updateUserProfile(userId: string, updates: UserProfileUpdate): Promise<User>
}
```

#### Password Reset Service
```typescript
interface PasswordResetService {
  generateResetToken(email: string): Promise<string>
  validateResetToken(token: string): Promise<{ userId: string; email: string }>
  sendResetEmail(email: string, token: string): Promise<void>
  cleanupExpiredTokens(): Promise<void>
}
```

#### Migration Service
```typescript
interface MigrationService {
  migrateFromKeycloak(): Promise<MigrationResult>
  createDefaultAdminUser(): Promise<User>
  validateMigration(): Promise<ValidationResult>
}
```

### Frontend Components

#### Enhanced LoginForm
```typescript
interface LoginFormProps {
  onSuccess?: (user: User) => void
  redirectTo?: string
}

interface LoginFormState {
  email: string
  password: string
  isLoading: boolean
  error: string | null
  showForgotPassword: boolean
}
```

#### Password Reset Components
```typescript
// ForgotPasswordForm - Email input for reset request
// ResetPasswordForm - New password form for reset token
// ChangePasswordForm - Current + new password for logged-in users
```

#### Updated AuthContext
```typescript
interface AuthContextType {
  // Authentication state
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  
  // Authentication actions
  login(email: string, password: string): Promise<void>
  logout(): Promise<void>
  refreshUser(): Promise<void>
  
  // Password management
  forgotPassword(email: string): Promise<void>
  resetPassword(token: string, password: string): Promise<void>
  changePassword(oldPassword: string, newPassword: string): Promise<void>
}
```

### API Routes

#### Authentication Routes (`/api/auth`)
- `POST /login` - Direct email/password authentication
- `POST /logout` - Revoke refresh tokens
- `POST /refresh` - Refresh access tokens
- `GET /me` - Get current user profile
- `PUT /profile` - Update user profile

#### Password Management Routes (`/api/auth/password`)
- `POST /forgot` - Initiate password reset
- `POST /reset` - Complete password reset with token
- `POST /change` - Change password for authenticated user

#### User Management Routes (`/api/users`)
- `POST /` - Create new user (admin only)
- `GET /:id` - Get user by ID
- `PUT /:id` - Update user
- `DELETE /:id` - Deactivate user

## Data Models

### Enhanced User Model
```typescript
interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  role: 'agent' | 'admin'
  isActive: boolean
  emailVerified: boolean
  keycloakId?: string // Optional for backward compatibility
  createdAt: Date
  updatedAt: Date
}
```

### Authentication Models
```typescript
interface AuthTokens {
  accessToken: string
  refreshToken: string
  user: User
}

interface LoginRequest {
  email: string
  password: string
}

interface CreateUserRequest {
  email: string
  password: string
  firstName: string
  lastName: string
  role?: 'agent' | 'admin'
}

interface PasswordResetRequest {
  email: string
}

interface ResetPasswordRequest {
  token: string
  password: string
}
```

## Error Handling

### Authentication Errors
- **Invalid Credentials**: Generic message to prevent user enumeration
- **Account Inactive**: Clear message for deactivated accounts
- **Rate Limiting**: Temporary lockout after failed attempts
- **Token Expired**: Automatic refresh attempt, fallback to login

### Password Reset Errors
- **Email Not Found**: Generic success message to prevent enumeration
- **Invalid Token**: Clear error with link to request new reset
- **Expired Token**: Clear error with link to request new reset
- **Weak Password**: Detailed validation feedback

### Validation Errors
- **Email Format**: Real-time validation with clear feedback
- **Password Strength**: Progressive strength indicator
- **Required Fields**: Inline validation messages

## Testing Strategy

### Unit Tests
- **AuthService**: All authentication methods with mocked database
- **Password validation**: Various password strength scenarios
- **Token generation/validation**: JWT creation and verification
- **Rate limiting**: Failed attempt counting and lockout

### Integration Tests
- **Login flow**: End-to-end authentication process
- **Password reset**: Complete reset workflow
- **Token refresh**: Automatic token renewal
- **Migration**: Keycloak to local auth migration

### Security Tests
- **Password hashing**: Verify bcrypt implementation
- **Token security**: JWT signature validation
- **Rate limiting**: Brute force protection
- **SQL injection**: Parameterized query validation

### Frontend Tests
- **Login form**: User interaction and validation
- **Error handling**: Network failures and invalid responses
- **Token storage**: Secure localStorage management
- **Auto-refresh**: Seamless token renewal

## Migration Strategy

### Phase 1: Database Schema Update
1. Add password-related columns to users table
2. Create password reset tokens table
3. Update indexes for performance

### Phase 2: Backend Implementation
1. Implement enhanced AuthService
2. Create password reset functionality
3. Update authentication middleware
4. Add migration utilities

### Phase 3: Frontend Updates
1. Replace Keycloak redirect with direct login form
2. Add password reset components
3. Update AuthContext and auth service
4. Remove Keycloak-specific code

### Phase 4: Data Migration
1. Create default admin user
2. Migrate existing Keycloak users (if any)
3. Validate migration results
4. Clean up old authentication code

### Backward Compatibility
- Existing users with `keycloak_id` remain functional
- API endpoints maintain same response format
- JWT token structure remains compatible
- Gradual migration without service interruption