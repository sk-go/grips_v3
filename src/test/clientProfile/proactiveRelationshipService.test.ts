/**
 * Unit tests for ProactiveRelationshipService
 */

import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { ProactiveRelationshipService } from '../../services/clientProfile/proactiveRelationshipService';
import { ClientProfileService, ClientProfileData } from '../../services/clientProfile/clientProfileService';
import { NLPProcessingService } from '../../services/nlp/nlpProcessingService';
import { Client, Communication, RelationshipHealth } from '../../types';

// Mock dependencies
jest.mock('pg');
jest.mock('ioredis');
jest.mock('../../services/clientProfile/clientProfileService');
jest.mock('../../services/nlp/nlpProcessingService');
jest.mock('../../utils/logger');

describe('ProactiveRelationshipService', () => {
  let service: ProactiveRelationshipService;
  let mockDb: jest.Mocked<Pool>;
  let mockRedis: jest.Mocked<Redis>;
  let mockClientProfileService: jest.Mocked<ClientProfileService>;
  let mockNlpService: jest.Mocked<NLPProcessingService>;

  const mockRelationshipHealth: RelationshipHealth = {
    score: 75,
    lastInteraction: new Date('2024-01-15'),
    sentimentTrend: 'positive',
    interactionFrequency: 5,
    responseTime: 2
  };

  const mockClient: Client = {
    id: 'client-1',
    crmId: 'crm-123',
    crmSystem: 'zoho',
    name: 'John Doe',
    email: 'john@example.com',
    phone: '+1234567890',
    personalDetails: {
      hobbies: ['golf', 'reading'],
      family: [],
      preferences: {},
      importantDates: []
    },
    relationshipHealth: mockRelationshipHealth,
    lastCrmSync: new Date(),
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const mockCommunications: Communication[] = [
    {
      id: 'comm-1',
      clientId: 'client-1',
      type: 'email',
      direction: 'inbound',
      subject: 'Policy Question',
      content: 'I have a question about my policy coverage.',
      timestamp: new Date('2024-01-10'),
      tags: ['policy', 'question'],
      sentiment: 0.6,
      isUrgent: false,
      source: 'john@example.com',
      metadata: {
        messageId: 'msg-123',
        readStatus: 'unread'
      }
    }
  ];

  const mockProfileData: ClientProfileData = {
    client: mockClient,
    familyMembers: [],
    importantDates: [],
    preferences: {},
    relationships: []
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock instances
    mockDb = {
      query: jest.fn()
    } as any;

    mockRedis = {
      setex: jest.fn(),
      get: jest.fn()
    } as any;

    mockClientProfileService = {
      getClientProfile: jest.fn()
    } as any;

    mockNlpService = {
      processText: jest.fn(),
      extractKeyTopics: jest.fn(),
      generateSummary: jest.fn()
    } as any;

    // Create service instance
    service = new ProactiveRelationshipService(
      mockDb,
      mockRedis,
      mockClientProfileService,
      mockNlpService
    );
  });

  describe('generateMeetingBrief', () => {
    it('should generate a comprehensive meeting brief', async () => {
      // Setup mocks
      mockClientProfileService.getClientProfile.mockResolvedValue(mockProfileData);

      mockDb.query
        .mockResolvedValueOnce({ rows: mockCommunications }) // Recent communications
        .mockResolvedValueOnce({ rows: [] }) // Birthday opportunities
        .mockResolvedValueOnce({ rows: [] }) // Anniversary opportunities
        .mockResolvedValueOnce({ rows: [] }) // Follow-up opportunities
        .mockResolvedValueOnce({ rows: [] }); // Renewal opportunities

      mockNlpService.extractKeyTopics.mockResolvedValue(['policy', 'coverage', 'questions']);
      mockNlpService.generateSummary.mockResolvedValue('John is a valued client with recent policy questions.');

      // Execute
      const result = await service.generateMeetingBrief('client-1');

      // Verify
      expect(result).toBeDefined();
      expect(result.clientId).toBe('client-1');
      expect(result.clientName).toBe('John Doe');
      expect(result.relationshipScore).toBe(75);
      expect(result.keyTopics).toContain('policy');
      expect(result.aiSummary).toContain('John is a valued client');
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'meeting_brief:client-1',
        7200,
        expect.any(String)
      );
    });

    it('should throw error for non-existent client', async () => {
      mockClientProfileService.getClientProfile.mockResolvedValue(null);

      await expect(service.generateMeetingBrief('non-existent')).rejects.toThrow('Client not found: non-existent');
    });
  });

  describe('getUpcomingOpportunities', () => {
    it('should return upcoming opportunities sorted by priority', async () => {
      const mockBirthdayRows = [{
        id: 'client-1',
        name: 'John Doe',
        date_value: new Date('2024-02-15'),
        description: 'Birthday'
      }];

      const mockFollowUpRows = [{
        id: 'task-1',
        client_id: 'client-1',
        description: 'Follow up on policy renewal',
        due_date: new Date('2024-02-10'),
        priority: 'high'
      }];

      mockDb.query
        .mockResolvedValueOnce({ rows: mockBirthdayRows }) // Birthday opportunities
        .mockResolvedValueOnce({ rows: [] }) // Anniversary opportunities
        .mockResolvedValueOnce({ rows: mockFollowUpRows }) // Follow-up opportunities
        .mockResolvedValueOnce({ rows: [] }) // Renewal opportunities
        .mockResolvedValueOnce({ rows: [{ name: 'John Doe' }] }); // Client name lookup

      const result = await service.getUpcomingOpportunities('client-1');

      expect(result).toHaveLength(2);
      expect(result[0].priority).toBe('high'); // High priority first
      expect(result[0].type).toBe('follow_up');
      expect(result[1].type).toBe('birthday');
    });
  });

  describe('detectStaleRelationships', () => {
    it('should detect relationships with no recent interaction', async () => {
      const mockStaleRows = [{
        id: 'client-2',
        name: 'Jane Smith',
        relationship_score: 60,
        last_interaction: new Date('2023-06-01'),
        days_since_last_interaction: 200
      }];

      mockDb.query.mockResolvedValue({ rows: mockStaleRows });
      mockClientProfileService.getClientProfile.mockResolvedValue({
        ...mockProfileData,
        client: { ...mockClient, id: 'client-2', name: 'Jane Smith' }
      });

      const result = await service.detectStaleRelationships(180);

      expect(result).toHaveLength(1);
      expect(result[0].clientName).toBe('Jane Smith');
      expect(result[0].riskLevel).toBe('medium');
      expect(result[0].daysSinceLastInteraction).toBe(200);
      expect(result[0].suggestedActions).toContain('Send friendly check-in email');
    });

    it('should classify high-risk relationships correctly', async () => {
      const mockHighRiskRows = [{
        id: 'client-3',
        name: 'Bob Johnson',
        relationship_score: 25,
        last_interaction: new Date('2022-01-01'),
        days_since_last_interaction: 400
      }];

      const highRiskRelationshipHealth: RelationshipHealth = {
        score: 25,
        lastInteraction: new Date('2022-01-01'),
        sentimentTrend: 'negative',
        interactionFrequency: 1,
        responseTime: 48
      };

      mockDb.query.mockResolvedValue({ rows: mockHighRiskRows });
      mockClientProfileService.getClientProfile.mockResolvedValue({
        ...mockProfileData,
        client: { 
          ...mockClient, 
          id: 'client-3', 
          name: 'Bob Johnson', 
          relationshipHealth: highRiskRelationshipHealth 
        }
      });

      const result = await service.detectStaleRelationships(180);

      expect(result[0].riskLevel).toBe('high');
      expect(result[0].suggestedActions).toContain('Schedule urgent check-in call');
    });
  });

  describe('generateReEngagementSuggestions', () => {
    it('should generate multiple re-engagement suggestions', async () => {
      mockClientProfileService.getClientProfile.mockResolvedValue(mockProfileData);
      mockDb.query.mockResolvedValue({ rows: [] }); // No recent communications

      const result = await service.generateReEngagementSuggestions('client-1');

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].type).toBe('email');
      expect(result[0].clientId).toBe('client-1');
      expect(result[0].confidence).toBeGreaterThan(0);
      
      // Should include call suggestion for high-scoring client
      const callSuggestion = result.find(s => s.type === 'call');
      expect(callSuggestion).toBeDefined();
      
      // Should include meeting suggestion for high-scoring client
      const meetingSuggestion = result.find(s => s.type === 'meeting');
      expect(meetingSuggestion).toBeDefined();
    });

    it('should not suggest call/meeting for low-scoring clients', async () => {
      const lowScoreRelationshipHealth: RelationshipHealth = {
        ...mockRelationshipHealth,
        score: 40
      };

      const lowScoreClient = { 
        ...mockClient, 
        relationshipHealth: lowScoreRelationshipHealth 
      };
      
      mockClientProfileService.getClientProfile.mockResolvedValue({
        ...mockProfileData,
        client: lowScoreClient
      });

      mockDb.query.mockResolvedValue({ rows: [] });

      const result = await service.generateReEngagementSuggestions('client-1');

      expect(result.some(s => s.type === 'call')).toBe(false);
      expect(result.some(s => s.type === 'meeting')).toBe(false);
      expect(result.some(s => s.type === 'email')).toBe(true);
    });
  });

  describe('getProactiveOpportunitiesDashboard', () => {
    it('should return dashboard data with statistics', async () => {
      // Mock opportunities
      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // Birthday opportunities
        .mockResolvedValueOnce({ rows: [] }) // Anniversary opportunities
        .mockResolvedValueOnce({ rows: [] }) // Follow-up opportunities
        .mockResolvedValueOnce({ rows: [] }) // Renewal opportunities
        .mockResolvedValueOnce({ rows: [] }) // Stale relationships
        .mockResolvedValueOnce({ 
          rows: [{ 
            total_clients: '100', 
            healthy_relationships: '70', 
            at_risk_relationships: '15' 
          }] 
        }); // Client statistics

      const result = await service.getProactiveOpportunitiesDashboard();

      expect(result).toHaveProperty('upcomingOpportunities');
      expect(result).toHaveProperty('staleRelationships');
      expect(result).toHaveProperty('totalClients');
      expect(result).toHaveProperty('healthyRelationships');
      expect(result).toHaveProperty('atRiskRelationships');
      expect(result.totalClients).toBe(100);
      expect(result.healthyRelationships).toBe(70);
      expect(result.atRiskRelationships).toBe(15);
    });
  });
});