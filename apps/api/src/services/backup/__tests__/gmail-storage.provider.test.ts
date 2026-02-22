import { describe, expect, it, vi, beforeEach } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import { GmailStorageProvider } from '../storage/gmail-storage.provider.js';
import { GmailApiClient } from '../gmail-api-client.js';
import { GmailOAuthService } from '../gmail-oauth.service.js';

// GmailApiClientをモック
vi.mock('../gmail-api-client.js', () => {
  return {
    GmailApiClient: vi.fn()
  };
});

describe('GmailStorageProvider', () => {
  let oauth2Client: OAuth2Client;
  let mockGmailApiClient: any;
  let mockOAuthService: GmailOAuthService;
  let onTokenUpdate: (token: string) => Promise<void>;

  beforeEach(() => {
    oauth2Client = {
      setCredentials: vi.fn(),
      getAccessToken: vi.fn()
    } as unknown as OAuth2Client;

    mockGmailApiClient = {
      searchMessages: vi.fn(),
      searchMessagesLimited: vi.fn(),
      getMessage: vi.fn(),
      getFirstAttachment: vi.fn(),
      archiveMessage: vi.fn()
    };

    (GmailApiClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockGmailApiClient);

    mockOAuthService = {
      refreshAccessToken: vi.fn()
    } as unknown as GmailOAuthService;

    onTokenUpdate = vi.fn().mockResolvedValue(undefined);

    vi.clearAllMocks();
  });

  describe('download', () => {
    it('should download file from Gmail using subject pattern', async () => {
      const provider = new GmailStorageProvider({
        oauth2Client,
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        subjectPattern: 'CSV Import',
        oauthService: mockOAuthService,
        onTokenUpdate
      });

      const mockMessageIds = ['msg1'];
      const mockAttachment = {
        buffer: Buffer.from('test csv data'),
        filename: 'employees.csv'
      };

      mockGmailApiClient.searchMessages.mockResolvedValueOnce(mockMessageIds);
      mockGmailApiClient.getFirstAttachment.mockResolvedValueOnce(mockAttachment);
      mockGmailApiClient.archiveMessage.mockResolvedValueOnce(undefined);

      const result = await provider.download('CSV Import');

      expect(result).toBeInstanceOf(Buffer);
      expect(result.toString()).toBe('test csv data');
      expect(mockGmailApiClient.searchMessages).toHaveBeenCalledWith(
        expect.stringContaining('subject:"CSV Import"')
      );
      expect(mockGmailApiClient.getFirstAttachment).toHaveBeenCalledWith('msg1');
      expect(mockGmailApiClient.archiveMessage).toHaveBeenCalledWith('msg1');
    });

    it('should use path parameter as subject pattern when provided', async () => {
      const provider = new GmailStorageProvider({
        oauth2Client,
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        oauthService: mockOAuthService,
        onTokenUpdate
      });

      const mockMessageIds = ['msg1'];
      const mockAttachment = {
        buffer: Buffer.from('test data'),
        filename: 'test.csv'
      };

      mockGmailApiClient.searchMessages.mockResolvedValueOnce(mockMessageIds);
      mockGmailApiClient.getFirstAttachment.mockResolvedValueOnce(mockAttachment);
      mockGmailApiClient.archiveMessage.mockResolvedValueOnce(undefined);

      await provider.download('Employees CSV');

      expect(mockGmailApiClient.searchMessages).toHaveBeenCalledWith(
        expect.stringContaining('subject:"Employees CSV"')
      );
    });

    it('should include fromEmail in search query when provided', async () => {
      const provider = new GmailStorageProvider({
        oauth2Client,
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        subjectPattern: 'CSV Import',
        fromEmail: 'sender@example.com',
        oauthService: mockOAuthService,
        onTokenUpdate
      });

      const mockMessageIds = ['msg1'];
      const mockAttachment = {
        buffer: Buffer.from('test data'),
        filename: 'test.csv'
      };

      mockGmailApiClient.searchMessages.mockResolvedValueOnce(mockMessageIds);
      mockGmailApiClient.getFirstAttachment.mockResolvedValueOnce(mockAttachment);
      mockGmailApiClient.archiveMessage.mockResolvedValueOnce(undefined);

      await provider.download('CSV Import');

      expect(mockGmailApiClient.searchMessages).toHaveBeenCalledWith(
        expect.stringContaining('from:sender@example.com')
      );
    });

    it('should throw error when no messages found', async () => {
      const provider = new GmailStorageProvider({
        oauth2Client,
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        oauthService: mockOAuthService,
        onTokenUpdate
      });

      mockGmailApiClient.searchMessages.mockResolvedValueOnce([]);

      await expect(provider.download('NonExistent')).rejects.toThrow(
        'No messages found matching query'
      );
    });

    it('should throw error when no attachment found', async () => {
      const provider = new GmailStorageProvider({
        oauth2Client,
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        oauthService: mockOAuthService,
        onTokenUpdate
      });

      const mockMessageIds = ['msg1'];

      mockGmailApiClient.searchMessages.mockResolvedValueOnce(mockMessageIds);
      mockGmailApiClient.getFirstAttachment.mockResolvedValueOnce(null);

      await expect(provider.download('CSV Import')).rejects.toThrow(
        'No attachment found in message'
      );
    });

    it('should refresh token and retry on 401 error', async () => {
      const provider = new GmailStorageProvider({
        oauth2Client,
        accessToken: 'expired-token',
        refreshToken: 'test-refresh-token',
        oauthService: mockOAuthService,
        onTokenUpdate
      });

      const mockMessageIds = ['msg1'];
      const mockAttachment = {
        buffer: Buffer.from('test data'),
        filename: 'test.csv'
      };

      // 最初の呼び出しで401エラー
      const authError = new Error('Unauthorized');
      (authError as any).status = 401;
      mockGmailApiClient.searchMessages.mockRejectedValueOnce(authError);

      // トークンリフレッシュ
      mockOAuthService.refreshAccessToken = vi.fn().mockResolvedValueOnce({
        accessToken: 'new-access-token',
        refreshToken: 'test-refresh-token',
        expiresIn: 3600,
        tokenType: 'Bearer'
      });

      // リトライ後に成功
      mockGmailApiClient.searchMessages.mockResolvedValueOnce(mockMessageIds);
      mockGmailApiClient.getFirstAttachment.mockResolvedValueOnce(mockAttachment);
      mockGmailApiClient.archiveMessage.mockResolvedValueOnce(undefined);

      const result = await provider.download('CSV Import');

      expect(result).toBeInstanceOf(Buffer);
      expect(mockOAuthService.refreshAccessToken).toHaveBeenCalledWith('test-refresh-token');
      expect(onTokenUpdate).toHaveBeenCalledWith('new-access-token');
    });

    it('should continue even if archive fails', async () => {
      const provider = new GmailStorageProvider({
        oauth2Client,
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        oauthService: mockOAuthService,
        onTokenUpdate
      });

      const mockMessageIds = ['msg1'];
      const mockAttachment = {
        buffer: Buffer.from('test data'),
        filename: 'test.csv'
      };

      mockGmailApiClient.searchMessages.mockResolvedValueOnce(mockMessageIds);
      mockGmailApiClient.getFirstAttachment.mockResolvedValueOnce(mockAttachment);
      mockGmailApiClient.archiveMessage.mockRejectedValueOnce(new Error('Archive failed'));

      const result = await provider.download('CSV Import');

      expect(result).toBeInstanceOf(Buffer);
      expect(result.toString()).toBe('test data');
    });
  });

  describe('list', () => {
    it('should list messages as FileInfo array', async () => {
      const provider = new GmailStorageProvider({
        oauth2Client,
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        oauthService: mockOAuthService,
        onTokenUpdate
      });

      const mockMessageIds = ['msg1', 'msg2'];
      const mockMessage1 = {
        id: 'msg1',
        threadId: 'thread1',
        labelIds: ['INBOX'],
        snippet: 'Test message 1',
        payload: {
          headers: [
            { name: 'Subject', value: 'CSV Import 1' },
            { name: 'Date', value: 'Mon, 29 Dec 2025 12:00:00 +0900' }
          ]
        }
      };
      const mockMessage2 = {
        id: 'msg2',
        threadId: 'thread2',
        labelIds: ['INBOX'],
        snippet: 'Test message 2',
        payload: {
          headers: [
            { name: 'Subject', value: 'CSV Import 2' },
            { name: 'Date', value: 'Mon, 29 Dec 2025 13:00:00 +0900' }
          ]
        }
      };

      mockGmailApiClient.searchMessages.mockResolvedValueOnce(mockMessageIds);
      mockGmailApiClient.getMessage.mockResolvedValueOnce(mockMessage1);
      mockGmailApiClient.getMessage.mockResolvedValueOnce(mockMessage2);

      const result = await provider.list('CSV Import');

      expect(result).toHaveLength(2);
      expect(result[0].path).toBe('CSV Import 1');
      expect(result[1].path).toBe('CSV Import 2');
      expect(result[0].modifiedAt).toBeInstanceOf(Date);
    });

    it('should handle message get errors gracefully', async () => {
      const provider = new GmailStorageProvider({
        oauth2Client,
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        oauthService: mockOAuthService,
        onTokenUpdate
      });

      const mockMessageIds = ['msg1', 'msg2'];
      const mockMessage1 = {
        id: 'msg1',
        threadId: 'thread1',
        labelIds: ['INBOX'],
        snippet: 'Test message 1',
        payload: {
          headers: [
            { name: 'Subject', value: 'CSV Import 1' }
          ]
        }
      };

      mockGmailApiClient.searchMessages.mockResolvedValueOnce(mockMessageIds);
      mockGmailApiClient.getMessage.mockResolvedValueOnce(mockMessage1);
      mockGmailApiClient.getMessage.mockRejectedValueOnce(new Error('Message not found'));

      const result = await provider.list('CSV Import');

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('CSV Import 1');
    });
  });

  describe('upload', () => {
    it('should throw error (Gmail is read-only)', async () => {
      const provider = new GmailStorageProvider({
        oauth2Client,
        accessToken: 'test-access-token',
        oauthService: mockOAuthService,
        onTokenUpdate
      });

      await expect(provider.upload(Buffer.from('test'), 'test.csv')).rejects.toThrow(
        'GmailStorageProvider does not support upload'
      );
    });
  });

  describe('delete', () => {
    it('should throw error (Gmail is read-only)', async () => {
      const provider = new GmailStorageProvider({
        oauth2Client,
        accessToken: 'test-access-token',
        oauthService: mockOAuthService,
        onTokenUpdate
      });

      await expect(provider.delete('test.csv')).rejects.toThrow(
        'GmailStorageProvider does not support delete'
      );
    });
  });

  describe('downloadAllWithMetadata', () => {
    it('should use searchMessagesLimited with default max 30', async () => {
      const provider = new GmailStorageProvider({
        oauth2Client,
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        oauthService: mockOAuthService,
        onTokenUpdate
      });

      mockGmailApiClient.searchMessagesLimited.mockResolvedValueOnce(['m1', 'm2']);
      mockGmailApiClient.getMessage.mockResolvedValue({
        id: 'm1',
        threadId: 't1',
        labelIds: ['UNREAD'],
        snippet: '',
        payload: {
          headers: [{ name: 'Subject', value: 'subject-1' }],
          parts: []
        }
      });
      mockGmailApiClient.getFirstAttachment.mockResolvedValue({
        buffer: Buffer.from('csv'),
        filename: 'file.csv'
      });

      const result = await provider.downloadAllWithMetadata('CSV Import');

      expect(mockGmailApiClient.searchMessagesLimited).toHaveBeenCalledWith(
        expect.stringContaining('subject:"CSV Import"'),
        30
      );
      expect(result).toHaveLength(2);
      expect(result[0].messageId).toBe('m1');
      expect(result[1].messageId).toBe('m2');
    });

    it('should honor GMAIL_MAX_MESSAGES_PER_BATCH env value', async () => {
      const previous = process.env.GMAIL_MAX_MESSAGES_PER_BATCH;
      try {
        process.env.GMAIL_MAX_MESSAGES_PER_BATCH = '12';

        const provider = new GmailStorageProvider({
          oauth2Client,
          accessToken: 'test-access-token',
          refreshToken: 'test-refresh-token',
          oauthService: mockOAuthService,
          onTokenUpdate
        });

        mockGmailApiClient.searchMessagesLimited.mockResolvedValueOnce([]);

        await expect(provider.downloadAllWithMetadata('CSV Import')).rejects.toThrow(
          'No messages found matching query'
        );

        expect(mockGmailApiClient.searchMessagesLimited).toHaveBeenCalledWith(
          expect.any(String),
          12
        );
      } finally {
        if (previous === undefined) {
          delete process.env.GMAIL_MAX_MESSAGES_PER_BATCH;
        } else {
          process.env.GMAIL_MAX_MESSAGES_PER_BATCH = previous;
        }
      }
    });
  });
});

