import { 
  AIAction, 
  ActionQueue, 
  QueueConfig, 
  QueueMetrics, 
  ActionStatus,
  ActionPriority,
  QueueType
} from '../../types/aiActions';
import { CacheService } from '../cacheService';
import { logger } from '../../utils/logger';
import { EventEmitter } from 'events';

export class ActionQueueService extends EventEmitter {
  private queues: Map<string, ActionQueue> = new Map();
  private cacheService: CacheService;
  private processingIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(cacheService: CacheService) {
    super();
    this.cacheService = cacheService;
    this.initializeDefaultQueues();
  }

  async enqueueAction(action: AIAction, queueId?: string): Promise<void> {
    const targetQueueId = queueId || this.selectQueue(action);
    const queue = this.queues.get(targetQueueId);
    
    if (!queue) {
      throw new Error(`Queue not found: ${targetQueueId}`);
    }

    // Update action status
    action.status = 'queued';
    action.updatedAt = new Date();

    // Add to queue
    queue.actions.push(action.id);
    queue.metrics.currentQueueSize++;

    // Cache the action
    await this.cacheAction(action);

    // Update queue in cache
    await this.cacheQueue(queue);

    logger.info('Action enqueued', {
      actionId: action.id,
      queueId: targetQueueId,
      priority: action.priority,
      type: action.type
    });

    this.emit('action_enqueued', { action, queueId: targetQueueId });

    // Start processing if not already running
    this.startQueueProcessing(targetQueueId);
  }

  async dequeueAction(queueId: string): Promise<AIAction | null> {
    const queue = this.queues.get(queueId);
    if (!queue || queue.actions.length === 0) {
      return null;
    }

    // Get highest priority action
    const actionId = await this.getNextAction(queue);
    if (!actionId) {
      return null;
    }

    // Remove from queue
    queue.actions = queue.actions.filter(id => id !== actionId);
    queue.metrics.currentQueueSize--;

    // Get action from cache
    const action = await this.getAction(actionId);
    if (!action) {
      logger.error('Action not found in cache', { actionId });
      return null;
    }

    // Update action status
    action.status = 'executing';
    action.updatedAt = new Date();
    action.executedAt = new Date();

    await this.cacheAction(action);
    await this.cacheQueue(queue);

    logger.debug('Action dequeued', {
      actionId,
      queueId,
      remainingInQueue: queue.actions.length
    });

    return action;
  }

  private async getNextAction(queue: ActionQueue): Promise<string | null> {
    if (queue.actions.length === 0) return null;

    // Get all actions in queue with their priorities
    const actionPriorities: Array<{ id: string; priority: number; createdAt: Date }> = [];

    for (const actionId of queue.actions) {
      const action = await this.getAction(actionId);
      if (action) {
        const priorityScore = this.calculatePriorityScore(action, queue.config.priorityWeights);
        actionPriorities.push({
          id: actionId,
          priority: priorityScore,
          createdAt: action.createdAt
        });
      }
    }

    // Sort by priority (highest first), then by creation time (oldest first)
    actionPriorities.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    return actionPriorities[0]?.id || null;
  }

  private calculatePriorityScore(action: AIAction, weights: any): number {
    const priorityWeights = {
      urgent: weights?.urgent || 4,
      high: weights?.high || 3,
      medium: weights?.medium || 2,
      low: weights?.low || 1
    };

    let score = priorityWeights[action.priority];

    // Boost score for actions requiring approval (to prevent delays)
    if (action.requiresApproval && action.status === 'approved') {
      score += 1;
    }

    // Boost score for retried actions
    if (action.retryCount > 0) {
      score += 0.5;
    }

    // Reduce score for actions that have been waiting too long (aging)
    const waitTime = Date.now() - action.createdAt.getTime();
    const hoursSinceCreation = waitTime / (1000 * 60 * 60);
    
    if (hoursSinceCreation > 1) {
      score += Math.min(2, hoursSinceCreation * 0.1);
    }

    return score;
  }

  private selectQueue(action: AIAction): string {
    // Select queue based on action characteristics
    if (action.requiresApproval) {
      return 'approval_required';
    }

    if (action.priority === 'urgent' || action.priority === 'high') {
      return 'high_priority';
    }

    if (action.riskLevel === 'low' && action.priority === 'low') {
      return 'background';
    }

    return 'standard';
  }

  private startQueueProcessing(queueId: string): void {
    if (this.processingIntervals.has(queueId)) {
      return; // Already processing
    }

    const queue = this.queues.get(queueId);
    if (!queue) return;

    const interval = setInterval(async () => {
      try {
        await this.processQueue(queueId);
      } catch (error) {
        logger.error('Queue processing error', { error, queueId });
      }
    }, 1000); // Process every second

    this.processingIntervals.set(queueId, interval);

    logger.info('Started queue processing', { queueId });
  }

  private async processQueue(queueId: string): Promise<void> {
    const queue = this.queues.get(queueId);
    if (!queue || queue.actions.length === 0) {
      return;
    }

    // Check if we can process more actions (concurrency limit)
    const processingActions = await this.getProcessingActionsCount(queueId);
    if (processingActions >= queue.maxConcurrency) {
      return;
    }

    // Dequeue and emit for processing
    const action = await this.dequeueAction(queueId);
    if (action) {
      this.emit('action_ready', { action, queueId });
    }
  }

  private async getProcessingActionsCount(queueId: string): Promise<number> {
    // In a real implementation, this would track currently executing actions
    // For now, return 0 to allow processing
    return 0;
  }

  async updateActionStatus(actionId: string, status: ActionStatus, result?: any): Promise<void> {
    const action = await this.getAction(actionId);
    if (!action) {
      throw new Error(`Action not found: ${actionId}`);
    }

    const oldStatus = action.status;
    action.status = status;
    action.updatedAt = new Date();

    if (result) {
      action.result = result;
    }

    await this.cacheAction(action);

    // Update queue metrics
    await this.updateQueueMetrics(action, oldStatus, status);

    logger.info('Action status updated', {
      actionId,
      oldStatus,
      newStatus: status,
      type: action.type
    });

    this.emit('action_status_changed', { action, oldStatus, newStatus: status });
  }

  private async updateQueueMetrics(action: AIAction, oldStatus: ActionStatus, newStatus: ActionStatus): Promise<void> {
    // Find which queue this action belongs to
    let targetQueueId: string | null = null;
    
    for (const [queueId, queue] of this.queues.entries()) {
      if (queue.actions.includes(action.id)) {
        targetQueueId = queueId;
        break;
      }
    }

    if (!targetQueueId) return;

    const queue = this.queues.get(targetQueueId);
    if (!queue) return;

    // Update metrics based on status change
    if (newStatus === 'completed') {
      queue.metrics.totalProcessed++;
      
      if (action.executedAt) {
        const executionTime = Date.now() - action.executedAt.getTime();
        queue.metrics.averageExecutionTime = 
          (queue.metrics.averageExecutionTime + executionTime) / 2;
      }
    } else if (newStatus === 'failed') {
      queue.metrics.totalProcessed++;
      queue.metrics.errorRate = 
        (queue.metrics.errorRate * (queue.metrics.totalProcessed - 1) + 1) / queue.metrics.totalProcessed;
    }

    // Recalculate success rate
    if (queue.metrics.totalProcessed > 0) {
      const successfulActions = queue.metrics.totalProcessed * (1 - queue.metrics.errorRate);
      queue.metrics.successRate = successfulActions / queue.metrics.totalProcessed;
    }

    await this.cacheQueue(queue);
  }

  async getQueueStatus(queueId: string): Promise<ActionQueue | null> {
    return this.queues.get(queueId) || null;
  }

  async getAllQueues(): Promise<ActionQueue[]> {
    return Array.from(this.queues.values());
  }

  async getQueueMetrics(queueId: string): Promise<QueueMetrics | null> {
    const queue = this.queues.get(queueId);
    return queue?.metrics || null;
  }

  async pauseQueue(queueId: string): Promise<void> {
    const interval = this.processingIntervals.get(queueId);
    if (interval) {
      clearInterval(interval);
      this.processingIntervals.delete(queueId);
      logger.info('Queue processing paused', { queueId });
    }
  }

  async resumeQueue(queueId: string): Promise<void> {
    this.startQueueProcessing(queueId);
  }

  async clearQueue(queueId: string): Promise<void> {
    const queue = this.queues.get(queueId);
    if (queue) {
      // Cancel all pending actions
      for (const actionId of queue.actions) {
        await this.updateActionStatus(actionId, 'cancelled');
      }
      
      queue.actions = [];
      queue.metrics.currentQueueSize = 0;
      await this.cacheQueue(queue);
      
      logger.info('Queue cleared', { queueId });
    }
  }

  private async cacheAction(action: AIAction): Promise<void> {
    try {
      await this.cacheService.set(
        `action:${action.id}`,
        JSON.stringify(action),
        86400 // 24 hours TTL
      );
    } catch (error) {
      logger.error('Failed to cache action', { error, actionId: action.id });
    }
  }

  private async getAction(actionId: string): Promise<AIAction | null> {
    try {
      const cached = await this.cacheService.get(`action:${actionId}`);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.error('Failed to get action from cache', { error, actionId });
      return null;
    }
  }

  private async cacheQueue(queue: ActionQueue): Promise<void> {
    try {
      await this.cacheService.set(
        `queue:${queue.id}`,
        JSON.stringify(queue),
        86400 // 24 hours TTL
      );
    } catch (error) {
      logger.error('Failed to cache queue', { error, queueId: queue.id });
    }
  }

  private initializeDefaultQueues(): void {
    const defaultConfig: QueueConfig = {
      retryPolicy: {
        maxRetries: 3,
        backoffStrategy: 'exponential',
        baseDelay: 1000,
        maxDelay: 30000,
        retryableErrors: ['timeout', 'network_error', 'temporary_failure']
      },
      timeoutPolicy: {
        defaultTimeout: 30000,
        timeoutByActionType: {
          send_email: 15000,
          make_call: 60000,
          schedule_meeting: 20000,
          update_crm: 10000,
          create_task: 5000,
          generate_document: 30000,
          send_notification: 5000,
          analyze_data: 45000,
          fetch_data: 15000,
          validate_data: 10000,
          custom: 30000
        },
        escalationTimeout: 300000 // 5 minutes
      },
      approvalPolicy: {
        autoApprovalThreshold: 0.8,
        requiredApprovers: 1,
        approverRoles: ['agent', 'supervisor'],
        escalationRules: [
          {
            condition: 'timeout > 300000',
            delay: 300000,
            escalateTo: ['supervisor'],
            action: 'notify'
          }
        ]
      },
      priorityWeights: {
        urgent: 4,
        high: 3,
        medium: 2,
        low: 1
      }
    };

    const defaultMetrics: QueueMetrics = {
      totalProcessed: 0,
      successRate: 0,
      averageExecutionTime: 0,
      averageWaitTime: 0,
      currentQueueSize: 0,
      processingRate: 0,
      errorRate: 0
    };

    // High priority queue
    this.queues.set('high_priority', {
      id: 'high_priority',
      name: 'High Priority Actions',
      type: 'high_priority',
      priority: 1,
      maxConcurrency: 5,
      actions: [],
      processors: [],
      config: defaultConfig,
      metrics: { ...defaultMetrics }
    });

    // Standard queue
    this.queues.set('standard', {
      id: 'standard',
      name: 'Standard Actions',
      type: 'standard',
      priority: 2,
      maxConcurrency: 3,
      actions: [],
      processors: [],
      config: defaultConfig,
      metrics: { ...defaultMetrics }
    });

    // Approval required queue
    this.queues.set('approval_required', {
      id: 'approval_required',
      name: 'Approval Required Actions',
      type: 'approval_required',
      priority: 3,
      maxConcurrency: 2,
      actions: [],
      processors: [],
      config: {
        ...defaultConfig,
        approvalPolicy: {
          ...defaultConfig.approvalPolicy,
          autoApprovalThreshold: 0.9 // Higher threshold for approval queue
        }
      },
      metrics: { ...defaultMetrics }
    });

    // Background queue
    this.queues.set('background', {
      id: 'background',
      name: 'Background Actions',
      type: 'background',
      priority: 4,
      maxConcurrency: 2,
      actions: [],
      processors: [],
      config: defaultConfig,
      metrics: { ...defaultMetrics }
    });

    logger.info('Default action queues initialized', {
      queueCount: this.queues.size,
      queues: Array.from(this.queues.keys())
    });
  }

  async shutdown(): Promise<void> {
    // Stop all queue processing
    for (const [queueId, interval] of this.processingIntervals.entries()) {
      clearInterval(interval);
      logger.info('Stopped queue processing', { queueId });
    }
    
    this.processingIntervals.clear();
    logger.info('Action queue service shutdown complete');
  }
}