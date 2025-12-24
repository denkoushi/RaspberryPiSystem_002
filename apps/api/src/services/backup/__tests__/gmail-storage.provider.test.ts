import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GmailStorageProvider } from '../storage/gmail-storage.provider.js';
import { GmailApiClient } from '../gmail-api.client.js';
import { GmailOAuthService } from '../gmail-oauth.service.js';

// GmailApiClientをモック
vi.mock('../gmail-api.client.js', () => {
  const mockGmailApiClient = {
    searchMessages: vi.fn(),
    getMessage: vi.fn(),
    getAttachment: vi.fn(),
    getOrCreateLabel: vi.fn(),
    addLabels: vi.fn(),
    markAsRead: vi.fn(),
    deleteMessage: vi.fn()
  };

  return {
    GmailApiClient: vi.fn(() => mockGmailApiClient)
  };
});

describe('GmailStorageProvider', () => {
  const mockAccessToken = 'test-access-token';
  const mockRefreshToken = 'test-refresh-token';
  const mockSubjectPattern = '^\\[Pi5 Backup\\] (employees|items)-\\d{8}\\.csv$';
  const mockLabelName = 'Pi5/Processed';
  const mockOnTokenUpdate = vi.fn();

  let gmailProvider: GmailStorageProvider;
  let mockGmailApiClient: ReturnType<typeof GmailApiClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // GmailApiClientのモックインスタンスを取得
    mockGmailApiClient = new GmailApiClient({
      accessToken: mockAccessToken,
      refreshToken: mockRefreshToken
    }) as unknown as ReturnType<typeof GmailApiClient>;

    gmailProvider = new GmailStorageProvider({
      accessToken: mockAccessToken,
      refreshToken: mockRefreshToken,
      subjectPattern: mockSubjectPattern,
      labelName: mockLabelName,
      onTokenUpdate: mockOnTokenUpdate
    });
  });

  describe('upload', () => {
    it('should throw error (not supported)', async () => {
      await expect(
        gmailProvider.upload(Buffer.from('test'), 'test.csv')
      ).rejects.toThrow('Upload is not supported for Gmail storage provider');
    });
  });

  describe('download', () => {
    it('should download attachment by messageId:attachmentId', async () => {
      const mockAttachmentData = Buffer.from('test-csv-data');
      (mockGmailApiClient.getAttachment as ReturnType<typeof vi.fn>).mockResolvedValue(mockAttachmentData);

      const result = await gmailProvider.download('msg1:att1');

      expect(result).toEqual(mockAttachmentData);
      expect(mockGmailApiClient.getAttachment).toHaveBeenCalledWith('msg1', 'att1');
    });

    it('should download attachment by messageId only (single attachment)', async () => {
      const mockMessage = {
        id: 'msg1',
        threadId: 'thread1',
        labelIds: [],
        snippet: 'Test',
        payload: {
          parts: [
            {
              partId: '0',
              mimeType: 'text/plain',
              filename: 'test.csv',
              body: { attachmentId: 'att1' }
            }
          ]
        }
      };
      const mockAttachmentData = Buffer.from('test-csv-data');
      
      (mockGmailApiClient.getMessage as ReturnType<typeof vi.fn>).mockResolvedValue(mockMessage);
      (mockGmailApiClient.getAttachment as ReturnType<typeof vi.fn>).mockResolvedValue(mockAttachmentData);

      const result = await gmailProvider.download('msg1');

      expect(result).toEqual(mockAttachmentData);
      expect(mockGmailApiClient.getMessage).toHaveBeenCalledWith('msg1');
      expect(mockGmailApiClient.getAttachment).toHaveBeenCalledWith('msg1', 'att1');
    });

    it('should throw error when messageId is missing', async () => {
      await expect(gmailProvider.download('')).rejects.toThrow('Invalid path format: messageId is required');
    });

    it('should throw error when no attachment found', async () => {
      const mockMessage = {
        id: 'msg1',
        threadId: 'thread1',
        labelIds: [],
        snippet: 'Test',
        payload: {
          parts: []
        }
      };
      
      (mockGmailApiClient.getMessage as ReturnType<typeof vi.fn>).mockResolvedValue(mockMessage);

      await expect(gmailProvider.download('msg1')).rejects.toThrow('No attachment found in message');
    });
  });

  describe('delete', () => {
    it('should delete message by messageId', async () => {
      (mockGmailApiClient.deleteMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await gmailProvider.delete('msg1:att1');

      expect(mockGmailApiClient.deleteMessage).toHaveBeenCalledWith('msg1');
    });

    it('should throw error when messageId is missing', async () => {
      await expect(gmailProvider.delete('')).rejects.toThrow('Invalid path format: messageId is required');
    });
  });

  describe('list', () => {
    it('should list messages matching subject pattern', async () => {
      const mockMessageIds = ['msg1', 'msg2'];
      const mockMessage1 = {
        id: 'msg1',
        threadId: 'thread1',
        labelIds: ['UNREAD'],
        snippet: 'Test',
        payload: {
          headers: [
            { name: 'Subject', value: '[Pi5 Backup] employees-20251224.csv' }
          ],
          parts: [
            {
              partId: '0',
              mimeType: 'text/csv',
              filename: 'employees-20251224.csv',
              body: { attachmentId: 'att1' }
            }
          ]
        }
      };
      const mockMessage2 = {
        id: 'msg2',
        threadId: 'thread2',
        labelIds: ['UNREAD'],
        snippet: 'Test',
        payload: {
          headers: [
            { name: 'Subject', value: '[Pi5 Backup] items-20251224.csv' }
          ],
          parts: [
            {
              partId: '0',
              mimeType: 'text/csv',
              filename: 'items-20251224.csv',
              body: { attachmentId: 'att2' }
            }
          ]
        }
      };

      (mockGmailApiClient.searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(mockMessageIds);
      (mockGmailApiClient.getMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockMessage1)
        .mockResolvedValueOnce(mockMessage2);

      const result = await gmailProvider.list('');

      expect(result).toHaveLength(2);
      expect(result[0].path).toBe('msg1:att1');
      expect(result[1].path).toBe('msg2:att2');
      expect(mockGmailApiClient.searchMessages).toHaveBeenCalledWith('is:unread');
    });

    it('should skip messages that do not match subject pattern', async () => {
      const mockMessageIds = ['msg1', 'msg2'];
      const mockMessage1 = {
        id: 'msg1',
        threadId: 'thread1',
        labelIds: ['UNREAD'],
        snippet: 'Test',
        payload: {
          headers: [
            { name: 'Subject', value: '[Pi5 Backup] employees-20251224.csv' }
          ],
          parts: [
            {
              partId: '0',
              mimeType: 'text/csv',
              filename: 'employees-20251224.csv',
              body: { attachmentId: 'att1' }
            }
          ]
        }
      };
      const mockMessage2 = {
        id: 'msg2',
        threadId: 'thread2',
        labelIds: ['UNREAD'],
        snippet: 'Test',
        payload: {
          headers: [
            { name: 'Subject', value: 'Other Subject' } // パターンにマッチしない
          ],
          parts: []
        }
      };

      (mockGmailApiClient.searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(mockMessageIds);
      (mockGmailApiClient.getMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockMessage1)
        .mockResolvedValueOnce(mockMessage2);

      const result = await gmailProvider.list('');

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('msg1:att1');
    });

    it('should return empty array when no messages found', async () => {
      (mockGmailApiClient.searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await gmailProvider.list('');

      expect(result).toEqual([]);
    });
  });

  describe('markAsProcessed', () => {
    it('should mark message as processed (add label and mark as read)', async () => {
      (mockGmailApiClient.getOrCreateLabel as ReturnType<typeof vi.fn>).mockResolvedValue('label-id');
      (mockGmailApiClient.addLabels as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (mockGmailApiClient.markAsRead as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await gmailProvider.markAsProcessed('msg1');

      expect(mockGmailApiClient.getOrCreateLabel).toHaveBeenCalledWith(mockLabelName);
      expect(mockGmailApiClient.addLabels).toHaveBeenCalledWith('msg1', ['label-id']);
      expect(mockGmailApiClient.markAsRead).toHaveBeenCalledWith('msg1');
    });
  });
});
