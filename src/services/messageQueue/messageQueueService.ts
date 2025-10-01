/**
 * RabbitMQ Message Queue Service
 * Provides standardized message publishing and consuming with error handling and retry logic
 */

import amqp, { Connection, Channel, Message } from 'amqplib';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';
import {
  MessageContract,
  MessageType,
  MessagePriority,
  QueueConfig,
  ExchangeConfig,
  PublishOptions,
  ConsumeOptions,
  MessageHandler,
  RetryPolicy,
  CircuitBreakerConfig,
  CircuitBreakerState,
  MessageQueueMetrics
} from '../../types/messageQueue';

export class MessageQueueService {
  private connection: Connection | null = null;
  private channel: Channel | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 5000;
  private circuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private lastFailureTime: Date | null = null;
  private metrics: MessageQueueMetrics = {
    messagesPublished: 0,
    messagesConsumed: 0,
    messagesRetried: 0,
    messagesFailed: 0,
    averageProcessingTime: 0,
    queueDepth: 0,
    connectionStatus: 'disconnected'
  };

  private readonly defaultRetryPolicy: RetryPolicy = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    retryableErrors: ['ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT']
  };

  private readonly circuitBreakerConfig: CircuitBreakerConfig = {
    failureThreshold: 5,
    recoveryTimeout: 60000,
    monitoringPeriod: 300000
  };

  constructor(
    private readonly connectionUrl: string = process.env.RABBITMQ_URL || 'amqp://admin:password@localhost:5672'
  ) {}

  /**
   * Initialize connection to RabbitMQ
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing RabbitMQ connection', { url: this.connectionUrl.replace(/\/\/.*@/, '//***@') });
      
      this.connection = await amqp.connect(this.connectionUrl);
      this.channel = await this.connection.createChannel();
      
      // Set up connection event handlers
      this.connection.on('error', this.handleConnectionError.bind(this));
      this.connection.on('close', this.handleConnectionClose.bind(this));
      
      this.channel.on('error', this.handleChannelError.bind(this));
      this.channel.on('close', this.handleChannelClose.bind(this));

      // Set up default exchanges and queues
      await this.setupDefaultInfrastructure();
      
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.metrics.connectionStatus = 'connected';
      this.circuitBreakerState = CircuitBreakerState.CLOSED;
      this.failureCount = 0;
      
      logger.info('RabbitMQ connection established successfully');
    } catch (error) {
      logger.error('Failed to initialize RabbitMQ connection', { error: error.message });
      this.metrics.connectionStatus = 'disconnected';
      await this.handleConnectionFailure(error);
      throw error;
    }
  }

  /**
   * Set up default exchanges and queues
   */
  private async setupDefaultInfrastructure(): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized');

    // Create default exchanges
    const exchanges: ExchangeConfig[] = [
      { name: 'ai.services', type: 'topic', durable: true, autoDelete: false },
      { name: 'crm.services', type: 'topic', durable: true, autoDelete: false },
      { name: 'communication.services', type: 'topic', durable: true, autoDelete: false },
      { name: 'document.services', type: 'topic', durable: true, autoDelete: false },
      { name: 'team.collaboration', type: 'topic', durable: true, autoDelete: false },
      { name: 'system.events', type: 'fanout', durable: true, autoDelete: false }
    ];

    for (const exchange of exchanges) {
      await this.channel.assertExchange(exchange.name, exchange.type, {
        durable: exchange.durable,
        autoDelete: exchange.autoDelete,
        arguments: exchange.arguments
      });
    }

    // Create default queues
    const queues: QueueConfig[] = [
      { name: 'ai.requests', durable: true, exclusive: false, autoDelete: false },
      { name: 'ai.responses', durable: true, exclusive: false, autoDelete: false },
      { name: 'crm.sync', durable: true, exclusive: false, autoDelete: false },
      { name: 'communication.processing', durable: true, exclusive: false, autoDelete: false },
      { name: 'document.generation', durable: true, exclusive: false, autoDelete: false },
      { name: 'team.handoffs', durable: true, exclusive: false, autoDelete: false },
      { name: 'system.health', durable: true, exclusive: false, autoDelete: false },
      { name: 'dead.letter', durable: true, exclusive: false, autoDelete: false }
    ];

    for (const queue of queues) {
      await this.channel.assertQueue(queue.name, {
        durable: queue.durable,
        exclusive: queue.exclusive,
        autoDelete: queue.autoDelete,
        arguments: {
          'x-dead-letter-exchange': 'dead.letter.exchange',
          'x-message-ttl': 3600000, // 1 hour TTL
          ...queue.arguments
        }
      });
    }

    // Set up dead letter exchange
    await this.channel.assertExchange('dead.letter.exchange', 'direct', { durable: true });
    await this.channel.bindQueue('dead.letter', 'dead.letter.exchange', '');

    logger.info('Default RabbitMQ infrastructure set up successfully');
  }

  /**
   * Publish a message to the queue
   */
  async publishMessage(
    message: Omit<MessageContract, 'messageId' | 'timestamp'>,
    options: PublishOptions
  ): Promise<string> {
    if (!this.isHealthy()) {
      throw new Error('Message queue service is not healthy');
    }

    const messageId = uuidv4();
    const fullMessage: MessageContract = {
      messageId,
      timestamp: new Date(),
      ...message,
      correlationId: message.correlationId || options.correlationId || uuidv4()
    };

    try {
      const messageBuffer = Buffer.from(JSON.stringify(fullMessage));
      const publishOptions = {
        persistent: options.persistent !== false,
        priority: options.priority || MessagePriority.NORMAL,
        correlationId: fullMessage.correlationId,
        messageId: messageId,
        timestamp: Date.now(),
        expiration: options.expiration
      };

      const success = this.channel!.publish(
        options.exchange || '',
        options.routingKey,
        messageBuffer,
        publishOptions
      );

      if (!success) {
        throw new Error('Failed to publish message - channel buffer full');
      }

      this.metrics.messagesPublished++;
      logger.debug('Message published successfully', {
        messageId,
        type: fullMessage.type,
        routingKey: options.routingKey,
        correlationId: fullMessage.correlationId
      });

      return messageId;
    } catch (error) {
      this.handlePublishError(error);
      throw error;
    }
  }

  /**
   * Consume messages from a queue
   */
  async consumeMessages(
    options: ConsumeOptions,
    handler: MessageHandler,
    retryPolicy: Partial<RetryPolicy> = {}
  ): Promise<string> {
    if (!this.channel) throw new Error('Channel not initialized');

    const finalRetryPolicy = { ...this.defaultRetryPolicy, ...retryPolicy };

    const consumerTag = await this.channel.consume(
      options.queue,
      async (msg: Message | null) => {
        if (!msg) return;

        const startTime = Date.now();
        let message: MessageContract;

        try {
          message = JSON.parse(msg.content.toString());
          this.metrics.messagesConsumed++;

          logger.debug('Processing message', {
            messageId: message.messageId,
            type: message.type,
            correlationId: message.correlationId
          });

          await handler(message);

          // Acknowledge successful processing
          this.channel!.ack(msg);

          const processingTime = Date.now() - startTime;
          this.updateAverageProcessingTime(processingTime);

          logger.debug('Message processed successfully', {
            messageId: message.messageId,
            processingTime
          });

        } catch (error) {
          logger.error('Error processing message', {
            error: error.message,
            messageId: message?.messageId,
            queue: options.queue
          });

          await this.handleMessageError(msg, error, finalRetryPolicy);
        }
      },
      {
        noAck: options.noAck || false,
        exclusive: options.exclusive || false,
        priority: options.priority,
        consumerTag: options.consumerTag,
        arguments: options.arguments
      }
    );

    logger.info('Consumer started', { queue: options.queue, consumerTag });
    return consumerTag;
  }

  /**
   * Handle message processing errors with retry logic
   */
  private async handleMessageError(
    msg: Message,
    error: Error,
    retryPolicy: RetryPolicy
  ): Promise<void> {
    const retryCount = (msg.properties.headers?.['x-retry-count'] as number) || 0;
    
    if (retryCount < retryPolicy.maxRetries && this.isRetryableError(error, retryPolicy)) {
      // Retry the message
      const delay = Math.min(
        retryPolicy.initialDelay * Math.pow(retryPolicy.backoffMultiplier, retryCount),
        retryPolicy.maxDelay
      );

      setTimeout(async () => {
        try {
          const messageContent = JSON.parse(msg.content.toString());
          messageContent.retryCount = retryCount + 1;

          await this.publishMessage(messageContent, {
            routingKey: msg.fields.routingKey,
            exchange: msg.fields.exchange,
            correlationId: msg.properties.correlationId
          });

          this.metrics.messagesRetried++;
          logger.info('Message queued for retry', {
            messageId: messageContent.messageId,
            retryCount: retryCount + 1,
            delay
          });
        } catch (retryError) {
          logger.error('Failed to retry message', { error: retryError.message });
          this.channel!.nack(msg, false, false); // Send to dead letter queue
        }
      }, delay);

      this.channel!.ack(msg); // Acknowledge original message
    } else {
      // Max retries exceeded or non-retryable error
      this.metrics.messagesFailed++;
      logger.error('Message failed permanently', {
        messageId: msg.properties.messageId,
        retryCount,
        error: error.message
      });
      
      this.channel!.nack(msg, false, false); // Send to dead letter queue
    }
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: Error, retryPolicy: RetryPolicy): boolean {
    return retryPolicy.retryableErrors.some(retryableError => 
      error.message.includes(retryableError) || error.name.includes(retryableError)
    );
  }

  /**
   * Check if the service is healthy
   */
  private isHealthy(): boolean {
    if (!this.isConnected || !this.channel) return false;
    
    if (this.circuitBreakerState === CircuitBreakerState.OPEN) {
      const now = Date.now();
      const timeSinceLastFailure = this.lastFailureTime ? now - this.lastFailureTime.getTime() : 0;
      
      if (timeSinceLastFailure > this.circuitBreakerConfig.recoveryTimeout) {
        this.circuitBreakerState = CircuitBreakerState.HALF_OPEN;
        logger.info('Circuit breaker moved to half-open state');
      } else {
        return false;
      }
    }

    return true;
  }

  /**
   * Get service health status
   */
  async getHealthStatus(): Promise<{ healthy: boolean; metrics: MessageQueueMetrics }> {
    const healthy = this.isHealthy();
    
    if (this.channel) {
      try {
        // Update queue depth metrics
        const queueInfo = await this.channel.checkQueue('ai.requests');
        this.metrics.queueDepth = queueInfo.messageCount;
      } catch (error) {
        logger.warn('Failed to get queue metrics', { error: error.message });
      }
    }

    return {
      healthy,
      metrics: { ...this.metrics }
    };
  }

  /**
   * Update average processing time
   */
  private updateAverageProcessingTime(processingTime: number): void {
    const totalMessages = this.metrics.messagesConsumed;
    const currentAverage = this.metrics.averageProcessingTime;
    
    this.metrics.averageProcessingTime = 
      ((currentAverage * (totalMessages - 1)) + processingTime) / totalMessages;
  }

  /**
   * Handle connection errors
   */
  private handleConnectionError(error: Error): void {
    logger.error('RabbitMQ connection error', { error: error.message });
    this.isConnected = false;
    this.metrics.connectionStatus = 'disconnected';
    this.recordFailure();
  }

  /**
   * Handle connection close
   */
  private handleConnectionClose(): void {
    logger.warn('RabbitMQ connection closed');
    this.isConnected = false;
    this.metrics.connectionStatus = 'disconnected';
    this.attemptReconnect();
  }

  /**
   * Handle channel errors
   */
  private handleChannelError(error: Error): void {
    logger.error('RabbitMQ channel error', { error: error.message });
    this.recordFailure();
  }

  /**
   * Handle channel close
   */
  private handleChannelClose(): void {
    logger.warn('RabbitMQ channel closed');
  }

  /**
   * Handle publish errors
   */
  private handlePublishError(error: Error): void {
    logger.error('Failed to publish message', { error: error.message });
    this.recordFailure();
  }

  /**
   * Record a failure for circuit breaker
   */
  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = new Date();

    if (this.failureCount >= this.circuitBreakerConfig.failureThreshold) {
      this.circuitBreakerState = CircuitBreakerState.OPEN;
      logger.warn('Circuit breaker opened due to failures', { failureCount: this.failureCount });
    }
  }

  /**
   * Handle connection failure and attempt reconnection
   */
  private async handleConnectionFailure(error: Error): Promise<void> {
    this.isConnected = false;
    this.metrics.connectionStatus = 'disconnected';
    this.recordFailure();
    
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      await this.attemptReconnect();
    } else {
      logger.error('Max reconnection attempts reached', { attempts: this.reconnectAttempts });
    }
  }

  /**
   * Attempt to reconnect to RabbitMQ
   */
  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.reconnectAttempts++;
    this.metrics.connectionStatus = 'reconnecting';
    
    logger.info('Attempting to reconnect to RabbitMQ', { 
      attempt: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts 
    });

    setTimeout(async () => {
      try {
        await this.initialize();
        logger.info('Successfully reconnected to RabbitMQ');
      } catch (error) {
        logger.error('Reconnection attempt failed', { 
          error: error.message,
          attempt: this.reconnectAttempts 
        });
        await this.attemptReconnect();
      }
    }, this.reconnectDelay * this.reconnectAttempts);
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }
      
      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }
      
      this.isConnected = false;
      this.metrics.connectionStatus = 'disconnected';
      logger.info('RabbitMQ connection closed');
    } catch (error) {
      logger.error('Error closing RabbitMQ connection', { error: error.message });
    }
  }
}