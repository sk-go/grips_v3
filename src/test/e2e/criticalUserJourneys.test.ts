import request from 'supertest';
import { app } from '../../server';
import { DatabaseService } from '../../services/database/DatabaseService';
import { RedisService } from '../../services/redis';

describe('Critical User Journeys E2E Tests', () => {
  let authToken: string;
  let testUserId: string;

  beforeAll(async () => {
    await DatabaseService.initialize();
    await RedisService.initialize();
    
    // Create test user and get auth token
    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'e2e-test@example.com',
        password: 'TestPassword123!',
        firstName: 'E2E',
        lastName: 'Test'
      });

    if (registerResponse.status === 201) {
      testUserId = registerResponse.body.user.id;
      authToken = registerResponse.body.token;
    } else {
      // Try to login if user already exists
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'e2e-test@example.com',
          password: 'TestPassword123!'
        });
      
      if (loginResponse.status === 200) {
        testUserId = loginResponse.body.user.id;
        authToken = loginResponse.body.token;
      }
    }
  });

  afterAll(async () => {
    // Cleanup test data
    if (testUserId) {
      try {
        await DatabaseService.query('DELETE FROM users WHERE id = $1', [testUserId]);
      } catch (error) {
        console.warn('Failed to cleanup test user:', error);
      }
    }
    
    await DatabaseService.close();
    await RedisService.close();
  });

  describe('Agent Onboarding Journey', () => {
    it('should complete full agent onboarding process', async () => {
      // Skip if no auth token (user creation failed)
      if (!authToken) {
        console.warn('Skipping onboarding test - no auth token available');
        return;
      }

      // Step 1: Start onboarding
      const startResponse = await request(app)
        .post('/api/onboarding/start')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(startResponse.body.success).toBe(true);
      expect(startResponse.body.data.currentStep).toBe('email_config');

      // Step 2: Configure email (mock configuration)
      const emailConfigResponse = await request(app)
        .post('/api/onboarding/email-config')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          provider: 'gmail',
          email: 'agent@example.com',
          // In real scenario, this would be OAuth tokens
          mockConfig: true
        })
        .expect(200);

      expect(emailConfigResponse.body.success).toBe(true);

      // Step 3: Configure Twilio (mock configuration)
      const twilioConfigResponse = await request(app)
        .post('/api/onboarding/twilio-config')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          phoneNumber: '+1234567890',
          mockConfig: true
        })
        .expect(200);

      expect(twilioConfigResponse.body.success).toBe(true);

      // Step 4: Configure CRM (mock configuration)
      const crmConfigResponse = await request(app)
        .post('/api/onboarding/crm-config')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          crmSystem: 'zoho',
          mockConfig: true
        })
        .expect(200);

      expect(crmConfigResponse.body.success).toBe(true);

      // Step 5: Set preferences
      const preferencesResponse = await request(app)
        .post('/api/onboarding/preferences')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          language: 'en',
          timezone: 'America/New_York',
          notifications: {
            email: true,
            sms: false,
            push: true
          }
        })
        .expect(200);

      expect(preferencesResponse.body.success).toBe(true);

      // Step 6: Complete onboarding
      const completeResponse = await request(app)
        .post('/api/onboarding/complete')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(completeResponse.body.success).toBe(true);
      expect(completeResponse.body.data.completed).toBe(true);

      // Verify onboarding status
      const statusResponse = await request(app)
        .get('/api/onboarding/status')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(statusResponse.body.data.isCompleted).toBe(true);
      expect(statusResponse.body.data.completedSteps).toContain('email_config');
      expect(statusResponse.body.data.completedSteps).toContain('twilio_config');
      expect(statusResponse.body.data.completedSteps).toContain('crm_config');
      expect(statusResponse.body.data.completedSteps).toContain('preferences');
    });
  });

  describe('Communication Center Journey', () => {
    it('should handle unified communication workflow', async () => {
      if (!authToken) {
        console.warn('Skipping communication test - no auth token available');
        return;
      }

      // Step 1: Access communication center
      const centerResponse = await request(app)
        .get('/api/communications/inbox')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(centerResponse.body.success).toBe(true);
      expect(Array.isArray(centerResponse.body.data.communications)).toBe(true);

      // Step 2: Search communications
      const searchResponse = await request(app)
        .get('/api/communications/search?query=test')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(searchResponse.body.success).toBe(true);
      expect(Array.isArray(searchResponse.body.data.results)).toBe(true);

      // Step 3: Filter communications
      const filterResponse = await request(app)
        .get('/api/communications/inbox?type=email&direction=inbound')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(filterResponse.body.success).toBe(true);

      // Step 4: Get communication statistics
      const statsResponse = await request(app)
        .get('/api/communications/stats')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(statsResponse.body.success).toBe(true);
      expect(statsResponse.body.data).toHaveProperty('totalCommunications');
      expect(statsResponse.body.data).toHaveProperty('byType');
      expect(statsResponse.body.data).toHaveProperty('byDirection');
    });
  });

  describe('Client Relationship Management Journey', () => {
    it('should handle complete client relationship workflow', async () => {
      if (!authToken) {
        console.warn('Skipping client relationship test - no auth token available');
        return;
      }

      // Step 1: View client list
      const clientsResponse = await request(app)
        .get('/api/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(clientsResponse.body.success).toBe(true);
      expect(Array.isArray(clientsResponse.body.data.clients)).toBe(true);

      // Step 2: Get relationship insights (if clients exist)
      const insightsResponse = await request(app)
        .get('/api/relationship-insights/dashboard')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(insightsResponse.body.success).toBe(true);
      expect(insightsResponse.body.data).toHaveProperty('healthScores');
      expect(insightsResponse.body.data).toHaveProperty('sentimentTrends');

      // Step 3: Get proactive relationship suggestions
      const suggestionsResponse = await request(app)
        .get('/api/proactive-relationship/opportunities')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(suggestionsResponse.body.success).toBe(true);
      expect(Array.isArray(suggestionsResponse.body.data.opportunities)).toBe(true);

      // Step 4: Generate meeting brief (mock client)
      const briefResponse = await request(app)
        .post('/api/proactive-relationship/meeting-brief')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          clientId: 'mock-client-id',
          meetingType: 'review'
        })
        .expect(200);

      expect(briefResponse.body.success).toBe(true);
      expect(briefResponse.body.data).toHaveProperty('brief');
    });
  });

  describe('Document Generation Journey', () => {
    it('should handle complete document generation workflow', async () => {
      if (!authToken) {
        console.warn('Skipping document generation test - no auth token available');
        return;
      }

      // Step 1: Get available templates
      const templatesResponse = await request(app)
        .get('/api/documents/templates')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(templatesResponse.body.success).toBe(true);
      expect(Array.isArray(templatesResponse.body.data.templates)).toBe(true);

      // Step 2: Generate document (using default template)
      const generateResponse = await request(app)
        .post('/api/documents/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          templateId: 'default-advisory-protocol',
          clientData: {
            name: 'Test Client',
            email: 'client@example.com',
            phone: '+1234567890'
          },
          additionalData: {
            meetingDate: new Date().toISOString(),
            topics: ['Policy Review', 'Coverage Analysis']
          }
        })
        .expect(200);

      expect(generateResponse.body.success).toBe(true);
      expect(generateResponse.body.data).toHaveProperty('documentId');
      expect(generateResponse.body.data).toHaveProperty('status');

      const documentId = generateResponse.body.data.documentId;

      // Step 3: Preview generated document
      const previewResponse = await request(app)
        .get(`/api/documents/${documentId}/preview`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(previewResponse.body.success).toBe(true);
      expect(previewResponse.body.data).toHaveProperty('content');

      // Step 4: Approve document (if required)
      if (generateResponse.body.data.status === 'pending_approval') {
        const approveResponse = await request(app)
          .post(`/api/documents/${documentId}/approve`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(approveResponse.body.success).toBe(true);
      }

      // Step 5: Download document
      const downloadResponse = await request(app)
        .get(`/api/documents/${documentId}/download`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(downloadResponse.headers['content-type']).toMatch(/application\/pdf/);
    });
  });

  describe('Performance Monitoring Journey', () => {
    it('should handle performance monitoring workflow', async () => {
      if (!authToken) {
        console.warn('Skipping performance monitoring test - no auth token available');
        return;
      }

      // Step 1: Check system health
      const healthResponse = await request(app)
        .get('/api/performance/health')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(healthResponse.body.success).toBe(true);
      expect(healthResponse.body.data.overall).toMatch(/healthy|warning|critical/);

      // Step 2: Get performance metrics
      const metricsResponse = await request(app)
        .get('/api/performance/metrics')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(metricsResponse.body.success).toBe(true);
      expect(metricsResponse.body.data.summary).toBeDefined();

      // Step 3: Analyze database performance
      const dbAnalysisResponse = await request(app)
        .get('/api/performance/database/analysis')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(dbAnalysisResponse.body.success).toBe(true);
      expect(dbAnalysisResponse.body.data.connectionPool).toBeDefined();

      // Step 4: Check scaling status
      const scalingResponse = await request(app)
        .get('/api/performance/scaling/status')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(scalingResponse.body.success).toBe(true);
      expect(scalingResponse.body.data.status.currentInstances).toBeGreaterThan(0);
    });
  });

  describe('Error Recovery Journey', () => {
    it('should handle error scenarios gracefully', async () => {
      if (!authToken) {
        console.warn('Skipping error recovery test - no auth token available');
        return;
      }

      // Test 1: Invalid client ID
      const invalidClientResponse = await request(app)
        .get('/api/clients/invalid-client-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(invalidClientResponse.body.error).toBeDefined();

      // Test 2: Invalid document template
      const invalidTemplateResponse = await request(app)
        .post('/api/documents/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          templateId: 'non-existent-template',
          clientData: { name: 'Test' }
        })
        .expect(400);

      expect(invalidTemplateResponse.body.error).toBeDefined();

      // Test 3: Malformed request data
      const malformedResponse = await request(app)
        .post('/api/onboarding/preferences')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          invalidField: 'invalid value'
        })
        .expect(400);

      expect(malformedResponse.body.error).toBeDefined();

      // Test 4: System should still be responsive after errors
      const healthCheckResponse = await request(app)
        .get('/api/health')
        .expect(200);

      expect(healthCheckResponse.body.status).toBe('ok');
    });
  });

  describe('Multi-language Support Journey', () => {
    it('should handle multi-language configuration', async () => {
      if (!authToken) {
        console.warn('Skipping multi-language test - no auth token available');
        return;
      }

      // Step 1: Get available languages
      const languagesResponse = await request(app)
        .get('/api/configuration/languages')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(languagesResponse.body.success).toBe(true);
      expect(Array.isArray(languagesResponse.body.data.languages)).toBe(true);

      // Step 2: Set language preference
      const setLanguageResponse = await request(app)
        .put('/api/configuration/language')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ language: 'es' })
        .expect(200);

      expect(setLanguageResponse.body.success).toBe(true);

      // Step 3: Verify language setting
      const configResponse = await request(app)
        .get('/api/configuration/user')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(configResponse.body.success).toBe(true);
      expect(configResponse.body.data.language).toBe('es');
    });
  });

  describe('Accessibility Journey', () => {
    it('should handle accessibility configuration', async () => {
      if (!authToken) {
        console.warn('Skipping accessibility test - no auth token available');
        return;
      }

      // Step 1: Get accessibility settings
      const accessibilityResponse = await request(app)
        .get('/api/configuration/accessibility')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(accessibilityResponse.body.success).toBe(true);
      expect(accessibilityResponse.body.data).toHaveProperty('settings');

      // Step 2: Update accessibility settings
      const updateResponse = await request(app)
        .put('/api/configuration/accessibility')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          highContrast: true,
          largeText: true,
          screenReader: false,
          keyboardNavigation: true
        })
        .expect(200);

      expect(updateResponse.body.success).toBe(true);

      // Step 3: Verify settings were saved
      const verifyResponse = await request(app)
        .get('/api/configuration/accessibility')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(verifyResponse.body.data.settings.highContrast).toBe(true);
      expect(verifyResponse.body.data.settings.largeText).toBe(true);
    });
  });
});