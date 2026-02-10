import { describe, expect, it, vi, beforeEach } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import { GmailApiClient } from '../gmail-api-client.js';

// googleapisをモック
const mockGmailMessages = {
  list: vi.fn(),
  get: vi.fn(),
  modify: vi.fn(),
  trash: vi.fn(),
  delete: vi.fn(),
  attachments: {
    get: vi.fn()
  }
};

const mockGmailLabels = {
  list: vi.fn(),
  create: vi.fn()
};

const mockGmail = {
  users: {
    messages: mockGmailMessages,
    labels: mockGmailLabels
  }
};

vi.mock('googleapis', () => {
  return {
    google: {
      gmail: vi.fn(() => ({
        users: {
          messages: mockGmailMessages,
          labels: mockGmailLabels
        }
      }))
    }
  };
});

describe('GmailApiClient', () => {
  let oauth2Client: OAuth2Client;
  let gmailClient: GmailApiClient;

  beforeEach(() => {
    oauth2Client = {
      setCredentials: vi.fn(),
      getAccessToken: vi.fn()
    } as unknown as OAuth2Client;

    gmailClient = new GmailApiClient(oauth2Client);
    vi.clearAllMocks();
  });

  describe('searchMessages', () => {
    it('should search messages and return message IDs', async () => {
      const mockQuery = 'subject:CSV Import';
      const mockResponse = {
        data: {
          messages: [
            { id: 'msg1' },
            { id: 'msg2' },
            { id: 'msg3' }
          ]
        }
      };

      mockGmailMessages.list.mockResolvedValueOnce(mockResponse);

      const result = await gmailClient.searchMessages(mockQuery);

      expect(result).toEqual(['msg1', 'msg2', 'msg3']);
      expect(mockGmailMessages.list).toHaveBeenCalledWith({
        userId: 'me',
        q: mockQuery,
        maxResults: 10
      });
    });

    it('should return empty array when no messages found', async () => {
      const mockQuery = 'subject:NonExistent';
      const mockResponse = {
        data: {
          messages: []
        }
      };

      mockGmailMessages.list.mockResolvedValueOnce(mockResponse);

      const result = await gmailClient.searchMessages(mockQuery);

      expect(result).toEqual([]);
    });

    it('should throw error when search fails', async () => {
      const mockQuery = 'subject:Error';
      const mockError = new Error('API Error');

      mockGmailMessages.list.mockRejectedValueOnce(mockError);

      await expect(gmailClient.searchMessages(mockQuery)).rejects.toThrow(
        'Failed to search messages'
      );
    });
  });

  describe('getMessage', () => {
    it('should get message details', async () => {
      const mockMessageId = 'msg1';
      const mockResponse = {
        data: {
          id: 'msg1',
          threadId: 'thread1',
          labelIds: ['INBOX', 'UNREAD'],
          snippet: 'Test message',
          payload: {
            headers: [
              { name: 'Subject', value: 'Test Subject' },
              { name: 'From', value: 'test@example.com' }
            ],
            parts: []
          }
        }
      };

      mockGmailMessages.get.mockResolvedValueOnce(mockResponse);

      const result = await gmailClient.getMessage(mockMessageId);

      expect(result.id).toBe('msg1');
      expect(result.threadId).toBe('thread1');
      expect(result.labelIds).toEqual(['INBOX', 'UNREAD']);
      expect(result.snippet).toBe('Test message');
      expect(mockGmailMessages.get).toHaveBeenCalledWith({
        userId: 'me',
        id: mockMessageId,
        format: 'full'
      });
    });

    it('should throw error when get message fails', async () => {
      const mockMessageId = 'invalid-msg';
      const mockError = new Error('Message not found');

      mockGmailMessages.get.mockRejectedValueOnce(mockError);

      await expect(gmailClient.getMessage(mockMessageId)).rejects.toThrow(
        'Failed to get message'
      );
    });
  });

  describe('getAttachment', () => {
    it('should get attachment as Buffer', async () => {
      const mockMessageId = 'msg1';
      const mockAttachmentId = 'att1';
      const mockData = Buffer.from('test attachment data').toString('base64');
      const mockResponse = {
        data: {
          data: mockData,
          size: 20
        }
      };

      mockGmailMessages.attachments.get.mockResolvedValueOnce(mockResponse);

      const result = await gmailClient.getAttachment(mockMessageId, mockAttachmentId);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.toString()).toBe('test attachment data');
      expect(mockGmailMessages.attachments.get).toHaveBeenCalledWith({
        userId: 'me',
        messageId: mockMessageId,
        id: mockAttachmentId
      });
    });

    it('should throw error when attachment data is empty', async () => {
      const mockMessageId = 'msg1';
      const mockAttachmentId = 'att1';
      const mockResponse = {
        data: {
          data: null,
          size: 0
        }
      };

      mockGmailMessages.attachments.get.mockResolvedValueOnce(mockResponse);

      await expect(gmailClient.getAttachment(mockMessageId, mockAttachmentId)).rejects.toThrow(
        'Attachment data is empty'
      );
    });

    it('should throw error when get attachment fails', async () => {
      const mockMessageId = 'msg1';
      const mockAttachmentId = 'invalid-att';
      const mockError = new Error('Attachment not found');

      mockGmailMessages.attachments.get.mockRejectedValueOnce(mockError);

      await expect(gmailClient.getAttachment(mockMessageId, mockAttachmentId)).rejects.toThrow(
        'Failed to get attachment'
      );
    });
  });

  describe('archiveMessage', () => {
    it('should archive message by removing INBOX label', async () => {
      const mockMessageId = 'msg1';
      const mockResponse = {
        data: {
          id: 'msg1',
          labelIds: []
        }
      };

      mockGmailMessages.modify.mockResolvedValueOnce(mockResponse);

      await gmailClient.archiveMessage(mockMessageId);

      expect(mockGmailMessages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: mockMessageId,
        requestBody: {
          removeLabelIds: ['INBOX']
        }
      });
    });

    it('should throw error when archive fails', async () => {
      const mockMessageId = 'invalid-msg';
      const mockError = new Error('Message not found');

      mockGmail.users.messages.modify.mockRejectedValueOnce(mockError);

      await expect(gmailClient.archiveMessage(mockMessageId)).rejects.toThrow(
        'Failed to archive message'
      );
    });
  });

  describe('getFirstAttachment', () => {
    it('should get first attachment from message', async () => {
      const mockMessageId = 'msg1';
      const mockMessageResponse = {
        data: {
          id: 'msg1',
          threadId: 'thread1',
          labelIds: ['INBOX'],
          snippet: 'Test message',
          payload: {
            parts: [
              {
                partId: '0',
                mimeType: 'text/plain',
                body: {
                  size: 100
                }
              },
              {
                partId: '1',
                mimeType: 'application/octet-stream',
                filename: 'test.csv',
                body: {
                  attachmentId: 'att1',
                  size: 200
                }
              }
            ]
          }
        }
      };

      const mockAttachmentData = Buffer.from('test csv data').toString('base64');
      const mockAttachmentResponse = {
        data: {
          data: mockAttachmentData,
          size: 200
        }
      };

      mockGmail.users.messages.get.mockResolvedValueOnce(mockMessageResponse);
      mockGmail.users.messages.attachments.get.mockResolvedValueOnce(mockAttachmentResponse);

      const result = await gmailClient.getFirstAttachment(mockMessageId);

      expect(result).not.toBeNull();
      expect(result?.filename).toBe('test.csv');
      expect(result?.buffer.toString()).toBe('test csv data');
    });

    it('should return null when no attachment found', async () => {
      const mockMessageId = 'msg1';
      const mockMessageResponse = {
        data: {
          id: 'msg1',
          threadId: 'thread1',
          labelIds: ['INBOX'],
          snippet: 'Test message',
          payload: {
            parts: [
              {
                partId: '0',
                mimeType: 'text/plain',
                body: {
                  size: 100
                }
              }
            ]
          }
        }
      };

      mockGmail.users.messages.get.mockResolvedValueOnce(mockMessageResponse);

      const result = await gmailClient.getFirstAttachment(mockMessageId);

      expect(result).toBeNull();
    });

    it('should handle message with direct attachment in body', async () => {
      const mockMessageId = 'msg1';
      const mockMessageResponse = {
        data: {
          id: 'msg1',
          threadId: 'thread1',
          labelIds: ['INBOX'],
          snippet: 'Test message',
          payload: {
            body: {
              attachmentId: 'att1',
              size: 200
            }
          }
        }
      };

      const mockAttachmentData = Buffer.from('test data').toString('base64');
      const mockAttachmentResponse = {
        data: {
          data: mockAttachmentData,
          size: 200
        }
      };

      mockGmail.users.messages.get.mockResolvedValueOnce(mockMessageResponse);
      mockGmail.users.messages.attachments.get.mockResolvedValueOnce(mockAttachmentResponse);

      const result = await gmailClient.getFirstAttachment(mockMessageId);

      expect(result).not.toBeNull();
      expect(result?.filename).toBe('attachment');
      expect(result?.buffer.toString()).toBe('test data');
    });
  });

  describe('trashMessage', () => {
    it('should add processed label then trash message', async () => {
      const messageId = 'msg-trash-1';
      mockGmailLabels.list.mockResolvedValueOnce({
        data: {
          labels: [{ id: 'label-processed', name: 'rps_processed' }]
        }
      });
      mockGmailMessages.modify.mockResolvedValueOnce({ data: {} });
      mockGmailMessages.trash.mockResolvedValueOnce({ data: {} });

      await gmailClient.trashMessage(messageId);

      expect(mockGmailMessages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: messageId,
        requestBody: {
          addLabelIds: ['label-processed']
        }
      });
      expect(mockGmailMessages.trash).toHaveBeenCalledWith({
        userId: 'me',
        id: messageId
      });
      const modifyOrder = mockGmailMessages.modify.mock.invocationCallOrder[0];
      const trashOrder = mockGmailMessages.trash.mock.invocationCallOrder[0];
      expect(modifyOrder).toBeLessThan(trashOrder);
    });

    it('should create processed label when missing', async () => {
      const messageId = 'msg-trash-2';
      mockGmailLabels.list.mockResolvedValueOnce({ data: { labels: [] } });
      mockGmailLabels.create.mockResolvedValueOnce({
        data: { id: 'label-created' }
      });
      mockGmailMessages.modify.mockResolvedValueOnce({ data: {} });
      mockGmailMessages.trash.mockResolvedValueOnce({ data: {} });

      await gmailClient.trashMessage(messageId);

      expect(mockGmailLabels.create).toHaveBeenCalledWith({
        userId: 'me',
        requestBody: {
          name: 'rps_processed',
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show'
        }
      });
      expect(mockGmailMessages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: messageId,
        requestBody: {
          addLabelIds: ['label-created']
        }
      });
    });
  });

  describe('cleanupProcessedTrash', () => {
    it('should search by query and delete matched messages', async () => {
      mockGmailMessages.list.mockResolvedValueOnce({
        data: {
          messages: [{ id: 'm1' }, { id: 'm2' }]
        }
      });
      mockGmailMessages.delete.mockResolvedValueOnce({ data: {} });
      mockGmailMessages.delete.mockRejectedValueOnce(new Error('delete failed'));

      const result = await gmailClient.cleanupProcessedTrash({
        processedLabelName: 'rps_processed',
        minAgeQuery: 'older_than:30m'
      });

      expect(mockGmailMessages.list).toHaveBeenCalledWith({
        userId: 'me',
        q: 'label:TRASH label:rps_processed older_than:30m',
        maxResults: 100,
        pageToken: undefined
      });
      expect(mockGmailMessages.delete).toHaveBeenNthCalledWith(1, {
        userId: 'me',
        id: 'm1'
      });
      expect(mockGmailMessages.delete).toHaveBeenNthCalledWith(2, {
        userId: 'me',
        id: 'm2'
      });
      expect(result.totalMatched).toBe(2);
      expect(result.deletedCount).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.query).toBe('label:TRASH label:rps_processed older_than:30m');
    });
  });
});

