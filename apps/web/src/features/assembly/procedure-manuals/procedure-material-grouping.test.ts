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
  it('groups a hinted PDF and its pages in numeric order without mutating input', () => {
    const receivedAt = '2026-10-07T00:00:00Z';
    const materials = [
      material('p3', 'DFD1 組立 (p3/3)', receivedAt, { gmailDedupeKey: 'mail:pdf:p3' }),
      material('p1', 'DFD1 組立 (p1/3)', receivedAt, { gmailDedupeKey: 'mail:pdf:p1' }),
      material('pdf', 'DFD1 組立', receivedAt, { kind: 'PDF', gmailDedupeKey: 'mail:pdf' }),
      material('p2', 'DFD1 組立 (p2/3)', receivedAt, { gmailDedupeKey: 'mail:pdf:p2' }),
    ];
    const before = structuredClone(materials);
    const groups = groupMaterials(materials);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'hint:DFD1 組立', title: 'DFD1 組立' });
    expect(groups[0].items.map(({ id }) => id)).toEqual(['pdf', 'p1', 'p2', 'p3']);
    expect(materials).toEqual(before);
  });
  it('groups hintless PDF pages by file base and mixes file bundles with hint bundles by receipt', () => {
    const receivedAt = '2026-10-07T00:00:00Z';
    const groups = groupMaterials([
      material('none', null, '2026-10-09T00:00:00Z'),
      material('p2', null, receivedAt, { originalFileName: '図面A p2.jpg', gmailDedupeKey: 'drawing:p2' }),
      material('pdf', null, receivedAt, { kind: 'PDF', originalFileName: '図面A.pdf', gmailDedupeKey: 'drawing' }),
      material('p1', '', receivedAt, { originalFileName: '図面A p1.jpg', gmailDedupeKey: 'drawing:p1' }),
      material('older', '組立', '2026-10-06T00:00:00Z'),
      material('newer', '検査', '2026-10-08T00:00:00Z'),
    ]);
    expect(groups.map(({ key, title }) => ({ key, title }))).toEqual([
      { key: 'hint:検査', title: '検査' },
      { key: 'file:図面A', title: '図面A' },
      { key: 'hint:組立', title: '組立' },
      { key: '__no_hint__', title: 'ヒントなし' },
    ]);
    expect(groups[1].items.map(({ id }) => id)).toEqual(['pdf', 'p1', 'p2']);
    expect(groups[3].items.map(({ id }) => id)).toEqual(['none']);
  });
  it('normalizes file base keys while preserving the first base and keeping hint keys distinct', () => {
    const receivedAt = '2026-10-07T00:00:00Z';
    const groups = groupMaterials([
      material('first', '　 ', receivedAt, { originalFileName: '　図面Ａ　 下段 p2.jpg', gmailDedupeKey: 'drawing:p2' }),
      material('second', null, receivedAt, { originalFileName: '図面A \t 下段 p1.jpg', gmailDedupeKey: 'drawing:p1' }),
      material('literal', 'file:図面A 下段', receivedAt),
      material('empty', '', receivedAt, { originalFileName: '' }),
    ]);
    expect(groups.map(({ key }) => key)).toEqual(['file:図面A 下段', 'hint:file:図面A 下段', '__no_hint__']);
    expect(groups[0].title).toBe('　図面Ａ　 下段');
    expect(groups[0].items.map(({ id }) => id)).toEqual(['second', 'first']);
    expect(groupMaterials(groups[0].items, '図面a 下段')).toHaveLength(1);
  });
  it('orders pages numerically even without a PDF parent', () => {
    const receivedAt = '2026-10-07T00:00:00Z';
    const groups = groupMaterials([
      material('p10', '組立 (p10/10)', receivedAt, { gmailDedupeKey: 'pdf:p10' }),
      material('p2', '組立 (p2/10)', receivedAt, { gmailDedupeKey: 'pdf:p2' }),
      material('p1', '組立 (p1/10)', receivedAt, { gmailDedupeKey: 'pdf:p1' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map(({ id }) => id)).toEqual(['p1', 'p2', 'p10']);
  });
  it('groups knowledge text chunks by stripped hint and orders them by chunk number', () => {
    const receivedAt = '2026-10-07T00:00:00Z';
    const groups = groupMaterials([
      material('second', '手順 (2/2)', receivedAt, { kind: 'TEXT', origin: 'KNOWLEDGE', gmailDedupeKey: 'knowledge:text:2' }),
      material('first', '手順 (1/2)', receivedAt, { kind: 'TEXT', origin: 'KNOWLEDGE', gmailDedupeKey: 'knowledge:text:1' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'hint:手順', title: '手順' });
    expect(groups[0].items.map(({ id }) => id)).toEqual(['first', 'second']);
  });
  it('sorts independent cards and sequence units by maximum receipt, preserving ties in input order', () => {
    const older = '2026-10-05T00:00:00Z';
    const middle = '2026-10-06T00:00:00Z';
    const newer = '2026-10-07T00:00:00Z';
    const groups = groupMaterials([
      material('p2', '組立 (p2/2)', middle, { gmailDedupeKey: 'pdf:p2' }),
      material('old-photo', '組立', older),
      material('other-p2', '組立 (p2/2)', middle, { gmailDedupeKey: 'other:p2' }),
      material('new-text', '組立', newer, { kind: 'TEXT', gmailDedupeKey: 'mail:body' }),
      material('tie-photo', '組立', newer),
      material('pdf', '組立', older, { kind: 'PDF', gmailDedupeKey: 'pdf' }),
      material('p1', '組立 (p1/2)', newer, { gmailDedupeKey: 'pdf:p1' }),
      material('other-p1', '組立 (p1/2)', middle, { gmailDedupeKey: 'other:p1' }),
      material('old-text', '組立', older, { kind: 'TEXT' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map(({ id }) => id)).toEqual([
      'pdf', 'p1', 'p2', 'new-text', 'tie-photo', 'other-p1', 'other-p2', 'old-photo', 'old-text',
    ]);
    const start = new Date(older).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const end = new Date(newer).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    expect(groups[0].subtitle).toBe(`メール · ${start}〜${end}`);
  });
  it('searches stripped bundle titles and preserves the first original label without its suffix', () => {
    const receivedAt = '2026-10-07T00:00:00Z';
    const materials = [
      material('p1', '　ＤＦＤ１　 組立 (p1/3)', receivedAt, { gmailDedupeKey: 'pdf:p1' }),
      material('p2', 'DFD1 \t 組立 (p2/3)', receivedAt, { gmailDedupeKey: 'pdf:p2' }),
      material('chunk', '手順 (1/2)', receivedAt, { kind: 'TEXT', gmailDedupeKey: 'knowledge:1' }),
    ];
    expect(groupMaterials(materials, ' ｄｆｄ１　組立 ').map(({ title }) => title)).toEqual(['　ＤＦＤ１　 組立']);
    expect(groupMaterials(materials, '(p1/3)')).toEqual([]);
    expect(groupMaterials(materials, '(1/2)')).toEqual([]);
  });
  it('keeps a hint that is only a page marker as its own titled bundle', () => {
    const receivedAt = '2026-10-07T00:00:00Z';
    const groups = groupMaterials([material('a', ' (p1/3)', receivedAt, { gmailDedupeKey: 'pdf:p1' }), material('b', '(p1/3)', receivedAt, { gmailDedupeKey: 'pdf:p2' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'hint:(p1/3)', title: ' (p1/3)' });
    expect(groupMaterials(groups[0].items, 'p1/3')).toHaveLength(1);
  });
  it('strips normalized full-width page suffixes while preserving the original title prefix', () => {
    const receivedAt = '2026-10-07T00:00:00Z';
    const materials = [
      material('p2', '　ＤＦＤ１　 組立　（ｐ２／３）　', receivedAt, { gmailDedupeKey: 'pdf:p2' }),
      material('p1', 'DFD1 組立 (p1/3)', receivedAt, { gmailDedupeKey: 'pdf:p1' }),
    ];
    const groups = groupMaterials(materials);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'hint:DFD1 組立', title: '　ＤＦＤ１　 組立' });
    expect(groups[0].items.map(({ id }) => id)).toEqual(['p1', 'p2']);
    expect(groupMaterials(materials, '(p2/3)')).toEqual([]);
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
