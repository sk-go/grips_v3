import { DatabaseService } from '../database';
import { CacheService } from '../cacheService';
import { EmailIntegrationService } from '../email/emailIntegrationService';
import { TwilioService } from '../twilio/twilioService';
import { CrmSyncService } from '../crm/crmSyncService';
import { EncryptionService } from '../security/encryptionService';

export interface OnboardingStatus {
  userId: string;
  isComplete: boolean;
  currentStep: 'email' | 'twilio' | 'crm' | 'preferences' | 'complete';
  completedSteps: string[];
  startedAt: Date;
  completedAt?: Date;
  estimatedTimeRemaining: number; // in minutes
}

export interface EmailAccountConfig {
  provider: 'gmail' | 'outlook' | 'exchange';
  email: string;
  displayName: string;
  oauthToken?: string;
  imapSettings?: {
    host: string;
    port: number;
    secure: boolean;
  };
  smtpSettings?: {
    host: string;
    port: number;
    secure: boolean;
  };
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
  webhookUrl?: string;
  officeHours?: {
    timezone: string;
    workdays: number[];
    startTime: string;
    endTime: string;
  };
}

export interface CrmConfig {
  crmSystem: 'zoho' | 'salesforce' | 'hubspot' | 'agencybloc';
  apiCredentials: Record<string, any>;
  syncSettings?: {
    syncInterval: number;
    syncFields: string[];
    bidirectional: boolean;
  };
}

export class OnboardingService {
  private static readonly ONBOARDING_CACHE_PREFIX = 'onboarding:';
  private static readonly STEP_TIME_ESTIMATES = {
    email: 3, // 3 minutes
    twilio: 2, // 2 minutes
    crm: 4, // 4 minutes
    preferences: 1 // 1 minute
  };

  static async getOnboardingStatus(userId: string): Promise<OnboardingStatus> {
    try {
      // Check cache first
      const cached = await CacheService.get(`${this.ONBOARDING_CACHE_PREFIX}${userId}`);
      if (cached) {
        return JSON.parse(cached);
      }

      // Get from database
      const query = `
        SELECT * FROM onboarding_sessions 
        WHERE user_id = $1 
        ORDER BY created_at DESC 
        LIMIT 1
      `;
      const result = await DatabaseService.query(query, [userId]);
      
      if (result.rows.length === 0) {
        // No onboarding session exists
        return {
          userId,
          isComplete: false,
          currentStep: 'email',
          completedSteps: [],
          startedAt: new Date(),
          estimatedTimeRemaining: 10
        };
      }

      const session = result.rows[0];
      const status: OnboardingStatus = {
        userId: session.user_id,
        isComplete: session.is_complete,
        currentStep: session.current_step,
        completedSteps: session.completed_steps || [],
        startedAt: new Date(session.created_at),
        completedAt: session.completed_at ? new Date(session.completed_at) : undefined,
        estimatedTimeRemaining: this.calculateTimeRemaining(session.completed_steps || [])
      };

      // Cache for 5 minutes
      await CacheService.set(
        `${this.ONBOARDING_CACHE_PREFIX}${userId}`,
        JSON.stringify(status),
        300
      );

      return status;
    } catch (error) {
      console.error('Error getting onboarding status:', error);
      throw new Error('Failed to get onboarding status');
    }
  }

  static async startOnboarding(userId: string): Promise<OnboardingStatus> {
    try {
      const query = `
        INSERT INTO onboarding_sessions (
          user_id, current_step, completed_steps, created_at
        ) VALUES ($1, $2, $3, NOW())
        ON CONFLICT (user_id) 
        DO UPDATE SET 
          current_step = EXCLUDED.current_step,
          updated_at = NOW()
        RETURNING *
      `;
      
      const result = await DatabaseService.query(query, [
        userId,
        'email',
        JSON.stringify([])
      ]);

      const session = result.rows[0];
      const status: OnboardingStatus = {
        userId: session.user_id,
        isComplete: false,
        currentStep: 'email',
        completedSteps: [],
        startedAt: new Date(session.created_at),
        estimatedTimeRemaining: 10
      };

      // Clear cache
      await CacheService.delete(`${this.ONBOARDING_CACHE_PREFIX}${userId}`);

      return status;
    } catch (error) {
      console.error('Error starting onboarding:', error);
      throw new Error('Failed to start onboarding');
    }
  }

  static async configureEmailAccount(userId: string, config: EmailAccountConfig): Promise<{ success: boolean; accountId?: string }> {
    try {
      // Encrypt sensitive data
      const encryptedToken = config.oauthToken ? 
        await EncryptionService.encrypt(config.oauthToken) : null;

      // Store email account configuration
      const query = `
        INSERT INTO email_accounts (
          user_id, provider, email, display_name, 
          oauth_token_encrypted, imap_settings, smtp_settings,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        RETURNING id
      `;

      const result = await DatabaseService.query(query, [
        userId,
        config.provider,
        config.email,
        config.displayName,
        encryptedToken,
        JSON.stringify(config.imapSettings || {}),
        JSON.stringify(config.smtpSettings || {})
      ]);

      const accountId = result.rows[0].id;

      // Test the email connection
      if (config.oauthToken || config.imapSettings) {
        try {
          await EmailIntegrationService.testConnection(accountId);
        } catch (error) {
          console.warn('Email connection test failed:', error);
          // Don't fail onboarding for connection issues
        }
      }

      return { success: true, accountId };
    } catch (error) {
      console.error('Error configuring email account:', error);
      throw new Error('Failed to configure email account');
    }
  }

  static async configureTwilioIntegration(userId: string, config: TwilioConfig): Promise<{ success: boolean; configId?: string }> {
    try {
      // Encrypt sensitive data
      const encryptedAuthToken = await EncryptionService.encrypt(config.authToken);

      // Store Twilio configuration
      const query = `
        INSERT INTO twilio_configurations (
          user_id, account_sid, auth_token_encrypted, 
          phone_number, webhook_url, office_hours,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
          account_sid = EXCLUDED.account_sid,
          auth_token_encrypted = EXCLUDED.auth_token_encrypted,
          phone_number = EXCLUDED.phone_number,
          webhook_url = EXCLUDED.webhook_url,
          office_hours = EXCLUDED.office_hours,
          updated_at = NOW()
        RETURNING id
      `;

      const result = await DatabaseService.query(query, [
        userId,
        config.accountSid,
        encryptedAuthToken,
        config.phoneNumber,
        config.webhookUrl,
        JSON.stringify(config.officeHours || {})
      ]);

      const configId = result.rows[0].id;

      // Test Twilio connection
      try {
        await TwilioService.testConnection(config.accountSid, config.authToken);
      } catch (error) {
        console.warn('Twilio connection test failed:', error);
        // Don't fail onboarding for connection issues
      }

      return { success: true, configId };
    } catch (error) {
      console.error('Error configuring Twilio integration:', error);
      throw new Error('Failed to configure Twilio integration');
    }
  }

  static async configureCrmConnection(userId: string, config: CrmConfig): Promise<{ success: boolean; connectionId?: string }> {
    try {
      // Encrypt API credentials
      const encryptedCredentials = await EncryptionService.encrypt(
        JSON.stringify(config.apiCredentials)
      );

      // Store CRM configuration
      const query = `
        INSERT INTO crm_connections (
          user_id, crm_system, api_credentials_encrypted,
          sync_settings, created_at
        ) VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (user_id, crm_system)
        DO UPDATE SET
          api_credentials_encrypted = EXCLUDED.api_credentials_encrypted,
          sync_settings = EXCLUDED.sync_settings,
          updated_at = NOW()
        RETURNING id
      `;

      const result = await DatabaseService.query(query, [
        userId,
        config.crmSystem,
        encryptedCredentials,
        JSON.stringify(config.syncSettings || {})
      ]);

      const connectionId = result.rows[0].id;

      // Test CRM connection
      try {
        await CrmSyncService.testConnection(config.crmSystem, config.apiCredentials);
      } catch (error) {
        console.warn('CRM connection test failed:', error);
        // Don't fail onboarding for connection issues
      }

      return { success: true, connectionId };
    } catch (error) {
      console.error('Error configuring CRM connection:', error);
      throw new Error('Failed to configure CRM connection');
    }
  }

  static async completeStep(userId: string, step: string, data?: any): Promise<{ success: boolean; nextStep?: string }> {
    try {
      // Get current onboarding status
      const currentStatus = await this.getOnboardingStatus(userId);
      
      // Add step to completed steps if not already there
      const completedSteps = [...currentStatus.completedSteps];
      if (!completedSteps.includes(step)) {
        completedSteps.push(step);
      }

      // Determine next step
      const stepOrder = ['email', 'twilio', 'crm', 'preferences'];
      const currentIndex = stepOrder.indexOf(step);
      const nextStep = currentIndex < stepOrder.length - 1 ? stepOrder[currentIndex + 1] : 'complete';

      // Update database
      const query = `
        UPDATE onboarding_sessions 
        SET 
          current_step = $2,
          completed_steps = $3,
          updated_at = NOW()
        WHERE user_id = $1
      `;

      await DatabaseService.query(query, [
        userId,
        nextStep,
        JSON.stringify(completedSteps)
      ]);

      // Clear cache
      await CacheService.delete(`${this.ONBOARDING_CACHE_PREFIX}${userId}`);

      return { success: true, nextStep: nextStep === 'complete' ? undefined : nextStep };
    } catch (error) {
      console.error('Error completing onboarding step:', error);
      throw new Error('Failed to complete onboarding step');
    }
  }

  static async finishOnboarding(userId: string): Promise<{ success: boolean; completedAt: Date }> {
    try {
      const completedAt = new Date();
      
      const query = `
        UPDATE onboarding_sessions 
        SET 
          is_complete = true,
          current_step = 'complete',
          completed_at = $2,
          updated_at = NOW()
        WHERE user_id = $1
      `;

      await DatabaseService.query(query, [userId, completedAt]);

      // Clear cache
      await CacheService.delete(`${this.ONBOARDING_CACHE_PREFIX}${userId}`);

      // Update user profile to mark onboarding as complete
      const userQuery = `
        UPDATE users 
        SET onboarding_completed = true, updated_at = NOW()
        WHERE id = $1
      `;
      await DatabaseService.query(userQuery, [userId]);

      return { success: true, completedAt };
    } catch (error) {
      console.error('Error finishing onboarding:', error);
      throw new Error('Failed to finish onboarding');
    }
  }

  private static calculateTimeRemaining(completedSteps: string[]): number {
    const allSteps = ['email', 'twilio', 'crm', 'preferences'];
    const remainingSteps = allSteps.filter(step => !completedSteps.includes(step));
    
    return remainingSteps.reduce((total, step) => {
      return total + (this.STEP_TIME_ESTIMATES[step as keyof typeof this.STEP_TIME_ESTIMATES] || 2);
    }, 0);
  }
}