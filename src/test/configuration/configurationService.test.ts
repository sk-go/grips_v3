import { ConfigurationService } from '../../services/configuration/configurationService';
import { DatabaseService } from '../../services/database/DatabaseService';
import { CacheService } from '../../services/cacheService';

// Mock dependencies
jest.mock('../../services/database/DatabaseService');
jest.mock('../../services/cacheService');

const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;
const mockCacheService = CacheService as jest.Mocked<typeof CacheService>;

describe('ConfigurationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllConfigurations', () => {
    it('should return cached configurations if available', async () => {
      const userId = 'test-user-id';
      const cachedConfigs = {
        feature_toggles: { data: [], updatedAt: new Date().toISOString() }
      };

      mockCacheService.get.mockResolvedValue(JSON.stringify(cachedConfigs));

      const result = await ConfigurationService.getAllConfigurations(userId);

      expect(result).toEqual(cachedConfigs);
      expect(mockCacheService.get).toHaveBeenCalledWith(`config:all:${userId}`);
    });

    it('should return database configurations and cache them', async () => {
      const userId = 'test-user-id';
      const dbRows = [
        {
          configuration_type: 'feature_toggles',
          configuration_data: [{ feature: 'test', enabled: true }],
          updated_at: new Date().toISOString()
        }
      ];

      mockCacheService.get.mockResolvedValue(null);
      mockDatabaseService.query.mockResolvedValue({ rows: dbRows });

      const result = await ConfigurationService.getAllConfigurations(userId);

      expect(result.feature_toggles).toBeDefined();
      expect(mockCacheService.set).toHaveBeenCalled();
    });

    it('should include default configurations for missing types', async () => {
      const userId = 'test-user-id';

      mockCacheService.get.mockResolvedValue(null);
      mockDatabaseService.query.mockResolvedValue({ rows: [] });

      const result = await ConfigurationService.getAllConfigurations(userId);

      expect(result.feature_toggles).toBeDefined();
      expect(result.approval_gates).toBeDefined();
      expect(result.accessibility_settings).toBeDefined();
    });
  });

  describe('getConfiguration', () => {
    it('should return cached configuration if available', async () => {
      const userId = 'test-user-id';
      const type = 'feature_toggles';
      const cachedConfig = { data: [], updatedAt: new Date().toISOString() };

      mockCacheService.get.mockResolvedValue(JSON.stringify(cachedConfig));

      const result = await ConfigurationService.getConfiguration(userId, type);

      expect(result).toEqual(cachedConfig);
      expect(mockCacheService.get).toHaveBeenCalledWith(`config:${type}:${userId}`);
    });

    it('should return database configuration and cache it', async () => {
      const userId = 'test-user-id';
      const type = 'feature_toggles';
      const dbRow = {
        configuration_data: [{ feature: 'test', enabled: true }],
        updated_at: new Date().toISOString()
      };

      mockCacheService.get.mockResolvedValue(null);
      mockDatabaseService.query.mockResolvedValue({ rows: [dbRow] });

      const result = await ConfigurationService.getConfiguration(userId, type);

      expect(result.data).toEqual(dbRow.configuration_data);
      expect(mockCacheService.set).toHaveBeenCalled();
    });

    it('should return default configuration if not found in database', async () => {
      const userId = 'test-user-id';
      const type = 'feature_toggles';

      mockCacheService.get.mockResolvedValue(null);
      mockDatabaseService.query.mockResolvedValue({ rows: [] });

      const result = await ConfigurationService.getConfiguration(userId, type);

      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
    });
  });

  describe('updateConfiguration', () => {
    it('should update configuration and clear cache', async () => {
      const userId = 'test-user-id';
      const type = 'feature_toggles';
      const data = [{ feature: 'test', enabled: true }];
      const dbRow = {
        id: 'config-id',
        user_id: userId,
        configuration_type: type,
        configuration_data: data,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      mockDatabaseService.query.mockResolvedValue({ rows: [dbRow] });
      mockCacheService.delete.mockResolvedValue(true);

      const result = await ConfigurationService.updateConfiguration(userId, type, data);

      expect(result.id).toBe('config-id');
      expect(result.userId).toBe(userId);
      expect(result.configurationType).toBe(type);
      expect(mockCacheService.delete).toHaveBeenCalledTimes(2); // type-specific and all configs
    });

    it('should validate configuration data', async () => {
      const userId = 'test-user-id';
      const type = 'feature_toggles';
      const invalidData = 'not an array';

      await expect(
        ConfigurationService.updateConfiguration(userId, type, invalidData)
      ).rejects.toThrow('Feature toggles must be an array');
    });
  });

  describe('getFeatureToggles', () => {
    it('should return feature toggles from configuration', async () => {
      const userId = 'test-user-id';
      const toggles = [{ feature: 'test', enabled: true, description: 'Test', category: 'test' }];

      mockCacheService.get.mockResolvedValue(JSON.stringify({ data: toggles }));

      const result = await ConfigurationService.getFeatureToggles(userId);

      expect(result).toEqual(toggles);
    });

    it('should return default toggles if no configuration exists', async () => {
      const userId = 'test-user-id';

      mockCacheService.get.mockResolvedValue(null);
      mockDatabaseService.query.mockResolvedValue({ rows: [] });

      const result = await ConfigurationService.getFeatureToggles(userId);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('updateFeatureToggle', () => {
    it('should update specific feature toggle', async () => {
      const userId = 'test-user-id';
      const feature = 'ai_voice_interaction';
      const enabled = false;
      const currentToggles = [
        { feature: 'ai_voice_interaction', enabled: true, description: 'Test', category: 'ai' },
        { feature: 'email_integration', enabled: true, description: 'Test', category: 'communication' }
      ];

      // Mock getFeatureToggles
      mockCacheService.get.mockResolvedValue(JSON.stringify({ data: currentToggles }));
      
      // Mock updateConfiguration
      mockDatabaseService.query.mockResolvedValue({ 
        rows: [{ 
          id: 'config-id', 
          user_id: userId, 
          configuration_type: 'feature_toggles',
          configuration_data: currentToggles,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }] 
      });

      const result = await ConfigurationService.updateFeatureToggle(userId, feature, enabled);

      expect(result.success).toBe(true);
    });
  });

  describe('getAccessibilitySettings', () => {
    it('should return accessibility settings from configuration', async () => {
      const userId = 'test-user-id';
      const settings = {
        highContrast: true,
        largeText: false,
        screenReader: true,
        keyboardNavigation: true,
        reducedMotion: false,
        colorBlindSupport: false,
        fontSize: 16,
        contrastRatio: 4.5
      };

      mockCacheService.get.mockResolvedValue(JSON.stringify({ data: settings }));

      const result = await ConfigurationService.getAccessibilitySettings(userId);

      expect(result).toEqual(settings);
    });

    it('should return default settings if no configuration exists', async () => {
      const userId = 'test-user-id';

      mockCacheService.get.mockResolvedValue(null);
      mockDatabaseService.query.mockResolvedValue({ rows: [] });

      const result = await ConfigurationService.getAccessibilitySettings(userId);

      expect(result.fontSize).toBe(16);
      expect(result.contrastRatio).toBe(4.5);
      expect(typeof result.highContrast).toBe('boolean');
    });
  });

  describe('updateAccessibilitySettings', () => {
    it('should validate WCAG compliance', async () => {
      const userId = 'test-user-id';
      const invalidSettings = {
        contrastRatio: 3.0, // Below WCAG AA requirement
        fontSize: 16
      };

      await expect(
        ConfigurationService.updateAccessibilitySettings(userId, invalidSettings)
      ).rejects.toThrow('Contrast ratio must be at least 4.5:1 for WCAG 2.1 AA compliance');
    });

    it('should update valid accessibility settings', async () => {
      const userId = 'test-user-id';
      const settings = {
        highContrast: true,
        fontSize: 18,
        contrastRatio: 7.0
      };

      // Mock current settings
      mockCacheService.get.mockResolvedValue(JSON.stringify({ 
        data: {
          highContrast: false,
          largeText: false,
          screenReader: false,
          keyboardNavigation: false,
          reducedMotion: false,
          colorBlindSupport: false,
          fontSize: 16,
          contrastRatio: 4.5
        }
      }));

      // Mock updateConfiguration
      mockDatabaseService.query.mockResolvedValue({ 
        rows: [{ 
          id: 'config-id', 
          user_id: userId, 
          configuration_type: 'accessibility_settings',
          configuration_data: settings,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }] 
      });

      const result = await ConfigurationService.updateAccessibilitySettings(userId, settings);

      expect(result.success).toBe(true);
    });
  });

  describe('getAvailableLanguages', () => {
    it('should return available languages', async () => {
      const result = await ConfigurationService.getAvailableLanguages();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('code');
      expect(result[0]).toHaveProperty('name');
      expect(result[0]).toHaveProperty('dialects');
      expect(result[0]).toHaveProperty('aiModels');
      expect(result[0]).toHaveProperty('supportedFeatures');
    });
  });

  describe('resetConfiguration', () => {
    it('should reset configuration to defaults', async () => {
      const userId = 'test-user-id';
      const type = 'feature_toggles';

      mockDatabaseService.query.mockResolvedValue({ 
        rows: [{ 
          id: 'config-id', 
          user_id: userId, 
          configuration_type: type,
          configuration_data: [],
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }] 
      });

      const result = await ConfigurationService.resetConfiguration(userId, type);

      expect(result.success).toBe(true);
    });
  });
});