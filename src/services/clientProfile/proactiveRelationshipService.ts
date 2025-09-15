/**
 * Proactive Relationship Management Service
 * Handles meeting brief generation, opportunity highlighting, stale relationship detection,
 * and automated re-engagement suggestions
 */

import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { Client, Communication, Task } from '../../types';
import { ClientProfileService } from './clientProfileService';
import { NLPProcessingService } from '../nlp/nlpProcessingService';
import { logger } from '../../utils/logger';

export interface MeetingBrief {
  clientId: string;
  clientName: string;
  lastInteraction: Date | null;
  relationshipScore: number;
  sentimentTrend: 'positive' | 'neutral' | 'negative';
  keyTopics: string[];
  personalHighlights: string[];
  suggestedFollowUps: string[];
  upcomingOpportunities: Opportunity[];
  recentCommunications: Communication[];
  aiSummary: string;
  generatedAt: Date;
}

export interface Opportunity {
  id: string;
  type: 'birthday' | 'anniversary' | 'follow_up' | 'renewal' | 'check_in' | 'custom';
  title: string;
  description: string;
  dueDate: Date;
  priority: 'low' | 'medium' | 'high';
  clientId: string;
  clientName: string;
  suggestedAction: string;
  autoExecutable: boolean;
}

export interface StaleRelationship {
  clientId: string;
  clientName: string;
  lastInteraction: Date | null;
  daysSinceLastInteraction: number;
  relationshipScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  suggestedActions: string[];
  reEngagementTemplate: string;
}

export interface ReEngagementSuggestion {
  clientId: string;
  type: 'email' | 'call' | 'meeting' | 'gift';
  subject: string;
  content: string;
  reasoning: string;
  confidence: number;
  riskLevel: 'low' | 'medium' | 'high';
}

export class ProactiveRelationshipService {
  constructor(
    private db: Pool,
    private redis: Redis,
    private clientProfileService: ClientProfileService,
    private nlpService: NLPProcessingService
  ) {}

  /**
   * Generate AI-powered meeting brief for a client
   * Requirement 3.2: Pre-meeting brief generation with AI summaries
   */
  async generateMeetingBrief(clientId: string): Promise<MeetingBrief> {
    try {
      logger.info(`Generating meeting brief for client: ${clientId}`);

      // Get client profile data
      const profileData = await this.clientProfileService.getClientProfile(clientId);
      if (!profileData) {
        throw new Error(`Client not found: ${clientId}`);
      }

      const { client } = profileData;

      // Get recent communications (last 30 days)
      const recentCommunications = await this.getRecentCommunications(clientId, 30);

      // Get upcoming opportunities
      const opportunities = await this.getUpcomingOpportunities(clientId);

      // Extract key topics from recent communications
      const keyTopics = await this.extractKeyTopics(recentCommunications);

      // Generate personal highlights from client data
      const personalHighlights = this.generatePersonalHighlights(profileData);

      // Generate suggested follow-ups
      const suggestedFollowUps = await this.generateFollowUpSuggestions(
        client,
        recentCommunications,
        opportunities
      );

      // Generate AI summary
      const aiSummary = await this.generateAISummary(
        client,
        recentCommunications,
        keyTopics,
        personalHighlights
      );

      const meetingBrief: MeetingBrief = {
        clientId: client.id,
        clientName: client.name,
        lastInteraction: client.relationshipHealth.lastInteraction,
        relationshipScore: client.relationshipHealth.score,
        sentimentTrend: client.relationshipHealth.sentimentTrend,
        keyTopics,
        personalHighlights,
        suggestedFollowUps,
        upcomingOpportunities: opportunities,
        recentCommunications: recentCommunications.slice(0, 5), // Top 5 most recent
        aiSummary,
        generatedAt: new Date()
      };

      // Cache the brief for 2 hours
      const cacheKey = `meeting_brief:${clientId}`;
      await this.redis.setex(cacheKey, 7200, JSON.stringify(meetingBrief));

      logger.info(`Generated meeting brief for client: ${clientId}`);
      return meetingBrief;

    } catch (error) {
      logger.error(`Error generating meeting brief for client ${clientId}:`, error);
      throw error;
    }
  }

  /**
   * Get upcoming opportunities for all clients or specific client
   * Requirement 3.5: Opportunity highlighting (birthdays, follow-ups)
   */
  async getUpcomingOpportunities(clientId?: string, daysAhead = 30): Promise<Opportunity[]> {
    try {
      const opportunities: Opportunity[] = [];
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() + daysAhead);

      // Get birthday opportunities
      const birthdayOpportunities = await this.getBirthdayOpportunities(clientId, daysAhead);
      opportunities.push(...birthdayOpportunities);

      // Get anniversary opportunities
      const anniversaryOpportunities = await this.getAnniversaryOpportunities(clientId, daysAhead);
      opportunities.push(...anniversaryOpportunities);

      // Get follow-up opportunities
      const followUpOpportunities = await this.getFollowUpOpportunities(clientId);
      opportunities.push(...followUpOpportunities);

      // Get renewal opportunities
      const renewalOpportunities = await this.getRenewalOpportunities(clientId, daysAhead);
      opportunities.push(...renewalOpportunities);

      // Sort by priority and due date
      opportunities.sort((a, b) => {
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return a.dueDate.getTime() - b.dueDate.getTime();
      });

      logger.info(`Found ${opportunities.length} upcoming opportunities`);
      return opportunities;

    } catch (error) {
      logger.error('Error getting upcoming opportunities:', error);
      throw error;
    }
  }

  /**
   * Detect stale relationships that need attention
   * Requirement 3.8: Stale relationship detection (>6mo no interaction)
   */
  async detectStaleRelationships(thresholdDays = 180): Promise<StaleRelationship[]> {
    try {
      const query = `
        SELECT 
          c.id, c.name, c.relationship_score, c.last_interaction,
          COALESCE(
            EXTRACT(DAY FROM (NOW() - c.last_interaction))::integer,
            999
          ) as days_since_last_interaction
        FROM clients c
        WHERE 
          c.last_interaction IS NULL OR 
          c.last_interaction < NOW() - INTERVAL '${thresholdDays} days'
        ORDER BY days_since_last_interaction DESC, c.relationship_score DESC
      `;

      const result = await this.db.query(query);
      const staleRelationships: StaleRelationship[] = [];

      for (const row of result.rows) {
        const daysSince = row.days_since_last_interaction;
        const riskLevel = this.calculateRiskLevel(daysSince, row.relationship_score);
        const suggestedActions = this.generateStaleRelationshipActions(daysSince, riskLevel);

        staleRelationships.push({
          clientId: row.id,
          clientName: row.name,
          lastInteraction: row.last_interaction,
          daysSinceLastInteraction: daysSince,
          relationshipScore: row.relationship_score || 50,
          riskLevel,
          suggestedActions,
          reEngagementTemplate: await this.generateReEngagementTemplate(row.id, riskLevel)
        });
      }

      logger.info(`Detected ${staleRelationships.length} stale relationships`);
      return staleRelationships;

    } catch (error) {
      logger.error('Error detecting stale relationships:', error);
      throw error;
    }
  }

  /**
   * Generate automated re-engagement suggestions
   * Requirement 3.8: Automated re-engagement suggestions
   */
  async generateReEngagementSuggestions(clientId: string): Promise<ReEngagementSuggestion[]> {
    try {
      const profileData = await this.clientProfileService.getClientProfile(clientId);
      if (!profileData) {
        throw new Error(`Client not found: ${clientId}`);
      }

      const { client } = profileData;
      const suggestions: ReEngagementSuggestion[] = [];

      // Get recent communications to understand context
      const recentComms = await this.getRecentCommunications(clientId, 90);
      const daysSinceLastInteraction = client.relationshipHealth.lastInteraction
        ? Math.floor((Date.now() - client.relationshipHealth.lastInteraction.getTime()) / (1000 * 60 * 60 * 24))
        : 999;

      // Generate email suggestion
      const emailSuggestion = await this.generateEmailReEngagement(client, recentComms, daysSinceLastInteraction);
      suggestions.push(emailSuggestion);

      // Generate call suggestion if relationship score is high enough
      if (client.relationshipHealth.score > 60) {
        const callSuggestion = await this.generateCallReEngagement(client, daysSinceLastInteraction);
        suggestions.push(callSuggestion);
      }

      // Generate meeting suggestion for high-value clients
      if (client.relationshipHealth.score > 70) {
        const meetingSuggestion = await this.generateMeetingReEngagement(client, profileData);
        suggestions.push(meetingSuggestion);
      }

      // Sort by confidence and risk level
      suggestions.sort((a, b) => {
        if (a.riskLevel !== b.riskLevel) {
          const riskOrder = { low: 3, medium: 2, high: 1 };
          return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
        }
        return b.confidence - a.confidence;
      });

      logger.info(`Generated ${suggestions.length} re-engagement suggestions for client: ${clientId}`);
      return suggestions;

    } catch (error) {
      logger.error(`Error generating re-engagement suggestions for client ${clientId}:`, error);
      throw error;
    }
  }

  /**
   * Get all proactive opportunities dashboard data
   */
  async getProactiveOpportunitiesDashboard(): Promise<{
    upcomingOpportunities: Opportunity[];
    staleRelationships: StaleRelationship[];
    totalClients: number;
    healthyRelationships: number;
    atRiskRelationships: number;
  }> {
    try {
      const [opportunities, staleRelationships, clientStats] = await Promise.all([
        this.getUpcomingOpportunities(),
        this.detectStaleRelationships(),
        this.getClientStatistics()
      ]);

      return {
        upcomingOpportunities: opportunities.slice(0, 20), // Top 20
        staleRelationships: staleRelationships.slice(0, 10), // Top 10 at risk
        ...clientStats
      };

    } catch (error) {
      logger.error('Error getting proactive opportunities dashboard:', error);
      throw error;
    }
  }

  // Private helper methods

  private async getRecentCommunications(clientId: string, days: number): Promise<Communication[]> {
    const query = `
      SELECT id, type, direction, subject, content, timestamp, tags, sentiment, is_urgent, source
      FROM communications
      WHERE client_id = $1 AND timestamp > NOW() - INTERVAL '${days} days'
      ORDER BY timestamp DESC
      LIMIT 50
    `;

    const result = await this.db.query(query, [clientId]);
    return result.rows.map(row => ({
      id: row.id,
      clientId,
      type: row.type,
      direction: row.direction,
      subject: row.subject,
      content: row.content,
      timestamp: row.timestamp,
      tags: row.tags || [],
      sentiment: row.sentiment,
      isUrgent: row.is_urgent,
      source: row.source,
      metadata: {
        messageId: row.message_id,
        threadId: row.thread_id,
        readStatus: row.read_status || 'unread'
      }
    }));
  }

  private async extractKeyTopics(communications: Communication[]): Promise<string[]> {
    if (communications.length === 0) return [];

    try {
      // Combine all communication content
      const allContent = communications
        .map(comm => `${comm.subject || ''} ${comm.content}`)
        .join(' ');

      // Use NLP service to extract key topics
      const topics = await this.nlpService.extractKeyTopics(allContent);
      return topics.slice(0, 5); // Top 5 topics

    } catch (error) {
      logger.error('Error extracting key topics:', error);
      return [];
    }
  }

  private generatePersonalHighlights(profileData: any): string[] {
    const highlights: string[] = [];
    const { client, familyMembers, importantDates } = profileData;

    // Add family information
    if (familyMembers.length > 0) {
      const spouses = familyMembers.filter((m: any) => m.relationship.toLowerCase().includes('spouse'));
      const children = familyMembers.filter((m: any) => m.relationship.toLowerCase().includes('child'));
      
      if (spouses.length > 0) {
        highlights.push(`Married to ${spouses[0].name}`);
      }
      if (children.length > 0) {
        highlights.push(`Has ${children.length} ${children.length === 1 ? 'child' : 'children'}`);
      }
    }

    // Add hobbies
    if (client.personalDetails.hobbies.length > 0) {
      highlights.push(`Interests: ${client.personalDetails.hobbies.slice(0, 3).join(', ')}`);
    }

    // Add upcoming important dates
    const upcomingDates = importantDates
      .filter((date: any) => {
        const dateObj = new Date(date.date);
        const now = new Date();
        const daysDiff = Math.ceil((dateObj.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return daysDiff > 0 && daysDiff <= 30;
      })
      .slice(0, 2);

    upcomingDates.forEach((date: any) => {
      highlights.push(`Upcoming ${date.type}: ${date.description}`);
    });

    return highlights;
  }

  private async generateFollowUpSuggestions(
    client: Client,
    communications: Communication[],
    opportunities: Opportunity[]
  ): Promise<string[]> {
    const suggestions: string[] = [];

    // Check for pending responses
    const pendingResponses = communications.filter(comm => 
      comm.direction === 'inbound' && 
      comm.timestamp > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
    );

    if (pendingResponses.length > 0) {
      suggestions.push('Follow up on recent client inquiries');
    }

    // Check relationship health
    if (client.relationshipHealth.score < 60) {
      suggestions.push('Schedule check-in call to strengthen relationship');
    }

    // Check for high-priority opportunities
    const highPriorityOps = opportunities.filter(op => op.priority === 'high');
    if (highPriorityOps.length > 0) {
      suggestions.push(`Address ${highPriorityOps.length} high-priority opportunities`);
    }

    // Check sentiment trend
    if (client.relationshipHealth.sentimentTrend === 'negative') {
      suggestions.push('Address potential concerns - recent sentiment decline detected');
    }

    return suggestions.slice(0, 5); // Top 5 suggestions
  }

  private async generateAISummary(
    client: Client,
    communications: Communication[],
    keyTopics: string[],
    personalHighlights: string[]
  ): Promise<string> {
    try {
      const context = {
        clientName: client.name,
        relationshipScore: client.relationshipHealth.score,
        sentimentTrend: client.relationshipHealth.sentimentTrend,
        lastInteraction: client.relationshipHealth.lastInteraction,
        recentTopics: keyTopics,
        personalInfo: personalHighlights,
        communicationCount: communications.length
      };

      const prompt = `Generate a concise meeting brief summary for ${client.name}. 
      Relationship score: ${client.relationshipHealth.score}/100
      Recent topics: ${keyTopics.join(', ')}
      Personal highlights: ${personalHighlights.join(', ')}
      Recent communications: ${communications.length} in last 30 days
      
      Provide a 2-3 sentence summary focusing on relationship status and key talking points.`;

      // Use NLP service to generate summary
      const summary = await this.nlpService.generateSummary(prompt, context);
      return summary || `${client.name} - Relationship score: ${client.relationshipHealth.score}/100. Recent activity: ${communications.length} communications. Key topics: ${keyTopics.slice(0, 3).join(', ')}.`;

    } catch (error) {
      logger.error('Error generating AI summary:', error);
      return `${client.name} - Relationship score: ${client.relationshipHealth.score}/100. Recent activity: ${communications.length} communications.`;
    }
  }

  private async getBirthdayOpportunities(clientId?: string, daysAhead = 30): Promise<Opportunity[]> {
    const whereClause = clientId ? 'AND c.id = $2' : '';
    const params = clientId ? [daysAhead, clientId] : [daysAhead];

    const query = `
      SELECT c.id, c.name, id.date_value, id.description
      FROM clients c
      JOIN important_dates id ON id.client_id = c.id
      WHERE id.type = 'birthday' 
        AND id.date_value BETWEEN NOW() AND NOW() + INTERVAL '${daysAhead} days'
        ${whereClause}
      ORDER BY id.date_value
    `;

    const result = await this.db.query(query, params);
    return result.rows.map(row => ({
      id: `birthday_${row.id}`,
      type: 'birthday' as const,
      title: `${row.name}'s Birthday`,
      description: row.description || `Birthday celebration for ${row.name}`,
      dueDate: new Date(row.date_value),
      priority: 'medium' as const,
      clientId: row.id,
      clientName: row.name,
      suggestedAction: 'Send birthday wishes and consider a small gift',
      autoExecutable: true
    }));
  }

  private async getAnniversaryOpportunities(clientId?: string, daysAhead = 30): Promise<Opportunity[]> {
    const whereClause = clientId ? 'AND c.id = $2' : '';
    const params = clientId ? [daysAhead, clientId] : [daysAhead];

    const query = `
      SELECT c.id, c.name, id.date_value, id.description
      FROM clients c
      JOIN important_dates id ON id.client_id = c.id
      WHERE id.type IN ('anniversary', 'work_anniversary') 
        AND id.date_value BETWEEN NOW() AND NOW() + INTERVAL '${daysAhead} days'
        ${whereClause}
      ORDER BY id.date_value
    `;

    const result = await this.db.query(query, params);
    return result.rows.map(row => ({
      id: `anniversary_${row.id}`,
      type: 'anniversary' as const,
      title: `${row.name}'s Anniversary`,
      description: row.description || `Anniversary celebration for ${row.name}`,
      dueDate: new Date(row.date_value),
      priority: 'medium' as const,
      clientId: row.id,
      clientName: row.name,
      suggestedAction: 'Send congratulations and schedule check-in',
      autoExecutable: true
    }));
  }

  private async getFollowUpOpportunities(clientId?: string): Promise<Opportunity[]> {
    const whereClause = clientId ? 'AND client_id = $1' : '';
    const params = clientId ? [clientId] : [];

    const query = `
      SELECT id, client_id, description, due_date, priority
      FROM tasks
      WHERE status = 'pending' 
        AND type = 'follow-up'
        AND due_date <= NOW() + INTERVAL '7 days'
        ${whereClause}
      ORDER BY due_date, priority DESC
    `;

    const result = await this.db.query(query, params);
    const opportunities: Opportunity[] = [];

    for (const row of result.rows) {
      // Get client name
      const clientQuery = 'SELECT name FROM clients WHERE id = $1';
      const clientResult = await this.db.query(clientQuery, [row.client_id]);
      const clientName = clientResult.rows[0]?.name || 'Unknown Client';

      opportunities.push({
        id: `followup_${row.id}`,
        type: 'follow_up',
        title: `Follow-up: ${row.description}`,
        description: row.description,
        dueDate: new Date(row.due_date),
        priority: row.priority,
        clientId: row.client_id,
        clientName,
        suggestedAction: 'Complete pending follow-up task',
        autoExecutable: false
      });
    }

    return opportunities;
  }

  private async getRenewalOpportunities(clientId?: string, daysAhead = 30): Promise<Opportunity[]> {
    // This would integrate with CRM data to find policy renewals
    // For now, return empty array as CRM integration is not fully implemented
    return [];
  }

  private calculateRiskLevel(daysSinceLastInteraction: number, relationshipScore: number): 'low' | 'medium' | 'high' {
    if (daysSinceLastInteraction > 365 || relationshipScore < 30) {
      return 'high';
    } else if (daysSinceLastInteraction > 180 || relationshipScore < 60) {
      return 'medium';
    }
    return 'low';
  }

  private generateStaleRelationshipActions(daysSince: number, riskLevel: string): string[] {
    const actions: string[] = [];

    if (riskLevel === 'high') {
      actions.push('Schedule urgent check-in call');
      actions.push('Send personalized re-engagement email');
      actions.push('Consider in-person meeting or gift');
    } else if (riskLevel === 'medium') {
      actions.push('Send friendly check-in email');
      actions.push('Schedule phone call');
      actions.push('Share relevant industry updates');
    } else {
      actions.push('Send brief update email');
      actions.push('Share helpful resources');
    }

    return actions;
  }

  private async generateReEngagementTemplate(clientId: string, riskLevel: string): Promise<string> {
    try {
      const profileData = await this.clientProfileService.getClientProfile(clientId);
      if (!profileData) return 'Generic re-engagement template';

      const { client } = profileData;
      
      if (riskLevel === 'high') {
        return `Hi ${client.name}, I hope you're doing well! It's been a while since we last connected, and I wanted to reach out to see how things are going with you and your family. I'd love to schedule a quick call to catch up and see if there's anything I can help you with. When would be a good time for you?`;
      } else if (riskLevel === 'medium') {
        return `Hi ${client.name}, I hope you're having a great week! I was thinking about you and wanted to check in to see how everything is going. Is there anything new happening that I should know about? I'm here if you need anything.`;
      } else {
        return `Hi ${client.name}, I hope all is well! Just wanted to send a quick note to stay in touch. Let me know if there's anything I can help you with.`;
      }

    } catch (error) {
      logger.error('Error generating re-engagement template:', error);
      return 'Generic re-engagement template';
    }
  }

  private async generateEmailReEngagement(
    client: Client,
    recentComms: Communication[],
    daysSince: number
  ): Promise<ReEngagementSuggestion> {
    const riskLevel = this.calculateRiskLevel(daysSince, client.relationshipHealth.score);
    
    return {
      clientId: client.id,
      type: 'email',
      subject: daysSince > 365 ? `Long time no talk, ${client.name}!` : `Checking in, ${client.name}`,
      content: await this.generateReEngagementTemplate(client.id, riskLevel),
      reasoning: `${daysSince} days since last interaction. Relationship score: ${client.relationshipHealth.score}`,
      confidence: Math.max(0.6, Math.min(0.9, (100 - daysSince / 10) / 100)),
      riskLevel
    };
  }

  private async generateCallReEngagement(
    client: Client,
    daysSince: number
  ): Promise<ReEngagementSuggestion> {
    return {
      clientId: client.id,
      type: 'call',
      subject: `Check-in call with ${client.name}`,
      content: `Schedule a friendly check-in call to reconnect and see how ${client.name} is doing.`,
      reasoning: `Strong relationship (score: ${client.relationshipHealth.score}) warrants personal call`,
      confidence: 0.75,
      riskLevel: 'low'
    };
  }

  private async generateMeetingReEngagement(
    client: Client,
    profileData: any
  ): Promise<ReEngagementSuggestion> {
    return {
      clientId: client.id,
      type: 'meeting',
      subject: `Coffee meeting with ${client.name}`,
      content: `Invite ${client.name} for coffee or lunch to strengthen the relationship and discuss their current needs.`,
      reasoning: `High-value client (score: ${client.relationshipHealth.score}) deserves face-to-face attention`,
      confidence: 0.8,
      riskLevel: 'low'
    };
  }

  private async getClientStatistics(): Promise<{
    totalClients: number;
    healthyRelationships: number;
    atRiskRelationships: number;
  }> {
    const query = `
      SELECT 
        COUNT(*) as total_clients,
        COUNT(CASE WHEN relationship_score >= 70 THEN 1 END) as healthy_relationships,
        COUNT(CASE WHEN relationship_score < 50 OR last_interaction < NOW() - INTERVAL '180 days' THEN 1 END) as at_risk_relationships
      FROM clients
    `;

    const result = await this.db.query(query);
    const row = result.rows[0];

    return {
      totalClients: parseInt(row.total_clients),
      healthyRelationships: parseInt(row.healthy_relationships),
      atRiskRelationships: parseInt(row.at_risk_relationships)
    };
  }
}