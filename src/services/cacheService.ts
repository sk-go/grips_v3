/**
 * Redis-based data access layer for CRM overlay data
 * Implements cache-only storage with blockchain-lite audit trail for compliance
 */

import { RedisService } from './redis';
import { logger } from '../utils/logger';
import {
  CacheManager,
  CrmCacheService,
  CommunicationCacheService,
  TaskCacheService,
  AICacheService,
  DocumentCacheService,
  EmailSyncCacheService,
  CacheMaintenanceService
} from '../utils/cache';
import {
  Client,
  Communication,
  Task,
  AIAction,
  AIChain,
  DocumentTemplate,
  GeneratedDocument,
  AuditLog,
  AuditAction,
  AuditMetadata,
  REDIS_KEYS
} from '../types';
import crypto from 'crypto';

// ============================================================================
// Blockchain-lite Audit Trail Implementation
// ============================================================================

export class AuditTrailService {
  private static currentBlockNumber = 0;
  private static readonly BLOCK_SIZE = 100; // Number of audit logs per block

  /**
   * Initialize audit trail system
   */
  static async initialize(): Promise<void> {
    try {
      // Get the latest block number from Redis
      const latestHash = await RedisService.get(REDIS_KEYS.AUDIT_HASH());
      if (latestHash) {
        // Find the current block number by checking existing blocks
        let blockNum = 0;
        while (await RedisService.exists(REDIS_KEYS.AUDIT_BLOCK(blockNum))) {
          blockNum++;
        }
        this.currentBlockNumber = Math.max(0, blockNum - 1);
      }
      
      logger.info('Audit trail initialized', { currentBlock: this.currentBlockNumber });
    } catch (error) {
      logger.error('Failed to initialize audit trail', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Add audit log entry to blockchain-lite structure
   */
  static async addAuditLog(auditLog: AuditLog): Promise<void> {
    try {
      const blockKey = REDIS_KEYS.AUDIT_BLOCK(this.currentBlockNumber);
      const client = RedisService.getClient();

      // Get current block
      let currentBlock = await RedisService.get(blockKey);
      if (!currentBlock) {
        currentBlock = {
          blockNumber: this.currentBlockNumber,
          timestamp: new Date(),
          logs: [],
          previousHash: await this.getPreviousBlockHash(),
          hash: ''
        };
      }

      // Add log to current block
      currentBlock.logs.push(auditLog);

      // Check if block is full
      if (currentBlock.logs.length >= this.BLOCK_SIZE) {
        // Finalize current block
        currentBlock.hash = this.calculateBlockHash(currentBlock);
        await RedisService.set(blockKey, currentBlock, 90 * 24 * 60 * 60); // 90 days TTL
        await RedisService.set(REDIS_KEYS.AUDIT_HASH(), currentBlock.hash);

        // Start new block
        this.currentBlockNumber++;
        logger.info('Audit block finalized', { 
          blockNumber: currentBlock.blockNumber,
          logCount: currentBlock.logs.length,
          hash: currentBlock.hash
        });
      } else {
        // Update current block
        await RedisService.set(blockKey, currentBlock, 90 * 24 * 60 * 60);
      }

      logger.debug('Audit log added', { 
        auditId: auditLog.id,
        blockNumber: this.currentBlockNumber,
        action: auditLog.action.type
      });
    } catch (error) {
      logger.error('Failed to add audit log', {
        auditId: auditLog.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Calculate hash for a block (blockchain-lite implementation)
   */
  private static calculateBlockHash(block: any): string {
    const blockString = JSON.stringify({
      blockNumber: block.blockNumber,
      timestamp: block.timestamp,
      logs: block.logs,
      previousHash: block.previousHash
    });
    
    return crypto.createHash('sha256').update(blockString).digest('hex');
  }

  /**
   * Get hash of previous block
   */
  private static async getPreviousBlockHash(): Promise<string> {
    if (this.currentBlockNumber === 0) {
      return '0'; // Genesis block
    }

    const previousBlockKey = REDIS_KEYS.AUDIT_BLOCK(this.currentBlockNumber - 1);
    const previousBlock = await RedisService.get(previousBlockKey);
    
    return previousBlock?.hash || '0';
  }

  /**
   * Verify audit trail integrity
   */
  static async verifyIntegrity(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    
    try {
      for (let i = 0; i <= this.currentBlockNumber; i++) {
        const blockKey = REDIS_KEYS.AUDIT_BLOCK(i);
        const block = await RedisService.get(blockKey);
        
        if (!block) {
          errors.push(`Missing block ${i}`);
          continue;
        }

        // Verify block hash
        const calculatedHash = this.calculateBlockHash(block);
        if (block.hash && block.hash !== calculatedHash) {
          errors.push(`Block ${i} hash mismatch`);
        }

        // Verify previous hash chain
        if (i > 0) {
          const previousBlockKey = REDIS_KEYS.AUDIT_BLOCK(i - 1);
          const previousBlock = await RedisService.get(previousBlockKey);
          
          if (previousBlock && block.previousHash !== previousBlock.hash) {
            errors.push(`Block ${i} previous hash mismatch`);
          }
        }
      }

      const isValid = errors.length === 0;
      logger.info('Audit trail integrity check completed', { 
        valid: isValid, 
        errorCount: errors.length 
      });

      return { valid: isValid, errors };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Audit trail verification failed', { error: errorMsg });
      return { valid: false, errors: [errorMsg] };
    }
  }

  /**
   * Get audit logs for a specific entity
   */
  static async getAuditLogs(
    entityType: string, 
    entityId: string, 
    limit: number = 50
  ): Promise<AuditLog[]> {
    const logs: AuditLog[] = [];
    
    try {
      // Search through blocks (in reverse order for recent logs first)
      for (let i = this.currentBlockNumber; i >= 0 && logs.length < limit; i--) {
        const blockKey = REDIS_KEYS.AUDIT_BLOCK(i);
        const block = await RedisService.get(blockKey);
        
        if (block && block.logs) {
          const matchingLogs = block.logs.filter((log: AuditLog) => 
            log.entityType === entityType && log.entityId === entityId
          );
          
          logs.push(...matchingLogs);
        }
      }

      return logs.slice(0, limit);
    } catch (error) {
      logger.error('Failed to get audit logs', {
        entityType,
        entityId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }
}

// ============================================================================
// Main Cache Service Class
// ============================================================================

export class CacheService {
  private redisClient: any;

  constructor(redisClient?: any) {
    this.redisClient = redisClient || RedisService.getClient();
  }

  // Instance methods for compatibility with existing services
  async get(key: string): Promise<string | null> {
    return await RedisService.get(key);
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    await RedisService.set(key, value, ttl);
  }

  async delete(key: string): Promise<void> {
    await RedisService.del(key);
  }

  async exists(key: string): Promise<boolean> {
    return await RedisService.exists(key);
  }

  /**
   * Initialize cache service and audit trail
   */
  static async initialize(): Promise<void> {
    try {
      await AuditTrailService.initialize();
      logger.info('Cache service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize cache service', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Create audit log entry for cache operations
   */
  static async createAuditLog(
    userId: string,
    action: AuditAction,
    entityType: string,
    entityId: string,
    metadata: Partial<AuditMetadata>,
    ipAddress: string = 'unknown',
    userAgent: string = 'cache-service'
  ): Promise<void> {
    const auditLog: AuditLog = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      userId,
      action,
      entityType: entityType as any,
      entityId,
      metadata: {
        source: 'system',
        correlationId: crypto.randomUUID(),
        ...metadata
      } as AuditMetadata,
      ipAddress,
      userAgent
    };

    await AuditTrailService.addAuditLog(auditLog);
  }

  // ============================================================================
  // CRM Data Operations with Audit Trail
  // ============================================================================

  /**
   * Cache CRM client data with audit logging
   */
  static async setCrmClient(
    crmSystem: string,
    crmId: string,
    clientData: Client,
    userId: string,
    syncStatus: 'success' | 'partial' | 'failed' = 'success'
  ): Promise<void> {
    try {
      await CrmCacheService.setCrmClient(crmSystem, crmId, clientData, syncStatus);
      
      await this.createAuditLog(
        userId,
        { type: 'update', description: 'CRM client data cached', riskLevel: 'low' },
        'client',
        clientData.id,
        { source: 'system', duration: 0 }
      );

      logger.info('CRM client cached with audit', { 
        crmSystem, 
        crmId, 
        clientId: clientData.id 
      });
    } catch (error) {
      logger.error('Failed to cache CRM client', {
        crmSystem,
        crmId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get CRM client data
   */
  static async getCrmClient(
    crmSystem: string, 
    crmId: string,
    userId: string
  ): Promise<Client | null> {
    try {
      const cacheData = await CrmCacheService.getCrmClient(crmSystem, crmId);
      
      if (cacheData) {
        await this.createAuditLog(
          userId,
          { type: 'read', description: 'CRM client data accessed', riskLevel: 'low' },
          'client',
          cacheData.clientData.id,
          { source: 'system' }
        );
        
        return cacheData.clientData;
      }
      
      return null;
    } catch (error) {
      logger.error('Failed to get CRM client', {
        crmSystem,
        crmId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  // ============================================================================
  // Communication Operations with Audit Trail
  // ============================================================================

  /**
   * Cache communication with audit logging
   */
  static async setCommunication(
    communication: Communication,
    userId: string
  ): Promise<void> {
    try {
      await CommunicationCacheService.setCommunication(communication);
      
      await this.createAuditLog(
        userId,
        { type: 'create', description: 'Communication cached', riskLevel: 'medium' },
        'communication',
        communication.id,
        { source: 'system' }
      );

      logger.info('Communication cached with audit', { 
        communicationId: communication.id,
        type: communication.type,
        clientId: communication.clientId
      });
    } catch (error) {
      logger.error('Failed to cache communication', {
        communicationId: communication.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get communication data
   */
  static async getCommunication(
    communicationId: string,
    userId: string
  ): Promise<Communication | null> {
    try {
      const communication = await CommunicationCacheService.getCommunication(communicationId);
      
      if (communication) {
        await this.createAuditLog(
          userId,
          { type: 'read', description: 'Communication accessed', riskLevel: 'low' },
          'communication',
          communicationId,
          { source: 'system' }
        );
      }
      
      return communication;
    } catch (error) {
      logger.error('Failed to get communication', {
        communicationId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  // ============================================================================
  // Task Operations with Audit Trail
  // ============================================================================

  /**
   * Cache task with audit logging
   */
  static async setTask(task: Task, userId: string): Promise<void> {
    try {
      await TaskCacheService.setTask(task);
      
      await this.createAuditLog(
        userId,
        { type: 'create', description: 'Task cached', riskLevel: 'low' },
        'task',
        task.id,
        { source: 'system' }
      );

      logger.info('Task cached with audit', { 
        taskId: task.id,
        type: task.type,
        clientId: task.clientId
      });
    } catch (error) {
      logger.error('Failed to cache task', {
        taskId: task.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get task data
   */
  static async getTask(taskId: string, userId: string): Promise<Task | null> {
    try {
      const task = await TaskCacheService.getTask(taskId);
      
      if (task) {
        await this.createAuditLog(
          userId,
          { type: 'read', description: 'Task accessed', riskLevel: 'low' },
          'task',
          taskId,
          { source: 'system' }
        );
      }
      
      return task;
    } catch (error) {
      logger.error('Failed to get task', {
        taskId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  // ============================================================================
  // AI Operations with Audit Trail
  // ============================================================================

  /**
   * Add AI action to queue with audit logging
   */
  static async addAIAction(
    agentId: string,
    action: AIAction,
    userId: string
  ): Promise<void> {
    try {
      await AICacheService.addToAIQueue(agentId, action);
      
      await this.createAuditLog(
        userId,
        { 
          type: 'create', 
          description: `AI action queued: ${action.type}`, 
          riskLevel: action.riskLevel 
        },
        'ai_action',
        action.id,
        { 
          source: 'ai',
          chainId: action.chainId,
          duration: 0
        }
      );

      logger.info('AI action queued with audit', { 
        agentId,
        actionId: action.id,
        type: action.type,
        riskLevel: action.riskLevel
      });
    } catch (error) {
      logger.error('Failed to queue AI action', {
        agentId,
        actionId: action.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  // ============================================================================
  // Document Operations with Audit Trail
  // ============================================================================

  /**
   * Cache document with audit logging
   */
  static async setDocument(
    document: GeneratedDocument,
    userId: string
  ): Promise<void> {
    try {
      await DocumentCacheService.setDocument(document);
      
      await this.createAuditLog(
        userId,
        { 
          type: 'create', 
          description: 'Document cached', 
          riskLevel: document.status === 'approved' ? 'high' : 'medium' 
        },
        'document',
        document.id,
        { source: 'system' }
      );

      logger.info('Document cached with audit', { 
        documentId: document.id,
        templateId: document.templateId,
        status: document.status
      });
    } catch (error) {
      logger.error('Failed to cache document', {
        documentId: document.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get cache statistics
   */
  static async getCacheStats(): Promise<Record<string, any>> {
    try {
      const stats = await CacheMaintenanceService.getCacheStats();
      const auditStats = {
        currentBlock: AuditTrailService['currentBlockNumber'],
        auditIntegrity: await AuditTrailService.verifyIntegrity()
      };
      
      return { ...stats, audit: auditStats };
    } catch (error) {
      logger.error('Failed to get cache stats', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return {};
    }
  }

  /**
   * Cleanup expired cache entries
   */
  static async cleanup(): Promise<void> {
    try {
      await CacheMaintenanceService.cleanupExpiredEntries();
      logger.info('Cache cleanup completed');
    } catch (error) {
      logger.error('Cache cleanup failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get audit logs for entity
   */
  static async getAuditLogs(
    entityType: string,
    entityId: string,
    limit: number = 50
  ): Promise<AuditLog[]> {
    return await AuditTrailService.getAuditLogs(entityType, entityId, limit);
  }

  /**
   * Verify audit trail integrity
   */
  static async verifyAuditIntegrity(): Promise<{ valid: boolean; errors: string[] }> {
    return await AuditTrailService.verifyIntegrity();
  }
}

// Export all cache services for direct access if needed
export {
  CacheManager,
  CrmCacheService,
  CommunicationCacheService,
  TaskCacheService,
  AICacheService,
  DocumentCacheService,
  EmailSyncCacheService,
  CacheMaintenanceService
};

// Default export for the main service
export default CacheService;