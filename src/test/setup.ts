/**
 * Jest Test Setup
 * Global setup and teardown for tests
 */

// Set test environment
process.env.NODE_ENV = 'test';

// Handle unhandled promise rejections in tests
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Global cleanup after all tests
afterAll(async () => {
  // Wait for any pending operations
  await new Promise(resolve => setTimeout(resolve, 100));
});