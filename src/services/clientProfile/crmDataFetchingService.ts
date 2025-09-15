/**
 * CRM Data Fetching Service
 * Handles fetching and synchronizing client data from various CRM systems
 */

import { Redis } from 'ioredis';
import { 
  Client, 
  CrmSystem, 
  PersonalDetails,
  FamilyMember,
  ImportantDate,
  REDIS_KEYS 
} from '../../types';
import { CrmSyncService } from '../crm/crmSyncService';
import { CrmConnectorFactory } from '../crm/crmConnectorFactory';
import { DatabaseService } from '../database/DatabaseService';
import { logger } from '../../utils/logger';

export interface CrmClientData {
  crmId: string;
  crmSystem: CrmSystem;
  name: string;
  email?: string;
  phone?: string;
  photo?: string;
  personalDetails: PersonalDetails;
  lastModified: Date;
  customFields: Record<string, any>;
}

export interface CrmSyncResult {
  success: boolean;
  clientsUpdated: number;
  clientsCreated: number;
  errors: string[];
  syncDuration: number;
  lastSyncTime: Date;
}

export interface CrmConnectionStatus {
  crmSystem: CrmSystem;
  connected: boolean;
  lastSync?: Date;
  error?: string;
  clientCount: number;
}

export class CrmDataFetchingService {
  constructor(
    private db: typeof DatabaseService,
    private redis: Redis,
    private crmSyncService: CrmSyncService
  ) {}

  /**
   * Fetch client data from CRM and update local overlay
   */
  async fetchAndUpdateClientData(
    crmSystem: CrmSystem,
    crmId: string,
    forceRefresh = false
  ): Promise<Client | null> {
    try {
      const cacheKey = REDIS_KEYS.CRM_CLIENT(crmSystem, crmId);
      
      // Check cache first unless force refresh
      if (!forceRefresh) {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          const cachedData = JSON.parse(cached);
          logger.info(`Retrieved CRM client data from cache: ${crmSystem}:${crmId}`);
          return this.convertCrmDataToClient(cachedData);
        }
      }

      // Fetch from CRM
      const connector = CrmConnectorFactory.getConnector(crmSystem, 'default');
      if (!connector) {
        throw new Error(`No CRM connector available for ${crmSystem}`);
      }
      const crmData = await connector.getClient(crmId);
      
      if (!crmData) {
        logger.warn(`Client not found in CRM: ${crmSystem}:${crmId}`);
        return null;
      }

      // Convert CRM data to our client format
      const clientData = this.convertCrmDataToClient(crmData);

      // Update local database
      await this.upsertClientData(clientData);

      // Cache the CRM data for 6 hours
      await this.redis.setex(cacheKey, 21600, JSON.stringify(crmData));

      logger.info(`Fetched and updated client data from CRM: ${crmSystem}:${crmId}`);
      return clientData;

    } catch (error) {
      logger.error(`Error fetching client data from CRM: ${crmSystem}:${crmId}`, error);
      throw error;
    }
  }

  /**
   * Sync all clients from a CRM system
   */
  async syncAllClientsFromCrm(crmSystem: CrmSystem): Promise<CrmSyncResult> {
    const startTime = Date.now();
    let clientsUpdated = 0;
    let clientsCreated = 0;
    const errors: string[] = [];

    try {
      logger.info(`Starting full sync from CRM: ${crmSystem}`);

      const connector = CrmConnectorFactory.getConnector(crmSystem, 'default');
      if (!connector) {
        throw new Error(`No CRM connector available for ${crmSystem}`);
      }
      
      // Get all clients from CRM (with pagination)
      let page = 1;
      let hasMore = true;
      
      while (hasMore) {
        try {
          const clientsPage = await connector.getClients({
            page,
            pageSize: 100,
            modifiedSince: await this.getLastSyncTime(crmSystem)
          });

          if (!clientsPage || !clientsPage.data || clientsPage.data.length === 0) {
            hasMore = false;
            break;
          }

          // Process each client
          for (const crmClient of clientsPage.data) {
            try {
              const existingClient = await this.findClientByCrmId(crmSystem, crmClient.id);
              const clientData = this.convertCrmDataToClient(crmClient);

              if (existingClient) {
                await this.updateClientData(existingClient.id, clientData);
                clientsUpdated++;
              } else {
                await this.createClientData(clientData);
                clientsCreated++;
              }

              // Cache the CRM data
              const cacheKey = REDIS_KEYS.CRM_CLIENT(crmSystem, crmClient.id);
              await this.redis.setex(cacheKey, 21600, JSON.stringify(crmClient));

            } catch (clientError) {
              const errorMsg = `Error processing client ${crmClient.id}: ${clientError}`;
              errors.push(errorMsg);
              logger.error(errorMsg);
            }
          }

          page++;
          
          // Check if we got a full page (indicating more data might be available)
          hasMore = clientsPage.data.length === 100;

        } catch (pageError) {
          const errorMsg = `Error fetching page ${page}: ${pageError}`;
          errors.push(errorMsg);
          logger.error(errorMsg);
          hasMore = false;
        }
      }

      // Update sync status
      await this.updateSyncStatus(crmSystem, 'success');

      const syncDuration = Date.now() - startTime;
      const result: CrmSyncResult = {
        success: errors.length === 0,
        clientsUpdated,
        clientsCreated,
        errors,
        syncDuration,
        lastSyncTime: new Date()
      };

      logger.info(`Completed CRM sync: ${crmSystem}`, result);
      return result;

    } catch (error) {
      await this.updateSyncStatus(crmSystem, 'failed', error instanceof Error ? error.message : 'Unknown error');
      
      const syncDuration = Date.now() - startTime;
      return {
        success: false,
        clientsUpdated,
        clientsCreated,
        errors: [...errors, error instanceof Error ? error.message : 'Unknown error'],
        syncDuration,
        lastSyncTime: new Date()
      };
    }
  }

  /**
   * Get CRM connection status for all configured systems
   */
  async getCrmConnectionStatus(): Promise<CrmConnectionStatus[]> {
    const crmSystems: CrmSystem[] = ['zoho', 'salesforce', 'hubspot', 'agencybloc'];
    const statuses: CrmConnectionStatus[] = [];

    for (const crmSystem of crmSystems) {
      try {
        const connector = CrmConnectorFactory.getConnector(crmSystem, 'default');
        if (!connector) {
          statuses.push({
            crmSystem,
            connected: false,
            error: 'No connector configured',
            clientCount: 0
          });
          continue;
        }
        const isConnected = await connector.healthCheck();
        
        const clientCount = await this.getClientCountForCrm(crmSystem);
        const lastSync = await this.getLastSyncTime(crmSystem);

        statuses.push({
          crmSystem,
          connected: isConnected,
          lastSync,
          clientCount
        });

      } catch (error) {
        statuses.push({
          crmSystem,
          connected: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          clientCount: 0
        });
      }
    }

    return statuses;
  }

  /**
   * Push client updates back to CRM
   */
  async pushClientUpdateToCrm(clientId: string, updates: Partial<Client>): Promise<boolean> {
    try {
      const client = await this.getClientById(clientId);
      if (!client) {
        throw new Error(`Client not found: ${clientId}`);
      }

      const connector = CrmConnectorFactory.getConnector(client.crmSystem, 'default');
      if (!connector) {
        throw new Error(`No CRM connector available for ${client.crmSystem}`);
      }
      
      // Convert our client data back to CRM format
      const crmUpdates = this.convertClientToCrmData(updates);
      
      const result = await connector.updateClient(client.crmId, crmUpdates);
      const success = !!result; // Assume success if no error thrown
      
      if (success) {
        // Clear cache to force refresh on next fetch
        const cacheKey = REDIS_KEYS.CRM_CLIENT(client.crmSystem, client.crmId);
        await this.redis.del(cacheKey);
        
        logger.info(`Pushed client updates to CRM: ${client.crmSystem}:${client.crmId}`);
      }

      return success;

    } catch (error) {
      logger.error(`Error pushing client updates to CRM: ${clientId}`, error);
      return false;
    }
  }

  /**
   * Convert CRM data to our client format
   */
  private convertCrmDataToClient(crmData: any): Client {
    return {
      id: '', // Will be set by database
      crmId: crmData.id,
      crmSystem: crmData.system,
      name: crmData.name || crmData.fullName || `${crmData.firstName} ${crmData.lastName}`.trim(),
      email: crmData.email || crmData.primaryEmail,
      phone: crmData.phone || crmData.primaryPhone,
      photo: crmData.photo || crmData.avatarUrl,
      personalDetails: {
        hobbies: crmData.hobbies || crmData.interests || [],
        family: this.extractFamilyMembers(crmData),
        preferences: crmData.preferences || {},
        importantDates: this.extractImportantDates(crmData)
      },
      relationshipHealth: {
        score: 50, // Default score, will be calculated
        lastInteraction: crmData.lastContactDate ? new Date(crmData.lastContactDate) : new Date(),
        sentimentTrend: 'neutral',
        interactionFrequency: 0,
        responseTime: 0
      },
      lastCrmSync: new Date(),
      createdAt: crmData.createdDate ? new Date(crmData.createdDate) : new Date(),
      updatedAt: crmData.modifiedDate ? new Date(crmData.modifiedDate) : new Date()
    };
  }

  /**
   * Extract family members from CRM data
   */
  private extractFamilyMembers(crmData: any): FamilyMember[] {
    const family: FamilyMember[] = [];

    // Check for spouse/partner
    if (crmData.spouse || crmData.partner) {
      family.push({
        id: `spouse_${crmData.id}`,
        name: crmData.spouse || crmData.partner,
        relationship: 'spouse'
      });
    }

    // Check for children
    if (crmData.children && Array.isArray(crmData.children)) {
      crmData.children.forEach((child: any, index: number) => {
        family.push({
          id: `child_${crmData.id}_${index}`,
          name: typeof child === 'string' ? child : child.name,
          relationship: 'child',
          age: typeof child === 'object' ? child.age : undefined
        });
      });
    }

    // Check for other family members in custom fields
    if (crmData.customFields) {
      Object.entries(crmData.customFields).forEach(([key, value]) => {
        if (key.toLowerCase().includes('family') && value) {
          family.push({
            id: `family_${crmData.id}_${key}`,
            name: String(value),
            relationship: 'other'
          });
        }
      });
    }

    return family;
  }

  /**
   * Extract important dates from CRM data
   */
  private extractImportantDates(crmData: any): ImportantDate[] {
    const dates: ImportantDate[] = [];

    // Birthday
    if (crmData.birthday || crmData.dateOfBirth) {
      dates.push({
        id: `birthday_${crmData.id}`,
        type: 'birthday',
        date: new Date(crmData.birthday || crmData.dateOfBirth),
        description: 'Birthday',
        recurring: true
      });
    }

    // Anniversary
    if (crmData.anniversary) {
      dates.push({
        id: `anniversary_${crmData.id}`,
        type: 'anniversary',
        date: new Date(crmData.anniversary),
        description: 'Anniversary',
        recurring: true
      });
    }

    // Policy renewals
    if (crmData.policyRenewalDate) {
      dates.push({
        id: `renewal_${crmData.id}`,
        type: 'policy_renewal',
        date: new Date(crmData.policyRenewalDate),
        description: 'Policy Renewal',
        recurring: true
      });
    }

    return dates;
  }

  /**
   * Convert client data back to CRM format for updates
   */
  private convertClientToCrmData(clientData: Partial<Client>): any {
    const crmData: any = {};

    if (clientData.name) crmData.name = clientData.name;
    if (clientData.email) crmData.email = clientData.email;
    if (clientData.phone) crmData.phone = clientData.phone;
    if (clientData.photo) crmData.photo = clientData.photo;

    if (clientData.personalDetails) {
      if (clientData.personalDetails.hobbies) {
        crmData.hobbies = clientData.personalDetails.hobbies;
      }
      if (clientData.personalDetails.preferences) {
        crmData.preferences = clientData.personalDetails.preferences;
      }
    }

    return crmData;
  }

  /**
   * Helper methods for database operations
   */
  private async findClientByCrmId(crmSystem: CrmSystem, crmId: string): Promise<Client | null> {
    const query = 'SELECT * FROM clients WHERE crm_system = $1 AND crm_id = $2';
    const result = await this.db.query(query, [crmSystem, crmId]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  private async getClientById(clientId: string): Promise<Client | null> {
    const query = 'SELECT * FROM clients WHERE id = $1';
    const result = await this.db.query(query, [clientId]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  private async upsertClientData(clientData: Client): Promise<void> {
    // Implementation would use the ClientProfileService.upsertClient method
    // This is a simplified version for the CRM fetching context
    const query = `
      INSERT INTO clients (crm_id, crm_system, name, email, phone, photo_url, last_crm_sync)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (crm_system, crm_id) 
      DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        photo_url = EXCLUDED.photo_url,
        last_crm_sync = NOW(),
        updated_at = NOW()
    `;

    await this.db.query(query, [
      clientData.crmId,
      clientData.crmSystem,
      clientData.name,
      clientData.email,
      clientData.phone,
      clientData.photo
    ]);
  }

  private async createClientData(clientData: Client): Promise<void> {
    await this.upsertClientData(clientData);
  }

  private async updateClientData(clientId: string, updates: Partial<Client>): Promise<void> {
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.name) {
      setClauses.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.email) {
      setClauses.push(`email = $${paramIndex++}`);
      values.push(updates.email);
    }
    if (updates.phone) {
      setClauses.push(`phone = $${paramIndex++}`);
      values.push(updates.phone);
    }
    if (updates.photo) {
      setClauses.push(`photo_url = $${paramIndex++}`);
      values.push(updates.photo);
    }

    if (setClauses.length > 0) {
      setClauses.push(`updated_at = NOW()`);
      values.push(clientId);

      const query = `UPDATE clients SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`;
      await this.db.query(query, values);
    }
  }

  private async getLastSyncTime(crmSystem: CrmSystem): Promise<Date | undefined> {
    const cacheKey = REDIS_KEYS.CRM_SYNC_STATUS(crmSystem);
    const syncStatus = await this.redis.get(cacheKey);
    
    if (syncStatus) {
      const status = JSON.parse(syncStatus);
      return status.lastSync ? new Date(status.lastSync) : undefined;
    }

    return undefined;
  }

  private async updateSyncStatus(crmSystem: CrmSystem, status: string, error?: string): Promise<void> {
    const cacheKey = REDIS_KEYS.CRM_SYNC_STATUS(crmSystem);
    const syncStatus = {
      status,
      lastSync: new Date().toISOString(),
      error
    };

    await this.redis.setex(cacheKey, 86400, JSON.stringify(syncStatus)); // Cache for 24 hours
  }

  private async getClientCountForCrm(crmSystem: CrmSystem): Promise<number> {
    const query = 'SELECT COUNT(*) as count FROM clients WHERE crm_system = $1';
    const result = await this.db.query(query, [crmSystem]);
    return parseInt(result.rows[0].count) || 0;
  }
}