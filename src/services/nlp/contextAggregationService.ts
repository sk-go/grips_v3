import { ConversationContext, ContextMessage } from '../../types/nlp';
import { CacheService } from '../cacheService';
import { logger } from '../../utils/logger';

// Define the Task type to ensure type safety
interface Task {
  id: string;
  type: string;
  description: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  dueDate: string;
  status: 'pending' | 'in_progress';
}

export class ContextAggregationService {
  private cacheService: CacheService;
  private maxContextMessages: number = 20;
  private contextTTL: number = 3600; // 1 hour in seconds

  // Priority order mapping for task sorting
  private priorityOrder: Record<Task['priority'], number> = {
    urgent: 4,
    high: 3,
    medium: 2,
    low: 1
  };

  constructor(cacheService: CacheService) {
    this.cacheService = cacheService;
  }

  async getContext(sessionId: string, agentId: string, clientId?: string): Promise<ConversationContext> {
    try {
      // Try to get existing context from cache
      const cachedContext = await this.cacheService.get(`context:${sessionId}`);
      
      if (cachedContext) {
        const context = JSON.parse(cachedContext) as ConversationContext;
        // Refresh context with latest data
        return await this.refreshContext(context, clientId);
      }

      // Create new context
      return await this.createNewContext(sessionId, agentId, clientId);

    } catch (error) {
      logger.error('Failed to get conversation context', { error, sessionId, agentId });
      // Return minimal context on error
      return {
        sessionId,
        agentId,
        clientId,
        previousMessages: [],
        metadata: {}
      };
    }
  }

  async updateContext(
    sessionId: string,
    message: ContextMessage,
    additionalData?: Partial<ConversationContext>
  ): Promise<void> {
    try {
      const context = await this.getContext(sessionId, additionalData?.agentId || '', additionalData?.clientId);
      
      // Add new message
      context.previousMessages.push(message);
      
      // Keep only the most recent messages
      if (context.previousMessages.length > this.maxContextMessages) {
        context.previousMessages = context.previousMessages.slice(-this.maxContextMessages);
      }

      // Update additional data if provided
      if (additionalData) {
        Object.assign(context, additionalData);
      }

      // Update timestamp
      context.metadata = {
        ...context.metadata,
        lastUpdated: new Date().toISOString()
      };

      // Save to cache
      await this.cacheService.set(
        `context:${sessionId}`,
        JSON.stringify(context),
        this.contextTTL
      );

    } catch (error) {
      logger.error('Failed to update conversation context', { error, sessionId });
    }
  }

  async aggregateCRMData(clientId: string): Promise<any> {
    try {
      // Get CRM data from cache (populated by CRM sync service)
      const crmData = await this.cacheService.get(`crm_client:${clientId}`);
      
      if (crmData) {
        const parsedData = JSON.parse(crmData);
        
        // Extract relevant information for context
        return {
          clientInfo: {
            id: parsedData.id,
            name: parsedData.name,
            email: parsedData.email,
            phone: parsedData.phone,
            company: parsedData.company
          },
          recentInteractions: parsedData.recentInteractions || [],
          policies: parsedData.policies || [],
          preferences: parsedData.preferences || {},
          relationshipHealth: parsedData.relationshipHealth || {}
        };
      }

      return null;
    } catch (error) {
      logger.error('Failed to aggregate CRM data', { error, clientId });
      return null;
    }
  }

  async aggregateRecentCommunications(clientId: string, limit: number = 10): Promise<any[]> {
    try {
      // Get recent communications from cache
      const communications = await this.cacheService.get(`communications:${clientId}`);
      
      if (communications) {
        const parsedComms = JSON.parse(communications);
        
        // Sort by timestamp and limit
        return parsedComms
          .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, limit)
          .map((comm: any) => ({
            id: comm.id,
            type: comm.type,
            direction: comm.direction,
            subject: comm.subject,
            timestamp: comm.timestamp,
            sentiment: comm.sentiment,
            summary: this.summarizeCommunication(comm.content)
          }));
      }

      return [];
    } catch (error) {
      logger.error('Failed to aggregate recent communications', { error, clientId });
      return [];
    }
  }

  async aggregateActiveTasks(agentId: string, clientId?: string): Promise<Task[]> {
    try {
      const cacheKey = clientId ? `tasks:${agentId}:${clientId}` : `tasks:${agentId}`;
      const tasks = await this.cacheService.get(cacheKey);
      
      if (tasks) {
        const parsedTasks = JSON.parse(tasks) as Task[];
        
        // Filter active tasks and sort by priority
        return parsedTasks
          .filter((task) => task.status === 'pending' || task.status === 'in_progress')
          .sort((a, b) => this.priorityOrder[b.priority] - this.priorityOrder[a.priority])
          .slice(0, 10) // Limit to 10 most important tasks
          .map((task) => ({
            id: task.id,
            type: task.type,
            description: task.description,
            priority: task.priority,
            dueDate: task.dueDate,
            status: task.status
          }));
      }

      return [];
    } catch (error) {
      logger.error('Failed to aggregate active tasks', { error, agentId, clientId });
      return [];
    }
  }

  private async createNewContext(
    sessionId: string,
    agentId: string,
    clientId?: string
  ): Promise<ConversationContext> {
    const context: ConversationContext = {
      sessionId,
      agentId,
      clientId,
      previousMessages: [],
      metadata: {
        created: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      }
    };

    // Populate with initial data if clientId is provided
    if (clientId) {
      context.crmData = await this.aggregateCRMData(clientId);
      context.recentCommunications = await this.aggregateRecentCommunications(clientId);
    }

    context.activeTasks = await this.aggregateActiveTasks(agentId, clientId);

    return context;
  }

  private async refreshContext(
    context: ConversationContext,
    clientId?: string
  ): Promise<ConversationContext> {
    // Update client ID if provided and different
    if (clientId && clientId !== context.clientId) {
      context.clientId = clientId;
      context.crmData = await this.aggregateCRMData(clientId);
      context.recentCommunications = await this.aggregateRecentCommunications(clientId);
    }

    // Always refresh active tasks
    context.activeTasks = await this.aggregateActiveTasks(context.agentId, context.clientId);

    return context;
  }

  private summarizeCommunication(content: string): string {
    // Simple summarization - in production, you might use AI for this
    if (content.length <= 100) {
      return content;
    }

    // Extract first sentence or first 100 characters
    const firstSentence = content.match(/^[^.!?]*[.!?]/);
    if (firstSentence && firstSentence[0].length <= 100) {
      return firstSentence[0];
    }

    return content.substring(0, 97) + '...';
  }

  async clearContext(sessionId: string): Promise<void> {
    try {
      await this.cacheService.delete(`context:${sessionId}`);
    } catch (error) {
      logger.error('Failed to clear conversation context', { error, sessionId });
    }
  }

  async getContextSummary(sessionId: string): Promise<string> {
    try {
      const context = await this.getContext(sessionId, '', undefined);
      
      const summary = [];
      
      if (context.clientId && context.crmData) {
        summary.push(`Client: ${context.crmData.clientInfo?.name || 'Unknown'}`);
      }
      
      if (context.previousMessages.length > 0) {
        summary.push(`Messages: ${context.previousMessages.length}`);
      }
      
      if (context.activeTasks && context.activeTasks.length > 0) {
        summary.push(`Active tasks: ${context.activeTasks.length}`);
      }
      
      if (context.recentCommunications && context.recentCommunications.length > 0) {
        summary.push(`Recent communications: ${context.recentCommunications.length}`);
      }

      return summary.join(', ') || 'No context available';
      
    } catch (error) {
      logger.error('Failed to get context summary', { error, sessionId });
      return 'Context unavailable';
    }
  }

  setMaxContextMessages(max: number): void {
    this.maxContextMessages = Math.max(1, Math.min(100, max));
  }

  setContextTTL(ttl: number): void {
    this.contextTTL = Math.max(300, ttl); // Minimum 5 minutes
  }
}