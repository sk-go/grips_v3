# Password Reset Service

The `PasswordResetService` provides secure password reset functionality for the direct login system. It manages the generation, validation, and cleanup of password reset tokens.

## Features

- **Secure Token Generation**: Uses cryptographically secure random tokens (64 hex characters)
- **Token Expiration**: Tokens expire after 1 hour for security
- **Automatic Cleanup**: Expired tokens are automatically cleaned up
- **User Validation**: Ensures only active users can request password resets
- **Token Invalidation**: Previous tokens are invalidated when new ones are generated
- **Comprehensive Logging**: All operations are logged for security auditing

## API Reference

### Core Methods

#### `generateResetToken(email: string): Promise<string>`
Generates a new password reset token for the given email address.

- **Parameters**: `email` - User's email address
- **Returns**: The generated token string (64 hex characters)
- **Throws**: Error if user not found or inactive
- **Security**: Invalidates any existing unused tokens for the user

#### `validateResetToken(token: string): Promise<TokenValidationResult>`
Validates a password reset token and returns user information.

- **Parameters**: `token` - The reset token to validate
- **Returns**: Object with `userId` and `email`
- **Throws**: Error if token is invalid, expired, or already used

#### `markTokenAsUsed(token: string): Promise<void>`
Marks a password reset token as used to prevent reuse.

- **Parameters**: `token` - The reset token to mark as used
- **Security**: Prevents token reuse attacks

### Management Methods

#### `cleanupExpiredTokens(): Promise<number>`
Removes expired tokens from the database.

- **Returns**: Number of tokens cleaned up
- **Usage**: Can be run as a scheduled job for maintenance

#### `invalidateUserTokens(userId: string): Promise<number>`
Invalidates all unused tokens for a specific user.

- **Parameters**: `userId` - User ID to invalidate tokens for
- **Returns**: Number of tokens invalidated
- **Usage**: Called when user changes password

#### `getActiveTokensForUser(userId: string): Promise<PasswordResetToken[]>`
Gets all active (unused and not expired) tokens for a user.

- **Parameters**: `userId` - User ID to check tokens for
- **Returns**: Array of active password reset tokens
- **Usage**: For debugging and monitoring

#### `getTokenStatistics(): Promise<TokenStatistics>`
Gets statistics about password reset tokens for monitoring.

- **Returns**: Object with counts of active, expired, and used tokens
- **Usage**: For system monitoring and health checks

## Database Schema

The service uses the `password_reset_tokens` table with the following structure:

```sql
CREATE TABLE password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

## Security Features

### Token Security
- **Cryptographically Secure**: Uses `crypto.randomBytes()` for token generation
- **Unique Tokens**: Database constraint ensures token uniqueness
- **Short Expiration**: 1-hour expiration window minimizes exposure
- **Single Use**: Tokens are marked as used after successful validation

### User Enumeration Protection
- **Generic Error Messages**: Doesn't reveal whether email exists in system
- **Consistent Response Time**: Similar processing time for valid/invalid emails
- **Logging**: Security events are logged without exposing sensitive data

### Rate Limiting
The service should be used with rate limiting middleware to prevent:
- **Brute Force**: Limit token generation attempts per IP/user
- **Token Flooding**: Prevent excessive token generation for single user
- **Validation Attacks**: Limit token validation attempts

## Usage Examples

### Basic Password Reset Flow

```typescript
import { PasswordResetService } from '../services/passwordResetService';

// Step 1: User requests password reset
try {
  const token = await PasswordResetService.generateResetToken('user@example.com');
  // Send token via email (handled by email service)
  await emailService.sendPasswordResetEmail('user@example.com', token);
} catch (error) {
  // Handle error (user not found, inactive, etc.)
}

// Step 2: User clicks reset link with token
try {
  const { userId, email } = await PasswordResetService.validateResetToken(token);
  // Show password reset form
} catch (error) {
  // Handle invalid/expired token
}

// Step 3: User submits new password
try {
  // Validate token again
  const { userId } = await PasswordResetService.validateResetToken(token);
  
  // Update password
  await AuthService.updatePassword(userId, newPassword);
  
  // Mark token as used
  await PasswordResetService.markTokenAsUsed(token);
} catch (error) {
  // Handle error
}
```

### Scheduled Cleanup

```typescript
import { PasswordResetService } from '../services/passwordResetService';

// Run as a cron job every hour
async function cleanupExpiredTokens() {
  try {
    const deletedCount = await PasswordResetService.cleanupExpiredTokens();
    console.log(`Cleaned up ${deletedCount} expired tokens`);
  } catch (error) {
    console.error('Token cleanup failed:', error);
  }
}
```

### Monitoring

```typescript
import { PasswordResetService } from '../services/passwordResetService';

// Get system statistics
async function getPasswordResetStats() {
  const stats = await PasswordResetService.getTokenStatistics();
  console.log('Password Reset Token Statistics:', stats);
  // { totalActive: 5, totalExpired: 12, totalUsed: 143 }
}
```

## Error Handling

The service throws descriptive errors for different scenarios:

- **`"If the email exists, a reset link will be sent"`**: User not found (generic message)
- **`"Account is inactive"`**: User account is deactivated
- **`"Invalid or expired reset token"`**: Token doesn't exist or has expired
- **`"Reset token has already been used"`**: Token was already consumed
- **`"Reset token has expired"`**: Token is past expiration time

## Integration with Auth System

The PasswordResetService integrates with the existing authentication system:

1. **User Validation**: Checks against the `users` table
2. **Password Updates**: Works with `AuthService.updatePassword()`
3. **Token Invalidation**: Automatically triggered by password changes
4. **Logging**: Uses the same logging system as other auth operations

## Maintenance

### Regular Tasks
- **Token Cleanup**: Run `cleanupExpiredTokens()` hourly via cron job
- **Statistics Monitoring**: Check token statistics for unusual patterns
- **Log Review**: Monitor logs for security events and errors

### Database Maintenance
- **Index Optimization**: Ensure indexes on `token`, `user_id`, and `expires_at` are healthy
- **Cleanup Verification**: Verify cleanup function is removing expired tokens
- **Performance Monitoring**: Monitor query performance for token operations

## Testing

The service includes comprehensive test coverage:

- **Unit Tests**: `src/test/passwordResetService.test.ts`
- **Integration Tests**: `src/test/integration/passwordResetService.integration.test.ts`
- **Test Coverage**: All methods and error conditions

Run tests with:
```bash
npm test -- --testPathPattern=passwordResetService
```