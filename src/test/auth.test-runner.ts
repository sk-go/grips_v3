#!/usr/bin/env node

/**
 * Authentication System Test Runner
 * 
 * This script runs comprehensive tests for the authentication system,
 * including unit tests, integration tests, and security tests.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

interface TestSuite {
  name: string;
  path: string;
  description: string;
  category: 'unit' | 'integration' | 'security' | 'frontend';
}

const testSuites: TestSuite[] = [
  // Backend Unit Tests
  {
    name: 'AuthService Unit Tests',
    path: 'src/test/auth.comprehensive.test.ts',
    description: 'Password hashing, validation, JWT tokens, user management',
    category: 'unit'
  },
  {
    name: 'Password Reset Service Tests',
    path: 'src/test/passwordResetService.test.ts',
    description: 'Token generation, validation, password reset flow',
    category: 'unit'
  },
  {
    name: 'Enhanced Auth Tests',
    path: 'src/test/auth.enhanced.test.ts',
    description: 'Enhanced authentication features and validation',
    category: 'unit'
  },

  // Backend Integration Tests
  {
    name: 'Authentication Integration Tests',
    path: 'src/test/integration/auth.comprehensive.integration.test.ts',
    description: 'Complete login, password reset, and token refresh flows',
    category: 'integration'
  },
  {
    name: 'Password Management Integration',
    path: 'src/test/integration/passwordManagement.integration.test.ts',
    description: 'End-to-end password management workflows',
    category: 'integration'
  },
  {
    name: 'Password Reset Integration',
    path: 'src/test/integration/passwordResetService.integration.test.ts',
    description: 'Complete password reset workflow integration',
    category: 'integration'
  },
  {
    name: 'Auth Middleware Integration',
    path: 'src/test/integration/auth.middleware.integration.test.ts',
    description: 'Authentication middleware with JWT validation',
    category: 'integration'
  },

  // Security Tests
  {
    name: 'Authentication Security Tests',
    path: 'src/test/security/auth.security.test.ts',
    description: 'Rate limiting, password security, JWT security, input validation',
    category: 'security'
  },
  {
    name: 'Rate Limiting Tests',
    path: 'src/test/services/rateLimitingService.test.ts',
    description: 'Rate limiting and brute force protection',
    category: 'security'
  },
  {
    name: 'Error Handling Tests',
    path: 'src/test/services/errorHandlingService.test.ts',
    description: 'Security-focused error handling',
    category: 'security'
  },

  // Frontend Tests
  {
    name: 'Login Form Tests',
    path: 'frontend/src/components/auth/__tests__/LoginForm.comprehensive.test.tsx',
    description: 'Comprehensive login form testing',
    category: 'frontend'
  },
  {
    name: 'Password Reset Components',
    path: 'frontend/src/components/auth/__tests__/PasswordReset.comprehensive.test.tsx',
    description: 'Forgot password, reset password, and change password forms',
    category: 'frontend'
  },
  {
    name: 'Auth Context Tests',
    path: 'frontend/src/contexts/__tests__/AuthContext.test.tsx',
    description: 'Authentication context and state management',
    category: 'frontend'
  }
];

interface TestResults {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration: number;
}

class AuthTestRunner {
  private results: Map<string, TestResults> = new Map();
  private startTime: number = 0;

  constructor() {
    this.startTime = Date.now();
  }

  async runAllTests(): Promise<void> {
    console.log('🔐 Authentication System Test Runner');
    console.log('=====================================\n');

    const categories = ['unit', 'integration', 'security', 'frontend'] as const;
    
    for (const category of categories) {
      await this.runTestCategory(category);
    }

    this.printSummary();
  }

  private async runTestCategory(category: string): Promise<void> {
    const categoryTests = testSuites.filter(suite => suite.category === category);
    
    if (categoryTests.length === 0) {
      return;
    }

    console.log(`\n📂 ${category.toUpperCase()} TESTS`);
    console.log('─'.repeat(50));

    for (const testSuite of categoryTests) {
      await this.runTestSuite(testSuite);
    }
  }

  private async runTestSuite(testSuite: TestSuite): Promise<void> {
    console.log(`\n🧪 ${testSuite.name}`);
    console.log(`   ${testSuite.description}`);

    if (!existsSync(testSuite.path)) {
      console.log(`   ❌ Test file not found: ${testSuite.path}`);
      return;
    }

    try {
      const startTime = Date.now();
      
      // Determine test command based on file location
      const isBackend = testSuite.path.startsWith('src/');
      const isFrontend = testSuite.path.startsWith('frontend/');
      
      let command: string;
      let cwd: string = process.cwd();

      if (isBackend) {
        command = `npx jest ${testSuite.path} --verbose --coverage --testTimeout=30000`;
      } else if (isFrontend) {
        command = `npm test -- ${testSuite.path} --verbose --coverage --watchAll=false`;
        cwd = path.join(process.cwd(), 'frontend');
      } else {
        throw new Error(`Unknown test location: ${testSuite.path}`);
      }

      const output = execSync(command, { 
        cwd,
        encoding: 'utf8',
        stdio: 'pipe'
      });

      const duration = Date.now() - startTime;
      const results = this.parseTestOutput(output);
      results.duration = duration;

      this.results.set(testSuite.name, results);

      if (results.failed === 0) {
        console.log(`   ✅ ${results.passed} tests passed (${duration}ms)`);
      } else {
        console.log(`   ❌ ${results.failed} tests failed, ${results.passed} passed (${duration}ms)`);
      }

    } catch (error: any) {
      console.log(`   ❌ Test execution failed: ${error.message}`);
      
      // Try to extract test results from error output
      if (error.stdout) {
        const results = this.parseTestOutput(error.stdout);
        this.results.set(testSuite.name, results);
      }
    }
  }

  private parseTestOutput(output: string): TestResults {
    const results: TestResults = {
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      duration: 0
    };

    // Parse Jest output
    const testResultMatch = output.match(/Tests:\s+(\d+)\s+failed,\s+(\d+)\s+passed,\s+(\d+)\s+total/);
    if (testResultMatch) {
      results.failed = parseInt(testResultMatch[1]);
      results.passed = parseInt(testResultMatch[2]);
      results.total = parseInt(testResultMatch[3]);
    } else {
      // Try alternative format
      const passedMatch = output.match(/(\d+)\s+passing/);
      const failedMatch = output.match(/(\d+)\s+failing/);
      
      if (passedMatch) results.passed = parseInt(passedMatch[1]);
      if (failedMatch) results.failed = parseInt(failedMatch[1]);
      results.total = results.passed + results.failed;
    }

    // Parse skipped tests
    const skippedMatch = output.match(/(\d+)\s+skipped/);
    if (skippedMatch) {
      results.skipped = parseInt(skippedMatch[1]);
      results.total += results.skipped;
    }

    return results;
  }

  private printSummary(): void {
    const totalDuration = Date.now() - this.startTime;
    
    console.log('\n📊 TEST SUMMARY');
    console.log('═'.repeat(50));

    let totalPassed = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    let totalTests = 0;

    // Summary by category
    const categories = ['unit', 'integration', 'security', 'frontend'] as const;
    
    for (const category of categories) {
      const categoryTests = testSuites.filter(suite => suite.category === category);
      const categoryResults = categoryTests
        .map(suite => this.results.get(suite.name))
        .filter(result => result !== undefined) as TestResults[];

      if (categoryResults.length === 0) continue;

      const categoryPassed = categoryResults.reduce((sum, r) => sum + r.passed, 0);
      const categoryFailed = categoryResults.reduce((sum, r) => sum + r.failed, 0);
      const categorySkipped = categoryResults.reduce((sum, r) => sum + r.skipped, 0);
      const categoryTotal = categoryResults.reduce((sum, r) => sum + r.total, 0);

      console.log(`\n${category.toUpperCase()} Tests:`);
      console.log(`  ✅ Passed: ${categoryPassed}`);
      console.log(`  ❌ Failed: ${categoryFailed}`);
      console.log(`  ⏭️  Skipped: ${categorySkipped}`);
      console.log(`  📊 Total: ${categoryTotal}`);

      totalPassed += categoryPassed;
      totalFailed += categoryFailed;
      totalSkipped += categorySkipped;
      totalTests += categoryTotal;
    }

    // Overall summary
    console.log('\n🎯 OVERALL RESULTS:');
    console.log(`  ✅ Total Passed: ${totalPassed}`);
    console.log(`  ❌ Total Failed: ${totalFailed}`);
    console.log(`  ⏭️  Total Skipped: ${totalSkipped}`);
    console.log(`  📊 Total Tests: ${totalTests}`);
    console.log(`  ⏱️  Duration: ${(totalDuration / 1000).toFixed(2)}s`);

    // Success rate
    const successRate = totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : '0';
    console.log(`  📈 Success Rate: ${successRate}%`);

    // Final status
    if (totalFailed === 0) {
      console.log('\n🎉 All authentication tests passed!');
      process.exit(0);
    } else {
      console.log(`\n💥 ${totalFailed} test(s) failed. Please review and fix.`);
      process.exit(1);
    }
  }

  async runSpecificTest(testName: string): Promise<void> {
    const testSuite = testSuites.find(suite => 
      suite.name.toLowerCase().includes(testName.toLowerCase()) ||
      suite.path.includes(testName)
    );

    if (!testSuite) {
      console.log(`❌ Test not found: ${testName}`);
      console.log('\nAvailable tests:');
      testSuites.forEach(suite => {
        console.log(`  - ${suite.name}`);
      });
      return;
    }

    console.log(`🧪 Running specific test: ${testSuite.name}\n`);
    await this.runTestSuite(testSuite);
    this.printSummary();
  }

  listTests(): void {
    console.log('🔐 Available Authentication Tests');
    console.log('=================================\n');

    const categories = ['unit', 'integration', 'security', 'frontend'] as const;
    
    for (const category of categories) {
      const categoryTests = testSuites.filter(suite => suite.category === category);
      
      if (categoryTests.length === 0) continue;

      console.log(`📂 ${category.toUpperCase()} TESTS:`);
      categoryTests.forEach(suite => {
        console.log(`  🧪 ${suite.name}`);
        console.log(`     ${suite.description}`);
        console.log(`     📁 ${suite.path}\n`);
      });
    }
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const runner = new AuthTestRunner();

  if (args.length === 0) {
    await runner.runAllTests();
  } else if (args[0] === '--list' || args[0] === '-l') {
    runner.listTests();
  } else if (args[0] === '--test' || args[0] === '-t') {
    if (args[1]) {
      await runner.runSpecificTest(args[1]);
    } else {
      console.log('❌ Please specify a test name after --test');
    }
  } else if (args[0] === '--help' || args[0] === '-h') {
    console.log('🔐 Authentication Test Runner');
    console.log('Usage:');
    console.log('  npm run test:auth              # Run all authentication tests');
    console.log('  npm run test:auth -- --list    # List available tests');
    console.log('  npm run test:auth -- --test <name>  # Run specific test');
    console.log('  npm run test:auth -- --help    # Show this help');
  } else {
    await runner.runSpecificTest(args[0]);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Test runner failed:', error);
    process.exit(1);
  });
}

export { AuthTestRunner, testSuites };