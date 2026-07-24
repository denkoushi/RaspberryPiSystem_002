import { createHash } from 'node:crypto';

export function buildGmailAttachmentDedupeKey(messageId: string, attachmentFilename: string): string {
  const normalizedFilename = attachmentFilename.normalize('NFC');
  return createHash('sha256')
    .update(`${messageId}|${normalizedFilename}`, 'utf8')
    .digest('hex');
}
