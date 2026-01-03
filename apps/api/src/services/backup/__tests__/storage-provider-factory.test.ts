import { describe, expect, it, vi, beforeEach } from 'vitest';
import { StorageProviderFactory, StorageProviderOptions } from '../storage-provider-factory.js';
import { LocalStorageProvider } from '../storage/local-storage.provider.js';
import { DropboxStorageProvider } from '../storage/dropbox-storage.provider.js';
import { GmailStorageProvider } from '../storage/gmail-storage.provider.js';
import { OAuth2Client } from 'google-auth-library';

// GmailStorageProviderをモック
vi.mock('../storage/gmail-storage.provider.js', () => {
  return {
    GmailStorageProvider: vi.fn()
  };
});

describe('StorageProviderFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create LocalStorageProvider', () => {
      const options: StorageProviderOptions = {
        provider: 'local',
        basePath: '/test-backups'
      };

      const provider = StorageProviderFactory.create(options);

      expect(provider).toBeInstanceOf(LocalStorageProvider);
    });

    it('should create DropboxStorageProvider', () => {
      const options: StorageProviderOptions = {
        provider: 'dropbox',
        accessToken: 'test-access-token',
        basePath: '/test-backups'
      };

      const provider = StorageProviderFactory.create(options);

      expect(provider).toBeInstanceOf(DropboxStorageProvider);
    });

    it('should create GmailStorageProvider', () => {
      const mockOAuth2Client = {
        setCredentials: vi.fn()
      } as unknown as OAuth2Client;

      const options: StorageProviderOptions = {
        provider: 'gmail',
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        subjectPattern: 'CSV Import',
        fromEmail: 'sender@example.com',
        oauth2Client: mockOAuth2Client
      };

      const provider = StorageProviderFactory.create(options);

      expect(GmailStorageProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          oauth2Client: mockOAuth2Client,
          accessToken: 'test-access-token',
          refreshToken: 'test-refresh-token',
          subjectPattern: 'CSV Import',
          fromEmail: 'sender@example.com',
          onTokenUpdate: undefined
        })
      );
      // oauthServiceはrefreshTokenとclientId/clientSecretがある場合に作成される
      const callArgs = (GmailStorageProvider as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.oauthService).toBeDefined();
      expect(callArgs.oauthService?.clientId).toBe('test-client-id');
      expect(callArgs.oauthService?.clientSecret).toBe('test-client-secret');
      expect(provider).toBeDefined();
    });

    it('should throw error for unknown provider', () => {
      const options = {
        provider: 'unknown' as 'local'
      };

      expect(() => StorageProviderFactory.create(options as StorageProviderOptions)).toThrow(
        'Unknown storage provider'
      );
    });

    it('should throw error when Gmail OAuth2Client is missing', () => {
      const options: StorageProviderOptions = {
        provider: 'gmail',
        accessToken: 'test-access-token'
      };

      expect(() => StorageProviderFactory.create(options)).toThrow(
        'OAuth2Client is required for Gmail storage provider'
      );
    });

    it('should throw error when Gmail accessToken is missing', () => {
      const mockOAuth2Client = {
        setCredentials: vi.fn()
      } as unknown as OAuth2Client;

      const options: StorageProviderOptions = {
        provider: 'gmail',
        oauth2Client: mockOAuth2Client
      };

      expect(() => StorageProviderFactory.create(options)).toThrow(
        'Gmail access token is required'
      );
    });
  });

  describe('getRegisteredProviders', () => {
    it('should return all registered providers', () => {
      const providers = StorageProviderFactory.getRegisteredProviders();

      expect(providers).toContain('local');
      expect(providers).toContain('dropbox');
      expect(providers).toContain('gmail');
      expect(providers.length).toBe(3);
    });
  });
});

