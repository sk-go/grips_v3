import { DatabaseService } from '../services/database/DatabaseService';
import { RedisService } from '../services/redis';

// Global test setup
beforeAll(async () => {
  // Set test environment
  process.env.NODE_ENV = 'test';
  
  // Suppress console logs during tests unless explicitly needed
  if (!process.env.VERBOSE_TESTS) {
    console.log = jest.fn();
    console.info = jest.fn();
    console.warn = jest.fn();
  }
  
  // Initialize test database connection
  try {
    await DatabaseService.initialize();
  } catch (error) {
    console.error('Failed to initialize test database:', error);
  }
  
  // Initialize test Redis connection
  try {
    await RedisService.initialize();
  } catch (error) {
    console.error('Failed to initialize test Redis:', error);
  }
});

// Global test cleanup
afterAll(async () => {
  // Close database connections
  try {
    await DatabaseService.close();
  } catch (error) {
    console.error('Failed to close test database:', error);
  }
  
  // Close Redis connections
  try {
    await RedisService.close();
  } catch (error) {
    console.error('Failed to close test Redis:', error);
  }
});

// Global test utilities
global.testUtils = {
  // Helper to create test user
  createTestUser: async () => {
    const testUser = {
      id: 'test-user-' + Date.now(),
      email: `test-${Date.now()}@example.com`,
      firstName: 'Test',
      lastName: 'User',
      password: 'TestPassword123!'
    };
    
    return testUser;
  },
  
  // Helper to create test auth token
  createTestToken: () => {
    return 'test-token-' + Date.now();
  },
  
  // Helper to wait for async operations
  wait: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
  
  // Helper to generate test data
  generateTestData: (type: string, count: number = 1) => {
    const data = [];
    
    for (let i = 0; i < count; i++) {
      switch (type) {
        case 'communication':
          data.push({
            id: `comm-${i}-${Date.now()}`,
            type: 'email',
            direction: 'inbound',
            from: `sender${i}@example.com`,
            to: `recipient${i}@example.com`,
            subject: `Test Subject ${i}`,
            content: `Test content ${i}`,
            timestamp: new Date(),
            clientId: `client-${i}`,
            tags: ['test'],
            isUrgent: false,
            isRead: false
          });
          break;
          
        case 'client':
          data.push({
            id: `client-${i}-${Date.now()}`,
            name: `Test Client ${i}`,
            email: `client${i}@example.com`,
            phone: `+123456789${i}`,
            crmSystem: 'zoho',
            crmId: `crm-${i}`
          });
          break;
          
        case 'document':
          data.push({
            id: `doc-${i}-${Date.now()}`,
            templateId: 'test-template',
            title: `Test Document ${i}`,
            content: `<h1>Test Document ${i}</h1><p>Content</p>`,
            status: 'draft'
          });
          break;
          
        default:
          data.push({ id: `${type}-${i}-${Date.now()}` });
      }
    }
    
    return count === 1 ? data[0] : data;
  }
};

// Custom matchers
expect.extend({
  toBeOneOf(received: any, expected: any[]) {
    const pass = expected.includes(received);
    if (pass) {
      return {
        message: () => `expected ${received} not to be one of ${expected.join(', ')}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be one of ${expected.join(', ')}`,
        pass: false,
      };
    }
  },
  
  toBeWithinRange(received: number, floor: number, ceiling: number) {
    const pass = received >= floor && received <= ceiling;
    if (pass) {
      return {
        message: () => `expected ${received} not to be within range ${floor} - ${ceiling}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be within range ${floor} - ${ceiling}`,
        pass: false,
      };
    }
  },
  
  toHaveResponseTime(received: any, maxTime: number) {
    const responseTime = parseInt(received.headers['x-response-time'] || '0');
    const pass = responseTime <= maxTime;
    if (pass) {
      return {
        message: () => `expected response time ${responseTime}ms not to be within ${maxTime}ms`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected response time ${responseTime}ms to be within ${maxTime}ms`,
        pass: false,
      };
    }
  }
});

// Type declarations for custom matchers
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeOneOf(expected: any[]): R;
      toBeWithinRange(floor: number, ceiling: number): R;
      toHaveResponseTime(maxTime: number): R;
    }
  }
  
  var testUtils: {
    createTestUser: () => Promise<any>;
    createTestToken: () => string;
    wait: (ms: number) => Promise<void>;
    generateTestData: (type: string, count?: number) => any;
  };
}