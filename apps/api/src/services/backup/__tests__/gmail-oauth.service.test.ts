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
  const mockRedirectUri = 'http://localhost:8080/api/backup/oauth/gmail/callback';

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
      expect(url).toContain('scope=');
      expect(url).toContain('gmail.readonly');
      expect(url).toContain('gmail.modify');
    });

    it('should include state parameter when provided', () => {
      const state = 'test-state-123';
      const url = oauthService.getAuthorizationUrl(state);
      
      expect(url).toContain(`state=${state}`);
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
        scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify'
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

    it('should throw error when response is not ok', async () => {
      const mockCode = 'invalid-code';
      const mockErrorResponse = {
        error: 'invalid_grant',
        error_description: 'Invalid authorization code'
      };

      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify(mockErrorResponse)
      });

      await expect(oauthService.exchangeCodeForTokens(mockCode)).rejects.toThrow();
    });
  });

  describe('refreshAccessToken', () => {
    it('should refresh access token using refresh token', async () => {
      const mockRefreshToken = 'test-refresh-token';
      const mockResponse = {
        access_token: 'new-access-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify'
      };

      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await oauthService.refreshAccessToken(mockRefreshToken);

      expect(result.accessToken).toBe(mockResponse.access_token);
      expect(result.refreshToken).toBe(mockRefreshToken); // リフレッシュトークンは保持される
      expect(result.expiresIn).toBe(mockResponse.expires_in);
      expect(result.tokenType).toBe(mockResponse.token_type);

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
      const mockErrorResponse = {
        error: 'invalid_grant',
        error_description: 'Token has been expired or revoked'
      };

      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify(mockErrorResponse)
      });

      await expect(oauthService.refreshAccessToken(mockRefreshToken)).rejects.toThrow();
    });
  });
});
