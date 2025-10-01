# Registration Rate Limiting Service

## Overview

The Registration Rate Limiting Service provides comprehensive rate limiting and monitoring capabilities for user registration processes. It implements multiple layers of protection against automated registration attacks and suspicious activity.

## Features

### Rate Limiting
- **IP-based rate limiting**: Limits registration attempts per IP address (5 per hour)
- **Email-based rate limiting**: Limits registration attempts per email address (3 per 24 hours)
- **Verification rate limiting**: Limits email verification attempts (10 per hour)
- **Resend verification rate limiting**: Limits resend verification requests (3 per 15 minutes)

### Progressive Delays
Implements progressive delays for repeated registration attempts:
- 1st attempt: No delay
- 2nd attempt: 5 seconds
- 3rd attempt: 15 seconds
- 4th attempt: 30 seconds
- 5th attempt: 60 seconds
- 6th+ attempts: 120+ seconds (max 300 seconds)

### Suspicious Activity Detection
Automatically detects and blocks suspicious registration patterns:
- More than 10 registrations per IP per hour
- More than 8 unique emails per IP per hour
- More than 20 failed attempts per IP per hour

### Monitoring and Alerting
- Real-time statistics collection
- Threshold monitoring with configurable limits
- Security alert generation and storage
- Historical metrics tracking
- Comprehensive monitoring reports

## Usage

### Basic Rate Limiting

```typescript
import { RegistrationRateLimitingService } from '../services/registrationRateLimitingService';

// Check IP-based rate limit
const ipResult = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(
  '192.168.1.1',
  'Mozilla/5.0...'
);

if (!ipResult.allowed) {
  // Handle rate limit exceeded
  console.log(`Rate limit exceeded. Retry after: ${ipResult.retryAfter} seconds`);
  console.log(`Progressive delay: ${ipResult.progressiveDelay} seconds`);
  
  if (ipResult.suspiciousActivity) {
    console.log('Suspicious activity detected!');
  }
}

// Check email-based rate limit
const emailResult = await RegistrationRateLimitingService.checkRegistrationRateLimitByEmail(
  'user@example.com',
  '192.168.1.1'
);

if (!emailResult.allowed) {
  // Handle rate limit exceeded
  console.log(`Email rate limit exceeded. Retry after: ${emailResult.retryAfter} seconds`);
}
```

### Recording Attempts

```typescript
// Record a registration attempt
await RegistrationRateLimitingService.recordRegistrationAttempt(
  'user@example.com',
  '192.168.1.1',
  true, // success
  'Mozilla/5.0...'
);

// Record verification attempt
await RegistrationRateLimitingService.recordVerificationAttempt(
  'user@example.com',
  '192.168.1.1',
  true // success
);

// Record resend verification attempt
await RegistrationRateLimitingService.recordResendVerificationAttempt(
  'user@example.com',
  '192.168.1.1'
);
```

### Cleanup

```typescript
// Clear attempts after successful registration
await RegistrationRateLimitingService.clearRegistrationAttempts(
  'user@example.com',
  '192.168.1.1'
);
```

### Statistics and Monitoring

```typescript
import { RegistrationMonitoringService } from '../services/registrationMonitoringService';

// Get current metrics
const metrics = await RegistrationMonitoringService.getCurrentMetrics();
console.log(`Total attempts: ${metrics.totalAttempts}`);
console.log(`Success rate: ${(metrics.successfulRegistrations / metrics.totalAttempts * 100).toFixed(1)}%`);

// Check thresholds
const thresholdCheck = await RegistrationMonitoringService.checkThresholds({
  maxRegistrationsPerHour: 50,
  maxFailureRatePercent: 30
});

if (thresholdCheck.overallStatus !== 'healthy') {
  console.log('Threshold violations detected:', thresholdCheck.violations);
}

// Generate monitoring report
const report = await RegistrationMonitoringService.generateMonitoringReport();
console.log('Registration monitoring report:', report);
```

## Configuration

### Rate Limit Configuration

The service uses the following default configurations:

```typescript
const registrationConfigs = {
  registrationPerIP: {
    limit: 5,
    windowMs: 60 * 60 * 1000, // 1 hour
    blockDuration: 2 * 60 * 60 // 2 hours lockout
  },
  registrationPerEmail: {
    limit: 3,
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    blockDuration: 24 * 60 * 60 // 24 hours lockout
  },
  verificationAttempts: {
    limit: 10,
    windowMs: 60 * 60 * 1000 // 1 hour
  },
  resendVerification: {
    limit: 3,
    windowMs: 15 * 60 * 1000 // 15 minutes
  }
};
```

### Monitoring Thresholds

```typescript
const defaultThresholds = {
  maxRegistrationsPerHour: 100,
  maxFailureRatePercent: 50,
  maxAlertsPerHour: 10,
  maxSuspiciousActivityPerHour: 5
};
```

### Suspicious Activity Thresholds

```typescript
const suspiciousActivityThresholds = {
  maxRegistrationsPerIPPerHour: 10,
  maxUniqueEmailsPerIPPerHour: 8,
  maxFailedAttemptsPerIPPerHour: 20
};
```

## Integration with Express Routes

### Registration Endpoint

```typescript
router.post('/register', async (req, res) => {
  const { email } = req.body;
  const ipAddress = req.ip || 'unknown';
  const userAgent = req.get('User-Agent');

  // Check IP rate limit
  const ipResult = await RegistrationRateLimitingService.checkRegistrationRateLimitByIP(
    ipAddress,
    userAgent
  );

  if (!ipResult.allowed) {
    return res.status(429).json({
      error: ipResult.suspiciousActivity 
        ? 'Suspicious activity detected. Please contact support.'
        : 'Too many registration attempts. Please try again later.',
      retryAfter: ipResult.retryAfter,
      progressiveDelay: ipResult.progressiveDelay
    });
  }

  // Check email rate limit
  const emailResult = await RegistrationRateLimitingService.checkRegistrationRateLimitByEmail(
    email,
    ipAddress
  );

  if (!emailResult.allowed) {
    return res.status(429).json({
      error: 'Too many registration attempts with this email.',
      retryAfter: emailResult.retryAfter
    });
  }

  try {
    // Perform registration logic...
    const success = await performRegistration(email, password);
    
    // Record the attempt
    await RegistrationRateLimitingService.recordRegistrationAttempt(
      email,
      ipAddress,
      success,
      userAgent
    );

    if (success) {
      // Clear attempts on success
      await RegistrationRateLimitingService.clearRegistrationAttempts(email, ipAddress);
    }

    return res.json({ success: true });
  } catch (error) {
    // Record failed attempt
    await RegistrationRateLimitingService.recordRegistrationAttempt(
      email,
      ipAddress,
      false,
      userAgent
    );
    
    throw error;
  }
});
```

## Redis Data Structure

### Rate Limiting Keys

```
registration:ip:{ipAddress}           - Array of registration attempts by IP
registration:email:{email}            - Array of registration attempts by email
registration:resend:{email}:{ip}      - Array of resend verification attempts
registration:global:attempts          - Global registration attempts log
```

### Monitoring Keys

```
registration:metrics:{timestamp}      - Historical metrics by minute
registration:alert:{alertId}          - Security alerts
registration:alerts:count             - Alert counter
```

### Data Retention

- Registration attempts: 25 hours
- Resend attempts: 1 hour
- Metrics: 7 days
- Alerts: 7 days

## Security Considerations

### Data Privacy
- Email addresses are normalized (lowercase) for consistency
- IP addresses are logged for security monitoring
- User agents are stored for pattern analysis
- All PII is encrypted at rest in Redis

### Attack Mitigation
- Progressive delays slow down automated attacks
- Suspicious activity detection blocks coordinated attacks
- IP and email-based limits prevent both distributed and concentrated attacks
- Comprehensive logging enables forensic analysis

### Monitoring and Alerting
- Real-time threshold monitoring
- Automated alert generation
- Historical trend analysis
- Integration points for external monitoring systems

## Performance Considerations

### Redis Usage
- Efficient data structures (arrays with TTL)
- Automatic cleanup of expired data
- Connection pooling and error handling
- Batch operations where possible

### Memory Management
- Limited array sizes (max 100 entries per key)
- Automatic pruning of old entries
- TTL-based expiration
- Configurable retention periods

### Scalability
- Stateless service design
- Redis-based shared state
- Horizontal scaling support
- Load balancer friendly

## Testing

The service includes comprehensive test coverage:

### Unit Tests
- Rate limiting logic
- Progressive delay calculation
- Suspicious activity detection
- Error handling
- Statistics calculation

### Integration Tests
- Redis integration
- End-to-end rate limiting flows
- Monitoring and alerting
- Cleanup and recovery

### Performance Tests
- High-volume registration attempts
- Concurrent user scenarios
- Memory usage under load
- Redis performance optimization

## Troubleshooting

### Common Issues

1. **Rate limits not working**
   - Check Redis connection
   - Verify configuration values
   - Check system clock synchronization

2. **False positive suspicious activity**
   - Review thresholds in configuration
   - Check for legitimate high-volume scenarios
   - Adjust detection parameters

3. **Memory usage growing**
   - Verify TTL settings
   - Check for Redis memory limits
   - Monitor key expiration

### Debugging

Enable debug logging:
```typescript
// Set LOG_LEVEL=debug in environment
logger.debug('Rate limit check', { email, ipAddress, result });
```

Monitor Redis keys:
```bash
redis-cli KEYS "registration:*"
redis-cli TTL "registration:ip:192.168.1.1"
```

Check statistics:
```typescript
const stats = await RegistrationRateLimitingService.getRegistrationStatistics();
console.log('Current statistics:', stats);
```