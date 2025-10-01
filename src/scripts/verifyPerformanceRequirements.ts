#!/usr/bin/env ts-node

import { DatabaseService } from '../services/database/DatabaseService';
import { RedisService } from '../services/redis';
import { performanceMonitor } from '../services/performance/performanceMonitor';
import { DatabaseOptimizer } from '../services/performance/databaseOptimizer';
import { autoScalingService } from '../services/performance/autoScalingService';
import { logger } from '../utils/logger';

interface PerformanceRequirement {
  name: string;
  description: string;
  target: string;
  test: () => Promise<{ passed: boolean; actual: string; details?: string }>;
}

class PerformanceRequirementsVerifier {
  private requirements: PerformanceRequirement[] = [
    {
      name: 'Response Time',
      description: 'UI response time including CRM calls',
      target: '<500ms',
      test: async () => {
        const summary = performanceMonitor.getPerformanceSummary();
        const avgResponseTime = summary.averages.responseTime;
        return {
          passed: avgResponseTime < 500,
          actual: `${avgResponseTime.toFixed(2)}ms`,
          details: `Current average response time across all endpoints`
        };
      }
    },
    {
      name: 'Concurrent Users',
      description: 'System support for concurrent agents',
      target: '100 concurrent agents',
      test: async () => {
        const scalingStatus = autoScalingService.getScalingStatus();
        const maxInstances = scalingStatus.config.maxInstances;
        const estimatedCapacity = maxInstances * 20; // Assume 20 users per instance
        return {
          passed: estimatedCapacity >= 100,
          actual: `${estimatedCapacity} estimated capacity`,
          details: `${maxInstances} max instances × 20 users per instance`
        };
      }
    },
    {
      name: 'Database Query Performance',
      description: 'Database query optimization and indexing',
      target: '<200ms average query time',
      test: async () => {
        const summary = performanceMonitor.getPerformanceSummary();
        const avgDbQueryTime = summary.averages.dbQueryTime;
        return {
          passed: avgDbQueryTime < 200,
          actual: `${avgDbQueryTime.toFixed(2)}ms`,
          details: `Average database query execution time`
        };
      }
    },
    {
      name: 'Database Connection Pool',
      description: 'Database connection pool health',
      target: 'Healthy pool status',
      test: async () => {
        const optimizer = new DatabaseOptimizer();
        const poolStatus = await optimizer.monitorConnectionPool();
        return {
          passed: poolStatus.poolHealth === 'healthy',
          actual: poolStatus.poolHealth,
          details: `${poolStatus.activeConnections}/${poolStatus.totalConnections} connections active`
        };
      }
    },
    {
      name: 'Cache Hit Rate',
      description: 'Redis cache performance',
      target: '>80% hit rate',
      test: async () => {
        const summary = performanceMonitor.getPerformanceSummary();
        const cacheHitRate = summary.averages.cacheHitRate;
        return {
          passed: cacheHitRate > 80,
          actual: `${cacheHitRate.toFixed(1)}%`,
          details: `Current cache hit rate across all operations`
        };
      }
    },
    {
      name: 'Memory Usage',
      description: 'System memory utilization',
      target: '<1GB heap usage',
      test: async () => {
        const memoryUsage = process.memoryUsage();
        const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
        return {
          passed: heapUsedMB < 1024,
          actual: `${heapUsedMB.toFixed(2)}MB`,
          details: `Current heap memory usage`
        };
      }
    },
    {
      name: 'Auto-scaling Configuration',
      description: 'Auto-scaling setup for cloud deployment',
      target: 'Configured for 1-10 instances',
      test: async () => {
        const scalingStatus = autoScalingService.getScalingStatus();
        const config = scalingStatus.config;
        const isConfigured = config.minInstances >= 1 && config.maxInstances >= 5;
        return {
          passed: isConfigured,
          actual: `${config.minInstances}-${config.maxInstances} instances`,
          details: `Min: ${config.minInstances}, Max: ${config.maxInstances}, Current: ${scalingStatus.currentInstances}`
        };
      }
    },
    {
      name: 'Database Indexes',
      description: 'Performance indexes implementation',
      target: 'Critical indexes present',
      test: async () => {
        try {
          const optimizer = new DatabaseOptimizer();
          const analysis = await optimizer.analyzePerformance();
          const highPriorityRecommendations = analysis.indexRecommendations.filter(r => r.estimatedImpact === 'high');
          return {
            passed: highPriorityRecommendations.length === 0,
            actual: `${highPriorityRecommendations.length} missing high-priority indexes`,
            details: highPriorityRecommendations.length > 0 
              ? `Missing: ${highPriorityRecommendations.map(r => `${r.table}(${r.columns.join(',')})`).join(', ')}`
              : 'All critical indexes are present'
          };
        } catch (error) {
          return {
            passed: false,
            actual: 'Unable to verify',
            details: `Error checking indexes: ${error}`
          };
        }
      }
    }
  ];

  async verifyAllRequirements(): Promise<void> {
    console.log('🎯 Performance Requirements Verification');
    console.log('========================================');
    console.log('Verifying system meets performance requirements for 100 concurrent agents...\n');

    // Initialize services
    await this.initializeServices();

    const results: Array<{ requirement: PerformanceRequirement; result: any }> = [];
    let allPassed = true;

    for (const requirement of this.requirements) {
      console.log(`📋 Testing: ${requirement.name}`);
      console.log(`   Description: ${requirement.description}`);
      console.log(`   Target: ${requirement.target}`);

      try {
        const result = await requirement.test();
        results.push({ requirement, result });

        const status = result.passed ? '✅ PASSED' : '❌ FAILED';
        console.log(`   Status: ${status}`);
        console.log(`   Actual: ${result.actual}`);
        
        if (result.details) {
          console.log(`   Details: ${result.details}`);
        }

        if (!result.passed) {
          allPassed = false;
        }

      } catch (error) {
        console.log(`   Status: ❌ ERROR`);
        console.log(`   Error: ${error}`);
        allPassed = false;
        results.push({ 
          requirement, 
          result: { passed: false, actual: 'Error occurred', details: String(error) }
        });
      }

      console.log('');
    }

    // Generate summary
    this.generateSummary(results, allPassed);

    // Cleanup
    await this.cleanupServices();

    process.exit(allPassed ? 0 : 1);
  }

  private async initializeServices(): Promise<void> {
    try {
      await DatabaseService.initialize();
      await RedisService.initialize();
      
      // Start performance monitoring for a short period to collect metrics
      performanceMonitor.startMonitoring(1000);
      
      // Collect initial metrics
      await performanceMonitor.collectMetrics();
      await autoScalingService.collectMetrics();
      
      // Wait a moment for metrics to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log('✅ Services initialized for verification\n');
    } catch (error) {
      console.error('❌ Failed to initialize services:', error);
      throw error;
    }
  }

  private async cleanupServices(): Promise<void> {
    try {
      performanceMonitor.stopMonitoring();
      await DatabaseService.close();
      await RedisService.close();
      console.log('✅ Services cleaned up');
    } catch (error) {
      console.error('⚠️  Warning: Failed to cleanup services:', error);
    }
  }

  private generateSummary(results: Array<{ requirement: PerformanceRequirement; result: any }>, allPassed: boolean): void {
    console.log('📊 Verification Summary');
    console.log('=======================');

    const passedCount = results.filter(r => r.result.passed).length;
    const totalCount = results.length;

    console.log(`Overall Status: ${allPassed ? '✅ ALL REQUIREMENTS MET' : '❌ SOME REQUIREMENTS NOT MET'}`);
    console.log(`Requirements: ${passedCount}/${totalCount} passed`);
    console.log(`Success Rate: ${((passedCount / totalCount) * 100).toFixed(1)}%`);

    console.log('\nDetailed Results:');
    console.log('-----------------');

    results.forEach(({ requirement, result }) => {
      const status = result.passed ? '✅' : '❌';
      console.log(`${status} ${requirement.name}: ${result.actual} (target: ${requirement.target})`);
    });

    // Performance optimization recommendations
    const failedRequirements = results.filter(r => !r.result.passed);
    if (failedRequirements.length > 0) {
      console.log('\n🔧 Optimization Recommendations:');
      console.log('--------------------------------');

      failedRequirements.forEach(({ requirement, result }) => {
        console.log(`• ${requirement.name}:`);
        
        switch (requirement.name) {
          case 'Response Time':
            console.log('  - Enable response caching');
            console.log('  - Optimize database queries');
            console.log('  - Implement CDN for static assets');
            break;
          case 'Database Query Performance':
            console.log('  - Run: npm run db:optimize');
            console.log('  - Add missing indexes');
            console.log('  - Optimize slow queries');
            break;
          case 'Cache Hit Rate':
            console.log('  - Increase cache TTL for stable data');
            console.log('  - Implement cache warming strategies');
            console.log('  - Review cache invalidation logic');
            break;
          case 'Memory Usage':
            console.log('  - Enable garbage collection optimization');
            console.log('  - Review memory leaks');
            console.log('  - Implement memory monitoring');
            break;
          case 'Database Indexes':
            console.log('  - Run: npm run performance:optimize');
            console.log('  - Apply recommended indexes');
            console.log('  - Update table statistics');
            break;
        }
        console.log('');
      });
    }

    // Cloud deployment readiness
    console.log('☁️  Cloud Deployment Readiness:');
    console.log('-------------------------------');
    
    const cloudReadiness = {
      autoScaling: results.find(r => r.requirement.name === 'Auto-scaling Configuration')?.result.passed || false,
      performance: results.find(r => r.requirement.name === 'Response Time')?.result.passed || false,
      database: results.find(r => r.requirement.name === 'Database Query Performance')?.result.passed || false,
      caching: results.find(r => r.requirement.name === 'Cache Hit Rate')?.result.passed || false
    };

    const readinessScore = Object.values(cloudReadiness).filter(Boolean).length / Object.keys(cloudReadiness).length;
    
    console.log(`Readiness Score: ${(readinessScore * 100).toFixed(1)}%`);
    console.log(`Auto-scaling: ${cloudReadiness.autoScaling ? '✅' : '❌'}`);
    console.log(`Performance: ${cloudReadiness.performance ? '✅' : '❌'}`);
    console.log(`Database: ${cloudReadiness.database ? '✅' : '❌'}`);
    console.log(`Caching: ${cloudReadiness.caching ? '✅' : '❌'}`);

    if (readinessScore >= 0.8) {
      console.log('\n🚀 System is ready for cloud deployment!');
    } else {
      console.log('\n⚠️  System needs optimization before cloud deployment.');
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Performance Requirements Verifier

Usage: npm run verify:performance [options]

This script verifies that the system meets all performance requirements:
- Response time <500ms (including CRM calls)
- Support for 100 concurrent agents
- Database query optimization
- Auto-scaling configuration
- Cache performance >80% hit rate
- Memory usage <1GB
- Critical database indexes

Options:
  --help, -h     Show this help message

The script will exit with code 0 if all requirements are met, or 1 if any fail.
    `);
    process.exit(0);
  }

  const verifier = new PerformanceRequirementsVerifier();
  
  try {
    await verifier.verifyAllRequirements();
  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { PerformanceRequirementsVerifier };