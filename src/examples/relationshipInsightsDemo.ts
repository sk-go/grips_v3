/**
 * Relationship Insights Demo
 * Demonstrates the AI-powered relationship insights functionality
 */

import { RelationshipInsightsService } from '../services/clientProfile/relationshipInsightsService';
import { SentimentTrendChart } from '../components/SentimentTrendChart';
import { Communication } from '../types';

// Mock data for demonstration
const mockCommunications: Communication[] = [
  {
    id: 'comm-1',
    clientId: 'client-123',
    type: 'email',
    direction: 'inbound',
    subject: 'Question about my policy',
    content: 'Hi, I have a question about my insurance policy. Can you help me understand the coverage details?',
    timestamp: new Date('2024-01-15T10:00:00Z'),
    tags: ['policy', 'inquiry'],
    sentiment: 0.2,
    isUrgent: false,
    source: 'john@example.com',
    metadata: {}
  },
  {
    id: 'comm-2',
    clientId: 'client-123',
    type: 'email',
    direction: 'outbound',
    subject: 'Re: Question about my policy',
    content: 'Hello John! I would be happy to help you understand your policy coverage. Let me get those details for you right away.',
    timestamp: new Date('2024-01-15T11:30:00Z'),
    tags: ['policy', 'response'],
    sentiment: 0.8,
    isUrgent: false,
    source: 'agent@insurance.com',
    metadata: {}
  },
  {
    id: 'comm-3',
    clientId: 'client-123',
    type: 'email',
    direction: 'inbound',
    subject: 'Thank you!',
    content: 'Thank you so much for the quick response! You were very helpful and professional. I really appreciate the excellent service.',
    timestamp: new Date('2024-01-15T14:00:00Z'),
    tags: ['thanks', 'positive'],
    sentiment: 0.9,
    isUrgent: false,
    source: 'john@example.com',
    metadata: {}
  },
  {
    id: 'comm-4',
    clientId: 'client-123',
    type: 'call',
    direction: 'inbound',
    subject: 'Follow-up call',
    content: 'Client called to discuss additional coverage options. Seemed satisfied with current service level.',
    timestamp: new Date('2024-01-20T09:00:00Z'),
    tags: ['call', 'coverage'],
    sentiment: 0.6,
    isUrgent: false,
    source: '+1234567890',
    metadata: { callDuration: 900 }
  }
];

export class RelationshipInsightsDemo {
  private service: RelationshipInsightsService;
  private chart: SentimentTrendChart;

  constructor(service: RelationshipInsightsService) {
    this.service = service;
    this.chart = new SentimentTrendChart({
      title: 'Client Relationship Sentiment Trend',
      width: 1000,
      height: 500
    });
  }

  /**
   * Demonstrate sentiment analysis functionality
   */
  async demonstrateSentimentAnalysis(): Promise<void> {
    console.log('=== Sentiment Analysis Demo ===\n');

    const testTexts = [
      'I am extremely happy with your excellent service!',
      'The response time was okay, nothing special.',
      'I am very frustrated with the poor service quality.',
      'Thank you for being so professional and helpful.',
      'This is absolutely terrible and unacceptable!'
    ];

    for (const text of testTexts) {
      try {
        const result = await this.service.analyzeSentiment(text);
        
        console.log(`Text: "${text}"`);
        console.log(`Sentiment Score: ${result.score.toFixed(3)} (${result.label})`);
        console.log(`Magnitude: ${result.magnitude.toFixed(3)}`);
        console.log(`Confidence: ${result.confidence.toFixed(3)}`);
        console.log(`Is Positive (>0.5): ${result.isPositive}`);
        console.log('---');
      } catch (error) {
        console.error(`Error analyzing sentiment for: "${text}"`, error);
      }
    }
  }

  /**
   * Demonstrate relationship health scoring
   */
  async demonstrateHealthScoring(): Promise<void> {
    console.log('\n=== Relationship Health Scoring Demo ===\n');

    try {
      const clientId = 'client-123';
      const healthScore = await this.service.calculateRelationshipHealth(clientId);

      console.log(`Client ID: ${clientId}`);
      console.log(`Overall Health Score: ${healthScore.score}/100`);
      console.log(`Trend: ${healthScore.trend}`);
      console.log('\nScore Breakdown:');
      console.log(`  Sentiment Trend: ${healthScore.factors.sentimentTrend}/30`);
      console.log(`  Interaction Frequency: ${healthScore.factors.interactionFrequency}/25`);
      console.log(`  Response Time: ${healthScore.factors.responseTime}/20`);
      console.log(`  Recent Activity: ${healthScore.factors.recentActivity}/15`);
      console.log(`  Communication Quality: ${healthScore.factors.communicationQuality}/10`);
      console.log(`\nLast Calculated: ${healthScore.lastCalculated.toISOString()}`);

      // Provide recommendations based on score
      this.provideHealthRecommendations(healthScore.score, healthScore.factors);

    } catch (error) {
      console.error('Error calculating relationship health:', error);
    }
  }

  /**
   * Demonstrate conversation summary generation
   */
  async demonstrateConversationSummary(): Promise<void> {
    console.log('\n=== Conversation Summary Demo ===\n');

    try {
      const clientId = 'client-123';
      const summary = await this.service.generateConversationSummary(clientId, mockCommunications);

      console.log(`Client ID: ${clientId}`);
      console.log(`Summary: ${summary.summary}`);
      console.log(`Sentiment Score: ${summary.sentimentScore.toFixed(3)}`);
      console.log(`Key Topics: ${summary.keyTopics.join(', ')}`);
      console.log(`Action Items: ${summary.actionItems.join(', ')}`);
      console.log(`Created: ${summary.createdAt.toISOString()}`);

    } catch (error) {
      console.error('Error generating conversation summary:', error);
    }
  }

  /**
   * Demonstrate sentiment trend visualization
   */
  async demonstrateSentimentTrend(): Promise<void> {
    console.log('\n=== Sentiment Trend Visualization Demo ===\n');

    try {
      const clientId = 'client-123';
      const trendData = await this.service.getSentimentTrend(clientId, '30d');

      console.log(`Client ID: ${clientId}`);
      console.log(`Timeframe: ${trendData.timeframe}`);
      console.log(`Overall Trend: ${trendData.overallTrend}`);
      console.log(`Trend Strength: ${trendData.trendStrength.toFixed(3)}`);
      console.log(`Data Points: ${trendData.dataPoints.length}`);

      // Display data points
      console.log('\nDaily Sentiment Data:');
      trendData.dataPoints.forEach(point => {
        console.log(`  ${point.date.toDateString()}: ${point.sentimentScore.toFixed(3)} (${point.communicationCount} comms, ${point.averageResponseTime.toFixed(1)}h avg response)`);
      });

      // Generate chart configurations
      console.log('\n--- Chart Generation ---');
      
      // SVG Chart
      const svgChart = this.chart.generateSVGChart(trendData.dataPoints);
      console.log(`SVG Chart generated (${svgChart.length} characters)`);
      
      // Chart.js Config
      const chartJSConfig = this.chart.generateChartJSConfig(trendData.dataPoints);
      console.log('Chart.js configuration generated:');
      console.log(`  Type: ${chartJSConfig.type}`);
      console.log(`  Datasets: ${chartJSConfig.data.datasets.length}`);
      console.log(`  Data Points: ${chartJSConfig.data.labels.length}`);

    } catch (error) {
      console.error('Error getting sentiment trend:', error);
    }
  }

  /**
   * Demonstrate batch sentiment analysis
   */
  async demonstrateBatchAnalysis(): Promise<void> {
    console.log('\n=== Batch Sentiment Analysis Demo ===\n');

    const communications = mockCommunications.filter(c => !c.sentiment);
    
    if (communications.length === 0) {
      console.log('All communications already have sentiment scores.');
      return;
    }

    console.log(`Analyzing sentiment for ${communications.length} communications...`);

    for (const comm of communications) {
      try {
        const result = await this.service.analyzeSentiment(comm.content);
        console.log(`Communication ${comm.id}: ${result.score.toFixed(3)} (${result.label})`);
      } catch (error) {
        console.error(`Error analyzing communication ${comm.id}:`, error);
      }
    }
  }

  /**
   * Provide health score recommendations
   */
  private provideHealthRecommendations(score: number, factors: any): void {
    console.log('\n--- Recommendations ---');

    if (score >= 80) {
      console.log('✅ Excellent relationship health! Keep up the great work.');
    } else if (score >= 60) {
      console.log('✅ Good relationship health with room for improvement.');
    } else if (score >= 40) {
      console.log('⚠️  Moderate relationship health. Consider improvement strategies.');
    } else {
      console.log('🚨 Poor relationship health. Immediate attention required.');
    }

    // Specific recommendations based on factors
    if (factors.sentimentTrend < 20) {
      console.log('• Focus on improving communication tone and client satisfaction');
    }
    
    if (factors.interactionFrequency < 15) {
      console.log('• Increase proactive communication frequency');
    }
    
    if (factors.responseTime < 10) {
      console.log('• Improve response times to client inquiries');
    }
    
    if (factors.recentActivity < 10) {
      console.log('• Schedule regular check-ins with this client');
    }
    
    if (factors.communicationQuality < 6) {
      console.log('• Enhance communication quality and personalization');
    }
  }

  /**
   * Run complete demo
   */
  async runCompleteDemo(): Promise<void> {
    console.log('🚀 Starting Relationship Insights Demo\n');
    
    try {
      await this.demonstrateSentimentAnalysis();
      await this.demonstrateHealthScoring();
      await this.demonstrateConversationSummary();
      await this.demonstrateSentimentTrend();
      await this.demonstrateBatchAnalysis();
      
      console.log('\n✅ Demo completed successfully!');
    } catch (error) {
      console.error('❌ Demo failed:', error);
    }
  }
}

// Export for use in other modules
export { mockCommunications };