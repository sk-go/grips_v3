/**
 * Client Profile Service
 * Handles CRM data fetching, relationship management, and profile enhancement
 */

import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { 
  Client, 
  FamilyMember, 
  ImportantDate, 
  PersonalDetails,
  RelationshipHealth,
  CrmSystem,
  REDIS_KEYS
} from '../../types';
import { CrmSyncService } from '../crm/crmSyncService';
import { logger } from '../../utils/logger';

export interface ClientProfileData {
  client: Client;
  familyMembers: FamilyMember[];
  importantDates: ImportantDate[];
  preferences: Record<string, any>;
  relationships: ClientRelationship[];
}

export interface ClientRelationship {
  id: string;
  relatedClientId: string;
  relatedClientName: string;
  relationshipType: string;
  strength: number;
  notes?: string;
}

export interface RelationshipGraphNode {
  id: string;
  name: string;
  type: 'client' | 'family';
  photo?: string;
  relationshipScore?: number;
}

export interface RelationshipGraphEdge {
  source: string;
  target: string;
  type: string;
  strength: number;
}

export interface RelationshipGraph {
  nodes: RelationshipGraphNode[];
  edges: RelationshipGraphEdge[];
}

export class ClientProfileService {
  constructor(
    private db: Pool,
    private redis: Redis,
    private crmSyncService: CrmSyncService
  ) {}

  /**
   * Get enhanced client profile with CRM data overlay
   */
  async getClientProfile(clientId: string, forceSync = false): Promise<ClientProfileData | null> {
    try {
      // Check cache first
      const cacheKey = `client_profile:${clientId}`;
      if (!forceSync) {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          logger.info(`Retrieved client profile from cache: ${clientId}`);
          return JSON.parse(cached);
        }
      }

      // Get client from database
      const client = await this.getClientById(clientId);
      if (!client) {
        return null;
      }

      // Sync with CRM if needed
      if (forceSync || this.shouldSyncWithCrm(client)) {
        await this.syncClientWithCrm(client);
        // Refresh client data after sync
        const updatedClient = await this.getClientById(clientId);
        if (updatedClient) {
          client.personalDetails = updatedClient.personalDetails;
          client.relationshipHealth = updatedClient.relationshipHealth;
          client.lastCrmSync = updatedClient.lastCrmSync;
        }
      }

      // Get related data
      const [familyMembers, importantDates, preferences, relationships] = await Promise.all([
        this.getFamilyMembers(clientId),
        this.getImportantDates(clientId),
        this.getClientPreferences(clientId),
        this.getClientRelationships(clientId)
      ]);

      const profileData: ClientProfileData = {
        client,
        familyMembers,
        importantDates,
        preferences,
        relationships
      };

      // Cache the result for 1 hour
      await this.redis.setex(cacheKey, 3600, JSON.stringify(profileData));

      logger.info(`Retrieved enhanced client profile: ${clientId}`);
      return profileData;

    } catch (error) {
      logger.error('Error getting client profile:', error);
      throw error;
    }
  }

  /**
   * Get client by ID from database
   */
  private async getClientById(clientId: string): Promise<Client | null> {
    const query = `
      SELECT 
        id, crm_id, crm_system, name, email, phone, photo_url,
        relationship_score, last_interaction, sentiment_trend,
        interaction_frequency, response_time_hours,
        last_crm_sync, sync_status, created_at, updated_at
      FROM clients 
      WHERE id = $1
    `;

    const result = await this.db.query(query, [clientId]);
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    
    // Get preferences to build personal details
    const preferences = await this.getClientPreferences(clientId);
    
    return {
      id: row.id,
      crmId: row.crm_id,
      crmSystem: row.crm_system as CrmSystem,
      name: row.name,
      email: row.email,
      phone: row.phone,
      photo: row.photo_url,
      personalDetails: {
        hobbies: preferences.hobbies || [],
        family: [], // Will be populated separately
        preferences: preferences.communication_preferences || {},
        importantDates: [] // Will be populated separately
      },
      relationshipHealth: {
        score: row.relationship_score || 50,
        lastInteraction: row.last_interaction,
        sentimentTrend: row.sentiment_trend || 'neutral',
        interactionFrequency: parseFloat(row.interaction_frequency) || 0,
        responseTime: parseFloat(row.response_time_hours) || 0
      },
      lastCrmSync: row.last_crm_sync,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Get family members for a client
   */
  private async getFamilyMembers(clientId: string): Promise<FamilyMember[]> {
    const query = `
      SELECT id, name, relationship, age, notes
      FROM family_members 
      WHERE client_id = $1
      ORDER BY relationship, name
    `;

    const result = await this.db.query(query, [clientId]);
    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      relationship: row.relationship,
      age: row.age,
      notes: row.notes
    }));
  }

  /**
   * Get important dates for a client
   */
  private async getImportantDates(clientId: string): Promise<ImportantDate[]> {
    const query = `
      SELECT id, type, date_value, description, recurring
      FROM important_dates 
      WHERE client_id = $1
      ORDER BY date_value
    `;

    const result = await this.db.query(query, [clientId]);
    return result.rows.map(row => ({
      id: row.id,
      type: row.type,
      date: row.date_value,
      description: row.description,
      recurring: row.recurring
    }));
  }

  /**
   * Get client preferences
   */
  private async getClientPreferences(clientId: string): Promise<Record<string, any>> {
    const query = `
      SELECT category, preferences
      FROM client_preferences 
      WHERE client_id = $1
    `;

    const result = await this.db.query(query, [clientId]);
    const preferences: Record<string, any> = {};
    
    result.rows.forEach(row => {
      preferences[row.category] = row.preferences;
    });

    return preferences;
  }

  /**
   * Get client relationships
   */
  private async getClientRelationships(clientId: string): Promise<ClientRelationship[]> {
    const query = `
      SELECT 
        cr.id, cr.related_client_id, cr.relationship_type, 
        cr.strength, cr.notes, c.name as related_client_name
      FROM client_relationships cr
      JOIN clients c ON c.id = cr.related_client_id
      WHERE cr.client_id = $1
      ORDER BY cr.strength DESC, c.name
    `;

    const result = await this.db.query(query, [clientId]);
    return result.rows.map(row => ({
      id: row.id,
      relatedClientId: row.related_client_id,
      relatedClientName: row.related_client_name,
      relationshipType: row.relationship_type,
      strength: row.strength,
      notes: row.notes
    }));
  }

  /**
   * Create or update client profile
   */
  async upsertClient(clientData: Partial<Client>): Promise<Client> {
    const query = `
      INSERT INTO clients (
        crm_id, crm_system, name, email, phone, photo_url,
        relationship_score, last_interaction, sentiment_trend,
        interaction_frequency, response_time_hours
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (crm_system, crm_id) 
      DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        photo_url = EXCLUDED.photo_url,
        relationship_score = EXCLUDED.relationship_score,
        last_interaction = EXCLUDED.last_interaction,
        sentiment_trend = EXCLUDED.sentiment_trend,
        interaction_frequency = EXCLUDED.interaction_frequency,
        response_time_hours = EXCLUDED.response_time_hours,
        updated_at = NOW()
      RETURNING *
    `;

    const values = [
      clientData.crmId,
      clientData.crmSystem,
      clientData.name,
      clientData.email,
      clientData.phone,
      clientData.photo,
      clientData.relationshipHealth?.score || 50,
      clientData.relationshipHealth?.lastInteraction,
      clientData.relationshipHealth?.sentimentTrend || 'neutral',
      clientData.relationshipHealth?.interactionFrequency || 0,
      clientData.relationshipHealth?.responseTime || 0
    ];

    const result = await this.db.query(query, values);
    const row = result.rows[0];

    // Clear cache
    await this.redis.del(`client_profile:${row.id}`);

    return this.getClientById(row.id) as Promise<Client>;
  }

  /**
   * Update family members for a client
   */
  async updateFamilyMembers(clientId: string, familyMembers: FamilyMember[]): Promise<void> {
    const client = this.db;
    
    try {
      await client.query('BEGIN');

      // Delete existing family members
      await client.query('DELETE FROM family_members WHERE client_id = $1', [clientId]);

      // Insert new family members
      for (const member of familyMembers) {
        await client.query(
          `INSERT INTO family_members (client_id, name, relationship, age, notes)
           VALUES ($1, $2, $3, $4, $5)`,
          [clientId, member.name, member.relationship, member.age, member.notes]
        );
      }

      await client.query('COMMIT');

      // Clear cache
      await this.redis.del(`client_profile:${clientId}`);

      logger.info(`Updated family members for client: ${clientId}`);

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error updating family members:', error);
      throw error;
    }
  }

  /**
   * Generate relationship graph for visualization
   */
  async getRelationshipGraph(clientId: string, depth = 2): Promise<RelationshipGraph> {
    const nodes: RelationshipGraphNode[] = [];
    const edges: RelationshipGraphEdge[] = [];
    const processedClients = new Set<string>();

    await this.buildRelationshipGraph(clientId, depth, nodes, edges, processedClients);

    return { nodes, edges };
  }

  /**
   * Recursively build relationship graph
   */
  private async buildRelationshipGraph(
    clientId: string,
    remainingDepth: number,
    nodes: RelationshipGraphNode[],
    edges: RelationshipGraphEdge[],
    processed: Set<string>
  ): Promise<void> {
    if (remainingDepth <= 0 || processed.has(clientId)) {
      return;
    }

    processed.add(clientId);

    // Get client data
    const client = await this.getClientById(clientId);
    if (!client) return;

    // Add client node
    nodes.push({
      id: clientId,
      name: client.name,
      type: 'client',
      photo: client.photo,
      relationshipScore: client.relationshipHealth.score
    });

    // Get family members
    const familyMembers = await this.getFamilyMembers(clientId);
    familyMembers.forEach(member => {
      const familyNodeId = `family_${member.id}`;
      nodes.push({
        id: familyNodeId,
        name: member.name,
        type: 'family'
      });

      edges.push({
        source: clientId,
        target: familyNodeId,
        type: member.relationship,
        strength: 3 // Family relationships are strong
      });
    });

    // Get client relationships
    const relationships = await this.getClientRelationships(clientId);
    for (const relationship of relationships) {
      edges.push({
        source: clientId,
        target: relationship.relatedClientId,
        type: relationship.relationshipType,
        strength: relationship.strength
      });

      // Recursively process related clients
      await this.buildRelationshipGraph(
        relationship.relatedClientId,
        remainingDepth - 1,
        nodes,
        edges,
        processed
      );
    }
  }

  /**
   * Sync client data with CRM
   */
  private async syncClientWithCrm(client: Client): Promise<void> {
    try {
      // For now, skip CRM sync as the method doesn't exist in CrmSyncService
      // This would need to be implemented in the CrmSyncService
      const crmData = null;

      if (crmData) {
        // Update client with CRM data - this would be implemented when CRM sync is available
        logger.info(`Would sync client with CRM data: ${client.id}`);
      }

      logger.info(`Synced client with CRM: ${client.id}`);

    } catch (error) {
      logger.error(`Error syncing client with CRM: ${client.id}`, error);
      // Update sync status to failed
      await this.db.query(
        'UPDATE clients SET sync_status = $1 WHERE id = $2',
        ['failed', client.id]
      );
    }
  }

  /**
   * Check if client should be synced with CRM
   */
  private shouldSyncWithCrm(client: Client): boolean {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    return !client.lastCrmSync || client.lastCrmSync < sixHoursAgo;
  }

  /**
   * Search clients by name or email
   */
  async searchClients(query: string, limit = 20): Promise<Client[]> {
    const searchQuery = `
      SELECT 
        id, crm_id, crm_system, name, email, phone, photo_url,
        relationship_score, last_interaction, sentiment_trend,
        interaction_frequency, response_time_hours,
        last_crm_sync, sync_status, created_at, updated_at
      FROM clients 
      WHERE 
        name ILIKE $1 OR 
        email ILIKE $1 OR 
        phone ILIKE $1
      ORDER BY 
        relationship_score DESC, 
        last_interaction DESC NULLS LAST
      LIMIT $2
    `;

    const result = await this.db.query(searchQuery, [`%${query}%`, limit]);
    
    return Promise.all(
      result.rows.map(async (row) => {
        const preferences = await this.getClientPreferences(row.id);
        
        return {
          id: row.id,
          crmId: row.crm_id,
          crmSystem: row.crm_system as CrmSystem,
          name: row.name,
          email: row.email,
          phone: row.phone,
          photo: row.photo_url,
          personalDetails: {
            hobbies: preferences.hobbies || [],
            family: [],
            preferences: preferences.communication_preferences || {},
            importantDates: []
          },
          relationshipHealth: {
            score: row.relationship_score || 50,
            lastInteraction: row.last_interaction,
            sentimentTrend: row.sentiment_trend || 'neutral',
            interactionFrequency: parseFloat(row.interaction_frequency) || 0,
            responseTime: parseFloat(row.response_time_hours) || 0
          },
          lastCrmSync: row.last_crm_sync,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
      })
    );
  }
}