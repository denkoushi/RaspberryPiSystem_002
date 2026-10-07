import { describe, expect, it } from 'vitest';

import { groupMaterials, groupWorkInstructionCandidates } from './procedure-material-grouping';

import type { ProcedureMaterialDto, ProcedureWorkInstructionCandidate } from './procedure-material-types';

const material = (id: string, subjectHint: string | null, receivedAt: string, extra: Partial<ProcedureMaterialDto> = {}): ProcedureMaterialDto => ({
  id, subjectHint, receivedAt, origin: 'GMAIL', kind: 'PHOTO', workInstructionRef: null, knowledgeRef: null,
  text: null, storageKey: null, sha256: null, contentType: null, byteSize: null, originalFileName: null,
  width: null, height: null, fromEmail: null, gmailMessageId: null, gmailDedupeKey: id,
  documentId: null, placedAt: null, discardedAt: null, createdAt: receivedAt, updatedAt: receivedAt, ...extra,
});
const candidate = (candidateKey: string, partNumber: string, shootingTarget: string, step: number): ProcedureWorkInstructionCandidate => ({
  candidateKey, partNumber, shootingTarget, step, memo: '', assetId: candidateKey, alreadyImported: false,
});

describe('groupMaterials', () => {
  it('puts missing hints last, sorts bundles and cards newest first, and keeps all kinds together without mutating input', () => {
    const materials = [
      material('old', '組立', '2026-10-05T00:00:00Z', { kind: 'TEXT' }),
      material('none', null, '2026-10-08T00:00:00Z'),
      material('other', '検査', '2026-10-06T00:00:00Z'),
      material('pdf', '組立', '2026-10-07T00:00:00Z', { kind: 'PDF' }),
      material('page', '組立', '2026-10-07T00:00:00Z'),
      material('empty', '', '2026-10-08T01:00:00Z'),
    ];
    const groups = groupMaterials(materials);
    expect(groups.map((group) => group.title)).toEqual(['組立', '検査', 'ヒントなし']);
    expect(groups[0].items.map((item) => item.id)).toEqual(['pdf', 'page', 'old']);
    expect(groups[2].items.map((item) => item.id)).toEqual(['empty', 'none']);
    expect(materials.map((item) => item.id)).toEqual(['old', 'none', 'other', 'pdf', 'page', 'empty']);
  });
  it('separates missing hints from literal labels and reserved keys', () => {
    const receivedAt = '2026-10-07T00:00:00Z';
    const groups = groupMaterials([
      material('none', null, receivedAt), material('blank', '　 \t ', receivedAt),
      material('literal', 'ヒントなし', receivedAt), material('reserved', '__no_hint__', receivedAt),
    ]);
    expect(groups.map(({ key, title, items }) => ({ key, title, ids: items.map((item) => item.id) }))).toEqual([
      { key: 'hint:ヒントなし', title: 'ヒントなし', ids: ['literal'] },
      { key: 'hint:__no_hint__', title: '__no_hint__', ids: ['reserved'] },
      { key: '__no_hint__', title: 'ヒントなし', ids: ['none', 'blank'] },
    ]);
  });
  it('normalizes hint comparison and search while preserving the first original label', () => {
    const groups = groupMaterials([
      material('first', '　ＤＦＤ１　 組立  ', '2026-10-06T00:00:00Z'),
      material('newer', 'DFD1 \t  組立', '2026-10-07T00:00:00Z'),
    ], ' ｄｆｄ１　　組立 ');
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('　ＤＦＤ１　 組立  ');
    expect(groups[0].items.map((item) => item.id)).toEqual(['newer', 'first']);
  });
  it('summarizes the card source and receipt range, with other sources noted', () => {
    const receivedAt = '2026-10-07T00:27:00Z';
    const newer = '2026-10-07T01:12:00Z';
    const groups = groupMaterials([material('a', '組立', receivedAt), material('b', '組立', newer, { origin: 'KNOWLEDGE' })]);
    const start = new Date(receivedAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const end = new Date(newer).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    expect(groups[0].subtitle).toBe(`ナレッジ ほか · ${start}〜${end}`);
    expect(groupMaterials([material('c', '加工', newer, { origin: 'WORK_INSTRUCTION' })])[0].subtitle).toMatch(/^加工 · /);
  });
  it('shows only bundles matching the hint during search', () => {
    const items = [material('a', 'DFD1 組立', '2026-10-07T00:00:00Z'), material('b', 'DFD2 検査', '2026-10-07T00:00:00Z'), material('c', null, '2026-10-07T00:00:00Z')];
    expect(groupMaterials(items, ' dfd1 ').map((group) => group.title)).toEqual(['DFD1 組立']);
    expect(groupMaterials(items, 'missing')).toEqual([]);
    expect(groupMaterials([])).toEqual([]);
  });
});

describe('groupWorkInstructionCandidates', () => {
  it('groups by part number, sorts targets then numeric steps, and summarizes target count and step range', () => {
    const items = [candidate('ten', '71-A61', 'A', 10), candidate('other', '80-C03', 'A', 3), candidate('b', '71-A61', 'B', 1), candidate('two', '71-A61', 'A', 2)];
    const groups = groupWorkInstructionCandidates(items);
    expect(groups.map((group) => group.title)).toEqual(['71-A61', '80-C03']);
    expect(groups[0].items.map((item) => item.candidateKey)).toEqual(['two', 'ten', 'b']);
    expect(groups[0].subtitle).toBe('撮影対象 2 · 手順 1〜10');
    expect(groups[1].subtitle).toBe('撮影対象 1 · 手順 3〜3');
    expect(items.map((item) => item.candidateKey)).toEqual(['ten', 'other', 'b', 'two']);
  });
  it('filters matching cards and bundles by part number or target with normalized search', () => {
    const items = [candidate('a', 'DFD1', '外径', 1), candidate('b', 'DFD1', '内径', 2), candidate('c', 'DFD2', '内径', 3)];
    expect(groupWorkInstructionCandidates(items, ' ｄｆｄ１ ')[0].items).toHaveLength(2);
    expect(groupWorkInstructionCandidates(items, '外径').map((group) => ({ title: group.title, items: group.items.map((item) => item.candidateKey) }))).toEqual([{ title: 'DFD1', items: ['a'] }]);
    expect(groupWorkInstructionCandidates(items, 'missing')).toEqual([]);
    expect(groupWorkInstructionCandidates([])).toEqual([]);
  });
});
