import { describe, expect, it } from 'vitest';

import {
  buildFankenmeiKeyToCandidates,
  pickCustomerNameFromCandidates,
  type CustomerScawCsvCandidate,
} from '../customer-scaw-candidates.js';
import { parseCustomerScawFankenymdUtcDayMs } from '../customer-scaw-fankenymd.js';
import { normalizeCustomerScawMatchKey } from '../customer-scaw-normalize.js';

describe('customer-scaw candidates / FANKENYMD proximity', () => {
  it('parseCustomerScawFankenymdUtcDayMs: 日付だけ文字列はタイムゾーン非依存で同じ日を返す', () => {
    expect(parseCustomerScawFankenymdUtcDayMs('2026-04-14')).toBe(Date.UTC(2026, 3, 14));
    expect(parseCustomerScawFankenymdUtcDayMs('04/14/2026')).toBe(Date.UTC(2026, 3, 14));
    expect(parseCustomerScawFankenymdUtcDayMs('2026/04/14')).toBe(Date.UTC(2026, 3, 14));
    expect(parseCustomerScawFankenymdUtcDayMs('2026-04-14T00:00:00')).toBe(Date.UTC(2026, 3, 14));
    expect(parseCustomerScawFankenymdUtcDayMs('2026年4月14日')).toBe(Date.UTC(2026, 3, 14));
  });

  it('pickCustomerNameFromCandidates: 最短距離を採用', () => {
    const start = new Date('2026-04-15T00:00:00.000Z');
    const list: CustomerScawCsvCandidate[] = [
      { customerName: '近い', fankenymdUtcDayMs: Date.UTC(2026, 3, 20), scanIndex: 0 },
      { customerName: '最寄り', fankenymdUtcDayMs: Date.UTC(2026, 3, 14), scanIndex: 1 },
    ];
    expect(pickCustomerNameFromCandidates(list, start)).toBe('最寄り');
  });

  it('pickCustomerNameFromCandidates: 同距離は着手日以前の FANKENYMD を優先', () => {
    const start = new Date('2026-04-15T00:00:00.000Z');
    const list: CustomerScawCsvCandidate[] = [
      { customerName: '未来側', fankenymdUtcDayMs: Date.UTC(2026, 3, 20), scanIndex: 0 },
      { customerName: '過去側', fankenymdUtcDayMs: Date.UTC(2026, 3, 10), scanIndex: 1 },
    ];
    expect(pickCustomerNameFromCandidates(list, start)).toBe('過去側');
  });

  it('pickCustomerNameFromCandidates: さらに同率なら CSV 後勝ち（scanIndex 最大）', () => {
    const start = new Date('2026-04-15T00:00:00.000Z');
    const day = Date.UTC(2026, 3, 12);
    const list: CustomerScawCsvCandidate[] = [
      { customerName: '先', fankenymdUtcDayMs: day, scanIndex: 0 },
      { customerName: '後', fankenymdUtcDayMs: day, scanIndex: 1 },
    ];
    expect(pickCustomerNameFromCandidates(list, start)).toBe('後');
  });

  it('pickCustomerNameFromCandidates: 着手日が無いときは後勝ち', () => {
    const list: CustomerScawCsvCandidate[] = [
      { customerName: '先', fankenymdUtcDayMs: Date.UTC(2026, 3, 1), scanIndex: 0 },
      { customerName: '後', fankenymdUtcDayMs: Date.UTC(2026, 3, 30), scanIndex: 1 },
    ];
    expect(pickCustomerNameFromCandidates(list, null)).toBe('後');
    expect(pickCustomerNameFromCandidates(list, undefined)).toBe('後');
  });

  it('pickCustomerNameFromCandidates: 有効な FANKENYMD が無いときは後勝ち', () => {
    const start = new Date('2026-04-15T00:00:00.000Z');
    const list: CustomerScawCsvCandidate[] = [
      { customerName: '先', fankenymdUtcDayMs: null, scanIndex: 0 },
      { customerName: '後', fankenymdUtcDayMs: null, scanIndex: 1 },
    ];
    expect(pickCustomerNameFromCandidates(list, start)).toBe('後');
  });

  it('buildFankenmeiKeyToCandidates: 同一 FANKENMEI で複数候補を保持', () => {
    const map = buildFankenmeiKeyToCandidates([
      { rowData: { Customer: 'A社', FANKENMEI: '機種X', FANKENYMD: '2026-04-10' } },
      { rowData: { Customer: 'B社', FANKENMEI: '機種X', FANKENYMD: '2026-04-20' } },
    ]);
    const key = normalizeCustomerScawMatchKey('機種X');
    const list = map.get(key);
    expect(list).toHaveLength(2);
    expect(list?.[0]?.customerName).toBe('A社');
    expect(list?.[1]?.customerName).toBe('B社');
    expect(list?.[0]?.scanIndex).toBe(0);
    expect(list?.[1]?.scanIndex).toBe(1);
  });
});
