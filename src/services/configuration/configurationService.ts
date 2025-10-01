import { DatabaseService } from '../database';
import { CacheService } from '../cacheService';

export interface SystemConfiguration {
  id: string;
  userId: string;
  configurationType: string;
  configurationData: Record<string, any>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeatureToggle {
  feature: string;
  enabled: boolean;
  description: string;
  category: string;
}

export interface ApprovalGate {
  action: string;
  requiresApproval: boolean;
  confidenceThreshold: number;
  approvers: string[];
}

export interface LanguageSettings {
  language: string;
  dialect?: string;
  aiModel?: string;
  supportedFeatures: string[];
}

export interface AccessibilitySettings {
  highContrast: boolean;
  largeText: boolean;
  screenReader: boolean;
  keyboardNavigation: boolean;
  reducedMotion: boolean;
  colorBlindSupport: boolean;
  fontSize: number;
  contrastRatio: number;
}

export class ConfigurationService {
  private static readonly CACHE_PREFIX = 'config:';
  private static readonly CACHE_TTL = 3600; // 1 hour

  // Default configurations
  private static readonly DEFAULT_FEATURE_TOGGLES: FeatureToggle[] = [
    { feature: 'ai_voice_interaction', enabled: true, description: 'Enable voice AI interactions', category: 'ai' },
    { feature: 'ai_auto_approval', enabled: false, description: 'Auto-approve low-risk AI actions', category: 'ai' },
    { feature: 'email_integration', enabled: true, description: 'Email account integration', category: 'communication' },
    { feature: 'twilio_integration', enabled: true, description: 'Twilio SMS/voice integration', category: 'communication' },
    { feature: 'crm_sync', enabled: true, description: 'CRM data synchronization', category: 'crm' },
    { feature: 'document_generation', enabled: true, description: 'Automated document generation', category: 'documents' },
    { feature: 'relationship_insights', enabled: true, description: 'AI-powered relationship insights', category: 'ai' },
    { feature: 'sentiment_analysis', enabled: true, description: 'Communication sentiment analysis', category: 'ai' },
    { feature: 'real_time_notifications', enabled: true, description: 'Real-time push notifications', category: 'notifications' },
    { feature: 'advanced_search', enabled: true, description: 'Advanced search capabilities', category: 'search' }
  ];

  private static readonly DEFAULT_APPROVAL_GATES: ApprovalGate[] = [
    { action: 'send_email', requiresApproval: true, confidenceThreshold: 0.8, approvers: ['user'] },
    { action: 'update_crm', requiresApproval: false, confidenceThreshold: 0.9, approvers: [] },
    { action: 'create_task', requiresApproval: false, confidenceThreshold: 0.7, approvers: [] },
    { action: 'schedule_meeting', requiresApproval: true, confidenceThreshold: 0.8, approvers: ['user'] },
    { action: 'generate_document', requiresApproval: true, confidenceThreshold: 0.8, approvers: ['user'] },
    { action: 'delete_data', requiresApproval: true, confidenceThreshold: 1.0, approvers: ['user'] }
  ];

  private static readonly AVAILABLE_LANGUAGES = [
    { 
      code: 'en', 
      name: 'English', 
      dialects: ['US', 'UK', 'AU', 'CA'], 
      aiModels: ['grok-beta', 'gpt-4'], 
      supportedFeatures: ['voice', 'text', 'sentiment', 'translation'] 
    },
    { 
      code: 'es', 
      name: 'Spanish', 
      dialects: ['ES', 'MX', 'AR', 'CO'], 
      aiModels: ['grok-beta', 'gpt-4'], 
      supportedFeatures: ['voice', 'text', 'sentiment', 'translation'] 
    },
    { 
      code: 'fr', 
      name: 'French', 
      dialects: ['FR', 'CA', 'BE', 'CH'], 
      aiModels: ['grok-beta', 'gpt-4'], 
      supportedFeatures: ['text', 'sentiment', 'translation'] 
    },
    { 
      code: 'de', 
      name: 'German', 
      dialects: ['DE', 'AT', 'CH'], 
      aiModels: ['grok-beta', 'gpt-4'], 
      supportedFeatures: ['text', 'sentiment', 'translation'] 
    },
    { 
      code: 'it', 
      name: 'Italian', 
      dialects: ['IT', 'CH'], 
      aiModels: ['grok-beta'], 
      supportedFeatures: ['text', 'sentiment'] 
    },
    { 
      code: 'pt', 
      name: 'Portuguese', 
      dialects: ['BR', 'PT'], 
      aiModels: ['grok-beta'], 
      supportedFeatures: ['text', 'sentiment'] 
    }
  ];

  private static readonly DEFAULT_ACCESSIBILITY_SETTINGS: AccessibilitySettings = {
    highContrast: false,
    largeText: false,
    screenReader: false,
    keyboardNavigation: false,
    reducedMotion: false,
    colorBlindSupport: false,
    fontSize: 16,
    contrastRatio: 4.5
  };

  static async getAllConfigurations(userId: string): Promise<Record<string, any>> {
    try {
      // Check cache first
      const cacheKey = `${this.CACHE_PREFIX}all:${userId}`;
      const cached = await CacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Get from database
      const query = `
        SELECT configuration_type, configuration_data, is_active, updated_at
        FROM system_configurations 
        WHERE user_id = $1 AND is_active = true
      `;
      const result = await DatabaseService.query(query, [userId]);
      
      const configurations: Record<string, any> = {};
      result.rows.forEach(row => {
        configurations[row.configuration_type] = {
          data: row.configuration_data,
          updatedAt: row.updated_at
        };
      });

      // Add defaults for missing configurations
      if (!configurations.feature_toggles) {
        configurations.feature_toggles = { data: this.DEFAULT_FEATURE_TOGGLES };
      }
      if (!configurations.approval_gates) {
        configurations.approval_gates = { data: this.DEFAULT_APPROVAL_GATES };
      }
      if (!configurations.accessibility_settings) {
        configurations.accessibility_settings = { data: this.DEFAULT_ACCESSIBILITY_SETTINGS };
      }

      // Cache for 1 hour
      await CacheService.set(cacheKey, JSON.stringify(configurations), this.CACHE_TTL);

      return configurations;
    } catch (error) {
      console.error('Error getting all configurations:', error);
      throw new Error('Failed to get configurations');
    }
  }

  static async getConfiguration(userId: string, type: string): Promise<any> {
    try {
      // Check cache first
      const cacheKey = `${this.CACHE_PREFIX}${type}:${userId}`;
      const cached = await CacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Get from database
      const query = `
        SELECT configuration_data, updated_at
        FROM system_configurations 
        WHERE user_id = $1 AND configuration_type = $2 AND is_active = true
      `;
      const result = await DatabaseService.query(query, [userId, type]);
      
      let configuration;
      if (result.rows.length > 0) {
        configuration = {
          data: result.rows[0].configuration_data,
          updatedAt: result.rows[0].updated_at
        };
      } else {
        // Return defaults
        configuration = { data: this.getDefaultConfiguration(type) };
      }

      // Cache for 1 hour
      await CacheService.set(cacheKey, JSON.stringify(configuration), this.CACHE_TTL);

      return configuration;
    } catch (error) {
      console.error('Error getting configuration:', error);
      throw new Error('Failed to get configuration');
    }
  }

  static async updateConfiguration(userId: string, type: string, data: any): Promise<SystemConfiguration> {
    try {
      // Validate configuration data
      this.validateConfigurationData(type, data);

      const query = `
        INSERT INTO system_configurations (
          user_id, configuration_type, configuration_data, created_at, updated_at
        ) VALUES ($1, $2, $3, NOW(), NOW())
        ON CONFLICT (user_id, configuration_type)
        DO UPDATE SET
          configuration_data = EXCLUDED.configuration_data,
          updated_at = NOW()
        RETURNING *
      `;

      const result = await DatabaseService.query(query, [userId, type, JSON.stringify(data)]);
      const config = result.rows[0];

      // Clear cache
      await this.clearConfigurationCache(userId, type);

      return {
        id: config.id,
        userId: config.user_id,
        configurationType: config.configuration_type,
        configurationData: config.configuration_data,
        isActive: config.is_active,
        createdAt: new Date(config.created_at),
        updatedAt: new Date(config.updated_at)
      };
    } catch (error) {
      console.error('Error updating configuration:', error);
      throw new Error('Failed to update configuration');
    }
  }

  static async getFeatureToggles(userId: string): Promise<FeatureToggle[]> {
    const config = await this.getConfiguration(userId, 'feature_toggles');
    return config.data || this.DEFAULT_FEATURE_TOGGLES;
  }

  static async updateFeatureToggle(userId: string, feature: string, enabled: boolean): Promise<{ success: boolean }> {
    try {
      const currentToggles = await this.getFeatureToggles(userId);
      const updatedToggles = currentToggles.map(toggle => 
        toggle.feature === feature ? { ...toggle, enabled } : toggle
      );

      await this.updateConfiguration(userId, 'feature_toggles', updatedToggles);
      return { success: true };
    } catch (error) {
      console.error('Error updating feature toggle:', error);
      throw new Error('Failed to update feature toggle');
    }
  }

  static async getApprovalGates(userId: string): Promise<ApprovalGate[]> {
    const config = await this.getConfiguration(userId, 'approval_gates');
    return config.data || this.DEFAULT_APPROVAL_GATES;
  }

  static async updateApprovalGates(userId: string, gates: ApprovalGate[]): Promise<{ success: boolean }> {
    try {
      await this.updateConfiguration(userId, 'approval_gates', gates);
      return { success: true };
    } catch (error) {
      console.error('Error updating approval gates:', error);
      throw new Error('Failed to update approval gates');
    }
  }

  static async getLanguageSettings(userId: string): Promise<LanguageSettings> {
    const config = await this.getConfiguration(userId, 'language_settings');
    return config.data || {
      language: 'en',
      dialect: 'US',
      aiModel: 'grok-beta',
      supportedFeatures: ['voice', 'text', 'sentiment', 'translation']
    };
  }

  static async updateLanguageSettings(userId: string, settings: Partial<LanguageSettings>): Promise<{ success: boolean }> {
    try {
      const currentSettings = await this.getLanguageSettings(userId);
      const updatedSettings = { ...currentSettings, ...settings };

      // Validate language support
      const language = this.AVAILABLE_LANGUAGES.find(lang => lang.code === updatedSettings.language);
      if (!language) {
        throw new Error('Unsupported language');
      }

      // Update supported features based on language
      updatedSettings.supportedFeatures = language.supportedFeatures;

      await this.updateConfiguration(userId, 'language_settings', updatedSettings);
      return { success: true };
    } catch (error) {
      console.error('Error updating language settings:', error);
      throw new Error('Failed to update language settings');
    }
  }

  static async getAccessibilitySettings(userId: string): Promise<AccessibilitySettings> {
    const config = await this.getConfiguration(userId, 'accessibility_settings');
    return config.data || this.DEFAULT_ACCESSIBILITY_SETTINGS;
  }

  static async updateAccessibilitySettings(userId: string, settings: Partial<AccessibilitySettings>): Promise<{ success: boolean }> {
    try {
      const currentSettings = await this.getAccessibilitySettings(userId);
      const updatedSettings = { ...currentSettings, ...settings };

      // Validate WCAG 2.1 AA compliance
      this.validateAccessibilitySettings(updatedSettings);

      await this.updateConfiguration(userId, 'accessibility_settings', updatedSettings);
      return { success: true };
    } catch (error) {
      console.error('Error updating accessibility settings:', error);
      throw new Error('Failed to update accessibility settings');
    }
  }

  static async getAvailableLanguages(): Promise<typeof ConfigurationService.AVAILABLE_LANGUAGES> {
    return this.AVAILABLE_LANGUAGES;
  }

  static async resetConfiguration(userId: string, type: string): Promise<{ success: boolean }> {
    try {
      const defaultData = this.getDefaultConfiguration(type);
      await this.updateConfiguration(userId, type, defaultData);
      return { success: true };
    } catch (error) {
      console.error('Error resetting configuration:', error);
      throw new Error('Failed to reset configuration');
    }
  }

  private static getDefaultConfiguration(type: string): any {
    switch (type) {
      case 'feature_toggles':
        return this.DEFAULT_FEATURE_TOGGLES;
      case 'approval_gates':
        return this.DEFAULT_APPROVAL_GATES;
      case 'accessibility_settings':
        return this.DEFAULT_ACCESSIBILITY_SETTINGS;
      case 'language_settings':
        return {
          language: 'en',
          dialect: 'US',
          aiModel: 'grok-beta',
          supportedFeatures: ['voice', 'text', 'sentiment', 'translation']
        };
      default:
        return {};
    }
  }

  private static validateConfigurationData(type: string, data: any): void {
    switch (type) {
      case 'feature_toggles':
        if (!Array.isArray(data)) {
          throw new Error('Feature toggles must be an array');
        }
        break;
      case 'approval_gates':
        if (!Array.isArray(data)) {
          throw new Error('Approval gates must be an array');
        }
        break;
      case 'accessibility_settings':
        this.validateAccessibilitySettings(data);
        break;
      case 'language_settings':
        if (!data.language || typeof data.language !== 'string') {
          throw new Error('Language is required');
        }
        break;
    }
  }

  private static validateAccessibilitySettings(settings: AccessibilitySettings): void {
    // WCAG 2.1 AA compliance validation
    if (settings.contrastRatio < 4.5) {
      throw new Error('Contrast ratio must be at least 4.5:1 for WCAG 2.1 AA compliance');
    }
    
    if (settings.fontSize < 12) {
      throw new Error('Font size must be at least 12px for accessibility');
    }

    // Validate boolean settings
    const booleanFields = ['highContrast', 'largeText', 'screenReader', 'keyboardNavigation', 'reducedMotion', 'colorBlindSupport'];
    for (const field of booleanFields) {
      if (typeof settings[field as keyof AccessibilitySettings] !== 'boolean') {
        throw new Error(`${field} must be a boolean value`);
      }
    }
  }

  private static async clearConfigurationCache(userId: string, type?: string): Promise<void> {
    if (type) {
      await CacheService.delete(`${this.CACHE_PREFIX}${type}:${userId}`);
    }
    await CacheService.delete(`${this.CACHE_PREFIX}all:${userId}`);
  }
}