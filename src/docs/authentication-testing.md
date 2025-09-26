# Authentication System Testing Documentation

## Overview

This document describes the comprehensive testing strategy for the direct login authentication system. The tests cover all aspects of authentication including password security, rate limiting, JWT tokens, and user interface components.

## Test Structure

### Backend Tests

#### Unit Tests

**AuthService Comprehensive Tests** (`src/test/auth.comprehensive.test.ts`)
- Password hashing and validation
- Email validation
- Rate limiting logic
- JWT token generation and verification
- User management operations
- Password strength validation
- Input sanitization

**Password Reset Service Tests** (`src/test/passwordResetService.test.ts`)
- Token generation and validation
- Email sending workflows
- Token expiration handling
- Security measures

#### Integration Tests

**Authentication Integration Tests** (`src/test/integration/auth.comprehensive.integration.test.ts`)
- Complete login flow with rate limiting
- Password reset end-to-end workflow
- Token refresh mechanisms
- Password change operations
- Logout functionality

**Password Management Integration** (`src/test/integration/passwordManagement.integration.test.ts`)
- Password reset initiation and completion
- Email notification workflows
- Database transaction handling

#### Security Tests

**Authentication Security Tests** (`src/test/security/auth.security.test.ts`)
- Rate limiting and brute force protection
- Password security (bcrypt, salt rounds, timing attacks)
- JWT token security (signature validation, tampering detection)
- Input validation and SQL injection prevention
- Session security and token revocation

### Frontend Tests

**Login Form Comprehensive Tests** (`frontend/src/components/auth/__tests__/LoginForm.comprehensive.test.tsx`)
- Form rendering and accessibility
- Real-time validation
- Authentication flow
- Error handling
- Loading states
- Keyboard navigation

**Password Reset Components Tests** (`frontend/src/components/auth/__tests__/PasswordReset.comprehensive.test.tsx`)
- Forgot password form
- Reset password form
- Change password form
- Password strength indicators
- Form validation and submission

## Test Categories

### 1. Password Security Tests

#### Password Hashing
```typescript
// Tests bcrypt implementation with proper salt rounds
test('should hash password with bcrypt', async () => {
  const password = 'TestPassword123!';
  const hash = await AuthService.hashPassword(password);
  
  expect(hash).toBeDefined();
  expect(hash).not.toBe(password);
  expect(hash.startsWith('$2a$12$')).toBe(true);
});
```

#### Password Validation
```typescript
// Tests comprehensive password strength requirements
test('should validate strong password', () => {
  const result = AuthService.validatePassword('StrongP@ssw0rd123');
  
  expect(result.isValid).toBe(true);
  expect(result.strength).toBe('strong');
  expect(result.score).toBeGreaterThan(80);
});
```

#### Timing Attack Resistance
```typescript
// Ensures consistent timing for password comparisons
test('should resist timing attacks in password comparison', async () => {
  // Test measures timing differences between correct and incorrect passwords
  const timeDifference = Math.abs(correctTime - wrongTime);
  expect(timeDifference).toBeLessThan(50); // Less than 50ms difference
});
```

### 2. Rate Limiting Tests

#### Brute Force Protection
```typescript
// Tests progressive lockout implementation
test('should implement progressive lockout times', async () => {
  const result = await AuthService.checkRateLimit(email, ipAddress);
  
  expect(result.isLimited).toBe(true);
  expect(mockRedisService.set).toHaveBeenCalledWith(
    'login_lockout:user@example.com:192.168.1.1',
    expect.any(String),
    1800 // 30 minutes lockout
  );
});
```

#### IP-based Rate Limiting
```typescript
// Tests rate limiting differentiation by IP address
test('should differentiate rate limiting by IP address', async () => {
  const result1 = await AuthService.checkRateLimit(email, ip1);
  const result2 = await AuthService.checkRateLimit(email, ip2);

  expect(result1.remainingAttempts).toBe(2);
  expect(result2.remainingAttempts).toBe(4);
});
```

### 3. JWT Security Tests

#### Token Integrity
```typescript
// Tests JWT signature validation and tampering detection
test('should reject tokens with invalid signatures', () => {
  const tamperedToken = parts[0] + '.' + parts[1] + '.tampered-signature';

  expect(() => {
    AuthService.verifyAccessToken(tamperedToken);
  }).toThrow('Invalid or expired token');
});
```

#### Token Claims Validation
```typescript
// Ensures proper JWT claims and security headers
test('should include proper JWT claims and security headers', () => {
  const decoded = AuthService.verifyAccessToken(token);

  expect(decoded.iss).toBe('relationship-care-platform');
  expect(decoded.aud).toBe('rcp-users');
  expect(decoded.exp).toBeDefined();
});
```

### 4. Integration Flow Tests

#### Complete Login Flow
```typescript
// Tests end-to-end authentication with rate limiting
test('should complete successful login flow with rate limiting', async () => {
  const result = await AuthService.authenticateUser(email, password, ipAddress);

  expect(result.user.id).toBe('user-123');
  expect(result.accessToken).toBeDefined();
  expect(result.refreshToken).toBeDefined();
});
```

#### Password Reset Workflow
```typescript
// Tests complete password reset from initiation to completion
test('should complete full password reset flow', async () => {
  await PasswordResetService.initiatePasswordReset(email, baseUrl);
  await PasswordResetService.completePasswordReset(token, newPassword, ipAddress);
  
  // Verify transaction was used and password updated
  expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
  expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
});
```

### 5. Frontend Component Tests

#### Form Validation
```typescript
// Tests real-time email validation
test('validates email format in real-time', async () => {
  await user.type(emailInput, 'invalid-email');
  await user.tab();
  
  await waitFor(() => {
    expect(screen.getByText(/please enter a valid email address/i)).toBeInTheDocument();
  });
});
```

#### Accessibility
```typescript
// Tests proper ARIA labels and keyboard navigation
test('has proper accessibility attributes', () => {
  const emailInput = screen.getByLabelText(/email address/i);
  
  expect(emailInput).toHaveAttribute('type', 'email');
  expect(emailInput).toHaveAttribute('autocomplete', 'email');
  expect(emailInput).toHaveAttribute('required');
});
```

## Running Tests

### All Authentication Tests
```bash
npm run test:auth
```

### Specific Test Categories
```bash
npm run test:auth:unit        # Unit tests only
npm run test:auth:integration # Integration tests only
npm run test:auth:security    # Security tests only
```

### Individual Test Suites
```bash
npm run test:auth -- --test "AuthService"
npm run test:auth -- --test "Password Reset"
npm run test:auth -- --test "Security"
```

### Frontend Tests
```bash
cd frontend
npm test -- --testPathPattern="auth"
```

## Test Coverage Requirements

### Backend Coverage Targets
- **AuthService**: 95%+ line coverage
- **PasswordResetService**: 90%+ line coverage
- **Rate Limiting**: 100% branch coverage
- **Security Functions**: 100% line coverage

### Frontend Coverage Targets
- **Login Components**: 90%+ line coverage
- **Password Forms**: 85%+ line coverage
- **Error Handling**: 100% branch coverage

## Security Test Scenarios

### 1. Brute Force Attack Simulation
```typescript
// Simulates rapid login attempts to test rate limiting
for (let i = 0; i < 10; i++) {
  try {
    await AuthService.authenticateUser(email, 'wrong-password', ipAddress);
  } catch (error) {
    if (error.message.includes('Too many failed attempts')) {
      break; // Rate limiting working
    }
  }
}
```

### 2. SQL Injection Prevention
```typescript
// Tests malicious input handling
const maliciousEmail = "admin@example.com'; DROP TABLE users; --";
await expect(
  AuthService.authenticateUser(maliciousEmail, password)
).rejects.toThrow('Invalid email format');
```

### 3. JWT Token Tampering
```typescript
// Tests token integrity validation
const parts = token.split('.');
const tamperedPayload = Buffer.from(JSON.stringify({
  ...payload,
  role: 'admin' // Privilege escalation attempt
})).toString('base64url');

const tamperedToken = parts[0] + '.' + tamperedPayload + '.' + parts[2];
expect(() => {
  AuthService.verifyAccessToken(tamperedToken);
}).toThrow('Invalid or expired token');
```

## Performance Tests

### Password Hashing Performance
```typescript
// Ensures bcrypt performance is acceptable
test('password hashing performance', async () => {
  const startTime = Date.now();
  await AuthService.hashPassword('TestPassword123!');
  const duration = Date.now() - startTime;
  
  expect(duration).toBeLessThan(1000); // Should complete within 1 second
});
```

### Rate Limiting Performance
```typescript
// Tests Redis operations performance
test('rate limiting check performance', async () => {
  const startTime = Date.now();
  await AuthService.checkRateLimit(email, ipAddress);
  const duration = Date.now() - startTime;
  
  expect(duration).toBeLessThan(100); // Should complete within 100ms
});
```

## Error Scenarios

### Network Failures
- Database connection timeouts
- Redis unavailability
- Email service failures

### Invalid Input Handling
- Malformed JWT tokens
- SQL injection attempts
- XSS attack vectors
- Buffer overflow attempts

### Race Conditions
- Concurrent login attempts
- Simultaneous password changes
- Token refresh conflicts

## Continuous Integration

### Pre-commit Hooks
```bash
# Run authentication tests before commit
npm run test:auth:unit
npm run test:auth:security
```

### CI Pipeline
```yaml
# GitHub Actions example
- name: Run Authentication Tests
  run: |
    npm run test:auth
    cd frontend && npm test -- --testPathPattern="auth" --coverage
```

## Test Data Management

### Mock Data
- Consistent test user accounts
- Predictable password hashes
- Controlled Redis state
- Mocked email services

### Test Database
- Isolated test environment
- Automatic cleanup
- Transaction rollbacks
- Seed data management

## Monitoring and Alerting

### Test Metrics
- Test execution time
- Coverage percentages
- Failure rates
- Security test results

### Alerts
- Failed security tests
- Coverage drops below threshold
- Performance degradation
- Authentication vulnerabilities

## Documentation Updates

When adding new authentication features:

1. **Add corresponding tests** in appropriate categories
2. **Update test documentation** with new scenarios
3. **Verify security implications** with dedicated tests
4. **Update coverage requirements** if needed
5. **Add performance benchmarks** for new operations

## Troubleshooting

### Common Test Failures

**Rate Limiting Tests Failing**
- Check Redis mock setup
- Verify timing expectations
- Ensure proper cleanup between tests

**JWT Tests Failing**
- Verify JWT_SECRET environment variable
- Check token expiration times
- Validate signature algorithms

**Frontend Tests Failing**
- Update React Testing Library setup
- Check mock implementations
- Verify async/await patterns

### Debug Commands
```bash
# Run tests with debug output
npm run test:auth -- --verbose --detectOpenHandles

# Run specific failing test
npm run test:auth -- --test "specific test name"

# Check test coverage
npm run test:auth -- --coverage
```

This comprehensive testing strategy ensures the authentication system is secure, reliable, and user-friendly while maintaining high code quality and security standards.