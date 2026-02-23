import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GmailUnifiedMailboxFetcher } from '../gmail-unified-mailbox-fetcher.js';
import type { UnifiedMailboxResult } from '../gmail-unified-mailbox-fetcher.js';

describe('GmailUnifiedMailboxFetcher', () => {
  let fetcher: GmailUnifiedMailboxFetcher;
  let mockProvider: {
    downloadAllBySubjectPatterns: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    fetcher = new GmailUnifiedMailboxFetcher();
    mockProvider = {
      downloadAllBySubjectPatterns: vi.fn()
    };
  });

  it('should call downloadAllBySubjectPatterns with subject patterns', async () => {
    const subjectPatterns = ['pattern1', 'pattern2', 'pattern3'];
    const expectedResult: UnifiedMailboxResult = {
      pattern1: [
        { buffer: Buffer.from('csv1'), messageId: 'msg1', messageSubject: 'Subject Pattern1' }
      ],
      pattern2: [
        { buffer: Buffer.from('csv2'), messageId: 'msg2', messageSubject: 'Subject Pattern2' }
      ],
      pattern3: []
    };

    mockProvider.downloadAllBySubjectPatterns.mockResolvedValueOnce(expectedResult);

    const result = await fetcher.fetchBySubjectPatterns(
      mockProvider as never,
      subjectPatterns
    );

    expect(mockProvider.downloadAllBySubjectPatterns).toHaveBeenCalledWith(subjectPatterns);
    expect(result).toEqual(expectedResult);
  });

  it('should handle empty subject patterns', async () => {
    const subjectPatterns: string[] = [];
    const expectedResult: UnifiedMailboxResult = {};

    mockProvider.downloadAllBySubjectPatterns.mockResolvedValueOnce(expectedResult);

    const result = await fetcher.fetchBySubjectPatterns(
      mockProvider as never,
      subjectPatterns
    );

    expect(mockProvider.downloadAllBySubjectPatterns).toHaveBeenCalledWith(subjectPatterns);
    expect(result).toEqual(expectedResult);
  });

  it('should propagate errors from provider', async () => {
    const subjectPatterns = ['pattern1'];
    const error = new Error('Provider error');

    mockProvider.downloadAllBySubjectPatterns.mockRejectedValueOnce(error);

    await expect(
      fetcher.fetchBySubjectPatterns(mockProvider as never, subjectPatterns)
    ).rejects.toThrow('Provider error');
  });
});
