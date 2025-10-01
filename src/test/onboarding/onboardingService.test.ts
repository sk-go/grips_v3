import { OnboardingService } from '../../services/onboarding/onboardingService';
import { DatabaseService } from '../../services/database/DatabaseService';
import { CacheService } from '../../services/cacheService';
import { EncryptionService } from '../../services/security/encryptionService';

// Mock dependencies
jest.mock('../../services/database/DatabaseService');
jest.mock('../../services/cacheService');
jest.mock('../../services/security/encryptionService');

const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;
const mockCacheService = CacheService as jest.Mocked<typeof CacheService>;
const mockEncryptionService = EncryptionService as jest.Mocked<typeof EncryptionService>;

describe('OnboardingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getOnboardingStatus', () => {
    it('should return cached status if available', async () => {
      const userId = 'test-user-id';
      const cachedStatus = {
        userId,
        isComplete: false,
        currentStep: 'email' as const,
        completedSteps: [],
        startedAt: new Date(),
        estimatedTimeRemaining: 10
      };

      mockCacheService.get.mockResolvedValue(JSON.stringify(cachedStatus));

      const result = await OnboardingService.getOnboardingStatus(userId);

      expect(result).toEqual(cachedStatus);
      expect(mockCacheService.get).toHaveBeenCalledWith(`onboarding:${userId}`);
    });

    it('should return default status for new user', async () => {
      const userId = 'test-user-id';

      mockCacheService.get.mockResolvedValue(null);
      mockDatabaseService.query.mockResolvedValue({ rows: [] });

      const result = await OnboardingService.getOnboardingStatus(userId);

      expect(result).toMatchObject({
        userId,
        isComplete: false,
        currentStep: 'email',
        completedSteps: [],
        estimatedTimeRemaining: 10
      });
    });

    it('should return database status and cache it', async () => {
      const userId = 'test-user-id';
      const dbRow = {
        user_id: userId,
        is_complete: false,
        current_step: 'twilio',
        completed_steps: ['email'],
        created_at: new Date().toISOString()
      };

      mockCacheService.get.mockResolvedValue(null);
      mockDatabaseService.query.mockResolvedValue({ rows: [dbRow] });

      const result = await OnboardingService.getOnboardingStatus(userId);

      expect(result).toMatchObject({
        userId,
        isComplete: false,
        currentStep: 'twilio',
        completedSteps: ['email']
      });
      expect(mockCacheService.set).toHaveBeenCalled();
    });
  });

  describe('startOnboarding', () => {
    it('should create new onboarding session', async () => {
      const userId = 'test-user-id';
      const dbRow = {
        user_id: userId,
        current_step: 'email',
        completed_steps: [],
        created_at: new Date().toISOString()
      };

      mockDatabaseService.query.mockResolvedValue({ rows: [dbRow] });
      mockCacheService.delete.mockResolvedValue(true);

      const result = await OnboardingService.startOnboarding(userId);

      expect(result).toMatchObject({
        userId,
        isComplete: false,
        currentStep: 'email',
        completedSteps: [],
        estimatedTimeRemaining: 10
      });
      expect(mockCacheService.delete).toHaveBeenCalledWith(`onboarding:${userId}`);
    });
  });

  describe('configureEmailAccount', () => {
    it('should configure email account with OAuth token', async () => {
      const userId = 'test-user-id';
      const config = {
        provider: 'gmail' as const,
        email: 'test@gmail.com',
        displayName: 'Test User',
        oauthToken: 'oauth-token'
      };

      mockEncryptionService.encrypt.mockResolvedValue('encrypted-token');
      mockDatabaseService.query.mockResolvedValue({ rows: [{ id: 'account-id' }] });

      const result = await OnboardingService.configureEmailAccount(userId, config);

      expect(result).toEqual({ success: true, accountId: 'account-id' });
      expect(mockEncryptionService.encrypt).toHaveBeenCalledWith('oauth-token');
    });

    it('should configure email account without OAuth token', async () => {
      const userId = 'test-user-id';
      const config = {
        provider: 'exchange' as const,
        email: 'test@company.com',
        displayName: 'Test User',
        imapSettings: {
          host: 'mail.company.com',
          port: 993,
          secure: true
        }
      };

      mockDatabaseService.query.mockResolvedValue({ rows: [{ id: 'account-id' }] });

      const result = await OnboardingService.configureEmailAccount(userId, config);

      expect(result).toEqual({ success: true, accountId: 'account-id' });
      expect(mockEncryptionService.encrypt).not.toHaveBeenCalled();
    });
  });

  describe('configureTwilioIntegration', () => {
    it('should configure Twilio integration', async () => {
      const userId = 'test-user-id';
      const config = {
        accountSid: 'AC123',
        authToken: 'auth-token',
        phoneNumber: '+1234567890',
        officeHours: {
          timezone: 'America/New_York',
          workdays: [1, 2, 3, 4, 5],
          startTime: '09:00',
          endTime: '17:00'
        }
      };

      mockEncryptionService.encrypt.mockResolvedValue('encrypted-token');
      mockDatabaseService.query.mockResolvedValue({ rows: [{ id: 'config-id' }] });

      const result = await OnboardingService.configureTwilioIntegration(userId, config);

      expect(result).toEqual({ success: true, configId: 'config-id' });
      expect(mockEncryptionService.encrypt).toHaveBeenCalledWith('auth-token');
    });
  });

  describe('configureCrmConnection', () => {
    it('should configure CRM connection', async () => {
      const userId = 'test-user-id';
      const config = {
        crmSystem: 'zoho' as const,
        apiCredentials: {
          clientId: 'client-id',
          clientSecret: 'client-secret'
        },
        syncSettings: {
          syncInterval: 15,
          syncFields: ['contacts', 'accounts'],
          bidirectional: true
        }
      };

      mockEncryptionService.encrypt.mockResolvedValue('encrypted-credentials');
      mockDatabaseService.query.mockResolvedValue({ rows: [{ id: 'connection-id' }] });

      const result = await OnboardingService.configureCrmConnection(userId, config);

      expect(result).toEqual({ success: true, connectionId: 'connection-id' });
      expect(mockEncryptionService.encrypt).toHaveBeenCalledWith(
        JSON.stringify(config.apiCredentials)
      );
    });
  });

  describe('completeStep', () => {
    it('should complete step and determine next step', async () => {
      const userId = 'test-user-id';
      const currentStatus = {
        userId,
        isComplete: false,
        currentStep: 'email' as const,
        completedSteps: [],
        startedAt: new Date(),
        estimatedTimeRemaining: 10
      };

      // Mock getOnboardingStatus
      mockCacheService.get.mockResolvedValue(JSON.stringify(currentStatus));
      mockDatabaseService.query.mockResolvedValue({ rows: [] });
      mockCacheService.delete.mockResolvedValue(true);

      const result = await OnboardingService.completeStep(userId, 'email');

      expect(result).toEqual({ success: true, nextStep: 'twilio' });
      expect(mockCacheService.delete).toHaveBeenCalledWith(`onboarding:${userId}`);
    });

    it('should handle last step completion', async () => {
      const userId = 'test-user-id';
      const currentStatus = {
        userId,
        isComplete: false,
        currentStep: 'preferences' as const,
        completedSteps: ['email', 'twilio', 'crm'],
        startedAt: new Date(),
        estimatedTimeRemaining: 1
      };

      mockCacheService.get.mockResolvedValue(JSON.stringify(currentStatus));
      mockDatabaseService.query.mockResolvedValue({ rows: [] });
      mockCacheService.delete.mockResolvedValue(true);

      const result = await OnboardingService.completeStep(userId, 'preferences');

      expect(result).toEqual({ success: true, nextStep: undefined });
    });
  });

  describe('finishOnboarding', () => {
    it('should finish onboarding and update user profile', async () => {
      const userId = 'test-user-id';

      mockDatabaseService.query.mockResolvedValue({ rows: [] });
      mockCacheService.delete.mockResolvedValue(true);

      const result = await OnboardingService.finishOnboarding(userId);

      expect(result.success).toBe(true);
      expect(result.completedAt).toBeInstanceOf(Date);
      expect(mockDatabaseService.query).toHaveBeenCalledTimes(2); // onboarding + user update
      expect(mockCacheService.delete).toHaveBeenCalledWith(`onboarding:${userId}`);
    });
  });
});