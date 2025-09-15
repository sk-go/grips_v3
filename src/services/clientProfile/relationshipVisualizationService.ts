/**
 * Relationship Visualization Service
 * Handles data preparation for D3.js relationship graph visualization
 */

import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { logger } from '../../utils/logger';

export interface GraphNode {
  id: string;
  name: string;
  type: 'client' | 'family' | 'business';
  group: number; // For D3.js color grouping
  size: number; // Node size based on relationship strength/importance
  photo?: string;
  metadata: {
    relationshipScore?: number;
    lastInteraction?: Date;
    sentimentTrend?: 'positive' | 'neutral' | 'negative';
    clientType?: string;
    age?: number;
    relationship?: string; // For family members
  };
}

export interface GraphLink {
  source: string;
  target: string;
  type: string;
  strength: number; // 1-5 scale for link thickness
  distance: number; // Preferred distance for D3.js force simulation
  metadata: {
    description?: string;
    duration?: string; // How long they've known each other
    notes?: string;
  };
}

export interface RelationshipGraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  centerNodeId: string;
  metadata: {
    totalNodes: number;
    totalConnections: number;
    maxDepth: number;
    generatedAt: Date;
  };
}

export interface GraphLayoutConfig {
  width: number;
  height: number;
  centerForce: number;
  linkDistance: number;
  nodeSize: {
    min: number;
    max: number;
  };
  colors: {
    client: string;
    family: string;
    business: string;
    selected: string;
  };
}

export class RelationshipVisualizationService {
  constructor(
    private db: Pool,
    private redis: Redis
  ) {}

  /**
   * Generate relationship graph data for D3.js visualization
   */
  async generateRelationshipGraph(
    clientId: string,
    maxDepth = 2,
    includeFamily = true,
    includeBusiness = true
  ): Promise<RelationshipGraphData> {
    try {
      const cacheKey = `relationship_graph:${clientId}:${maxDepth}:${includeFamily}:${includeBusiness}`;
      
      // Check cache first
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        logger.info(`Retrieved relationship graph from cache: ${clientId}`);
        return JSON.parse(cached);
      }

      const nodes: GraphNode[] = [];
      const links: GraphLink[] = [];
      const processedNodes = new Set<string>();

      // Build the graph starting from the center client
      await this.buildGraphRecursively(
        clientId,
        maxDepth,
        includeFamily,
        includeBusiness,
        nodes,
        links,
        processedNodes,
        0
      );

      // Calculate node sizes based on connections
      this.calculateNodeSizes(nodes, links);

      // Optimize link distances for better visualization
      this.optimizeLinkDistances(links);

      const graphData: RelationshipGraphData = {
        nodes,
        links,
        centerNodeId: clientId,
        metadata: {
          totalNodes: nodes.length,
          totalConnections: links.length,
          maxDepth,
          generatedAt: new Date()
        }
      };

      // Cache for 30 minutes
      await this.redis.setex(cacheKey, 1800, JSON.stringify(graphData));

      logger.info(`Generated relationship graph for client: ${clientId}, nodes: ${nodes.length}, links: ${links.length}`);
      return graphData;

    } catch (error) {
      logger.error('Error generating relationship graph:', error);
      throw error;
    }
  }

  /**
   * Recursively build the relationship graph
   */
  private async buildGraphRecursively(
    nodeId: string,
    remainingDepth: number,
    includeFamily: boolean,
    includeBusiness: boolean,
    nodes: GraphNode[],
    links: GraphLink[],
    processed: Set<string>,
    currentDepth: number
  ): Promise<void> {
    if (remainingDepth <= 0 || processed.has(nodeId)) {
      return;
    }

    processed.add(nodeId);

    // Get client data
    const client = await this.getClientData(nodeId);
    if (!client) return;

    // Add client node
    const clientNode: GraphNode = {
      id: nodeId,
      name: client.name,
      type: 'client',
      group: this.getNodeGroup('client', currentDepth),
      size: this.calculateBaseNodeSize(client.relationshipScore),
      photo: client.photo,
      metadata: {
        relationshipScore: client.relationshipScore,
        lastInteraction: client.lastInteraction,
        sentimentTrend: client.sentimentTrend,
        clientType: 'primary'
      }
    };

    nodes.push(clientNode);

    // Add family members if enabled
    if (includeFamily) {
      await this.addFamilyNodes(nodeId, nodes, links, currentDepth);
    }

    // Add business relationships if enabled
    if (includeBusiness) {
      const businessRelationships = await this.getBusinessRelationships(nodeId);
      
      for (const relationship of businessRelationships) {
        const linkId = `${nodeId}-${relationship.relatedClientId}`;
        
        // Add link
        links.push({
          source: nodeId,
          target: relationship.relatedClientId,
          type: relationship.relationshipType,
          strength: relationship.strength,
          distance: this.calculateLinkDistance(relationship.strength, relationship.relationshipType),
          metadata: {
            description: relationship.relationshipType,
            notes: relationship.notes
          }
        });

        // Recursively process related clients
        await this.buildGraphRecursively(
          relationship.relatedClientId,
          remainingDepth - 1,
          includeFamily,
          includeBusiness,
          nodes,
          links,
          processed,
          currentDepth + 1
        );
      }
    }
  }

  /**
   * Add family member nodes to the graph
   */
  private async addFamilyNodes(
    clientId: string,
    nodes: GraphNode[],
    links: GraphLink[],
    currentDepth: number
  ): Promise<void> {
    const familyQuery = `
      SELECT id, name, relationship, age, notes
      FROM family_members 
      WHERE client_id = $1
    `;

    const result = await this.db.query(familyQuery, [clientId]);

    result.rows.forEach(family => {
      const familyNodeId = `family_${family.id}`;
      
      // Add family node
      nodes.push({
        id: familyNodeId,
        name: family.name,
        type: 'family',
        group: this.getNodeGroup('family', currentDepth),
        size: this.calculateBaseNodeSize(70), // Family members get moderate size
        metadata: {
          age: family.age,
          relationship: family.relationship,
          clientType: 'family'
        }
      });

      // Add link to client
      links.push({
        source: clientId,
        target: familyNodeId,
        type: family.relationship,
        strength: this.getFamilyRelationshipStrength(family.relationship),
        distance: 50, // Keep family close
        metadata: {
          description: family.relationship,
          notes: family.notes
        }
      });
    });
  }

  /**
   * Get client data for graph node
   */
  private async getClientData(clientId: string): Promise<any> {
    const query = `
      SELECT 
        id, name, photo_url, relationship_score, 
        last_interaction, sentiment_trend
      FROM clients 
      WHERE id = $1
    `;

    const result = await this.db.query(query, [clientId]);
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      photo: row.photo_url,
      relationshipScore: row.relationship_score || 50,
      lastInteraction: row.last_interaction,
      sentimentTrend: row.sentiment_trend
    };
  }

  /**
   * Get business relationships for a client
   */
  private async getBusinessRelationships(clientId: string): Promise<any[]> {
    const query = `
      SELECT 
        cr.related_client_id, cr.relationship_type, 
        cr.strength, cr.notes
      FROM client_relationships cr
      WHERE cr.client_id = $1
      ORDER BY cr.strength DESC
    `;

    const result = await this.db.query(query, [clientId]);
    return result.rows.map(row => ({
      relatedClientId: row.related_client_id,
      relationshipType: row.relationship_type,
      strength: row.strength,
      notes: row.notes
    }));
  }

  /**
   * Calculate node sizes based on relationship importance
   */
  private calculateNodeSizes(nodes: GraphNode[], links: GraphLink[]): void {
    // Count connections for each node
    const connectionCounts = new Map<string, number>();
    
    links.forEach(link => {
      connectionCounts.set(link.source, (connectionCounts.get(link.source) || 0) + 1);
      connectionCounts.set(link.target, (connectionCounts.get(link.target) || 0) + 1);
    });

    // Update node sizes based on connections and relationship scores
    nodes.forEach(node => {
      const connections = connectionCounts.get(node.id) || 0;
      const baseSize = node.size;
      const connectionBonus = Math.min(connections * 5, 20); // Max 20px bonus
      
      node.size = Math.max(15, Math.min(baseSize + connectionBonus, 60));
    });
  }

  /**
   * Optimize link distances for better visualization
   */
  private optimizeLinkDistances(links: GraphLink[]): void {
    links.forEach(link => {
      // Adjust distance based on relationship strength and type
      if (link.type.includes('family')) {
        link.distance = Math.max(30, 80 - (link.strength * 10));
      } else if (link.type.includes('business')) {
        link.distance = Math.max(50, 120 - (link.strength * 15));
      } else {
        link.distance = Math.max(40, 100 - (link.strength * 12));
      }
    });
  }

  /**
   * Calculate base node size from relationship score
   */
  private calculateBaseNodeSize(relationshipScore: number): number {
    // Scale from 20-50px based on relationship score (0-100)
    return Math.max(20, Math.min(20 + (relationshipScore * 0.3), 50));
  }

  /**
   * Calculate link distance based on relationship strength
   */
  private calculateLinkDistance(strength: number, type: string): number {
    const baseDistance = type.includes('family') ? 60 : 100;
    return Math.max(30, baseDistance - (strength * 15));
  }

  /**
   * Get node group for D3.js color coding
   */
  private getNodeGroup(type: string, depth: number): number {
    switch (type) {
      case 'client':
        return depth === 0 ? 1 : 2; // Center client vs. connected clients
      case 'family':
        return 3;
      case 'business':
        return 4;
      default:
        return 0;
    }
  }

  /**
   * Get family relationship strength for visualization
   */
  private getFamilyRelationshipStrength(relationship: string): number {
    const strengthMap: Record<string, number> = {
      'spouse': 5,
      'partner': 5,
      'child': 4,
      'parent': 4,
      'sibling': 3,
      'grandparent': 2,
      'grandchild': 2,
      'other': 1
    };

    return strengthMap[relationship.toLowerCase()] || 2;
  }

  /**
   * Get default layout configuration for D3.js
   */
  getDefaultLayoutConfig(): GraphLayoutConfig {
    return {
      width: 800,
      height: 600,
      centerForce: 0.1,
      linkDistance: 80,
      nodeSize: {
        min: 15,
        max: 60
      },
      colors: {
        client: '#2563eb', // Blue for clients
        family: '#16a34a', // Green for family
        business: '#dc2626', // Red for business
        selected: '#f59e0b' // Amber for selected
      }
    };
  }

  /**
   * Generate graph statistics for analytics
   */
  async getGraphStatistics(clientId: string): Promise<any> {
    const query = `
      WITH client_stats AS (
        SELECT 
          COUNT(DISTINCT cr.related_client_id) as business_connections,
          AVG(cr.strength) as avg_relationship_strength
        FROM client_relationships cr
        WHERE cr.client_id = $1
      ),
      family_stats AS (
        SELECT COUNT(*) as family_members
        FROM family_members fm
        WHERE fm.client_id = $1
      )
      SELECT 
        cs.business_connections,
        cs.avg_relationship_strength,
        fs.family_members,
        c.relationship_score,
        c.sentiment_trend
      FROM client_stats cs
      CROSS JOIN family_stats fs
      JOIN clients c ON c.id = $1
    `;

    const result = await this.db.query(query, [clientId]);
    if (result.rows.length === 0) return null;

    const stats = result.rows[0];
    return {
      businessConnections: parseInt(stats.business_connections) || 0,
      averageRelationshipStrength: parseFloat(stats.avg_relationship_strength) || 0,
      familyMembers: parseInt(stats.family_members) || 0,
      relationshipScore: stats.relationship_score || 50,
      sentimentTrend: stats.sentiment_trend || 'neutral',
      networkSize: (parseInt(stats.business_connections) || 0) + (parseInt(stats.family_members) || 0)
    };
  }

  /**
   * Clear relationship graph cache for a client
   */
  async clearGraphCache(clientId: string): Promise<void> {
    const pattern = `relationship_graph:${clientId}:*`;
    const keys = await this.redis.keys(pattern);
    
    if (keys.length > 0) {
      await this.redis.del(...keys);
      logger.info(`Cleared relationship graph cache for client: ${clientId}`);
    }
  }
}