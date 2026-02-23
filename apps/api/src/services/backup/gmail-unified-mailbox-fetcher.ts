export type UnifiedMailboxMessage = {
  buffer: Buffer;
  messageId: string;
  messageSubject: string;
};

export type UnifiedMailboxResult = Record<string, UnifiedMailboxMessage[]>;
type UnifiedMailboxProvider = {
  downloadAllBySubjectPatterns: (subjectPatterns: string[]) => Promise<UnifiedMailboxResult>;
};

/**
 * Gmail messages.list の単一呼び出し結果を、subject patternごとへ振り分ける。
 */
export class GmailUnifiedMailboxFetcher {
  async fetchBySubjectPatterns(
    provider: UnifiedMailboxProvider,
    subjectPatterns: string[]
  ): Promise<UnifiedMailboxResult> {
    return provider.downloadAllBySubjectPatterns(subjectPatterns);
  }
}

