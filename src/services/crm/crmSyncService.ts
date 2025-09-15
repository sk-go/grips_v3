/**
 * CRM Synchronization Service
 * Handles bi-directional sync between platform and CRM systems with Redis caching
 */

import { ICrmConnector, CrmSyncResult, CrmSyncError, CrmClient } from './types';
import { Client, CrmSystem } from '../../types';
import { CacheService } from '../cacheService';
import { RetryHandler } from './retryHandler';
import { logger } from '../../utils/logger';

export interface SyncConfig {
  batchSize: number;
  maxConcurrentSyncs: number;
  syncIntervalMinutes: number;
  cacheExpirationMonths: number;
  enableBidirectionalSync: boolean;
  conflictResolution: 'crm_wins' | 'platform_wins' | 'manual';
}

export interface SyncStatus {
  crmSystem: CrmSystem;
  lastSyncTime: Date;
  nextSyncTime: Date;
  status: 'idle' | 'syncing' | 'error' | 'paused';
  success: boolean;
  clientsProcessed: number;
  clientsUpdated: number;
  clientsCreated: number;
  errors: CrmSyncError[];
  syncDuration: number; // milliseconds
}

export interface ConflictResolution {
  clientId: string;
  crmData: CrmClient;
  platformData: Client;
  conflictFields: string[];
  resolution: 'pending' | 'crm_wins' | 'platform_wins' | 'merged';
  resolvedAt?: Date;
  resolvedBy?: string;
}

export class CrmSyncService {
  private static instance: CrmSyncService;
  private cacheService: CacheService;
  private activeSyncs: Map<string, Promise<SyncStatus>> = new Map();
  private syncStatuses: Map<string, SyncStatus> = new Map();
  private conflicts: Map<string, ConflictResolution> = new Map();
  private syncIntervals: Map<string, NodeJS.Timeout> = new Map();

  private defaultConfig: SyncConfig = {
    batchSize: 100,
    maxConcurrentSyncs: 3,
    syncIntervalMinutes: 30,
    cacheExpirationMonths: 6,
    enableBidirectionalSync: true,
    conflictResolution: 'crm_wins'
  };

  private constructor() {
    this.cacheService = new CacheService();
  }

  static getInstance(): CrmSyncService {
    if (!CrmSyncService.instance) {
      CrmSyncService.instance = new CrmSyncService();
    }
    return CrmSyncService.instance;
  }

  // ============================================================================
  // Public Sync Methods
  // ============================================================================

  /**
   * Start synchronization for a CRM connector
   */
  async startSync(
    connector: ICrmConnector,
    config: Partial<SyncConfig> = {}
  ): Promise<SyncStatus> {
    const finalConfig = { ...this.defaultConfig, ...config };
    const syncKey = this.getSyncKey(connector.system, connector.config.clientId);

    // Check if sync is already running
    if (this.activeSyncs.has(syncKey)) {
      logger.warn(`Sync already running for ${syncKey}`);
      return await this.activeSyncs.get(syncKey)!;
    }

    // Check concurrent sync limit
    if (this.activeSyncs.size >= finalConfig.maxConcurrentSyncs) {
      throw new Error(`Maximum concurrent syncs (${finalConfig.maxConcurrentSyncs}) reached`);
    }

    logger.info(`Starting CRM sync for ${syncKey}`, { config: finalConfig });

    const syncPromise = this.performSync(connector, finalConfig);
    this.activeSyncs.set(syncKey, syncPromise);

    try {
      const result = await syncPromise;
      this.syncStatuses.set(syncKey, result);
      
      // Schedule next sync if successful
      if (result.status !== 'error') {
        this.scheduleNextSync(connector, finalConfig);
      }
      
      return result;
    } finally {
      this.activeSyncs.delete(syncKey);
    }
  }

  /**
   * Stop synchronization for a CRM system
   */
  stopSync(crmSystem: CrmSystem, clientId: string): void {
    const syncKey = this.getSyncKey(crmSystem, clientId);
    
    // Clear scheduled sync
    const interval = this.syncIntervals.get(syncKey);
    if (interval) {
      clearTimeout(interval);
      this.syncIntervals.delete(syncKey);
    }

    // Update status
    const status = this.syncStatuses.get(syncKey);
    if (status) {
      status.status = 'paused';
      this.syncStatuses.set(syncKey, status);
    }

    logger.info(`Stopped CRM sync for ${syncKey}`);
  }

  /**
   * Get sync status for a CRM system
   */
  getSyncStatus(crmSystem: CrmSystem, clientId: string): SyncStatus | undefined {
    const syncKey = this.getSyncKey(crmSystem, clientId);
    return this.syncStatuses.get(syncKey);
  }

  /**
   * Get all sync statuses
   */
  getAllSyncStatuses(): SyncStatus[] {
    return Array.from(this.syncStatuses.values());
  }

  /**
   * Force immediate sync
   */
  async forcSync(connector: ICrmConnector, config: Partial<SyncConfig> = {}): Promise<SyncStatus> {
    const syncKey = this.getSyncKey(connector.system, connector.config.clientId);
    
    // Stop any scheduled sync
    this.stopSync(connector.system, connector.config.clientId);
    
    // Start immediate sync
    return await this.startSync(connector, config);
  }

  // ============================================================================
  // Conflict Resolution Methods
  // ============================================================================

  /**
   * Get pending conflicts
   */
  getPendingConflicts(): ConflictResolution[] {
    return Array.from(this.conflicts.values()).filter(c => c.resolution === 'pending');
  }

  /**
   * Resolve a conflict
   */
  async resolveConflict(
    clientId: string,
    resolution: 'crm_wins' | 'platform_wins' | 'merged',
    resolvedBy: string,
    mergedData?: Partial<Client>
  ): Promise<void> {
    const conflict = this.conflicts.get(clientId);
    if (!conflict) {
      throw new Error(`No conflict found for client ${clientId}`);
    }

    conflict.resolution = resolution;
    conflict.resolvedAt = new Date();
    conflict.resolvedBy = resolvedBy;

    // Apply resolution
    switch (resolution) {
      case 'crm_wins':
        await this.applyCrmData(conflict.crmData);
        break;
      case 'platform_wins':
        await this.applyPlatformData(conflict.platformData);
        break;
      case 'merged':
        if (mergedData) {
          await this.applyMergedData(clientId, mergedData);
        }
        break;
    }

    this.conflicts.set(clientId, conflict);
    logger.info(`Resolved conflict for client ${clientId}`, { resolution, resolvedBy });
  }

  // ============================================================================
  // Cache Management Methods
  // ============================================================================

  /**
   * Get cached CRM client data
   */
  async getCachedClient(crmSystem: CrmSystem, crmId: string): Promise<Client | null> {
    const cacheKey = `crm_client:${crmSystem}:${crmId}`;
    const cachedData = await this.cacheService.get(cacheKey);
    return cachedData ? JSON.parse(cachedData) : null;
  }

  /**
   * Cache CRM client data
   */
  async setCachedClient(client: Client): Promise<void> {
    const cacheKey = `crm_client:${client.crmSystem}:${client.crmId}`;
    const expirationMonths = this.defaultConfig.cacheExpirationMonths;
    const ttl = expirationMonths * 30 * 24 * 60 * 60; // Convert to seconds
    
    await this.cacheService.set(cacheKey, JSON.stringify(client), ttl);
  }

  /**
   * Invalidate cached client data
   */
  async invalidateCachedClient(crmSystem: CrmSystem, crmId: string): Promise<void> {
    const cacheKey = `crm_client:${crmSystem}:${crmId}`;
    await this.cacheService.delete(cacheKey);
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(crmSystem: CrmSystem): Promise<{
    totalCached: number;
    cacheHitRate: number;
    averageAge: number;
  }> {
    // This would require implementing cache statistics in the cache service
    // For now, return placeholder data
    return {
      totalCached: 0,
      cacheHitRate: 0.85,
      averageAge: 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds
    };
  }

  // ============================================================================
  // Private Sync Implementation
  // ============================================================================

  private async performSync(
    connector: ICrmConnector,
    config: SyncConfig
  ): Promise<SyncStatus> {
    const startTime = Date.now();
    const syncKey = this.getSyncKey(connector.system, connector.config.clientId);
    
    const status: SyncStatus = {
      crmSystem: connector.system,
      lastSyncTime: new Date(),
      nextSyncTime: new Date(Date.now() + config.syncIntervalMinutes * 60 * 1000),
      status: 'syncing',
      success: false,
      clientsProcessed: 0,
      clientsUpdated: 0,
      clientsCreated: 0,
      errors: [],
      syncDuration: 0
    };

    this.syncStatuses.set(syncKey, status);

    try {
      // Get last sync time from cache
      const lastSyncKey = `crm_sync:${connector.system}:${connector.config.clientId}`;
      const lastSyncTimeStr = await this.cacheService.get(lastSyncKey);
      const lastSyncTime = lastSyncTimeStr ? new Date(lastSyncTimeStr) : undefined;

      // Perform CRM sync with retry logic
      const syncResult = await RetryHandler.executeWithRetry(
        () => connector.syncClients(lastSyncTime),
        RetryHandler.createConfig('standard'),
        `CRM Sync ${connector.system}`
      );

      if (syncResult.success && syncResult.result) {
        const crmResult = syncResult.result;
        
        // Update status with CRM results
        status.clientsProcessed = crmResult.clientsProcessed;
        status.clientsUpdated = crmResult.clientsUpdated;
        status.clientsCreated = crmResult.clientsCreated;
        status.errors = crmResult.errors;

        // Process clients in batches
        if (config.enableBidirectionalSync) {
          await this.processBidirectionalSync(connector, config);
        }

        // Update last sync time in cache
        await this.cacheService.set(lastSyncKey, new Date().toISOString(), 24 * 60 * 60); // 24 hours TTL

        status.success = crmResult.success;
        status.status = crmResult.success ? 'idle' : 'error';
      } else {
        status.success = false;
        status.status = 'error';
        status.errors.push({
          error: syncResult.error?.message || 'Sync failed',
          retryable: true
        });
      }

    } catch (error) {
      logger.error(`CRM sync failed for ${syncKey}:`, error);
      status.success = false;
      status.status = 'error';
      status.errors.push({
        error: error instanceof Error ? error.message : 'Unknown error',
        retryable: false
      });
    }

    status.syncDuration = Date.now() - startTime;
    status.lastSyncTime = new Date();

    logger.info(`CRM sync completed for ${syncKey}`, {
      status: status.status,
      processed: status.clientsProcessed,
      updated: status.clientsUpdated,
      created: status.clientsCreated,
      errors: status.errors.length,
      duration: status.syncDuration
    });

    return status;
  }

  private async processBidirectionalSync(
    connector: ICrmConnector,
    config: SyncConfig
  ): Promise<void> {
    // This would implement the bidirectional sync logic
    // For now, it's a placeholder that would:
    // 1. Get platform clients that need to be synced to CRM
    // 2. Compare with CRM data to detect conflicts
    // 3. Apply conflict resolution strategy
    // 4. Update both systems as needed
    
    logger.debug(`Processing bidirectional sync for ${connector.system}`);
    
    // Placeholder implementation
    // In a real implementation, this would:
    // - Query platform database for clients
    // - Compare with CRM data
    // - Detect and resolve conflicts
    // - Update both systems
  }

  private async applyCrmData(crmData: CrmClient): Promise<void> {
    // Convert CRM data to platform format and update
    const platformClient = this.transformCrmToClient(crmData);
    await this.setCachedClient(platformClient);
    
    // In a real implementation, this would also update the platform database
    logger.debug(`Applied CRM data for client ${crmData.id}`);
  }

  private async applyPlatformData(platformData: Client): Promise<void> {
    // Update CRM with platform data
    // This would require the CRM connector to update the remote system
    logger.debug(`Applied platform data for client ${platformData.id}`);
  }

  private async applyMergedData(clientId: string, mergedData: Partial<Client>): Promise<void> {
    // Apply merged data to both systems
    logger.debug(`Applied merged data for client ${clientId}`);
  }

  private transformCrmToClient(crmData: CrmClient): Client {
    // Transform CRM client data to platform client format
    return {
      id: crmData.id,
      crmId: crmData.id,
      crmSystem: 'zoho' as CrmSystem, // This should be determined from context
      name: crmData.name,
      email: crmData.email,
      phone: crmData.phone,
      photo: undefined,
      personalDetails: {
        hobbies: [],
        family: [],
        preferences: crmData.customFields || {},
        importantDates: []
      },
      relationshipHealth: {
        score: 50, // Default score
        lastInteraction: crmData.lastActivity || new Date(),
        sentimentTrend: 'neutral',
        interactionFrequency: 0,
        responseTime: 0
      },
      lastCrmSync: new Date(),
      createdAt: crmData.createdAt,
      updatedAt: crmData.updatedAt
    };
  }

  private scheduleNextSync(connector: ICrmConnector, config: SyncConfig): void {
    const syncKey = this.getSyncKey(connector.system, connector.config.clientId);
    const delay = config.syncIntervalMinutes * 60 * 1000;

    const timeout = setTimeout(() => {
      this.startSync(connector, config).catch(error => {
        logger.error(`Scheduled sync failed for ${syncKey}:`, error);
      });
    }, delay);

    this.syncIntervals.set(syncKey, timeout);
    
    logger.debug(`Scheduled next sync for ${syncKey} in ${config.syncIntervalMinutes} minutes`);
  }

  private getSyncKey(crmSystem: CrmSystem, clientId: string): string {
    return `${crmSystem}-${clientId}`;
  }

  // ============================================================================
  // Cleanup Methods
  // ============================================================================

  /**
   * Stop all active syncs
   */
  stopAllSyncs(): void {
    for (const [syncKey] of this.syncStatuses) {
      const [crmSystem, clientId] = syncKey.split('-');
      this.stopSync(crmSystem as CrmSystem, clientId);
    }
    
    logger.info('Stopped all CRM syncs');
  }

  /**
   * Clear all sync data
   */
  clearAllSyncData(): void {
    this.activeSyncs.clear();
    this.syncStatuses.clear();
    this.conflicts.clear();
    
    for (const timeout of this.syncIntervals.values()) {
      clearTimeout(timeout);
    }
    this.syncIntervals.clear();
    
    logger.info('Cleared all CRM sync data');
  }

  /**
   * Cleanup method for testing - ensures all timers are cleared
   */
  cleanup(): void {
    this.stopAllSyncs();
    this.clearAllSyncData();
  }
}