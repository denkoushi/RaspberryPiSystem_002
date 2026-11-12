/**
 * Gmailメッセージ情報
 */
export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: {
    attachmentId?: string;
    size?: number;
    /** Gmail may inline small MIME bodies instead of returning attachmentId. */
    data?: string;
  };
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  internalDateMs: number;
  payload?: GmailMessagePart;
}

export interface GmailAttachmentDescriptor {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size?: number;
  isInline: boolean;
}

function findPartHeader(part: GmailMessagePart, name: string): string | undefined {
  return part.headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value;
}

/**
 * Gmail MIMEツリーからattachmentIdを持つパートを再帰列挙する。
 * Content-Disposition / Content-ID は呼び出し側が実添付とinlineを区別するため保持する。
 */
export function collectGmailAttachments(message: GmailMessage): GmailAttachmentDescriptor[] {
  const results: GmailAttachmentDescriptor[] = [];
  const seen = new Set<string>();

  const walk = (part: GmailMessagePart | undefined): void => {
    if (!part) return;
    const attachmentId = part.body?.attachmentId;
    if (attachmentId) {
      // 監査用メタデータでは Gmail が返した添付名をそのまま保持する。
      // 空白除去や NFC 正規化は、検証・重複キー生成を行う各ドメイン側の責務とする。
      const filename = part.filename ?? '';
      const disposition = findPartHeader(part, 'Content-Disposition')?.trim().toLowerCase() ?? '';
      const contentId = findPartHeader(part, 'Content-ID')?.trim() ?? '';
      const explicitlyAttached = disposition.startsWith('attachment');
      const isInline = disposition.startsWith('inline') || (!explicitlyAttached && contentId.length > 0);
      const key = `${attachmentId}|${filename}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({
          attachmentId,
          filename,
          mimeType: part.mimeType?.trim() ?? '',
          size: part.body?.size,
          isInline
        });
      }
    }
    for (const child of part.parts ?? []) {
      walk(child);
    }
  };

  walk(message.payload);
  return results;
}
