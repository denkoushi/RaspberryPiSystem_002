import { describe, expect, it } from 'vitest';

import { matchesHaizenSearch, normalizeHaizenSearch, parseHaizenSpeech, timeSincePlaced } from './haizenSearch';

import type { HaizenOverviewRow } from '../../../api/domains/mobile-placement';

const rows: HaizenOverviewRow[] = [{ source: 'branch', id: '1', branchNo: 1, shelfCodeRaw: '西-北-01', manufacturingOrderBarcodeRaw: '123', fseiban: 'BA1S2320', fhincd: 'K0381', fhinmei: '部品', machineName: 'ＲＶ－１２Ａ', updatedAt: '2026-10-22T00:00:00Z' }];

describe('haizen search', () => {
  it('normalizes case, full-width, hyphens and whitespace', () => {
    expect(normalizeHaizenSearch(' ｒｖ－１２ a — ')).toBe('RV12A');
    expect(matchesHaizenSearch(rows[0], { kind: 'machineName', text: 'rv12a' })).toBe(true);
    expect(matchesHaizenSearch(rows[0], { kind: 'fseiban', text: 'ｂａ１ｓ ２３' })).toBe(true);
    expect(matchesHaizenSearch(rows[0], { kind: 'fhincd', text: '- ' })).toBe(false);
    expect(matchesHaizenSearch({ ...rows[0], fhincd: null }, { kind: 'fhincd', text: '1' })).toBe(false);
  });
  it('searches snapshot fields for Zero2W rows with no branch number', () => {
    const row: HaizenOverviewRow = { ...rows[0], source: 'zero2w', branchNo: null };
    expect(matchesHaizenSearch(row, { kind: 'fseiban', text: 'BA1S2320' })).toBe(true);
    expect(matchesHaizenSearch(row, { kind: 'fhincd', text: 'K0381' })).toBe(true);
    expect(parseHaizenSpeech('RV12A', [row])).toEqual({ kind: 'machineName', text: 'RV12A' });
  });
  it.each([
    ['製番 BA1S2320', 'fseiban', 'BA1S2320'], ['品番 K0381。', 'fhincd', 'K0381'],
    ['機種 RV-12A', 'machineName', 'RV-12A'], ['機種名：ＲＶ－１２Ａ', 'machineName', 'RV-12A'],
    ['ba1s2320', 'fseiban', 'ba1s2320'], ['K0381', 'fhincd', 'K0381'], ['RV12A', 'machineName', 'RV12A']
  ])('parses %s', (speech, kind, text) => expect(parseHaizenSpeech(speech, rows)).toEqual({ kind, text }));
  it('uses seiban, part code, machine name priority without a keyword', () => {
    expect(parseHaizenSpeech('X', [{ ...rows[0], fseiban: 'X', fhincd: 'X', machineName: 'X' }])?.kind).toBe('fseiban');
    expect(parseHaizenSpeech('製番', rows)).toBeNull();
    expect(parseHaizenSpeech('unknown', rows)).toBeNull();
    expect(parseHaizenSpeech('品番 missing', rows)).toEqual({ kind: 'fhincd', text: 'missing' });
  });
  it('formats elapsed minutes, hours and days without negative ages', () => {
    const start = Date.parse(rows[0].updatedAt);
    expect(timeSincePlaced(rows[0].updatedAt, start - 1)).toBe('0分前');
    expect(timeSincePlaced(rows[0].updatedAt, start + 59 * 60000)).toBe('59分前');
    expect(timeSincePlaced(rows[0].updatedAt, start + 60 * 60000)).toBe('1時間前');
    expect(timeSincePlaced(rows[0].updatedAt, start + 1440 * 60000)).toBe('1日前');
  });
});
