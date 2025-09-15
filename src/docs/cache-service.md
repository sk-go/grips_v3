# Cache Service Documentation

## Overview

The Cache Service provides a Redis-based data access layer for CRM overlay data with blockchain-lite audit trail functionality. It implements cache-only storage to avoid data duplication while maintaining compliance through immutable audit logs.

## Key Features

- **Cache-Only Storage**: No persistent client data storage, only CRM overlay enhancements
- **Blockchain-lite Audit Trail**: Immutable audit logs for compliance (HIPAA/GDPR)
- **TTL Management**: Automatic expiration of cached data based on data type
- **CRM Sync Support**: Bi-directional synchronization with multiple CRM systems
- **Error Handling**: Graceful degradation and comprehensive error logging

## Architecture

### Core Components

1. **CacheManager**: Generic cache operations with TTL and metadata
2. **CrmCacheService**: CRM-specific caching with sync status tracking
3. **CommunicationCacheService**: Communication data caching with client association
4. **TaskCacheService**: Task management with client task lists
5. **AICacheService**: AI context and action queue management
6. **DocumentCacheService**: Document template and generation caching
7. **AuditTrailService**: Blockchain-lite audit trail implementation

### Data Flow

```
CRM System → Cache Service → Redis Cache
     ↓              ↓
Audit Trail ← Blockchain-lite Blocks
```

## Usage Examples

### Caching CRM Client Data

```typescript
import { CacheService } from '../services/cacheService';

// Cache client data from CRM sync
await CacheService.setCrmClient(
  'salesforce',
  'crm-123',
  clientData,
  'agent-456'
);

// Retrieve cached client data
const client = await CacheService.getCrmClient(
  'salesforce',
  'crm-123',
  'agent-456'
);
```

### Managing Communications

```typescript
// Cache communication
await CacheService.setCommunication(communication, 'agent-456');

// Get communication
const comm = await CacheService.getCommunication('comm-123', 'agent-456');
```

### AI Action Management

```typescript
// Add AI action to queue
await CacheService.addAIAction('agent-123', aiAction, 'agent-456');

// Get pending actions
const actions = await AICacheService.getAIQueue('agent-123');
```

## Cache TTL Configuration

| Data Type | TTL | Reason |
|-----------|-----|--------|
| Session | 24 hours | User session duration |
| CRM Client | 6 hours | Balance freshness vs API calls |
| AI Context | 1 hour | Conversation context relevance |
| Communication | 7 days | Recent interaction history |
| Task | 30 days | Task lifecycle management |
| Document | 7 days | Temporary document storage |
| Audit Block | 90 days | Compliance requirement |

## Redis Key Patterns

- `session:{sessionId}` - User session data
- `crm_client:{crmSystem}:{crmId}` - CRM client overlay data
- `communication:{communicationId}` - Individual communications
- `client_comms:{clientId}` - Client communication list
- `task:{taskId}` - Individual tasks
- `client_tasks:{clientId}` - Client task list
- `ai_queue:{agentId}` - Pending AI actions
- `ai_context:{sessionId}` - AI conversation context
- `document:{documentId}` - Generated documents
- `audit_block:{blockNumber}` - Audit trail blocks

## Audit Trail Implementation

### Blockchain-lite Structure

The audit trail uses a simplified blockchain structure:

```typescript
interface AuditBlock {
  blockNumber: number;
  timestamp: Date;
  logs: AuditLog[];
  previousHash: string;
  hash: string;
}
```

### Features

- **Immutable Logs**: Once written, audit logs cannot be modified
- **Hash Chain**: Each block references the previous block's hash
- **Integrity Verification**: Built-in verification of audit trail integrity
- **Compliance**: Meets HIPAA/GDPR audit requirements

### Usage

```typescript
// Verify audit trail integrity
const { valid, errors } = await CacheService.verifyAuditIntegrity();

// Get audit logs for an entity
const logs = await CacheService.getAuditLogs('client', 'client-123');
```

## Error Handling

### Graceful Degradation

- Cache failures don't break application functionality
- Fallback to direct CRM API calls when cache unavailable
- Comprehensive error logging for debugging

### Error Scenarios

1. **Redis Connection Failure**: Returns null, logs error
2. **Cache Expiration**: Automatic cleanup and re-fetch
3. **Audit Trail Corruption**: Integrity verification and alerts
4. **CRM Sync Failures**: Error tracking with partial sync support

## Performance Considerations

### Optimization Strategies

- **Connection Pooling**: Redis connection reuse
- **Batch Operations**: Multiple cache operations in single call
- **TTL Management**: Automatic expiration prevents memory bloat
- **Compression**: Large objects compressed before storage

### Monitoring

```typescript
// Get cache statistics
const stats = await CacheService.getCacheStats();

// Cleanup expired entries
await CacheService.cleanup();
```

## Testing

### Unit Tests

- Mock Redis operations for isolated testing
- Validate data structure integrity
- Test TTL expiration logic
- Error handling scenarios

### Integration Tests

- Real Redis instance testing
- CRM sync workflow validation
- Concurrent operation handling
- Performance benchmarking

### Running Tests

```bash
# Run cache-specific tests
npm test -- --testPathPattern=cache

# Run with coverage
npm test -- --coverage --testPathPattern=cache
```

## Configuration

### Environment Variables

```env
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=your-password
LOG_LEVEL=info
```

### Cache Configuration

```typescript
// Custom TTL values
export const CACHE_TTL = {
  SESSION: 24 * 60 * 60,      // 24 hours
  CRM_CLIENT: 6 * 60 * 60,    // 6 hours
  AI_CONTEXT: 60 * 60,        // 1 hour
  // ... other TTL values
};
```

## Compliance Features

### GDPR Compliance

- **Data Minimization**: Only cache essential overlay data
- **Right to Erasure**: Cache expiration ensures data deletion
- **Audit Trail**: Complete record of data access and modifications
- **Consent Tracking**: Audit logs include consent metadata

### HIPAA Compliance

- **Encryption**: AES-256 encryption for sensitive data
- **Access Logging**: All data access logged in audit trail
- **Minimum Necessary**: Only cache data needed for functionality
- **Audit Trail**: Immutable logs for compliance reporting

## Troubleshooting

### Common Issues

1. **Cache Miss Rate High**: Check TTL values and CRM sync frequency
2. **Memory Usage High**: Review cleanup processes and TTL settings
3. **Audit Trail Errors**: Verify Redis connectivity and permissions
4. **Performance Slow**: Check Redis connection pool and query patterns

### Debug Commands

```typescript
// Check cache statistics
const stats = await CacheService.getCacheStats();

// Verify audit integrity
const integrity = await CacheService.verifyAuditIntegrity();

// Manual cleanup
await CacheService.cleanup();
```

## Future Enhancements

- **Redis Cluster Support**: Horizontal scaling for high availability
- **Cache Warming**: Proactive cache population for better performance
- **Advanced Analytics**: Cache hit/miss ratio tracking and optimization
- **Compression**: Automatic compression for large cached objects
- **Encryption**: Field-level encryption for sensitive data elements