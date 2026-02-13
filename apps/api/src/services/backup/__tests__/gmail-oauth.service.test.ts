import { describe, expect, it, vi, beforeEach } from 'vitest';
import fetch from 'node-fetch';
import { GmailOAuthService } from '../gmail-oauth.service.js';

// node-fetchをモック
vi.mock('node-fetch', () => ({
  default: vi.fn()
}));

describe('GmailOAuthService', () => {
  const mockClientId = 'test-client-id';
  const mockClientSecret = 'test-client-secret';
  const mockRedirectUri = 'http://localhost:8080/api/gmail/oauth/callback';

  let oauthService: GmailOAuthService;

  beforeEach(() => {
    oauthService = new GmailOAuthService({
      clientId: mockClientId,
      clientSecret: mockClientSecret,
      redirectUri: mockRedirectUri
    });
    vi.clearAllMocks();
  });

  describe('getAuthorizationUrl', () => {
    it('should generate authorization URL with required parameters', () => {
      const url = oauthService.getAuthorizationUrl();
      
      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url).toContain(`client_id=${mockClientId}`);
      expect(url).toContain('response_type=code');
      expect(url).toContain('access_type=offline');
      expect(url).toContain('prompt=consent');
      expect(url).toContain(`redirect_uri=${encodeURIComponent(mockRedirectUri)}`);
      expect(url).toContain('scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.readonly');
      expect(url).toContain(encodeURIComponent('https://mail.google.com/'));
    });

    it('should include state parameter when provided', () => {
      const state = 'test-state-123';
      const url = oauthService.getAuthorizationUrl(state);
      
      expect(url).toContain(`state=${state}`);
    });

    it('should use custom scopes when provided', () => {
      const customScopes = [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify'
      ];
      const customOAuthService = new GmailOAuthService({
        clientId: mockClientId,
        clientSecret: mockClientSecret,
        redirectUri: mockRedirectUri,
        scopes: customScopes
      });
      
      const url = customOAuthService.getAuthorizationUrl();
      // URLSearchParamsはスペースを+にエンコードする
      const expectedScope = customScopes.map(s => encodeURIComponent(s)).join('+');
      expect(url).toContain(`scope=${expectedScope}`);
    });

    it('should throw error when redirectUri is not provided', () => {
      const serviceWithoutRedirect = new GmailOAuthService({
        clientId: mockClientId,
        clientSecret: mockClientSecret
      });
      
      expect(() => serviceWithoutRedirect.getAuthorizationUrl()).toThrow(
        'redirectUri is required to generate Gmail authorization URL'
      );
    });
  });

  describe('exchangeCodeForTokens', () => {
    it('should exchange authorization code for tokens', async () => {
      const mockCode = 'test-auth-code';
      const mockResponse = {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'https://www.googleapis.com/auth/gmail.readonly'
      };

      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await oauthService.exchangeCodeForTokens(mockCode);

      expect(result.accessToken).toBe(mockResponse.access_token);
      expect(result.refreshToken).toBe(mockResponse.refresh_token);
      expect(result.expiresIn).toBe(mockResponse.expires_in);
      expect(result.tokenType).toBe(mockResponse.token_type);
      expect(result.scope).toBe(mockResponse.scope);

      // fetchが正しいパラメータで呼ばれたことを確認
      expect(fetch).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/token',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: expect.stringContaining(`code=${mockCode}`)
        })
      );
    });

    it('should throw error when exchange fails', async () => {
      const mockCode = 'invalid-code';

      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Invalid authorization code'
      });

      await expect(oauthService.exchangeCodeForTokens(mockCode)).rejects.toThrow(
        'Failed to exchange code for tokens'
      );
    });

    it('should throw error when redirectUri is not provided', async () => {
      const serviceWithoutRedirect = new GmailOAuthService({
        clientId: mockClientId,
        clientSecret: mockClientSecret
      });
      
      await expect(serviceWithoutRedirect.exchangeCodeForTokens('test-code')).rejects.toThrow(
        'redirectUri is required to exchange Gmail auth code for tokens'
      );
    });
  });

  describe('refreshAccessToken', () => {
    it('should refresh access token using refresh token', async () => {
      const mockRefreshToken = 'test-refresh-token';
      const mockResponse = {
        access_token: 'refreshed-access-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'https://www.googleapis.com/auth/gmail.readonly'
      };

      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await oauthService.refreshAccessToken(mockRefreshToken);

      expect(result.accessToken).toBe(mockResponse.access_token);
      expect(result.expiresIn).toBe(mockResponse.expires_in);
      expect(result.tokenType).toBe(mockResponse.token_type);
      expect(result.scope).toBe(mockResponse.scope);
      expect(result.refreshToken).toBe(mockRefreshToken); // リフレッシュトークンは保持される

      // fetchが正しいパラメータで呼ばれたことを確認
      expect(fetch).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/token',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: expect.stringContaining(`refresh_token=${mockRefreshToken}`)
        })
      );
    });

    it('should throw error when refresh fails', async () => {
      const mockRefreshToken = 'invalid-refresh-token';

      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Invalid refresh token'
      });

      await expect(oauthService.refreshAccessToken(mockRefreshToken)).rejects.toThrow(
        'Failed to refresh access token'
      );
    });
  });
});

