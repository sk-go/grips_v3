import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import axios from 'axios';
import { DatabaseService } from './database';
import { logger } from '../utils/logger';

interface KeycloakUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  isActive: boolean;
}

interface KeycloakTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  user: KeycloakUser;
}

class KeycloakAuthService {
  private static readonly KEYCLOAK_URL = process.env.KEYCLOAK_URL || 'http://localhost:8080';
  private static readonly KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'relationship-care-platform';
  private static readonly KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || 'rcp-client';
  private static readonly KEYCLOAK_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET;

  private static jwksClient = jwksClient({
    jwksUri: `${this.KEYCLOAK_URL}/realms/${this.KEYCLOAK_REALM}/protocol/openid-connect/certs`,
    cache: true,
    cacheMaxAge: 600000, // 10 minutes
    rateLimit: true,
    jwksRequestsPerMinute: 10
  });

  static async getSigningKey(kid: string): Promise<string> {
    const key = await this.jwksClient.getSigningKey(kid);
    return key.getPublicKey();
  }

  static async verifyToken(token: string): Promise<any> {
    try {
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded || !decoded.header.kid) {
        throw new Error('Invalid token structure');
      }

      const signingKey = await this.getSigningKey(decoded.header.kid);
      
      return jwt.verify(token, signingKey, {
        algorithms: ['RS256'],
        issuer: `${this.KEYCLOAK_URL}/realms/${this.KEYCLOAK_REALM}`,
        audience: this.KEYCLOAK_CLIENT_ID
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.warn('Token verification failed', { error: errorMessage });
      throw new Error('Invalid or expired token');
    }
  }

  static async exchangeCodeForTokens(code: string, redirectUri: string): Promise<KeycloakTokens> {
    try {
      const tokenEndpoint = `${this.KEYCLOAK_URL}/realms/${this.KEYCLOAK_REALM}/protocol/openid-connect/token`;
      
      const response = await axios.post(tokenEndpoint, new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.KEYCLOAK_CLIENT_ID,
        client_secret: this.KEYCLOAK_CLIENT_SECRET || '',
        code,
        redirect_uri: redirectUri
      }), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const { access_token, refresh_token, id_token } = response.data;
      
      // Verify and decode the access token to get user info
      const tokenPayload = await this.verifyToken(access_token);
      
      const user: KeycloakUser = {
        id: tokenPayload.sub,
        email: tokenPayload.email,
        firstName: tokenPayload.given_name || '',
        lastName: tokenPayload.family_name || '',
        roles: tokenPayload.realm_access?.roles || [],
        isActive: true
      };

      // Sync user to local database for relationship data
      await this.syncUserToDatabase(user);

      logger.info('User authenticated via Keycloak', { userId: user.id, email: user.email });

      return {
        accessToken: access_token,
        refreshToken: refresh_token,
        idToken: id_token,
        user
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Keycloak token exchange failed', { error: errorMessage });
      throw new Error('Authentication failed');
    }
  }

  static async refreshTokens(refreshToken: string): Promise<KeycloakTokens> {
    try {
      const tokenEndpoint = `${this.KEYCLOAK_URL}/realms/${this.KEYCLOAK_REALM}/protocol/openid-connect/token`;
      
      const response = await axios.post(tokenEndpoint, new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.KEYCLOAK_CLIENT_ID,
        client_secret: this.KEYCLOAK_CLIENT_SECRET || '',
        refresh_token: refreshToken
      }), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const { access_token, refresh_token: new_refresh_token, id_token } = response.data;
      
      const tokenPayload = await this.verifyToken(access_token);
      
      const user: KeycloakUser = {
        id: tokenPayload.sub,
        email: tokenPayload.email,
        firstName: tokenPayload.given_name || '',
        lastName: tokenPayload.family_name || '',
        roles: tokenPayload.realm_access?.roles || [],
        isActive: true
      };

      await this.syncUserToDatabase(user);

      return {
        accessToken: access_token,
        refreshToken: new_refresh_token,
        idToken: id_token,
        user
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Keycloak token refresh failed', { error: errorMessage });
      throw new Error('Token refresh failed');
    }
  }

  static async logout(refreshToken: string): Promise<void> {
    try {
      const logoutEndpoint = `${this.KEYCLOAK_URL}/realms/${this.KEYCLOAK_REALM}/protocol/openid-connect/logout`;
      
      await axios.post(logoutEndpoint, new URLSearchParams({
        client_id: this.KEYCLOAK_CLIENT_ID,
        client_secret: this.KEYCLOAK_CLIENT_SECRET || '',
        refresh_token: refreshToken
      }), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      logger.info('User logged out from Keycloak');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.warn('Keycloak logout failed', { error: errorMessage });
      // Don't throw - logout should succeed even if Keycloak call fails
    }
  }

  private static async syncUserToDatabase(user: KeycloakUser): Promise<void> {
    try {
      // Map Keycloak roles to local roles
      const localRole = user.roles.includes('admin') ? 'admin' : 'agent';
      
      await DatabaseService.query(`
        INSERT INTO users (id, email, first_name, last_name, role, is_active, keycloak_id)
        VALUES ($1, $2, $3, $4, $5, $6, $1)
        ON CONFLICT (keycloak_id) 
        DO UPDATE SET 
          email = EXCLUDED.email,
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          role = EXCLUDED.role,
          is_active = EXCLUDED.is_active,
          updated_at = CURRENT_TIMESTAMP
      `, [user.id, user.email, user.firstName, user.lastName, localRole, user.isActive]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to sync user to database', { error: errorMessage, userId: user.id });
      // Don't throw - auth should succeed even if local sync fails
    }
  }

  static getAuthUrl(redirectUri: string, state?: string): string {
    const authEndpoint = `${this.KEYCLOAK_URL}/realms/${this.KEYCLOAK_REALM}/protocol/openid-connect/auth`;
    const params = new URLSearchParams({
      client_id: this.KEYCLOAK_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile'
    });

    if (state) {
      params.append('state', state);
    }

    return `${authEndpoint}?${params.toString()}`;
  }
}

export { KeycloakAuthService, KeycloakUser, KeycloakTokens };