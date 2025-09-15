/**
 * OAuth Service for CRM Authentication
 * Handles OAuth 2.0 flows for different CRM systems
 */

import crypto from 'crypto';
import { CrmSystem } from '../../types';
import { CrmConfig, CrmAuthTokens, CrmError } from './types';
import { logger } from '../../utils/logger';

export interface OAuthState {
  state: string;
  crmSystem: CrmSystem;
  userId: string;
  redirectUri: string;
  createdAt: Date;
  expiresAt: Date;
}

export class OAuthService {
  private static pendingStates: Map<string, OAuthState> = new Map();
  
  /**
   * Generate OAuth authorization URL
   */
  static generateAuthUrl(config: CrmConfig, userId: string): { url: string; state: string } {
    const state = this.generateState();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store state for validation
    this.pendingStates.set(state, {
      state,
      crmSystem: config.system,
      userId,
      redirectUri: config.redirectUri,
      createdAt: new Date(),
      expiresAt
    });

    const authUrl = this.buildAuthUrl(config, state);
    
    logger.info(`Generated OAuth URL for ${config.system}`, { 
      userId, 
      state: state.substring(0, 8) + '...' 
    });

    return { url: authUrl, state };
  }

  /**
   * Validate OAuth state and return stored information
   */
  static validateState(state: string): OAuthState | null {
    const storedState = this.pendingStates.get(state);
    
    if (!storedState) {
      logger.warn('Invalid OAuth state received', { state: state.substring(0, 8) + '...' });
      return null;
    }

    if (new Date() > storedState.expiresAt) {
      this.pendingStates.delete(state);
      logger.warn('Expired OAuth state received', { state: state.substring(0, 8) + '...' });
      return null;
    }

    return storedState;
  }

  /**
   * Complete OAuth flow and clean up state
   */
  static completeOAuth(state: string): void {
    this.pendingStates.delete(state);
    logger.info('OAuth flow completed', { state: state.substring(0, 8) + '...' });
  }

  /**
   * Clean up expired states
   */
  static cleanupExpiredStates(): void {
    const now = new Date();
    let cleanedCount = 0;

    for (const [state, stateData] of this.pendingStates.entries()) {
      if (now > stateData.expiresAt) {
        this.pendingStates.delete(state);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} expired OAuth states`);
    }
  }

  /**
   * Get authorization URL for specific CRM system
   */
  private static buildAuthUrl(config: CrmConfig, state: string): string {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      state,
      response_type: 'code'
    });

    if (config.scopes && config.scopes.length > 0) {
      params.append('scope', config.scopes.join(' '));
    }

    let authEndpoint: string;

    switch (config.system) {
      case 'zoho':
        authEndpoint = `${config.baseUrl}/oauth/v2/auth`;
        // Zoho-specific parameters
        params.append('access_type', 'offline');
        break;

      case 'salesforce':
        authEndpoint = `${config.baseUrl}/services/oauth2/authorize`;
        // Salesforce-specific parameters
        params.append('prompt', 'consent');
        break;

      case 'hubspot':
        authEndpoint = `${config.baseUrl}/oauth/authorize`;
        // HubSpot-specific parameters
        params.append('optional_scope', 'crm.objects.contacts.read crm.objects.contacts.write');
        break;

      case 'agencybloc':
        authEndpoint = `${config.baseUrl}/oauth/authorize`;
        break;

      default:
        throw new CrmError(
          `Unsupported CRM system for OAuth: ${config.system}`,
          'UNSUPPORTED_OAUTH',
          config.system
        );
    }

    return `${authEndpoint}?${params.toString()}`;
  }

  /**
   * Generate secure random state parameter
   */
  private static generateState(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Validate OAuth callback parameters
   */
  static validateCallback(params: {
    code?: string;
    state?: string;
    error?: string;
    error_description?: string;
  }): { isValid: boolean; error?: string } {
    if (params.error) {
      return {
        isValid: false,
        error: `OAuth error: ${params.error} - ${params.error_description || 'Unknown error'}`
      };
    }

    if (!params.code) {
      return {
        isValid: false,
        error: 'Missing authorization code in OAuth callback'
      };
    }

    if (!params.state) {
      return {
        isValid: false,
        error: 'Missing state parameter in OAuth callback'
      };
    }

    const stateData = this.validateState(params.state);
    if (!stateData) {
      return {
        isValid: false,
        error: 'Invalid or expired OAuth state'
      };
    }

    return { isValid: true };
  }

  /**
   * Get system-specific OAuth scopes
   */
  static getDefaultScopes(system: CrmSystem): string[] {
    switch (system) {
      case 'zoho':
        return ['ZohoCRM.modules.ALL', 'ZohoCRM.settings.ALL'];
      
      case 'salesforce':
        return ['api', 'refresh_token', 'offline_access'];
      
      case 'hubspot':
        return ['contacts', 'crm.objects.contacts.read', 'crm.objects.contacts.write'];
      
      case 'agencybloc':
        return ['contacts:read', 'contacts:write'];
      
      default:
        return [];
    }
  }

  /**
   * Get system-specific OAuth endpoints
   */
  static getOAuthEndpoints(system: CrmSystem): { 
    authUrl: string; 
    tokenUrl: string; 
    revokeUrl?: string; 
  } {
    switch (system) {
      case 'zoho':
        return {
          authUrl: 'https://accounts.zoho.com/oauth/v2/auth',
          tokenUrl: 'https://accounts.zoho.com/oauth/v2/token',
          revokeUrl: 'https://accounts.zoho.com/oauth/v2/token/revoke'
        };
      
      case 'salesforce':
        return {
          authUrl: 'https://login.salesforce.com/services/oauth2/authorize',
          tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
          revokeUrl: 'https://login.salesforce.com/services/oauth2/revoke'
        };
      
      case 'hubspot':
        return {
          authUrl: 'https://app.hubspot.com/oauth/authorize',
          tokenUrl: 'https://api.hubapi.com/oauth/v1/token'
        };
      
      case 'agencybloc':
        return {
          authUrl: 'https://api.agencybloc.com/oauth/authorize',
          tokenUrl: 'https://api.agencybloc.com/oauth/token'
        };
      
      default:
        throw new CrmError(
          `Unsupported CRM system: ${system}`,
          'UNSUPPORTED_SYSTEM',
          system
        );
    }
  }

  /**
   * Check if tokens need refresh (within 5 minutes of expiry)
   */
  static needsRefresh(tokens: CrmAuthTokens): boolean {
    if (!tokens.expiresAt) {
      return false; // No expiry info, assume valid
    }

    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
    return tokens.expiresAt <= fiveMinutesFromNow;
  }

  /**
   * Get all pending OAuth states (for debugging)
   */
  static getPendingStates(): OAuthState[] {
    return Array.from(this.pendingStates.values());
  }

  /**
   * Clear all pending states
   */
  static clearAllStates(): void {
    this.pendingStates.clear();
    logger.info('Cleared all pending OAuth states');
  }
}

// Cleanup expired states every 5 minutes (only in production)
let cleanupInterval: NodeJS.Timeout | undefined;

if (process.env.NODE_ENV !== 'test') {
  cleanupInterval = setInterval(() => {
    OAuthService.cleanupExpiredStates();
  }, 5 * 60 * 1000);
}

// Export cleanup function for testing
export const stopOAuthCleanup = () => {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = undefined;
  }
};