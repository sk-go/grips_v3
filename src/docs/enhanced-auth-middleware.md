# Enhanced Authentication Middleware

## Overview

The enhanced authentication middleware provides a robust, secure authentication system that prioritizes local JWT tokens while maintaining backward compatibility with Keycloak authentication. This implementation fulfills the requirements for the direct login system while ensuring a smooth transition from external authentication providers.

## Key Features

### 1. Local JWT Token Priority
- **Primary Authentication**: Local JWT tokens are verified first using the application's JWT secrets
- **Token Structure Validation**: Comprehensive validation of JWT token format and claims
- **Security Verification**: Email matching between token and database for additional security
- **Performance**: Fast local verification without external API calls

### 2. Backward Compatibility
- **Keycloak Fallback**: Automatic fallback to Keycloak authentication when local JWT fails
- **Seamless Migration**: Existing Keycloak users continue to work without interruption
- **Dual Support**: Both authentication methods can coexist during transition period
- **User Data Preservation**: All existing user data and sessions remain functional

### 3. Enhanced Security
- **Token Structure Validation**: Validates JWT format before processing
- **Email Verification**: Cross-references token email with database email
- **Account Status Checks**: Verifies user account is active before granting access
- **Comprehensive Logging**: Detailed security event logging for audit trails
- **Error Code Classification**: Structured error responses with specific error codes

### 4. Advanced Features
- **Token Refresh Middleware**: Automatic token refresh capability
- **Optional Authentication**: Flexible middleware for optional authentication scenarios
- **Role-Based Access Control**: Enhanced role validation with detailed logging
- **Combined Middleware**: Pre-configured middleware chains for common use cases

## Middleware Functions

### Core Authentication

#### `authenticateToken`
Primary authentication middleware that validates JWT tokens.

```typescript
app.get('/protected', authenticateToken, (req, res) => {
  // req.user contains authenticated user information
  // req.user.authMethod indicates 'local' or 'keycloak'
});
```

**Features:**
- Prioritizes local JWT verification
- Falls back to Keycloak for backward compatibility
- Validates user account status and email matching
- Sets comprehensive user object in request

#### `optionalAuth`
Middleware for routes that benefit from authentication but don't require it.

```typescript
app.get('/public-with-context', optionalAuth, (req, res) => {
  if (req.user) {
    // User is authenticated, provide personalized response
  } else {
    // User is not authenticated, provide public response
  }
});
```

### Authorization

#### `requireRole(roles)`
Role-based access control middleware.

```typescript
// Single role
app.get('/admin', authenticateToken, requireRole('admin'), handler);

// Multiple roles
app.get('/staff', authenticateToken, requireRole(['admin', 'agent']), handler);
```

**Features:**
- Supports single role or array of roles
- Detailed authorization logging
- Structured error responses with role information

### Advanced Features

#### `refreshTokenMiddleware`
Handles automatic token refresh using refresh tokens.

```typescript
app.use('/api', refreshTokenMiddleware);
```

**Features:**
- Checks for `X-Refresh-Token` header
- Automatically refreshes expired access tokens
- Sets new tokens in response headers
- Continues with normal auth flow if refresh fails

#### `validateTokenStructure`
Validates JWT token format before processing.

```typescript
app.use('/api', validateTokenStructure);
```

**Features:**
- Validates JWT structure (header.payload.signature)
- Checks base64 encoding integrity
- Early rejection of malformed tokens

#### `authenticateWithRefresh`
Pre-configured middleware chain combining validation, refresh, and authentication.

```typescript
app.get('/api/data', authenticateWithRefresh, handler);
// Equivalent to: [validateTokenStructure, refreshTokenMiddleware, authenticateToken]
```

## Request User Object

When authentication succeeds, the middleware sets a comprehensive user object:

```typescript
interface RequestUser {
  id: string;                    // User ID
  email: string;                 // User email
  role: string;                  // User role (admin, agent, etc.)
  keycloakId?: string;          // Keycloak ID (if applicable)
  firstName?: string;           // User first name
  lastName?: string;            // User last name
  isActive?: boolean;           // Account status
  authMethod?: 'local' | 'keycloak'; // Authentication method used
}
```

## Error Responses

The middleware provides structured error responses with specific error codes:

### Authentication Errors
```json
{
  "error": "Access token required",
  "code": "TOKEN_MISSING"
}

{
  "error": "Invalid or expired token",
  "code": "TOKEN_INVALID"
}

{
  "error": "User account is inactive",
  "code": "ACCOUNT_INACTIVE"
}

{
  "error": "Invalid token format",
  "code": "TOKEN_MALFORMED"
}
```

### Authorization Errors
```json
{
  "error": "Insufficient permissions",
  "code": "INSUFFICIENT_PERMISSIONS",
  "required": ["admin"],
  "current": "agent"
}
```

## Security Features

### Token Validation
1. **Structure Validation**: Ensures JWT has correct format (header.payload.signature)
2. **Signature Verification**: Validates token signature using local JWT secrets
3. **Claim Validation**: Verifies required claims (userId, email, role)
4. **Email Cross-Reference**: Matches token email with database email
5. **Account Status**: Checks if user account is active

### Logging and Monitoring
- **Authentication Events**: All authentication attempts are logged
- **Security Warnings**: Failed attempts and suspicious activity
- **Performance Metrics**: Token verification timing
- **Audit Trail**: Complete authentication history

### Rate Limiting Integration
The middleware integrates with the existing rate limiting system:
- Failed authentication attempts are tracked
- Automatic lockout after multiple failures
- IP-based and user-based rate limiting

## Migration Strategy

### Phase 1: Deployment
1. Deploy enhanced middleware alongside existing Keycloak system
2. Local JWT authentication takes priority
3. Keycloak remains as fallback for existing users

### Phase 2: User Migration
1. New users automatically use local authentication
2. Existing users can continue with Keycloak tokens
3. Optional migration tools for converting Keycloak users

### Phase 3: Keycloak Removal
1. Monitor authentication method usage
2. Gradually deprecate Keycloak authentication
3. Remove Keycloak dependencies when usage drops to zero

## Configuration

### Environment Variables
```bash
# JWT Configuration (required for local authentication)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-this-in-production
JWT_REFRESH_EXPIRES_IN=7d

# Keycloak Configuration (optional for backward compatibility)
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=relationship-care-platform
KEYCLOAK_CLIENT_ID=rcp-client
KEYCLOAK_CLIENT_SECRET=your-keycloak-client-secret
```

### Usage Examples

#### Basic Protected Route
```typescript
import { authenticateToken } from './middleware/auth';

app.get('/api/profile', authenticateToken, (req, res) => {
  res.json({
    user: req.user,
    authMethod: req.user?.authMethod
  });
});
```

#### Admin-Only Route
```typescript
import { authenticateToken, requireRole } from './middleware/auth';

app.post('/api/admin/users', 
  authenticateToken, 
  requireRole('admin'), 
  (req, res) => {
    // Only admin users can access this route
  }
);
```

#### Optional Authentication
```typescript
import { optionalAuth } from './middleware/auth';

app.get('/api/public-data', optionalAuth, (req, res) => {
  const data = getPublicData();
  
  if (req.user) {
    // Add personalized data for authenticated users
    data.personalized = getPersonalizedData(req.user.id);
  }
  
  res.json(data);
});
```

#### With Automatic Refresh
```typescript
import { authenticateWithRefresh } from './middleware/auth';

app.get('/api/sensitive-data', authenticateWithRefresh, (req, res) => {
  // This route supports automatic token refresh
  // New tokens will be provided in response headers if refresh occurs
});
```

## Testing

The middleware includes comprehensive test coverage:

### Unit Tests
- Individual middleware function testing
- Mock-based testing for all dependencies
- Edge case and error condition testing
- Token validation and security testing

### Integration Tests
- End-to-end authentication flows
- Real JWT token generation and verification
- Database integration testing
- Error response validation

### Security Tests
- Token tampering detection
- Invalid token format handling
- Account status validation
- Email mismatch detection

## Performance Considerations

### Local JWT Priority
- Local JWT verification is significantly faster than external API calls
- Reduces dependency on external services
- Improves response times for authenticated requests

### Caching Strategy
- User data is fetched from database for each request
- Consider implementing Redis caching for frequently accessed user data
- Token verification results could be cached for short periods

### Database Optimization
- Ensure proper indexing on user ID and email columns
- Consider connection pooling for high-traffic scenarios
- Monitor query performance for user lookups

## Monitoring and Alerting

### Key Metrics
- Authentication success/failure rates
- Authentication method distribution (local vs Keycloak)
- Token refresh frequency
- Failed authentication patterns

### Security Alerts
- Multiple failed authentication attempts
- Token tampering attempts
- Inactive account access attempts
- Unusual authentication patterns

### Performance Monitoring
- Authentication middleware response times
- Database query performance
- Token verification latency
- Memory usage patterns

## Troubleshooting

### Common Issues

#### "Invalid or expired token" errors
1. Check JWT_SECRET configuration
2. Verify token expiration settings
3. Ensure database connectivity
4. Check user account status

#### "Token email mismatch" errors
1. Verify token generation includes correct email
2. Check for email updates in database
3. Ensure token payload structure is correct

#### Keycloak fallback not working
1. Verify Keycloak configuration
2. Check network connectivity to Keycloak
3. Validate Keycloak client credentials
4. Review Keycloak logs for errors

### Debug Logging
Enable debug logging to troubleshoot authentication issues:

```bash
LOG_LEVEL=debug
```

This will provide detailed logs for:
- Token verification attempts
- Database queries
- Authentication method selection
- Error details and stack traces