module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/**/*.ts',
    '**/?(*.)+(spec|test).ts'
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/test/**',
    '!src/scripts/**',
    '!src/examples/**',
    '!src/docs/**',
    '!src/server.ts', // Exclude main server file from coverage
  ],
  coverageDirectory: 'coverage',
  coverageReporters: [
    'text',
    'text-summary',
    'html',
    'json-summary',
    'lcov'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 85,
      lines: 90,
      statements: 90
    },
    // Specific thresholds for critical components
    'src/services/performance/**/*.ts': {
      branches: 90,
      functions: 95,
      lines: 95,
      statements: 95
    },
    'src/services/security/**/*.ts': {
      branches: 85,
      functions: 90,
      lines: 90,
      statements: 90
    },
    'src/services/database/**/*.ts': {
      branches: 85,
      functions: 90,
      lines: 90,
      statements: 90
    },
    'src/middleware/**/*.ts': {
      branches: 80,
      functions: 85,
      lines: 85,
      statements: 85
    }
  },
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  testTimeout: 30000,
  maxWorkers: 4,
  verbose: true,
  detectOpenHandles: true,
  forceExit: true,
  // Performance testing configuration
  testEnvironmentOptions: {
    NODE_ENV: 'test'
  },
  // Global test configuration
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json'
    }
  },
  // Module path mapping
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  // Test result processors
  reporters: [
    'default',
    ['jest-html-reporters', {
      publicPath: './coverage/html-report',
      filename: 'test-report.html',
      expand: true,
      hideIcon: false,
      pageTitle: 'Relationship Care Platform Test Report'
    }]
  ]
};