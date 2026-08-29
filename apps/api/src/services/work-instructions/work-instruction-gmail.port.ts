import type { GmailMessage } from '../backup/gmail-api-client.js';

/** The small Gmail surface required by the work-instruction application service. */
export type WorkInstructionGmailPort = {
  searchMessagesAll: (query: string) => Promise<string[]>;
  getMessage: (messageId: string) => Promise<GmailMessage>;
  getAttachment: (messageId: string, attachmentId: string) => Promise<Buffer>;
  markAsRead: (messageId: string) => Promise<void>;
  trashMessage: (messageId: string) => Promise<void>;
};
