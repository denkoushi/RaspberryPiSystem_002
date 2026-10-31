import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { buildPublishedExamplesPrompt, loadPublishedProcedures, selectPublishedExamples, type PublishedProcedure } from '../procedure-published-examples.js';

const doc = (texts: string[], revisionRootId = 'other'): PublishedProcedure => ({ id: revisionRootId, revisionRootId, texts, updatedAt: new Date(0) });
afterEach(() => vi.restoreAllMocks());
describe('published examples selection', () => {
  it('loads only published active heads and classifies across revisions with assembly priority', async () => {
    const updatedAt = new Date('2026-10-31T00:00:00Z');
    vi.spyOn(prisma.assemblyProcedureDocument, 'findMany').mockResolvedValue(['assembly-root', 'grinding-root'].map(id => ({
      id, updatedAt: new Date(0), publishedAt: new Date(0), revisionMetadata: { revisionRootId: id, updatedAt: new Date(0) },
      overlayElements: [{ text: '専用受台', updatedAt }, { text: '  ', updatedAt }],
    })) as never);
    vi.spyOn(prisma.procedureManualAssignment, 'findMany').mockResolvedValue([
      { process: { name: '研削', parent: null }, assemblyProcedureDocument: { revisionMetadata: { revisionRootId: 'assembly-root' } } },
      { process: { name: '検査', parent: { name: '組立工程' } }, assemblyProcedureDocument: { revisionMetadata: { revisionRootId: 'assembly-root' } } },
      { process: { name: '検査', parent: { name: '研削工程' } }, assemblyProcedureDocument: { revisionMetadata: { revisionRootId: 'grinding-root' } } },
    ] as never);
    expect(await loadPublishedProcedures('grinding')).toEqual([{ id: 'grinding-root', revisionRootId: 'grinding-root', texts: ['専用受台'], updatedAt }]);
    expect(prisma.assemblyProcedureDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'PUBLISHED', isActive: true, revisionMetadata: { isRevisionHead: true } },
      select: expect.objectContaining({ overlayElements: { where: { kind: 'TEXT' }, select: { text: true, updatedAt: true } } }),
    }));
  });
  it('deduplicates ignoring whitespace and excludes the current revision root', () => {
    expect(selectPublishedExamples([doc(['同じ 文', '同じ\n文', '同じ文']), doc(['除外'], 'current')], 'current', [])).toHaveLength(1);
    expect(selectPublishedExamples([doc(['除外'], 'current')], 'current', [])).toEqual([]);
  });
  it('ranks by bigram similarity then length then string', () => {
    expect(selectPublishedExamples([doc(['遠い文章', '固定する', 'いあ', 'あい', 'ワークを固定する'])], 'current', ['ワークを固定する']))
      .toEqual(['ワークを固定する', '固定する', 'あい', 'いあ', '遠い文章']);
  });
  it('caps the total at 1500 Unicode characters without truncating texts', () => {
    const examples = selectPublishedExamples([doc(['あ'.repeat(1000), 'い'.repeat(500), 'う'.repeat(600), '😀'.repeat(1501)])], 'current', ['ああ']);
    expect(examples.reduce((n, t) => n + Array.from(t).length, 0)).toBe(1500);
    expect(examples).toEqual(['あ'.repeat(1000), 'い'.repeat(500)]);
  });
  it('returns empty examples and no prompt with no source', () => {
    expect(selectPublishedExamples([], 'current', ['固定'])).toEqual([]);
    expect(buildPublishedExamplesPrompt([])).toBe('');
    expect(buildPublishedExamplesPrompt(['一行\n次行'])).toContain('"一行\\n次行"');
  });
});
