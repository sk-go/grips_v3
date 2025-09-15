/**
 * Demo script for Proactive Relationship Management features
 * Shows how to use meeting briefs, opportunity detection, and re-engagement suggestions
 */

import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { ProactiveRelationshipService } from '../services/clientProfile/proactiveRelationshipService';
import { ClientProfileService } from '../services/clientProfile/clientProfileService';
import { CrmSyncService } from '../services/crm/crmSyncService';
import { logger } from '../utils/logger';

// Mock NLP service for demo
const mockNlpService = {
  extractKeyTopics: async (text: string) => {
    // Simple keyword extraction for demo
    const keywords = text.toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 4)
      .slice(0, 5);
    return keywords;
  },
  generateSummary: async (prompt: string, context?: any) => {
    if (context?.clientName) {
      return `${context.clientName} is a valued client with ${context.communicationCount || 0} recent interactions. Relationship score: ${context.relationshipScore || 'N/A'}/100.`;
    }
    return 'AI-generated summary of client interactions and relationship status.';
  }
} as any;

async function demonstrateProactiveRelationshipManagement() {
  console.log('🚀 Proactive Relationship Management Demo');
  console.log('=========================================\n');

  try {
    // Initialize mock services (in real app, these would be properly configured)
    const mockDb = {
      query: async (sql: string, params?: any[]) => {
        console.log(`📊 Database Query: ${sql.substring(0, 50)}...`);
        
        // Mock different responses based on query type
        if (sql.includes('SELECT c.id, c.name')) {
          // Mock stale relationships query
          return {
            rows: [
              {
                id: 'client-1',
                name: 'John Smith',
                relationship_score: 45,
                last_interaction: new Date('2023-12-01'),
                days_since_last_interaction: 250
              },
              {
                id: 'client-2', 
                name: 'Sarah Johnson',
                relationship_score: 30,
                last_interaction: null,
                days_since_last_interaction: 999
              }
            ]
          };
        } else if (sql.includes('communications')) {
          // Mock recent communications
          return {
            rows: [
              {
                id: 'comm-1',
                type: 'email',
                direction: 'inbound',
                subject: 'Policy renewal question',
                content: 'I have questions about my upcoming policy renewal and coverage options.',
                timestamp: new Date('2024-01-15'),
                tags: ['policy', 'renewal'],
                sentiment: 0.6,
                is_urgent: false,
                source: 'john@example.com',
                message_id: 'msg-123',
                read_status: 'unread'
              }
            ]
          };
        } else if (sql.includes('important_dates')) {
          // Mock birthday/anniversary opportunities
          return {
            rows: [
              {
                id: 'client-1',
                name: 'John Smith',
                date_value: new Date('2024-02-20'),
                description: 'Birthday'
              }
            ]
          };
        } else if (sql.includes('tasks')) {
          // Mock follow-up tasks
          return {
            rows: [
              {
                id: 'task-1',
                client_id: 'client-1',
                description: 'Follow up on policy renewal discussion',
                due_date: new Date('2024-02-15'),
                priority: 'high'
              }
            ]
          };
        } else if (sql.includes('total_clients')) {
          // Mock client statistics
          return {
            rows: [{
              total_clients: '150',
              healthy_relationships: '105',
              at_risk_relationships: '25'
            }]
          };
        }
        
        return { rows: [] };
      }
    } as Pool;

    const mockRedis = {
      setex: async (key: string, ttl: number, value: string) => {
        console.log(`💾 Cache SET: ${key} (TTL: ${ttl}s)`);
        return 'OK';
      },
      get: async (key: string) => {
        console.log(`💾 Cache GET: ${key}`);
        return null; // Always miss for demo
      }
    } as Redis;

    // Mock client profile service
    const mockClientProfileService = {
      getClientProfile: async (clientId: string) => {
        console.log(`👤 Getting client profile: ${clientId}`);
        return {
          client: {
            id: clientId,
            crmId: 'crm-123',
            crmSystem: 'zoho' as const,
            name: 'John Smith',
            email: 'john@example.com',
            phone: '+1234567890',
            personalDetails: {
              hobbies: ['golf', 'fishing'],
              family: [],
              preferences: {},
              importantDates: []
            },
            relationshipHealth: {
              score: 75,
              lastInteraction: new Date('2024-01-15'),
              sentimentTrend: 'positive' as const,
              interactionFrequency: 4,
              responseTime: 2
            },
            lastCrmSync: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          },
          familyMembers: [],
          importantDates: [],
          preferences: {},
          relationships: []
        };
      }
    } as any;

    // Initialize proactive relationship service
    const proactiveService = new ProactiveRelationshipService(
      mockDb,
      mockRedis,
      mockClientProfileService,
      mockNlpService
    );

    // Demo 1: Generate Meeting Brief
    console.log('📋 Demo 1: Generating Meeting Brief');
    console.log('-----------------------------------');
    const meetingBrief = await proactiveService.generateMeetingBrief('client-1');
    console.log('✅ Meeting Brief Generated:');
    console.log(`   Client: ${meetingBrief.clientName}`);
    console.log(`   Relationship Score: ${meetingBrief.relationshipScore}/100`);
    console.log(`   Sentiment Trend: ${meetingBrief.sentimentTrend}`);
    console.log(`   Key Topics: ${meetingBrief.keyTopics.join(', ')}`);
    console.log(`   AI Summary: ${meetingBrief.aiSummary}`);
    console.log(`   Suggested Follow-ups: ${meetingBrief.suggestedFollowUps.length} items`);
    console.log();

    // Demo 2: Detect Upcoming Opportunities
    console.log('🎯 Demo 2: Detecting Upcoming Opportunities');
    console.log('-------------------------------------------');
    const opportunities = await proactiveService.getUpcomingOpportunities();
    console.log(`✅ Found ${opportunities.length} upcoming opportunities:`);
    opportunities.forEach((opp, index) => {
      console.log(`   ${index + 1}. ${opp.title} (${opp.type}) - Priority: ${opp.priority}`);
      console.log(`      Due: ${opp.dueDate.toDateString()}`);
      console.log(`      Action: ${opp.suggestedAction}`);
    });
    console.log();

    // Demo 3: Detect Stale Relationships
    console.log('⚠️  Demo 3: Detecting Stale Relationships');
    console.log('----------------------------------------');
    const staleRelationships = await proactiveService.detectStaleRelationships();
    console.log(`✅ Found ${staleRelationships.length} stale relationships:`);
    staleRelationships.forEach((stale, index) => {
      console.log(`   ${index + 1}. ${stale.clientName} - Risk: ${stale.riskLevel.toUpperCase()}`);
      console.log(`      Days since last interaction: ${stale.daysSinceLastInteraction}`);
      console.log(`      Relationship score: ${stale.relationshipScore}/100`);
      console.log(`      Suggested actions: ${stale.suggestedActions.join(', ')}`);
    });
    console.log();

    // Demo 4: Generate Re-engagement Suggestions
    console.log('💡 Demo 4: Generating Re-engagement Suggestions');
    console.log('----------------------------------------------');
    const suggestions = await proactiveService.generateReEngagementSuggestions('client-1');
    console.log(`✅ Generated ${suggestions.length} re-engagement suggestions:`);
    suggestions.forEach((suggestion, index) => {
      console.log(`   ${index + 1}. ${suggestion.type.toUpperCase()}: ${suggestion.subject}`);
      console.log(`      Confidence: ${(suggestion.confidence * 100).toFixed(1)}%`);
      console.log(`      Risk Level: ${suggestion.riskLevel}`);
      console.log(`      Reasoning: ${suggestion.reasoning}`);
    });
    console.log();

    // Demo 5: Dashboard Overview
    console.log('📊 Demo 5: Proactive Opportunities Dashboard');
    console.log('-------------------------------------------');
    const dashboard = await proactiveService.getProactiveOpportunitiesDashboard();
    console.log('✅ Dashboard Summary:');
    console.log(`   Total Clients: ${dashboard.totalClients}`);
    console.log(`   Healthy Relationships: ${dashboard.healthyRelationships}`);
    console.log(`   At-Risk Relationships: ${dashboard.atRiskRelationships}`);
    console.log(`   Upcoming Opportunities: ${dashboard.upcomingOpportunities.length}`);
    console.log(`   Stale Relationships: ${dashboard.staleRelationships.length}`);
    console.log();

    console.log('🎉 Demo completed successfully!');
    console.log('\nKey Features Demonstrated:');
    console.log('• AI-powered meeting brief generation with context');
    console.log('• Automated opportunity detection (birthdays, follow-ups, etc.)');
    console.log('• Stale relationship identification with risk assessment');
    console.log('• Intelligent re-engagement suggestions');
    console.log('• Comprehensive dashboard for proactive management');

  } catch (error) {
    console.error('❌ Demo failed:', error);
    logger.error('Proactive relationship demo failed', { error });
  }
}

// Run demo if this file is executed directly
if (require.main === module) {
  demonstrateProactiveRelationshipManagement()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Demo execution failed:', error);
      process.exit(1);
    });
}

export { demonstrateProactiveRelationshipManagement };