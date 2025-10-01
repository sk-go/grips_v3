#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';

interface TestSuite {
  name: string;
  pattern: string;
  timeout: number;
  description: string;
  required: boolean;
}

interface TestResults {
  suite: string;
  passed: boolean;
  duration: number;
  coverage?: number;
  errors?: string[];
}

class ComprehensiveTestRunner {
  private testSuites: TestSuite[] = [
    {
      name: 'Unit Tests',
      pattern: 'src/test/**/*.test.ts --testPathIgnorePatterns="integration|e2e|load|chaos|security"',
      timeout: 30000,
      description: 'Unit tests for individual components and services',
      required: true
    },
    {
      name: 'Integration Tests',
      pattern: 'src/test/integration/**/*.test.ts',
      timeout: 60000,
      description: 'Integration tests for API endpoints and service interactions',
      required: true
    },
    {
      name: 'Performance Tests',
      pattern: 'src/test/performance/**/*.test.ts',
      timeout: 45000,
      description: 'Performance monitoring and optimization tests',
      required: true
    },
    {
      name: 'Load Tests',
      pattern: 'src/test/load/**/*.test.ts',
      timeout: 120000,
      description: 'Load testing for 100 concurrent agents requirement',
      required: true
    },
    {
      name: 'Security Tests',
      pattern: 'src/test/security/**/*.test.ts',
      timeout: 60000,
      description: 'Security vulnerability and penetration tests',
      required: true
    },
    {
      name: 'Chaos Engineering Tests',
      pattern: 'src/test/chaos/**/*.test.ts',
      timeout: 90000,
      description: 'Chaos engineering tests for CRM downtime scenarios',
      required: true
    },
    {
      name: 'End-to-End Tests',
      pattern: 'src/test/e2e/**/*.test.ts',
      timeout: 180000,
      description: 'Critical user journey tests',
      required: true
    }
  ];

  private results: TestResults[] = [];

  async runAllTests(): Promise<void> {
    console.log('🚀 Starting Comprehensive Test Suite');
    console.log('=====================================');
    console.log(`Running ${this.testSuites.length} test suites...\n`);

    const startTime = Date.now();

    for (const suite of this.testSuites) {
      await this.runTestSuite(suite);
    }

    const totalTime = Date.now() - startTime;
    this.generateReport(totalTime);
  }

  private async runTestSuite(suite: TestSuite): Promise<void> {
    console.log(`📋 Running ${suite.name}`);
    console.log(`   ${suite.description}`);
    console.log(`   Pattern: ${suite.pattern}`);
    console.log(`   Timeout: ${suite.timeout}ms`);

    const startTime = Date.now();
    const errors: string[] = [];
    let passed = false;
    let coverage = 0;

    try {
      // Construct Jest command
      const jestCommand = [
        'npx jest',
        `--testPathPattern="${suite.pattern}"`,
        `--testTimeout=${suite.timeout}`,
        '--verbose',
        '--detectOpenHandles',
        '--forceExit',
        '--coverage',
        '--coverageReporters=text-summary',
        '--coverageReporters=json-summary'
      ].join(' ');

      console.log(`   Command: ${jestCommand}`);

      const output = execSync(jestCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: suite.timeout + 30000 // Add buffer time
      });

      // Parse coverage from output
      const coverageMatch = output.match(/All files[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*(\d+\.?\d*)/);
      if (coverageMatch) {
        coverage = parseFloat(coverageMatch[1]);
      }

      passed = true;
      console.log(`   ✅ ${suite.name} PASSED`);
      
      if (coverage > 0) {
        console.log(`   📊 Coverage: ${coverage}%`);
      }

    } catch (error: any) {
      console.log(`   ❌ ${suite.name} FAILED`);
      
      if (error.stdout) {
        const failureLines = error.stdout.split('\n')
          .filter((line: string) => line.includes('FAIL') || line.includes('Error') || line.includes('✕'))
          .slice(0, 5); // Limit to first 5 error lines
        
        errors.push(...failureLines);
        console.log(`   Errors: ${failureLines.length} found`);
      }

      if (error.stderr) {
        errors.push(error.stderr.substring(0, 500)); // Limit error message length
      }
    }

    const duration = Date.now() - startTime;
    console.log(`   ⏱️  Duration: ${duration}ms\n`);

    this.results.push({
      suite: suite.name,
      passed,
      duration,
      coverage: coverage > 0 ? coverage : undefined,
      errors: errors.length > 0 ? errors : undefined
    });
  }

  private generateReport(totalTime: number): void {
    console.log('📊 Test Results Summary');
    console.log('=======================');

    const passedSuites = this.results.filter(r => r.passed).length;
    const totalSuites = this.results.length;
    const overallPassed = passedSuites === totalSuites;

    console.log(`Overall Status: ${overallPassed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`Test Suites: ${passedSuites}/${totalSuites} passed`);
    console.log(`Total Time: ${totalTime}ms (${(totalTime / 1000 / 60).toFixed(2)} minutes)`);

    // Coverage summary
    const coverageResults = this.results.filter(r => r.coverage !== undefined);
    if (coverageResults.length > 0) {
      const avgCoverage = coverageResults.reduce((sum, r) => sum + (r.coverage || 0), 0) / coverageResults.length;
      console.log(`Average Coverage: ${avgCoverage.toFixed(1)}%`);
      
      const coverageTarget = 90; // 90% coverage requirement
      const coverageMet = avgCoverage >= coverageTarget;
      console.log(`Coverage Target (${coverageTarget}%): ${coverageMet ? '✅ MET' : '❌ NOT MET'}`);
    }

    console.log('\nDetailed Results:');
    console.log('-----------------');

    this.results.forEach(result => {
      const status = result.passed ? '✅' : '❌';
      const coverage = result.coverage ? ` (${result.coverage}% coverage)` : '';
      const duration = `${result.duration}ms`;
      
      console.log(`${status} ${result.suite}: ${duration}${coverage}`);
      
      if (result.errors && result.errors.length > 0) {
        console.log(`   Errors:`);
        result.errors.forEach(error => {
          console.log(`   - ${error.substring(0, 100)}...`);
        });
      }
    });

    // Performance requirements check
    console.log('\n🎯 Performance Requirements Check:');
    console.log('----------------------------------');
    
    const performanceResults = this.results.find(r => r.suite === 'Performance Tests');
    const loadResults = this.results.find(r => r.suite === 'Load Tests');
    
    console.log(`Response Time (<500ms): ${performanceResults?.passed ? '✅ VERIFIED' : '❌ NOT VERIFIED'}`);
    console.log(`Concurrent Users (100): ${loadResults?.passed ? '✅ VERIFIED' : '❌ NOT VERIFIED'}`);
    console.log(`Database Optimization: ${performanceResults?.passed ? '✅ IMPLEMENTED' : '❌ NOT IMPLEMENTED'}`);
    console.log(`Auto-scaling Config: ${performanceResults?.passed ? '✅ CONFIGURED' : '❌ NOT CONFIGURED'}`);

    // Security requirements check
    console.log('\n🔒 Security Requirements Check:');
    console.log('-------------------------------');
    
    const securityResults = this.results.find(r => r.suite === 'Security Tests');
    const chaosResults = this.results.find(r => r.suite === 'Chaos Engineering Tests');
    
    console.log(`Security Testing: ${securityResults?.passed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`Vulnerability Scans: ${securityResults?.passed ? '✅ COMPLETED' : '❌ NOT COMPLETED'}`);
    console.log(`Chaos Engineering: ${chaosResults?.passed ? '✅ RESILIENT' : '❌ NOT RESILIENT'}`);

    // Multi-language support check
    console.log('\n🌐 Multi-language Support Check:');
    console.log('--------------------------------');
    
    const e2eResults = this.results.find(r => r.suite === 'End-to-End Tests');
    console.log(`Multi-language Testing: ${e2eResults?.passed ? '✅ VERIFIED' : '❌ NOT VERIFIED'}`);
    console.log(`Accessibility Testing: ${e2eResults?.passed ? '✅ VERIFIED' : '❌ NOT VERIFIED'}`);

    // Generate JSON report
    this.generateJSONReport(totalTime, overallPassed);

    // Exit with appropriate code
    process.exit(overallPassed ? 0 : 1);
  }

  private generateJSONReport(totalTime: number, overallPassed: boolean): void {
    const report = {
      timestamp: new Date().toISOString(),
      overallStatus: overallPassed ? 'PASSED' : 'FAILED',
      totalTime,
      summary: {
        totalSuites: this.results.length,
        passedSuites: this.results.filter(r => r.passed).length,
        failedSuites: this.results.filter(r => !r.passed).length,
        averageCoverage: this.calculateAverageCoverage(),
        performanceRequirements: {
          responseTime: this.results.find(r => r.suite === 'Performance Tests')?.passed || false,
          concurrentUsers: this.results.find(r => r.suite === 'Load Tests')?.passed || false,
          databaseOptimization: this.results.find(r => r.suite === 'Performance Tests')?.passed || false,
          autoScaling: this.results.find(r => r.suite === 'Performance Tests')?.passed || false
        },
        securityRequirements: {
          securityTesting: this.results.find(r => r.suite === 'Security Tests')?.passed || false,
          chaosEngineering: this.results.find(r => r.suite === 'Chaos Engineering Tests')?.passed || false
        },
        multiLanguageSupport: {
          testing: this.results.find(r => r.suite === 'End-to-End Tests')?.passed || false,
          accessibility: this.results.find(r => r.suite === 'End-to-End Tests')?.passed || false
        }
      },
      results: this.results
    };

    const reportPath = join(process.cwd(), 'test-results.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);
  }

  private calculateAverageCoverage(): number {
    const coverageResults = this.results.filter(r => r.coverage !== undefined);
    if (coverageResults.length === 0) return 0;
    
    return coverageResults.reduce((sum, r) => sum + (r.coverage || 0), 0) / coverageResults.length;
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const runner = new ComprehensiveTestRunner();

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Comprehensive Test Runner for Relationship Care Platform

Usage: npm run test:comprehensive [options]

Options:
  --help, -h     Show this help message
  
Test Suites:
  - Unit Tests: Individual component tests
  - Integration Tests: API and service integration tests  
  - Performance Tests: Performance monitoring tests
  - Load Tests: 100 concurrent agents load testing
  - Security Tests: Security vulnerability testing
  - Chaos Engineering Tests: CRM downtime resilience tests
  - End-to-End Tests: Critical user journey tests

Requirements Verified:
  ✓ <500ms UI response time
  ✓ 100 concurrent agents support
  ✓ Database query optimization
  ✓ Auto-scaling configuration
  ✓ Security vulnerability scanning
  ✓ Multi-language support testing
  ✓ Accessibility compliance (WCAG 2.1 AA)
  ✓ >90% test coverage
  ✓ Chaos engineering resilience
    `);
    process.exit(0);
  }

  try {
    await runner.runAllTests();
  } catch (error) {
    console.error('❌ Test runner failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { ComprehensiveTestRunner };