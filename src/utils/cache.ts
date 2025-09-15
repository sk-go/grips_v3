/**
 * Cache utilities with TTL management for Redis-based overlay data
 * Provides type-safe caching operations with automatic serialization/deserialization
 */

import { RedisService } from '../services/redis';
import { logger } from './logger';
import { 
  CacheEntry, 
  CrmCacheData, 
  EmailSyncState, 
  AIContextCache, 
  REDIS_KEYS,
  Client,
  Communication,
  Task,
  AIAction,
  DocumentTemplate,
  GeneratedDocument
} from '../types';

// ============================================================================
// Cache Configuration
// ============================================================================

export const CACHE_TTL = {
  // Session data - 24 hours
  SESSION: 24 * 60 * 60,
  
  // CRM data - 6 hours (frequent sync needed)
  CRM_CLIENT: 6 * 60 * 60,
  CRM_SYNC_STATUS: 30 * 60,
  
  // Email sync state - 24 hours
  EMAIL_SYNC: 24 * 60 * 60,
  
  // AI context - 1 hour (conversation context)
  AI_CONTEXT: 60 * 60,
  AI_QUEUE: 24 * 60 * 60,
  AI_CHAIN: 2 * 60 * 60,
  
  // Communication data - 7 days
  COMMUNICATION: 7 * 24 * 60 * 60,
  CLIENT_COMMUNICATIONS: 7 * 24 * 60 * 60,
  
  // Task data - 30 days
  TASK: 30 * 24 * 60 * 60,
  CLIENT_TASKS: 30 * 24 * 60 * 60,
  
  // Document data - 7 days (temporary storage)
  DOCUMENT: 7 * 24 * 60 * 60,
  TEMPLATE: 30 * 24 * 60 * 60,
  
  // Rate limiting - 1 hour
  RATE_LIMIT: 60 * 60,
  
  // Audit logs - 90 days (compliance requirement)
  AUDIT_BLOCK: 90 * 24 * 60 * 60,
} as const;

// ============================================================================
// Generic Cache Operations
// ============================================================================

export class CacheManager {
  /**
   * Store data in cache with TTL and metadata
   */
  static async set<T>(
    key: string, 
    data: T, 
    ttl: number = CACHE_TTL.SESSION,
    source: string = 'system'
  ): Promise<void> {
    try {
      const cacheEntry: CacheEntry<T> = {
        data,
        timestamp: new Date(),
        ttl,
        version: '1.0',
        source
      };

      await RedisService.set(key, cacheEntry, ttl);
      
      logger.debug('Cache entry stored', { 
        key, 
        ttl, 
        source,
        dataType: typeof data 
      });
    } catch (error) {
      logger.error('Failed to store cache entry', { 
        key, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Retrieve data from cache with automatic deserialization
   */
  static async get<T>(key: string): Promise<T | null> {
    try {
      const cacheEntry = await RedisService.get(key) as CacheEntry<T> | null;
      
      if (!cacheEntry) {
        logger.debug('Cache miss', { key });
        return null;
      }

      // Check if cache entry is still valid (additional validation)
      const now = new Date();
      const entryAge = (now.getTime() - new Date(cacheEntry.timestamp).getTime()) / 1000;
      
      if (entryAge > cacheEntry.ttl) {
        logger.debug('Cache entry expired', { key, age: entryAge, ttl: cacheEntry.ttl });
        await this.delete(key);
        return null;
      }

      logger.debug('Cache hit', { 
        key, 
        age: entryAge, 
        source: cacheEntry.source 
      });
      
      return cacheEntry.data;
    } catch (error) {
      logger.error('Failed to retrieve cache entry', { 
        key, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return null;
    }
  }

  /**
   * Delete cache entry
   */
  static async delete(key: string): Promise<void> {
    try {
      await RedisService.del(key);
      logger.debug('Cache entry deleted', { key });
    } catch (error) {
      logger.error('Failed to delete cache entry', { 
        key, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  /**
   * Check if cache entry exists
   */
  static async exists(key: string): Promise<boolean> {
    try {
      return await RedisService.exists(key);
    } catch (error) {
      logger.error('Failed to check cache entry existence', { 
        key, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return false;
    }
  }

  /**
   * Update TTL for existing cache entry
   */
  static async updateTTL(key: string, ttl: number): Promise<void> {
    try {
      const client = RedisService.getClient();
      await client.expire(key, ttl);
      logger.debug('Cache TTL updated', { key, ttl });
    } catch (error) {
      logger.error('Failed to update cache TTL', { 
        key, 
        ttl,
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }
}

// ============================================================================
// Specialized Cache Services
// ============================================================================

export class CrmCacheService {
  /**
   * Cache CRM client data with sync metadata
   */
  static async setCrmClient(
    crmSystem: string, 
    crmId: string, 
    clientData: Client,
    syncStatus: 'success' | 'partial' | 'failed' = 'success',
    errors: string[] = []
  ): Promise<void> {
    const key = REDIS_KEYS.CRM_CLIENT(crmSystem, crmId);
    const cacheData: CrmCacheData = {
      clientData,
      lastSync: new Date(),
      syncStatus,
      errors
    };

    await CacheManager.set(key, cacheData, CACHE_TTL.CRM_CLIENT, `crm:${crmSystem}`);
  }

  /**
   * Retrieve CRM client data
   */
  static async getCrmClient(crmSystem: string, crmId: string): Promise<CrmCacheData | null> {
    const key = REDIS_KEYS.CRM_CLIENT(crmSystem, crmId);
    return await CacheManager.get<CrmCacheData>(key);
  }

  /**
   * Set CRM sync status
   */
  static async setCrmSyncStatus(crmSystem: string, status: any): Promise<void> {
    const key = REDIS_KEYS.CRM_SYNC_STATUS(crmSystem);
    await CacheManager.set(key, status, CACHE_TTL.CRM_SYNC_STATUS, `crm:${crmSystem}`);
  }

  /**
   * Get CRM sync status
   */
  static async getCrmSyncStatus(crmSystem: string): Promise<any | null> {
    const key = REDIS_KEYS.CRM_SYNC_STATUS(crmSystem);
    return await CacheManager.get(key);
  }
}

export class CommunicationCacheService {
  /**
   * Cache communication data
   */
  static async setCommunication(communication: Communication): Promise<void> {
    const key = REDIS_KEYS.COMMUNICATION(communication.id);
    await CacheManager.set(key, communication, CACHE_TTL.COMMUNICATION, 'communication');

    // Also add to client's communication list
    await this.addToClientCommunications(communication.clientId, communication.id);
  }

  /**
   * Get communication data
   */
  static async getCommunication(communicationId: string): Promise<Communication | null> {
    const key = REDIS_KEYS.COMMUNICATION(communicationId);
    return await CacheManager.get<Communication>(key);
  }

  /**
   * Add communication ID to client's communication list
   */
  static async addToClientCommunications(clientId: string, communicationId: string): Promise<void> {
    const key = REDIS_KEYS.CLIENT_COMMUNICATIONS(clientId);
    const client = RedisService.getClient();
    
    try {
      await client.lPush(key, communicationId);
      await client.expire(key, CACHE_TTL.CLIENT_COMMUNICATIONS);
      
      logger.debug('Communication added to client list', { clientId, communicationId });
    } catch (error) {
      logger.error('Failed to add communication to client list', {
        clientId,
        communicationId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get client's communication IDs
   */
  static async getClientCommunications(clientId: string, limit: number = 50): Promise<string[]> {
    const key = REDIS_KEYS.CLIENT_COMMUNICATIONS(clientId);
    const client = RedisService.getClient();
    
    try {
      return await client.lRange(key, 0, limit - 1);
    } catch (error) {
      logger.error('Failed to get client communications', {
        clientId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }
}

export class TaskCacheService {
  /**
   * Cache task data
   */
  static async setTask(task: Task): Promise<void> {
    const key = REDIS_KEYS.TASK(task.id);
    await CacheManager.set(key, task, CACHE_TTL.TASK, 'task');

    // Add to client's task list if associated with a client
    if (task.clientId) {
      await this.addToClientTasks(task.clientId, task.id);
    }
  }

  /**
   * Get task data
   */
  static async getTask(taskId: string): Promise<Task | null> {
    const key = REDIS_KEYS.TASK(taskId);
    return await CacheManager.get<Task>(key);
  }

  /**
   * Add task ID to client's task list
   */
  static async addToClientTasks(clientId: string, taskId: string): Promise<void> {
    const key = REDIS_KEYS.CLIENT_TASKS(clientId);
    const client = RedisService.getClient();
    
    try {
      await client.lPush(key, taskId);
      await client.expire(key, CACHE_TTL.CLIENT_TASKS);
      
      logger.debug('Task added to client list', { clientId, taskId });
    } catch (error) {
      logger.error('Failed to add task to client list', {
        clientId,
        taskId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get client's task IDs
   */
  static async getClientTasks(clientId: string, limit: number = 50): Promise<string[]> {
    const key = REDIS_KEYS.CLIENT_TASKS(clientId);
    const client = RedisService.getClient();
    
    try {
      return await client.lRange(key, 0, limit - 1);
    } catch (error) {
      logger.error('Failed to get client tasks', {
        clientId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }
}

export class AICacheService {
  /**
   * Set AI context for a session
   */
  static async setAIContext(sessionId: string, context: AIContextCache): Promise<void> {
    const key = REDIS_KEYS.AI_CONTEXT(sessionId);
    await CacheManager.set(key, context, CACHE_TTL.AI_CONTEXT, 'ai');
  }

  /**
   * Get AI context for a session
   */
  static async getAIContext(sessionId: string): Promise<AIContextCache | null> {
    const key = REDIS_KEYS.AI_CONTEXT(sessionId);
    return await CacheManager.get<AIContextCache>(key);
  }

  /**
   * Add AI action to agent's queue
   */
  static async addToAIQueue(agentId: string, action: AIAction): Promise<void> {
    const key = REDIS_KEYS.AI_QUEUE(agentId);
    const client = RedisService.getClient();
    
    try {
      await client.lPush(key, JSON.stringify(action));
      await client.expire(key, CACHE_TTL.AI_QUEUE);
      
      logger.debug('AI action added to queue', { agentId, actionId: action.id });
    } catch (error) {
      logger.error('Failed to add AI action to queue', {
        agentId,
        actionId: action.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get pending AI actions for agent
   */
  static async getAIQueue(agentId: string, limit: number = 20): Promise<AIAction[]> {
    const key = REDIS_KEYS.AI_QUEUE(agentId);
    const client = RedisService.getClient();
    
    try {
      const actions = await client.lRange(key, 0, limit - 1);
      return actions.map(action => JSON.parse(action) as AIAction);
    } catch (error) {
      logger.error('Failed to get AI queue', {
        agentId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Remove AI action from queue
   */
  static async removeFromAIQueue(agentId: string, actionId: string): Promise<void> {
    const key = REDIS_KEYS.AI_QUEUE(agentId);
    const client = RedisService.getClient();
    
    try {
      // Get all actions and filter out the one to remove
      const actions = await this.getAIQueue(agentId);
      const filteredActions = actions.filter(action => action.id !== actionId);
      
      // Clear the list and repopulate
      await client.del(key);
      if (filteredActions.length > 0) {
        const serializedActions = filteredActions.map(action => JSON.stringify(action));
        for (const serializedAction of serializedActions) {
          await client.lPush(key, serializedAction);
        }
        await client.expire(key, CACHE_TTL.AI_QUEUE);
      }
      
      logger.debug('AI action removed from queue', { agentId, actionId });
    } catch (error) {
      logger.error('Failed to remove AI action from queue', {
        agentId,
        actionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

export class DocumentCacheService {
  /**
   * Cache document template
   */
  static async setTemplate(template: DocumentTemplate): Promise<void> {
    const key = REDIS_KEYS.TEMPLATE(template.id);
    await CacheManager.set(key, template, CACHE_TTL.TEMPLATE, 'document');
  }

  /**
   * Get document template
   */
  static async getTemplate(templateId: string): Promise<DocumentTemplate | null> {
    const key = REDIS_KEYS.TEMPLATE(templateId);
    return await CacheManager.get<DocumentTemplate>(key);
  }

  /**
   * Cache generated document
   */
  static async setDocument(document: GeneratedDocument): Promise<void> {
    const key = REDIS_KEYS.DOCUMENT(document.id);
    await CacheManager.set(key, document, CACHE_TTL.DOCUMENT, 'document');
  }

  /**
   * Get generated document
   */
  static async getDocument(documentId: string): Promise<GeneratedDocument | null> {
    const key = REDIS_KEYS.DOCUMENT(documentId);
    return await CacheManager.get<GeneratedDocument>(key);
  }
}

// ============================================================================
// Email Sync Cache Service
// ============================================================================

export class EmailSyncCacheService {
  /**
   * Set email sync state
   */
  static async setEmailSyncState(accountId: string, state: EmailSyncState): Promise<void> {
    const key = REDIS_KEYS.EMAIL_SYNC(accountId);
    await CacheManager.set(key, state, CACHE_TTL.EMAIL_SYNC, 'email');
  }

  /**
   * Get email sync state
   */
  static async getEmailSyncState(accountId: string): Promise<EmailSyncState | null> {
    const key = REDIS_KEYS.EMAIL_SYNC(accountId);
    return await CacheManager.get<EmailSyncState>(key);
  }

  /**
   * Update sync status
   */
  static async updateSyncStatus(
    accountId: string, 
    status: 'idle' | 'syncing' | 'error',
    errorCount?: number
  ): Promise<void> {
    const currentState = await this.getEmailSyncState(accountId);
    if (currentState) {
      currentState.syncStatus = status;
      if (errorCount !== undefined) {
        currentState.errorCount = errorCount;
      }
      await this.setEmailSyncState(accountId, currentState);
    }
  }
}

// ============================================================================
// Cache Cleanup and Maintenance
// ============================================================================

export class CacheMaintenanceService {
  /**
   * Clean up expired cache entries (manual cleanup for additional safety)
   */
  static async cleanupExpiredEntries(): Promise<void> {
    try {
      const client = RedisService.getClient();
      
      // Get all keys with our prefixes
      const patterns = [
        'session:*',
        'crm_client:*',
        'communication:*',
        'task:*',
        'ai_context:*',
        'document:*'
      ];

      for (const pattern of patterns) {
        const keys = await client.keys(pattern);
        
        for (const key of keys) {
          const ttl = await client.ttl(key);
          if (ttl === -1) {
            // Key exists but has no TTL, this shouldn't happen
            logger.warn('Found key without TTL', { key });
          }
        }
      }
      
      logger.info('Cache cleanup completed');
    } catch (error) {
      logger.error('Cache cleanup failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get cache statistics
   */
  static async getCacheStats(): Promise<Record<string, number>> {
    try {
      const client = RedisService.getClient();
      const info = await client.info('memory');
      
      // Parse Redis info response
      const stats: Record<string, number> = {};
      const lines = info.split('\r\n');
      
      for (const line of lines) {
        if (line.includes(':')) {
          const [key, value] = line.split(':');
          const numValue = parseInt(value, 10);
          if (!isNaN(numValue)) {
            stats[key] = numValue;
          }
        }
      }
      
      return stats;
    } catch (error) {
      logger.error('Failed to get cache stats', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return {};
    }
  }
}