/**
 * Unit Tests for Message Queue Service
 */

import { MessageQueueService } from '../../services/messageQueue/messageQueueService';
import { MessageType, MessagePriority, CircuitBreakerState } from '../../types/messageQueue';

// Mock amqplib
jest.mock('amqplib', () => ({
  connect: jest.fn(),
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('MessageQueueService', () => {
  let messageQueueService: MessageQueueService;
  let mockConnection: any;
  let mockChannel: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock channel
    mockChannel = {
      assertExchange: jest.fn().mockResolvedValue({}),
      assertQueue: jest.fn().mockResolvedValue({}),
      bindQueue: jest.fn().mockResolvedValue({}),
      publish: jest.fn().mockReturnValue(true),
      consume: jest.fn().mockResolvedValue('consumer-tag-123'),
      ack: jest.fn(),
      nack: jest.fn(),
      checkQueue: jest.fn().mockResolvedValue({ messageCount: 5 }),
      close: jest.fn().mockResolvedValue({}),
      on: jest.fn(),
    };

    // Create mock connection
    mockConnection = {
      createChannel: jest.fn().mockResolvedValue(mockChannel),
      close: jest.fn().mockResolvedValue({}),
      on: jest.fn(),
    };

    // Mock amqplib connect
    const amqp = require('amqplib');
    amqp.connect.mockResolvedValue(mockConnection);

    messageQueueService = new MessageQueueService('amqp://test:test@localhost:5672');
  });

  describe('initialize', () => {
    it('should successfully initialize connection and set up infrastructure', async () => {
      await messageQueueService.initialize();

      expect(mockConnection.createChannel).toHaveBeenCalled();
      expect(mockChannel.assertExchange).toHaveBeenCalledTimes(6); // 6 default exchanges
      expect(mockChannel.assertQueue).toHaveBeenCalledTimes(8); // 8 default queues
    });

    it('should handle connection errors during initialization', async () => {
      const amqp = require('amqplib');
      amqp.connect.mockRejectedValue(new Error('Connection failed'));

      await expect(messageQueueService.initialize()).rejects.toThrow('Connection failed');
    });

    it('should set up event handlers for connection and channel', async () => {
      await messageQueueService.initialize();

      expect(mockConnection.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockConnection.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockChannel.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockChannel.on).toHaveBeenCalledWith('close', expect.any(Function));
    });
  });

  describe('publishMessage', () => {
    beforeEach(async () => {
      await messageQueueService.initialize();
    });

    it('should successfully publish a message', async () => {
      const message = {
        source: 'test-service',
        type: MessageType.AI_REQUEST,
        payload: { test: 'data' },
        correlationId: 'test-correlation-id'
      };

      const options = {
        routingKey: 'ai.request',
        exchange: 'ai.services'
      };

      const messageId = await messageQueueService.publishMessage(message, options);

      expect(messageId).toBeDefined();
      expect(mockChannel.publish).toHaveBeenCalledWith(
        'ai.services',
        'ai.request',
        expect.any(Buffer),
        expect.objectContaining({
          persistent: true,
          priority: MessagePriority.NORMAL,
          correlationId: 'test-correlation-id',
          messageId: messageId
        })
      );
    });

    it('should generate correlation ID if not provided', async () => {
      const message = {
        source: 'test-service',
        type: MessageType.AI_REQUEST,
        payload: { test: 'data' }
      };

      const options = {
        routingKey: 'ai.request'
      };

      await messageQueueService.publishMessage(message, options);

      const publishCall = mockChannel.publish.mock.calls[0];
      const messageBuffer = publishCall[2];
      const parsedMessage = JSON.parse(messageBuffer.toString());

      expect(parsedMessage.correlationId).toBeDefined();
      expect(parsedMessage.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('should handle publish failures', async () => {
      mockChannel.publish.mockReturnValue(false);

      const message = {
        source: 'test-service',
        type: MessageType.AI_REQUEST,
        payload: { test: 'data' },
        correlationId: 'test-correlation-id'
      };

      const options = {
        routingKey: 'ai.request'
      };

      await expect(messageQueueService.publishMessage(message, options))
        .rejects.toThrow('Failed to publish message - channel buffer full');
    });
  });

  describe('consumeMessages', () => {
    beforeEach(async () => {
      await messageQueueService.initialize();
    });

    it('should successfully set up message consumer', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      const options = {
        queue: 'test-queue'
      };

      const consumerTag = await messageQueueService.consumeMessages(options, handler);

      expect(consumerTag).toBe('consumer-tag-123');
      expect(mockChannel.consume).toHaveBeenCalledWith(
        'test-queue',
        expect.any(Function),
        expect.objectContaining({
          noAck: false,
          exclusive: false
        })
      );
    });

    it('should process messages successfully', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      const options = {
        queue: 'test-queue'
      };

      await messageQueueService.consumeMessages(options, handler);

      // Simulate message processing
      const consumeCallback = mockChannel.consume.mock.calls[0][1];
      const mockMessage = {
        content: Buffer.from(JSON.stringify({
          messageId: 'test-message-id',
          timestamp: new Date(),
          source: 'test-service',
          type: MessageType.AI_REQUEST,
          payload: { test: 'data' },
          correlationId: 'test-correlation-id'
        })),
        properties: {
          messageId: 'test-message-id',
          correlationId: 'test-correlation-id',
          headers: {}
        },
        fields: {
          routingKey: 'ai.request',
          exchange: 'ai.services'
        }
      };

      await consumeCallback(mockMessage);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        messageId: 'test-message-id',
        type: MessageType.AI_REQUEST
      }));
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);
    });

    it('should handle message processing errors with retry logic', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('Processing failed'));
      const options = {
        queue: 'test-queue'
      };

      await messageQueueService.consumeMessages(options, handler, {
        maxRetries: 2,
        initialDelay: 100
      });

      // Simulate message processing
      const consumeCallback = mockChannel.consume.mock.calls[0][1];
      const mockMessage = {
        content: Buffer.from(JSON.stringify({
          messageId: 'test-message-id',
          timestamp: new Date(),
          source: 'test-service',
          type: MessageType.AI_REQUEST,
          payload: { test: 'data' },
          correlationId: 'test-correlation-id'
        })),
        properties: {
          messageId: 'test-message-id',
          correlationId: 'test-correlation-id',
          headers: {}
        },
        fields: {
          routingKey: 'ai.request',
          exchange: 'ai.services'
        }
      };

      await consumeCallback(mockMessage);

      expect(handler).toHaveBeenCalled();
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage); // Original message acked for retry
    });

    it('should send message to dead letter queue after max retries', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('Processing failed'));
      const options = {
        queue: 'test-queue'
      };

      await messageQueueService.consumeMessages(options, handler, {
        maxRetries: 0 // No retries
      });

      // Simulate message processing
      const consumeCallback = mockChannel.consume.mock.calls[0][1];
      const mockMessage = {
        content: Buffer.from(JSON.stringify({
          messageId: 'test-message-id',
          timestamp: new Date(),
          source: 'test-service',
          type: MessageType.AI_REQUEST,
          payload: { test: 'data' },
          correlationId: 'test-correlation-id'
        })),
        properties: {
          messageId: 'test-message-id',
          correlationId: 'test-correlation-id',
          headers: {}
        },
        fields: {
          routingKey: 'ai.request',
          exchange: 'ai.services'
        }
      };

      await consumeCallback(mockMessage);

      expect(handler).toHaveBeenCalled();
      expect(mockChannel.nack).toHaveBeenCalledWith(mockMessage, false, false);
    });
  });

  describe('getHealthStatus', () => {
    beforeEach(async () => {
      await messageQueueService.initialize();
    });

    it('should return healthy status when service is operational', async () => {
      const healthStatus = await messageQueueService.getHealthStatus();

      expect(healthStatus.healthy).toBe(true);
      expect(healthStatus.metrics).toEqual(expect.objectContaining({
        messagesPublished: expect.any(Number),
        messagesConsumed: expect.any(Number),
        connectionStatus: 'connected',
        queueDepth: 5 // From mock checkQueue
      }));
    });

    it('should handle queue check errors gracefully', async () => {
      mockChannel.checkQueue.mockRejectedValue(new Error('Queue check failed'));

      const healthStatus = await messageQueueService.getHealthStatus();

      expect(healthStatus.healthy).toBe(true); // Still healthy, just can't get metrics
      expect(healthStatus.metrics.queueDepth).toBe(0); // Default value
    });
  });

  describe('close', () => {
    beforeEach(async () => {
      await messageQueueService.initialize();
    });

    it('should successfully close connection and channel', async () => {
      await messageQueueService.close();

      expect(mockChannel.close).toHaveBeenCalled();
      expect(mockConnection.close).toHaveBeenCalled();
    });

    it('should handle close errors gracefully', async () => {
      mockChannel.close.mockRejectedValue(new Error('Close failed'));
      mockConnection.close.mockRejectedValue(new Error('Close failed'));

      await expect(messageQueueService.close()).resolves.not.toThrow();
    });
  });

  describe('error handling and circuit breaker', () => {
    beforeEach(async () => {
      await messageQueueService.initialize();
    });

    it('should open circuit breaker after failure threshold', async () => {
      // Simulate multiple failures
      const connectionErrorHandler = mockConnection.on.mock.calls
        .find(call => call[0] === 'error')[1];

      // Trigger 5 failures (default threshold)
      for (let i = 0; i < 5; i++) {
        connectionErrorHandler(new Error('Connection error'));
      }

      // Try to publish a message - should fail due to circuit breaker
      const message = {
        source: 'test-service',
        type: MessageType.AI_REQUEST,
        payload: { test: 'data' },
        correlationId: 'test-correlation-id'
      };

      const options = {
        routingKey: 'ai.request'
      };

      await expect(messageQueueService.publishMessage(message, options))
        .rejects.toThrow('Message queue service is not healthy');
    });
  });
});