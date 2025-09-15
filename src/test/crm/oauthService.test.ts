/**
 * OAuth Service Tests
 * Tests OAuth 2.0 functionality for CRM authentication
 */

import { OAuthService, OAuthState, stopOAuthCleanup } from '../../services/crm/oauthService';
import { CrmConfig } from '../../services/crm/types';

describe('OAuthService', () => {
  let mockConfig: CrmConfig;

  beforeEach(() => {
    mockConfig = {
      system: 'zoho',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'http://localhost:3000/callback',
      scopes: ['read', 'write'],
      baseUrl: 'https://accounts.zoho.com'
    };

    // Clear any existing states
    OAuthService.clearAllStates();
  });

  afterEach(() => {
    OAuthService.clearAllStates();
  });

  afterAll(() => {
    stopOAuthCleanup();
  });

  describe('generateAuthUrl', () => {
    it('should generate valid OAuth URL for Zoho', () => {
      const userId = 'test-user-123';
      const result = OAuthService.generateAuthUrl(mockConfig, userId);

      expect(result.url).toContain('https://accounts.zoho.com/oauth/v2/auth');
      expect(result.url).toContain(`client_id=${mockConfig.clientId}`);
      expect(result.url).toContain(`redirect_uri=${encodeURIComponent(mockConfig.redirectUri)}`);
      expect(result.url).toContain(`state=${result.state}`);
      expect(result.url).toContain('response_type=code');
      expect(result.url).toContain('scope=read+write');
      expect(result.url).toContain('access_type=offline');
      expect(result.state).toHaveLength(64); // 32 bytes = 64 hex chars
    });

    it('should generate valid OAuth URL for Salesforce', () => {
      const salesforceConfig: CrmConfig = {
        ...mockConfig,
        system: 'salesforce',
        baseUrl: 'https://login.salesforce.com'
      };

      const result = OAuthService.generateAuthUrl(salesforceConfig, 'test-user');

      expect(result.url).toContain('https://login.salesforce.com/services/oauth2/authorize');
      expect(result.url).toContain('prompt=consent');
    });

    it('should generate valid OAuth URL for HubSpot', () => {
      const hubspotConfig: CrmConfig = {
        ...mockConfig,
        system: 'hubspot',
        baseUrl: 'https://api.hubapi.com'
      };

      const result = OAuthService.generateAuthUrl(hubspotConfig, 'test-user');

      expect(result.url).toContain('https://api.hubapi.com/oauth/authorize');
      expect(result.url).toContain('optional_scope=crm.objects.contacts.read+crm.objects.contacts.write');
    });

    it('should store state information correctly', () => {
      const userId = 'test-user-123';
      const result = OAuthService.generateAuthUrl(mockConfig, userId);

      const storedState = OAuthService.validateState(result.state);
      
      expect(storedState).not.toBeNull();
      expect(storedState!.crmSystem).toBe('zoho');
      expect(storedState!.userId).toBe(userId);
      expect(storedState!.redirectUri).toBe(mockConfig.redirectUri);
      expect(storedState!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('validateState', () => {
    it('should return null for invalid state', () => {
      const result = OAuthService.validateState('invalid-state');
      expect(result).toBeNull();
    });

    it('should return null for expired state', () => {
      // Generate a state and manually expire it
      const { state } = OAuthService.generateAuthUrl(mockConfig, 'test-user');
      
      // Manually set expiration to past
      const pendingStates = (OAuthService as any).pendingStates;
      const stateData = pendingStates.get(state);
      stateData.expiresAt = new Date(Date.now() - 1000);

      const result = OAuthService.validateState(state);
      expect(result).toBeNull();
    });

    it('should return valid state data for valid state', () => {
      const userId = 'test-user-123';
      const { state } = OAuthService.generateAuthUrl(mockConfig, userId);

      const result = OAuthService.validateState(state);
      
      expect(result).not.toBeNull();
      expect(result!.userId).toBe(userId);
      expect(result!.crmSystem).toBe('zoho');
    });
  });

  describe('completeOAuth', () => {
    it('should remove state after completion', () => {
      const { state } = OAuthService.generateAuthUrl(mockConfig, 'test-user');
      
      // Verify state exists
      expect(OAuthService.validateState(state)).not.toBeNull();
      
      // Complete OAuth
      OAuthService.completeOAuth(state);
      
      // Verify state is removed
      expect(OAuthService.validateState(state)).toBeNull();
    });
  });

  describe('validateCallback', () => {
    it('should return error for OAuth error response', () => {
      const result = OAuthService.validateCallback({
        error: 'access_denied',
        error_description: 'User denied access'
      });

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('access_denied');
      expect(result.error).toContain('User denied access');
    });

    it('should return error for missing code', () => {
      const result = OAuthService.validateCallback({
        state: 'valid-state'
      });

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Missing authorization code');
    });

    it('should return error for missing state', () => {
      const result = OAuthService.validateCallback({
        code: 'auth-code'
      });

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Missing state parameter');
    });

    it('should return error for invalid state', () => {
      const result = OAuthService.validateCallback({
        code: 'auth-code',
        state: 'invalid-state'
      });

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Invalid or expired OAuth state');
    });

    it('should return valid for correct callback', () => {
      const { state } = OAuthService.generateAuthUrl(mockConfig, 'test-user');
      
      const result = OAuthService.validateCallback({
        code: 'auth-code',
        state: state
      });

      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('getDefaultScopes', () => {
    it('should return correct scopes for Zoho', () => {
      const scopes = OAuthService.getDefaultScopes('zoho');
      expect(scopes).toEqual(['ZohoCRM.modules.ALL', 'ZohoCRM.settings.ALL']);
    });

    it('should return correct scopes for Salesforce', () => {
      const scopes = OAuthService.getDefaultScopes('salesforce');
      expect(scopes).toEqual(['api', 'refresh_token', 'offline_access']);
    });

    it('should return correct scopes for HubSpot', () => {
      const scopes = OAuthService.getDefaultScopes('hubspot');
      expect(scopes).toEqual(['contacts', 'crm.objects.contacts.read', 'crm.objects.contacts.write']);
    });

    it('should return correct scopes for AgencyBloc', () => {
      const scopes = OAuthService.getDefaultScopes('agencybloc');
      expect(scopes).toEqual(['contacts:read', 'contacts:write']);
    });
  });

  describe('getOAuthEndpoints', () => {
    it('should return correct endpoints for Zoho', () => {
      const endpoints = OAuthService.getOAuthEndpoints('zoho');
      
      expect(endpoints.authUrl).toBe('https://accounts.zoho.com/oauth/v2/auth');
      expect(endpoints.tokenUrl).toBe('https://accounts.zoho.com/oauth/v2/token');
      expect(endpoints.revokeUrl).toBe('https://accounts.zoho.com/oauth/v2/token/revoke');
    });

    it('should return correct endpoints for Salesforce', () => {
      const endpoints = OAuthService.getOAuthEndpoints('salesforce');
      
      expect(endpoints.authUrl).toBe('https://login.salesforce.com/services/oauth2/authorize');
      expect(endpoints.tokenUrl).toBe('https://login.salesforce.com/services/oauth2/token');
      expect(endpoints.revokeUrl).toBe('https://login.salesforce.com/services/oauth2/revoke');
    });

    it('should return correct endpoints for HubSpot', () => {
      const endpoints = OAuthService.getOAuthEndpoints('hubspot');
      
      expect(endpoints.authUrl).toBe('https://app.hubspot.com/oauth/authorize');
      expect(endpoints.tokenUrl).toBe('https://api.hubapi.com/oauth/v1/token');
      expect(endpoints.revokeUrl).toBeUndefined();
    });

    it('should throw error for unsupported system', () => {
      expect(() => {
        OAuthService.getOAuthEndpoints('unsupported' as any);
      }).toThrow('Unsupported CRM system');
    });
  });

  describe('needsRefresh', () => {
    it('should return false when no expiry date', () => {
      const tokens = {
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenType: 'Bearer'
      } as any;

      expect(OAuthService.needsRefresh(tokens)).toBe(false);
    });

    it('should return true when token expires within 5 minutes', () => {
      const tokens = {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: new Date(Date.now() + 4 * 60 * 1000), // 4 minutes from now
        tokenType: 'Bearer'
      };

      expect(OAuthService.needsRefresh(tokens)).toBe(true);
    });

    it('should return false when token expires after 5 minutes', () => {
      const tokens = {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes from now
        tokenType: 'Bearer'
      };

      expect(OAuthService.needsRefresh(tokens)).toBe(false);
    });
  });

  describe('cleanupExpiredStates', () => {
    it('should remove expired states', () => {
      // Generate some states
      const { state: state1 } = OAuthService.generateAuthUrl(mockConfig, 'user1');
      const { state: state2 } = OAuthService.generateAuthUrl(mockConfig, 'user2');

      // Manually expire one state
      const pendingStates = (OAuthService as any).pendingStates;
      const stateData1 = pendingStates.get(state1);
      stateData1.expiresAt = new Date(Date.now() - 1000);

      // Cleanup
      OAuthService.cleanupExpiredStates();

      // Check results
      expect(OAuthService.validateState(state1)).toBeNull();
      expect(OAuthService.validateState(state2)).not.toBeNull();
    });

    it('should not remove valid states', () => {
      const { state } = OAuthService.generateAuthUrl(mockConfig, 'user');
      
      OAuthService.cleanupExpiredStates();
      
      expect(OAuthService.validateState(state)).not.toBeNull();
    });
  });

  describe('getPendingStates', () => {
    it('should return all pending states', () => {
      OAuthService.generateAuthUrl(mockConfig, 'user1');
      OAuthService.generateAuthUrl(mockConfig, 'user2');

      const states = OAuthService.getPendingStates();
      
      expect(states).toHaveLength(2);
      expect(states[0].userId).toBeDefined();
      expect(states[1].userId).toBeDefined();
    });

    it('should return empty array when no states', () => {
      const states = OAuthService.getPendingStates();
      expect(states).toHaveLength(0);
    });
  });
});