import { EventEmitter } from 'events';
import { Pool } from 'pg';
import { CacheService } from '../cacheService';
import { EmailMessage, EmailSearchQuery } from '../../types/email';
import { PhoneCall, SmsMessage } from '../../types/twilio';
import { logger } from '../../utils/logger';
import { WebSocketServer } from 'ws';

export interface UnifiedCommunication {
  id: string;
  type: 'email' | 'call' | 'sms';
  direction: 'inbound' | 'outbound';
  from: string;
  to: string;
  subject?: string;
  content: string;
  timestamp: Date;
  clientId?: string;
  tags: string[];
  isUrgent: boolean;
  isRead?: boolean;
  sentiment?: number;
  metadata: Record<string, any>;
  originalData: EmailMessage | PhoneCall | SmsMessage;
}

export interface CommunicationSearchQuery {
  userId?: string;
  clientId?: string;
  type?: 'email' | 'call' | 'sms';
  direction?: 'inbound' | 'outbound';
  from?: string;
  to?: string;
  subject?: string;
  content?: string;
  dateFrom?: Date;
  dateTo?: Date;
  tags?: string[];
  isUrgent?: boolean;
  isRead?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: 'timestamp' | 'type' | 'urgency';
  sortOrder?: 'asc' | 'desc';
}

export interface AutoTagRule {
  id: string;
  userId: string;
  name: string;
  description: string;
  conditions: TagCondition[];
  actions: TagAction[];
  isActive: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TagCondition {
  field: 'from' | 'to' | 'subject' | 'content' | 'type' | 'time';
  operator: 'contains' | 'equals' | 'starts_with' | 'ends_with' | 'regex' | 'time_range';
  value: string | string[];
  caseSensitive?: boolean;
}

export interface TagAction {
  type: 'add_tag' | 'set_urgent' | 'set_read' | 'assign_client';
  value: string | boolean;
}

export class CommunicationCenterService extends EventEmitter {
  private wsServer?: WebSocketServer;

  constructor(
    private dbService: Pool,
    private cacheService: CacheService
  ) {
    super();
  }

  public setWebSocketServer(wsServer: WebSocketServer): void {
    this.wsServer = wsServer;
  }

  public async getUnifiedCommunications(query: CommunicationSearchQuery): Promise<{
    communications: UnifiedCommunication[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      const limit = Math.min(query.limit || 20, 100);
      const offset = query.offset || 0;

      // Build the unified query
      let sql = `
        SELECT 
          'email' as type,
          id,
          from_addresses->0->>'address' as from_address,
          to_addresses->0->>'address' as to_address,
          subject,
          COALESCE(body_text, body_html) as content,
          date as timestamp,
          client_id,
          tags,
          is_important as is_urgent,
          is_read,
          sentiment,
          created_at,
          'inbound' as direction
        FROM email_messages
        WHERE 1=1
      `;

      const params: any[] = [];
      let paramIndex = 1;

      // Add email-specific filters
      if (query.clientId) {
        sql += ` AND client_id = $${paramIndex}`;
        params.push(query.clientId);
        paramIndex++;
      }

      if (query.from) {
        sql += ` AND from_addresses::text ILIKE $${paramIndex}`;
        params.push(`%${query.from}%`);
        paramIndex++;
      }

      if (query.subject) {
        sql += ` AND subject ILIKE $${paramIndex}`;
        params.push(`%${query.subject}%`);
        paramIndex++;
      }

      if (query.content) {
        sql += ` AND (body_text ILIKE $${paramIndex} OR body_html ILIKE $${paramIndex})`;
        params.push(`%${query.content}%`);
        paramIndex++;
      }

      if (query.dateFrom) {
        sql += ` AND date >= $${paramIndex}`;
        params.push(query.dateFrom);
        paramIndex++;
      }

      if (query.dateTo) {
        sql += ` AND date <= $${paramIndex}`;
        params.push(query.dateTo);
        paramIndex++;
      }

      if (query.tags && query.tags.length > 0) {
        sql += ` AND tags::jsonb ?| $${paramIndex}`;
        params.push(query.tags);
        paramIndex++;
      }

      if (query.isUrgent !== undefined) {
        sql += ` AND is_important = $${paramIndex}`;
        params.push(query.isUrgent);
        paramIndex++;
      }

      if (query.isRead !== undefined) {
        sql += ` AND is_read = $${paramIndex}`;
        params.push(query.isRead);
        paramIndex++;
      }

      // Add phone calls
      sql += `
        UNION ALL
        SELECT 
          'call' as type,
          id,
          from_number as from_address,
          to_number as to_address,
          CASE 
            WHEN transcription IS NOT NULL THEN CONCAT('Call - ', transcription)
            ELSE CONCAT('Call - Duration: ', COALESCE(duration::text, 'Unknown'))
          END as subject,
          COALESCE(transcription, 'No transcription available') as content,
          COALESCE(start_time, created_at) as timestamp,
          client_id,
          tags,
          false as is_urgent,
          true as is_read,
          null as sentiment,
          created_at,
          direction
        FROM phone_calls
        WHERE 1=1
      `;

      // Add SMS messages
      sql += `
        UNION ALL
        SELECT 
          'sms' as type,
          id,
          from_number as from_address,
          to_number as to_address,
          CONCAT('SMS - ', LEFT(body, 50)) as subject,
          body as content,
          COALESCE(date_sent, created_at) as timestamp,
          client_id,
          tags,
          false as is_urgent,
          true as is_read,
          null as sentiment,
          created_at,
          direction
        FROM sms_messages
        WHERE 1=1
      `;

      // Add ordering and pagination
      const sortField = query.sortBy === 'type' ? 'type' : 
                       query.sortBy === 'urgency' ? 'is_urgent' : 'timestamp';
      const sortOrder = query.sortOrder === 'asc' ? 'ASC' : 'DESC';
      
      sql += ` ORDER BY ${sortField} ${sortOrder}, timestamp DESC`;
      sql += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit + 1, offset); // Get one extra to check if there are more

      const result = await this.dbService.query(sql, params);
      
      const hasMore = result.rows.length > limit;
      const communications = result.rows.slice(0, limit).map((row: any) => this.mapRowToUnifiedCommunication(row));

      // Get total count for pagination
      const countSql = `
        SELECT COUNT(*) as total FROM (
          SELECT id FROM email_messages WHERE 1=1
          UNION ALL
          SELECT id FROM phone_calls WHERE 1=1
          UNION ALL
          SELECT id FROM sms_messages WHERE 1=1
        ) combined
      `;
      const countResult = await this.dbService.query(countSql);
      const total = parseInt(countResult.rows[0].total);

      return {
        communications,
        total,
        hasMore,
      };
    } catch (error) {
      logger.error('Failed to get unified communications:', error);
      throw error;
    }
  }

  public async searchCommunications(searchTerm: string, options: {
    userId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<UnifiedCommunication[]> {
    try {
      const limit = Math.min(options.limit || 20, 100);
      const offset = options.offset || 0;

      // Full-text search across all communication types
      const sql = `
        SELECT * FROM (
          SELECT 
            'email' as type,
            id,
            from_addresses->0->>'address' as from_address,
            to_addresses->0->>'address' as to_address,
            subject,
            COALESCE(body_text, body_html) as content,
            date as timestamp,
            client_id,
            tags,
            is_important as is_urgent,
            is_read,
            sentiment,
            created_at,
            'inbound' as direction,
            ts_rank(to_tsvector('english', COALESCE(subject, '') || ' ' || COALESCE(body_text, '')), plainto_tsquery('english', $1)) as rank
          FROM email_messages
          WHERE to_tsvector('english', COALESCE(subject, '') || ' ' || COALESCE(body_text, '')) @@ plainto_tsquery('english', $1)
          
          UNION ALL
          
          SELECT 
            'call' as type,
            id,
            from_number as from_address,
            to_number as to_address,
            CASE 
              WHEN transcription IS NOT NULL THEN CONCAT('Call - ', transcription)
              ELSE CONCAT('Call - Duration: ', COALESCE(duration::text, 'Unknown'))
            END as subject,
            COALESCE(transcription, 'No transcription available') as content,
            COALESCE(start_time, created_at) as timestamp,
            client_id,
            tags,
            false as is_urgent,
            true as is_read,
            null as sentiment,
            created_at,
            direction,
            ts_rank(to_tsvector('english', COALESCE(transcription, '')), plainto_tsquery('english', $1)) as rank
          FROM phone_calls
          WHERE transcription IS NOT NULL AND to_tsvector('english', transcription) @@ plainto_tsquery('english', $1)
          
          UNION ALL
          
          SELECT 
            'sms' as type,
            id,
            from_number as from_address,
            to_number as to_address,
            CONCAT('SMS - ', LEFT(body, 50)) as subject,
            body as content,
            COALESCE(date_sent, created_at) as timestamp,
            client_id,
            tags,
            false as is_urgent,
            true as is_read,
            null as sentiment,
            created_at,
            direction,
            ts_rank(to_tsvector('english', body), plainto_tsquery('english', $1)) as rank
          FROM sms_messages
          WHERE to_tsvector('english', body) @@ plainto_tsquery('english', $1)
        ) combined
        ORDER BY rank DESC, timestamp DESC
        LIMIT $2 OFFSET $3
      `;

      const result = await this.dbService.query(sql, [searchTerm, limit, offset]);
      return result.rows.map((row: any) => this.mapRowToUnifiedCommunication(row));
    } catch (error) {
      logger.error('Failed to search communications:', error);
      throw error;
    }
  }

  public async getAutoTagRules(userId: string): Promise<AutoTagRule[]> {
    try {
      const query = `
        SELECT * FROM auto_tag_rules 
        WHERE user_id = $1 AND is_active = true 
        ORDER BY priority DESC, created_at ASC
      `;
      const result = await this.dbService.query(query, [userId]);
      
      return result.rows.map((row: any) => this.mapRowToAutoTagRule(row));
    } catch (error) {
      logger.error(`Failed to get auto tag rules for user ${userId}:`, error);
      throw error;
    }
  }

  public async createAutoTagRule(userId: string, rule: Omit<AutoTagRule, 'id' | 'userId' | 'createdAt' | 'updatedAt'>): Promise<AutoTagRule> {
    try {
      const query = `
        INSERT INTO auto_tag_rules (
          user_id, name, description, conditions, actions, is_active, priority, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        RETURNING *
      `;

      const result = await this.dbService.query(query, [
        userId,
        rule.name,
        rule.description,
        JSON.stringify(rule.conditions),
        JSON.stringify(rule.actions),
        rule.isActive,
        rule.priority,
      ]);

      return this.mapRowToAutoTagRule(result.rows[0]);
    } catch (error) {
      logger.error('Failed to create auto tag rule:', error);
      throw error;
    }
  }

  public async applyAutoTagRules(communication: UnifiedCommunication, userId: string): Promise<UnifiedCommunication> {
    try {
      const rules = await this.getAutoTagRules(userId);
      let updatedCommunication = { ...communication };

      for (const rule of rules) {
        if (this.evaluateTagConditions(communication, rule.conditions)) {
          updatedCommunication = this.applyTagActions(updatedCommunication, rule.actions);
        }
      }

      return updatedCommunication;
    } catch (error) {
      logger.error('Failed to apply auto tag rules:', error);
      return communication;
    }
  }

  private evaluateTagConditions(communication: UnifiedCommunication, conditions: TagCondition[]): boolean {
    return conditions.every(condition => {
      const fieldValue = this.getFieldValue(communication, condition.field);
      
      switch (condition.operator) {
        case 'contains':
          return this.stringContains(fieldValue, condition.value as string, condition.caseSensitive);
        case 'equals':
          return this.stringEquals(fieldValue, condition.value as string, condition.caseSensitive);
        case 'starts_with':
          return this.stringStartsWith(fieldValue, condition.value as string, condition.caseSensitive);
        case 'ends_with':
          return this.stringEndsWith(fieldValue, condition.value as string, condition.caseSensitive);
        case 'regex':
          return this.stringMatchesRegex(fieldValue, condition.value as string, condition.caseSensitive);
        case 'time_range':
          return this.timeInRange(communication.timestamp, condition.value as string[]);
        default:
          return false;
      }
    });
  }

  private applyTagActions(communication: UnifiedCommunication, actions: TagAction[]): UnifiedCommunication {
    let updated = { ...communication };

    for (const action of actions) {
      switch (action.type) {
        case 'add_tag':
          if (!updated.tags.includes(action.value as string)) {
            updated.tags.push(action.value as string);
          }
          break;
        case 'set_urgent':
          updated.isUrgent = action.value as boolean;
          break;
        case 'set_read':
          updated.isRead = action.value as boolean;
          break;
        case 'assign_client':
          updated.clientId = action.value as string;
          break;
      }
    }

    return updated;
  }

  private getFieldValue(communication: UnifiedCommunication, field: string): string {
    switch (field) {
      case 'from':
        return communication.from;
      case 'to':
        return communication.to;
      case 'subject':
        return communication.subject || '';
      case 'content':
        return communication.content;
      case 'type':
        return communication.type;
      case 'time':
        return communication.timestamp.toISOString();
      default:
        return '';
    }
  }

  private stringContains(text: string, value: string, caseSensitive = false): boolean {
    const searchText = caseSensitive ? text : text.toLowerCase();
    const searchValue = caseSensitive ? value : value.toLowerCase();
    return searchText.includes(searchValue);
  }

  private stringEquals(text: string, value: string, caseSensitive = false): boolean {
    const searchText = caseSensitive ? text : text.toLowerCase();
    const searchValue = caseSensitive ? value : value.toLowerCase();
    return searchText === searchValue;
  }

  private stringStartsWith(text: string, value: string, caseSensitive = false): boolean {
    const searchText = caseSensitive ? text : text.toLowerCase();
    const searchValue = caseSensitive ? value : value.toLowerCase();
    return searchText.startsWith(searchValue);
  }

  private stringEndsWith(text: string, value: string, caseSensitive = false): boolean {
    const searchText = caseSensitive ? text : text.toLowerCase();
    const searchValue = caseSensitive ? value : value.toLowerCase();
    return searchText.endsWith(searchValue);
  }

  private stringMatchesRegex(text: string, pattern: string, caseSensitive = false): boolean {
    try {
      const flags = caseSensitive ? 'g' : 'gi';
      const regex = new RegExp(pattern, flags);
      return regex.test(text);
    } catch (error) {
      logger.warn(`Invalid regex pattern: ${pattern}`);
      return false;
    }
  }

  private timeInRange(timestamp: Date, range: string[]): boolean {
    if (range.length !== 2) return false;
    
    const [startTime, endTime] = range;
    const time = timestamp.toTimeString().substring(0, 5); // HH:MM format
    
    return time >= startTime && time <= endTime;
  }

  public async broadcastNewCommunication(communication: UnifiedCommunication): Promise<void> {
    // Broadcast via WebSocket if available
    if (this.wsServer) {
      const message = JSON.stringify({
        type: 'new_communication',
        data: communication,
      });

      this.wsServer.clients.forEach(client => {
        if (client.readyState === 1) { // WebSocket.OPEN
          client.send(message);
        }
      });
    }

    // Always emit event for other services
    this.emit('newCommunication', communication);
  }

  private mapRowToUnifiedCommunication(row: any): UnifiedCommunication {
    return {
      id: row.id,
      type: row.type,
      direction: row.direction || 'inbound',
      from: row.from_address,
      to: row.to_address,
      subject: row.subject,
      content: row.content,
      timestamp: row.timestamp,
      clientId: row.client_id,
      tags: row.tags || [],
      isUrgent: row.is_urgent || false,
      isRead: row.is_read,
      sentiment: row.sentiment,
      metadata: {
        createdAt: row.created_at,
        rank: row.rank,
      },
      originalData: row, // In a real implementation, you'd fetch the full original data
    };
  }

  private mapRowToAutoTagRule(row: any): AutoTagRule {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      conditions: row.conditions,
      actions: row.actions,
      isActive: row.is_active,
      priority: row.priority,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}