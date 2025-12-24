import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GmailApiClient } from '../gmail-api.client.js';
import { google } from 'googleapis';

// googleapisをモック
vi.mock('googleapis', () => {
  const mockGmail = {
    users: {
      messages: {
        list: vi.fn(),
        get: vi.fn(),
        attachments: {
          get: vi.fn()
        },
        modify: vi.fn(),
        delete: vi.fn()
      },
      labels: {
        list: vi.fn(),
        create: vi.fn()
      }
    }
  };

  return {
    google: {
      gmail: vi.fn(() => mockGmail),
      auth: {
        OAuth2: vi.fn(() => ({
          setCredentials: vi.fn(),
          on: vi.fn()
        }))
      }
    }
  };
});

describe('GmailApiClient', () => {
  const mockAccessToken = 'test-access-token';
  const mockRefreshToken = 'test-refresh-token';
  const mockOnTokenUpdate = vi.fn();
  const mockRefreshAccessTokenFn = vi.fn().mockResolvedValue('new-access-token');

  let gmailClient: GmailApiClient;

  beforeEach(() => {
    vi.clearAllMocks();
    gmailClient = new GmailApiClient({
      accessToken: mockAccessToken,
      refreshToken: mockRefreshToken,
      onTokenUpdate: mockOnTokenUpdate,
      refreshAccessTokenFn: mockRefreshAccessTokenFn
    });
  });

  describe('searchMessages', () => {
    it('should search messages with query', async () => {
      const mockMessages = [
        { id: 'msg1' },
        { id: 'msg2' }
      ];

      const mockGmail = (google.gmail as ReturnType<typeof vi.fn>)();
      (mockGmail.users.messages.list as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { messages: mockMessages }
      });

      const result = await gmailClient.searchMessages('is:unread');

      expect(result).toEqual(['msg1', 'msg2']);
      expect(mockGmail.users.messages.list).toHaveBeenCalledWith({
        userId: 'me',
        q: 'is:unread',
        maxResults: 100
      });
    });

    it('should return empty array when no messages found', async () => {
      const mockGmail = (google.gmail as ReturnType<typeof vi.fn>)();
      (mockGmail.users.messages.list as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { messages: [] }
      });

      const result = await gmailClient.searchMessages('is:unread');

      expect(result).toEqual([]);
    });
  });

  describe('getMessage', () => {
    it('should get message by ID', async () => {
      const mockMessage = {
        id: 'msg1',
        threadId: 'thread1',
        labelIds: ['INBOX', 'UNREAD'],
        snippet: 'Test message',
        payload: {
          headers: [
            { name: 'Subject', value: 'Test Subject' },
            { name: 'From', value: 'test@example.com' }
          ]
        }
      };

      const mockGmail = (google.gmail as ReturnType<typeof vi.fn>)();
      (mockGmail.users.messages.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: mockMessage
      });

      const result = await gmailClient.getMessage('msg1');

      expect(result.id).toBe('msg1');
      expect(result.threadId).toBe('thread1');
      expect(result.labelIds).toEqual(['INBOX', 'UNREAD']);
      expect(result.snippet).toBe('Test message');
      expect(mockGmail.users.messages.get).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg1',
        format: 'full'
      });
    });

    it('should throw error when message data is invalid', async () => {
      const mockGmail = (google.gmail as ReturnType<typeof vi.fn>)();
      (mockGmail.users.messages.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { id: undefined, threadId: undefined }
      });

      await expect(gmailClient.getMessage('msg1')).rejects.toThrow('Invalid message data');
    });
  });

  describe('getAttachment', () => {
    it('should get attachment by message ID and attachment ID', async () => {
      const mockAttachmentData = Buffer.from('test-attachment-data').toString('base64');
      const mockGmail = (google.gmail as ReturnType<typeof vi.fn>)();
      (mockGmail.users.messages.attachments.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { data: mockAttachmentData }
      });

      const result = await gmailClient.getAttachment('msg1', 'att1');

      expect(result).toBeInstanceOf(Buffer);
      expect(result.toString()).toBe('test-attachment-data');
      expect(mockGmail.users.messages.attachments.get).toHaveBeenCalledWith({
        userId: 'me',
        messageId: 'msg1',
        id: 'att1'
      });
    });

    it('should throw error when attachment data is empty', async () => {
      const mockGmail = (google.gmail as ReturnType<typeof vi.fn>)();
      (mockGmail.users.messages.attachments.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { data: null }
      });

      await expect(gmailClient.getAttachment('msg1', 'att1')).rejects.toThrow('Attachment data is empty');
    });
  });

  describe('getOrCreateLabel', () => {
    it('should return existing label ID if label exists', async () => {
      const mockLabels = [
        { id: 'label1', name: 'Existing Label' },
        { id: 'label2', name: 'Pi5/Processed' }
      ];

      const mockGmail = (google.gmail as ReturnType<typeof vi.fn>)();
      (mockGmail.users.labels.list as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { labels: mockLabels }
      });

      const result = await gmailClient.getOrCreateLabel('Pi5/Processed');

      expect(result).toBe('label2');
      expect(mockGmail.users.labels.create).not.toHaveBeenCalled();
    });

    it('should create new label if label does not exist', async () => {
      const mockLabels = [
        { id: 'label1', name: 'Existing Label' }
      ];

      const mockGmail = (google.gmail as ReturnType<typeof vi.fn>)();
      (mockGmail.users.labels.list as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { labels: mockLabels }
      });
      (mockGmail.users.labels.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { id: 'new-label-id' }
      });

      const result = await gmailClient.getOrCreateLabel('Pi5/Processed');

      expect(result).toBe('new-label-id');
      expect(mockGmail.users.labels.create).toHaveBeenCalledWith({
        userId: 'me',
        requestBody: {
          name: 'Pi5/Processed',
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show'
        }
      });
    });
  });

  describe('addLabels', () => {
    it('should add labels to message', async () => {
      const mockGmail = (google.gmail as ReturnType<typeof vi.fn>)();
      (mockGmail.users.messages.modify as ReturnType<typeof vi.fn>).mockResolvedValue({});

      await gmailClient.addLabels('msg1', ['label1', 'label2']);

      expect(mockGmail.users.messages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg1',
        requestBody: {
          addLabelIds: ['label1', 'label2']
        }
      });
    });
  });

  describe('markAsRead', () => {
    it('should mark message as read', async () => {
      const mockGmail = (google.gmail as ReturnType<typeof vi.fn>)();
      (mockGmail.users.messages.modify as ReturnType<typeof vi.fn>).mockResolvedValue({});

      await gmailClient.markAsRead('msg1');

      expect(mockGmail.users.messages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg1',
        requestBody: {
          removeLabelIds: ['UNREAD']
        }
      });
    });
  });

  describe('deleteMessage', () => {
    it('should delete message', async () => {
      const mockGmail = (google.gmail as ReturnType<typeof vi.fn>)();
      (mockGmail.users.messages.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});

      await gmailClient.deleteMessage('msg1');

      expect(mockGmail.users.messages.delete).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg1'
      });
    });
  });
});
