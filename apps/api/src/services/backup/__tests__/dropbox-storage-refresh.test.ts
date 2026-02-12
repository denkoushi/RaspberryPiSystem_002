import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Dropbox } from 'dropbox';
import { DropboxStorageProvider } from '../storage/dropbox-storage.provider.js';
import { DropboxOAuthService } from '../dropbox-oauth.service.js';

// Dropbox SDKをモック
vi.mock('dropbox', () => ({
  Dropbox: vi.fn()
}));

describe('DropboxStorageProvider - Refresh Token Auto-Refresh', () => {
  const mockAccessToken = 'initial-access-token';
  const mockRefreshToken = 'test-refresh-token';
  const mockAppKey = 'test-app-key';
  const mockAppSecret = 'test-app-secret';
  const mockRedirectUri = 'http://localhost:8080/api/backup/oauth/callback';

  let mockDbx: {
    filesUpload: ReturnType<typeof vi.fn>;
    filesDownload: ReturnType<typeof vi.fn>;
    filesDeleteV2: ReturnType<typeof vi.fn>;
    filesListFolder: ReturnType<typeof vi.fn>;
  };
  let mockOAuthService: DropboxOAuthService;
  let onTokenUpdate: ReturnType<typeof vi.fn>;
  let storageProvider: DropboxStorageProvider;

  beforeEach(() => {
    // Dropbox SDKのモック
    mockDbx = {
      filesUpload: vi.fn(),
      filesDownload: vi.fn(),
      filesDeleteV2: vi.fn(),
      filesListFolder: vi.fn()
    };

    (Dropbox as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockDbx);

    // OAuthサービスのモック
    mockOAuthService = {
      refreshAccessToken: vi.fn()
    } as unknown as DropboxOAuthService;

    // トークン更新コールバックのモック
    onTokenUpdate = vi.fn().mockResolvedValue(undefined);

    storageProvider = new DropboxStorageProvider({
      accessToken: mockAccessToken,
      refreshToken: mockRefreshToken,
      oauthService: mockOAuthService,
      onTokenUpdate
    });

    vi.clearAllMocks();
  });

  describe('automatic token refresh on 401 error', () => {
    it('should automatically refresh token when upload fails with 401 error', async () => {
      const mockRefreshedToken = 'refreshed-access-token';
      const mockFile = Buffer.from('test-file-content');
      const mockPath = 'test/path.txt';

      // 最初の呼び出しで401エラーを返す
      mockDbx.filesUpload
        .mockRejectedValueOnce({
          status: 401,
          error: {
            error: {
              '.tag': 'expired_access_token'
            }
          }
        })
        // リフレッシュ後の呼び出しで成功
        .mockResolvedValueOnce(undefined);

      // リフレッシュトークンで新しいアクセストークンを取得
      vi.mocked(mockOAuthService.refreshAccessToken).mockResolvedValue({
        accessToken: mockRefreshedToken,
        refreshToken: mockRefreshToken,
        expiresIn: 14400,
        tokenType: 'bearer'
      });

      // リフレッシュ後にDropboxインスタンスが再作成されることをモック
      (Dropbox as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => mockDbx);

      await storageProvider.upload(mockFile, mockPath);

      // リフレッシュトークンが呼ばれたことを確認
      expect(mockOAuthService.refreshAccessToken).toHaveBeenCalledWith(mockRefreshToken);
      
      // トークン更新コールバックが呼ばれたことを確認
      expect(onTokenUpdate).toHaveBeenCalledWith(mockRefreshedToken);
      
      // アップロードが2回呼ばれたことを確認（1回目: 401エラー、2回目: 成功）
      expect(mockDbx.filesUpload).toHaveBeenCalledTimes(2);
    });

    it('should automatically refresh token when download fails with 401 error', async () => {
      const mockRefreshedToken = 'refreshed-access-token';
      const mockPath = 'test/path.txt';
      const mockFileBinary = Buffer.from('test-file-content');

      // 最初の呼び出しで401エラーを返す
      mockDbx.filesDownload
        .mockRejectedValueOnce({
          status: 401,
          error: {
            error: {
              '.tag': 'expired_access_token'
            }
          }
        })
        // リフレッシュ後の呼び出しで成功
        .mockResolvedValueOnce({
          fileBinary: mockFileBinary
        });

      // リフレッシュトークンで新しいアクセストークンを取得
      vi.mocked(mockOAuthService.refreshAccessToken).mockResolvedValue({
        accessToken: mockRefreshedToken,
        refreshToken: mockRefreshToken,
        expiresIn: 14400,
        tokenType: 'bearer'
      });

      // リフレッシュ後にDropboxインスタンスが再作成されることをモック
      (Dropbox as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => mockDbx);

      const result = await storageProvider.download(mockPath);

      // リフレッシュトークンが呼ばれたことを確認
      expect(mockOAuthService.refreshAccessToken).toHaveBeenCalledWith(mockRefreshToken);
      
      // トークン更新コールバックが呼ばれたことを確認
      expect(onTokenUpdate).toHaveBeenCalledWith(mockRefreshedToken);
      
      // ダウンロードが2回呼ばれたことを確認（1回目: 401エラー、2回目: 成功）
      expect(mockDbx.filesDownload).toHaveBeenCalledTimes(2);
      
      // 結果が正しいことを確認
      expect(result).toEqual(mockFileBinary);
    });

    it('should not refresh token when refresh token is not provided', async () => {
      // リフレッシュトークンなしでストレージプロバイダーを作成
      const providerWithoutRefresh = new DropboxStorageProvider({
        accessToken: mockAccessToken
      });

      const mockFile = Buffer.from('test-file-content');
      const mockPath = 'test/path.txt';

      // 401エラーを返す（リトライロジックを考慮して複数回エラーを返す）
      const error401 = {
        status: 401,
        error: {
          error: {
            '.tag': 'expired_access_token'
          }
        }
      };
      
      // 最大リトライ回数（5回）分エラーを返す
      for (let i = 0; i < 5; i++) {
        mockDbx.filesUpload.mockRejectedValueOnce(error401);
      }

      // リフレッシュされずにエラーが再スローされることを確認
      await expect(providerWithoutRefresh.upload(mockFile, mockPath)).rejects.toMatchObject({
        status: 401
      });
    });

    it('should not refresh token for non-401 errors', async () => {
      const mockFile = Buffer.from('test-file-content');
      const mockPath = 'test/path.txt';

      // 500エラー（サーバーエラー）を返す
      // 実装では、429エラー以外はリトライされずに即座にエラーがスローされる
      const error500 = {
        status: 500,
        error: {
          error: {
            '.tag': 'internal_error'
          }
        }
      };
      
      // 1回だけエラーを返す（リトライされない）
      mockDbx.filesUpload.mockRejectedValueOnce(error500);

      // リフレッシュされずにエラーが再スローされることを確認
      await expect(storageProvider.upload(mockFile, mockPath)).rejects.toMatchObject({
        status: 500
      });

      // リフレッシュトークンが呼ばれていないことを確認
      expect(mockOAuthService.refreshAccessToken).not.toHaveBeenCalled();
    });

    it('should read fileBinary from response.result.fileBinary', async () => {
      const mockPath = 'test/path.txt';
      const nestedFileBinary = Buffer.from('nested-binary');

      mockDbx.filesDownload.mockResolvedValueOnce({
        result: {
          fileBinary: nestedFileBinary,
        }
      });

      const result = await storageProvider.download(mockPath);
      expect(result.equals(nestedFileBinary)).toBe(true);
    });

    it('should convert ArrayBuffer fileBinary to Buffer', async () => {
      const mockPath = 'test/path.txt';
      const src = Uint8Array.from([65, 66, 67]).buffer; // "ABC"

      mockDbx.filesDownload.mockResolvedValueOnce({
        fileBinary: src,
      });

      const result = await storageProvider.download(mockPath);
      expect(result.toString()).toBe('ABC');
    });

    it('should refresh token when malformed token error is returned as 400', async () => {
      const mockRefreshedToken = 'refreshed-access-token';
      const mockPath = 'test/path.txt';
      const mockFileBinary = Buffer.from('after-refresh');

      mockDbx.filesDownload
        .mockRejectedValueOnce({
          status: 400,
          message: 'Malformed access token',
          error: 'malformed token'
        })
        .mockResolvedValueOnce({
          fileBinary: mockFileBinary
        });

      vi.mocked(mockOAuthService.refreshAccessToken).mockResolvedValue({
        accessToken: mockRefreshedToken,
        refreshToken: mockRefreshToken,
        expiresIn: 14400,
        tokenType: 'bearer'
      });

      (Dropbox as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => mockDbx);

      const result = await storageProvider.download(mockPath);
      expect(result.equals(mockFileBinary)).toBe(true);
      expect(mockOAuthService.refreshAccessToken).toHaveBeenCalledWith(mockRefreshToken);
      expect(onTokenUpdate).toHaveBeenCalledWith(mockRefreshedToken);
    });
  });
});
