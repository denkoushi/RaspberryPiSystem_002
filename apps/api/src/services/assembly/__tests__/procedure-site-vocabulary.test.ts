import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { recordLearningSnapshot, validateVocabulary } from '../procedure-site-vocabulary.js';
import type { PublishedProcedure } from '../procedure-published-examples.js';
const documents = (texts: string[]): PublishedProcedure[] => ['one', 'two'].map(id => ({ id, revisionRootId: id, updatedAt: new Date(0), texts }));
describe('site vocabulary validation', () => {
  it('rejects invalid lengths, numbers, symbols, programs, quantities and existing site knowledge', () => {
    const invalid = ['あ', 'あ'.repeat(16), '1234', '１２３', '！？', 'O3135', 'Ｏ３１３５', '3mm', '３μm', '3個', '0.02 mm', '磁力MAX', '反り抜きシート'];
    expect(validateVocabulary('grinding', [...invalid, '専用受台', '専用受台', 'あ'.repeat(15)], documents([...invalid, '専用受台', 'あ'.repeat(15)])))
      .toEqual([{ term: 'あ'.repeat(15), documentCount: 2 }, { term: '専用受台', documentCount: 2 }]);
  });
  it('requires verbatim support in two distinct documents', () => {
    const docs = documents(['専用受台']);
    expect(validateVocabulary('grinding', ['専用受台'], [docs[0], docs[0]])).toEqual([]);
    expect(validateVocabulary('grinding', ['専用受台'], [docs[0], { ...docs[1], texts: ['専用 受台'] }])).toEqual([]);
  });
  it('caps at 80 sorted by document count then deterministic string order', () => {
    const terms = Array.from({ length: 82 }, (_, i) => `専用受台${String(i).padStart(2, '0')}`);
    const result = validateVocabulary('grinding', terms.reverse(), [...documents(terms), { ...documents([])[0], id: 'three', texts: ['専用受台81'] }]);
    expect(result).toHaveLength(80);
    expect(result[0]).toEqual({ term: '専用受台81', documentCount: 3 });
    expect(result[1]).toEqual({ term: '専用受台00', documentCount: 2 });
  });
});

describe('learning snapshot', () => {
  afterEach(() => vi.restoreAllMocks());

  it('stores separate counts for layout and dictation outcomes', async () => {
    const site = 'assembly';
    const now = new Date('2026-11-18T16:00:00Z');
    const day = new Date('2026-11-19T00:00:00Z');
    const feedback = [
      { source: 'LAYOUT', outcome: 'KEPT', count: 1 },
      { source: 'LAYOUT', outcome: 'EDITED', count: 2 },
      { source: 'LAYOUT', outcome: 'REVERTED', count: 3 },
      { source: 'DICTATION', outcome: 'KEPT', count: 4 },
      { source: 'DICTATION', outcome: 'EDITED', count: 5 },
      { source: 'DICTATION', outcome: 'REVERTED', count: 6 },
    ];
    vi.spyOn(prisma.assemblyProcedureDocument, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.assemblyProcedureTextFeedback, 'count').mockImplementation(async options =>
      feedback.find(row => row.source === options?.where?.source && row.outcome === options?.where?.outcome && options.where.site === site)?.count ?? 0);
    vi.spyOn(prisma.assemblyProcedureCaptionFeedback, 'count').mockResolvedValue(0);
    vi.spyOn(prisma.assemblyProcedureLearnedTerm, 'count').mockResolvedValue(0);
    vi.spyOn(prisma.assemblyProcedureSiteVocabulary, 'count').mockResolvedValue(0);
    vi.spyOn(prisma.assemblyProcedureLearningSnapshot, 'findFirst').mockResolvedValue(null);
    const upsert = vi.spyOn(prisma.assemblyProcedureLearningSnapshot, 'upsert').mockResolvedValue({} as never);

    const expected = { textKept: 1, textEdited: 2, textReverted: 3, dictationKept: 4, dictationEdited: 5, dictationReverted: 6 };
    await expect(recordLearningSnapshot(site, now)).resolves.toMatchObject(expected);
    expect(upsert).toHaveBeenCalledExactlyOnceWith({
      where: { site_day: { site, day } },
      create: expect.objectContaining({ site, day, ...expected }),
      update: expect.objectContaining(expected),
    });
  });
});
