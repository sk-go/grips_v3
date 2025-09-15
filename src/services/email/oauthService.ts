import { AuthorizationCode } from 'simple-oauth2';
import { OAuthConfig } from '../../types/email';
import { logger } from '../../utils/logger';

export class EmailOAuthService {
  private clients: Map<string, AuthorizationCode> = new Map();

  constructor(private config: Record<string, OAuthConfig>) {
    this.initializeClients();
  }

  private initializeClients(): void {
    Object.entries(this.config).forEach(([provider, config]) => {
      try {
        const client = new AuthorizationCode({
          client: {
            id: config.clientId,
            secret: config.clientSecret,
          },
          auth: {
            tokenHost: this.getTokenHost(provider),
            tokenPath: this.getTokenPath(provider),
            authorizePath: this.getAuthorizePath(provider),
          },
        });

        this.clients.set(provider, client);
        logger.info(`OAuth client initialized for ${provider}`);
      } catch (error) {
        logger.error(`Failed to initialize OAuth client for ${provider}:`, error);
      }
    });
  }

  private getTokenHost(provider: string): string {
    switch (provider) {
      case 'gmail':
        return 'https://oauth2.googleapis.com';
      case 'outlook':
        return 'https://login.microsoftonline.com';
      case 'exchange':
        return 'https://login.microsoftonline.com';
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  private getTokenPath(provider: string): string {
    switch (provider) {
      case 'gmail':
        return '/token';
      case 'outlook':
      case 'exchange':
        return '/common/oauth2/v2.0/token';
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  private getAuthorizePath(provider: string): string {
    switch (provider) {
      case 'gmail':
        return '/auth';
      case 'outlook':
      case 'exchange':
        return '/common/oauth2/v2.0/authorize';
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  public getAuthorizationUrl(provider: string, state?: string): string {
    const client = this.clients.get(provider);
    if (!client) {
      throw new Error(`OAuth client not found for provider: ${provider}`);
    }

    const config = this.config[provider];
    const authorizationUri = client.authorizeURL({
      redirect_uri: config.redirectUri,
      scope: config.scopes.join(' '),
      state: state || Math.random().toString(36).substring(7),
      prompt: 'consent',
    } as any);

    return authorizationUri;
  }

  public async exchangeCodeForTokens(
    provider: string,
    code: string,
    state?: string
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  }> {
    const client = this.clients.get(provider);
    if (!client) {
      throw new Error(`OAuth client not found for provider: ${provider}`);
    }

    try {
      const config = this.config[provider];
      const tokenParams = {
        code,
        redirect_uri: config.redirectUri,
        scope: config.scopes.join(' '),
      };

      const accessToken = await client.getToken(tokenParams);
      const token = accessToken.token;

      return {
        accessToken: token.access_token as string,
        refreshToken: token.refresh_token as string,
        expiresAt: new Date(Date.now() + (token.expires_in as number) * 1000),
      };
    } catch (error) {
      logger.error(`Failed to exchange code for tokens (${provider}):`, error);
      throw new Error(`OAuth token exchange failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  public async refreshAccessToken(
    provider: string,
    refreshToken: string
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt: Date;
  }> {
    const client = this.clients.get(provider);
    if (!client) {
      throw new Error(`OAuth client not found for provider: ${provider}`);
    }

    try {
      const accessToken = client.createToken({
        refresh_token: refreshToken,
      });

      const newToken = await accessToken.refresh();
      const token = newToken.token;

      return {
        accessToken: token.access_token as string,
        refreshToken: token.refresh_token as string || refreshToken,
        expiresAt: new Date(Date.now() + (token.expires_in as number) * 1000),
      };
    } catch (error) {
      logger.error(`Failed to refresh access token (${provider}):`, error);
      throw new Error(`Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  public async validateToken(provider: string, accessToken: string): Promise<boolean> {
    try {
      // Make a simple API call to validate the token
      const response = await fetch(this.getValidationUrl(provider), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      return response.ok;
    } catch (error) {
      logger.error(`Token validation failed (${provider}):`, error);
      return false;
    }
  }

  private getValidationUrl(provider: string): string {
    switch (provider) {
      case 'gmail':
        return 'https://www.googleapis.com/oauth2/v1/tokeninfo';
      case 'outlook':
      case 'exchange':
        return 'https://graph.microsoft.com/v1.0/me';
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }
}