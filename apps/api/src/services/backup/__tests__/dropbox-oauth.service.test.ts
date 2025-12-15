import { describe, expect, it, vi, beforeEach } from 'vitest';
import fetch from 'node-fetch';
import { DropboxOAuthService } from '../dropbox-oauth.service.js';

// node-fetchをモック
vi.mock('node-fetch', () => ({
  default: vi.fn()
}));

describe('DropboxOAuthService', () => {
  const mockAppKey = 'test-app-key';
  const mockAppSecret = 'test-app-secret';
  const mockRedirectUri = 'http://localhost:8080/api/backup/oauth/callback';

  let oauthService: DropboxOAuthService;

  beforeEach(() => {
    oauthService = new DropboxOAuthService({
      appKey: mockAppKey,
      appSecret: mockAppSecret,
      redirectUri: mockRedirectUri
    });
    vi.clearAllMocks();
  });

  describe('getAuthorizationUrl', () => {
    it('should generate authorization URL with required parameters', () => {
      const url = oauthService.getAuthorizationUrl();
      
      expect(url).toContain('https://www.dropbox.com/oauth2/authorize');
      expect(url).toContain(`client_id=${mockAppKey}`);
      expect(url).toContain('response_type=code');
      expect(url).toContain('token_access_type=offline');
      expect(url).toContain(`redirect_uri=${encodeURIComponent(mockRedirectUri)}`);
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
        expires_in: 14400,
        token_type: 'bearer',
        account_id: 'test-account-id',
        uid: 'test-uid'
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
      expect(result.accountId).toBe(mockResponse.account_id);
      expect(result.uid).toBe(mockResponse.uid);

      // fetchが正しいパラメータで呼ばれたことを確認
      expect(fetch).toHaveBeenCalledWith(
        'https://api.dropbox.com/oauth2/token',
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
  });

  describe('refreshAccessToken', () => {
    it('should refresh access token using refresh token', async () => {
      const mockRefreshToken = 'test-refresh-token';
      const mockResponse = {
        access_token: 'refreshed-access-token',
        expires_in: 14400,
        token_type: 'bearer'
      };

      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await oauthService.refreshAccessToken(mockRefreshToken);

      expect(result.accessToken).toBe(mockResponse.access_token);
      expect(result.expiresIn).toBe(mockResponse.expires_in);
      expect(result.tokenType).toBe(mockResponse.token_type);
      expect(result.refreshToken).toBe(mockRefreshToken); // リフレッシュトークンは保持される

      // fetchが正しいパラメータで呼ばれたことを確認
      expect(fetch).toHaveBeenCalledWith(
        'https://api.dropbox.com/oauth2/token',
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
