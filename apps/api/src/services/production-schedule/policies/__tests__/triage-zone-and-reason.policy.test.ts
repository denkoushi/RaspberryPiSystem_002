import { describe, expect, it } from 'vitest';

import { buildTriageReasons, type TriageReasonInput } from '../triage-reason-policy.js';
import { classifyTriageZone } from '../triage-zone-policy.js';

describe('classifyTriageZone', () => {
  const small = { partsCount: 0, processCount: 0 };

  it.each([
    [-5, 'danger'],
    [0, 'danger'],
    [1, 'danger'],
    [2, 'caution'],
    [3, 'caution'],
    [4, 'safe'],
    [30, 'safe']
  ] as const)('daysUntilDue=%s with small remaining work -> %s', (daysUntilDue, expected) => {
    expect(classifyTriageZone({ daysUntilDue, ...small })).toBe(expected);
  });

  it('treats a missing due date as caution (not safe)', () => {
    expect(classifyTriageZone({ daysUntilDue: null, ...small })).toBe('caution');
  });

  it('escalates one level when parts count reaches 20 (boundary is inclusive)', () => {
    expect(classifyTriageZone({ daysUntilDue: 10, partsCount: 19, processCount: 0 })).toBe('safe');
    expect(classifyTriageZone({ daysUntilDue: 10, partsCount: 20, processCount: 0 })).toBe('caution');
    expect(classifyTriageZone({ daysUntilDue: 2, partsCount: 20, processCount: 0 })).toBe('danger');
  });

  it('escalates one level when process count reaches 40 (boundary is inclusive)', () => {
    expect(classifyTriageZone({ daysUntilDue: 10, partsCount: 0, processCount: 39 })).toBe('safe');
    expect(classifyTriageZone({ daysUntilDue: 10, partsCount: 0, processCount: 40 })).toBe('caution');
  });

  it('escalates only once even when both parts and process thresholds are exceeded', () => {
    expect(classifyTriageZone({ daysUntilDue: 10, partsCount: 100, processCount: 100 })).toBe('caution');
  });

  it('escalates a missing due date with large work to danger', () => {
    expect(classifyTriageZone({ daysUntilDue: null, partsCount: 20, processCount: 0 })).toBe('danger');
  });

  it('stays danger (clamped) when already danger and large work', () => {
    expect(classifyTriageZone({ daysUntilDue: -1, partsCount: 50, processCount: 50 })).toBe('danger');
  });
});

describe('buildTriageReasons', () => {
  const base: TriageReasonInput = {
    dueDateText: '2026-11-10',
    daysUntilDue: 10,
    partsCount: 0,
    processCount: 0,
    topProcessingType: null
  };

  it('returns no reasons for a comfortable item', () => {
    expect(buildTriageReasons(base)).toEqual([]);
  });

  it.each([
    [-1, 'DUE_DATE_OVERDUE', '納期日を超過しています'],
    [0, 'DUE_DATE_TODAY', '納期日が今日です'],
    [1, 'DUE_DATE_TOMORROW', '納期日が明日です'],
    [2, 'DUE_DATE_SOON', '納期日が3日以内です'],
    [3, 'DUE_DATE_SOON', '納期日が3日以内です']
  ] as const)('daysUntilDue=%s -> %s', (daysUntilDue, code, message) => {
    expect(buildTriageReasons({ ...base, daysUntilDue })).toEqual([{ code, message }]);
  });

  it('adds no due-date reason at 4 days', () => {
    expect(buildTriageReasons({ ...base, daysUntilDue: 4 })).toEqual([]);
  });

  it('reports DUE_DATE_MISSING when due date text is empty, ignoring daysUntilDue', () => {
    expect(buildTriageReasons({ ...base, dueDateText: null, daysUntilDue: -3 })).toEqual([
      { code: 'DUE_DATE_MISSING', message: '納期日が未設定です' }
    ]);
    expect(buildTriageReasons({ ...base, dueDateText: '', daysUntilDue: null }).map((r) => r.code)).toEqual([
      'DUE_DATE_MISSING'
    ]);
  });

  it('emits no due-date reason when text is present but daysUntilDue is null', () => {
    expect(buildTriageReasons({ ...base, daysUntilDue: null })).toEqual([]);
  });

  it('includes counts in large-work messages at inclusive thresholds', () => {
    expect(buildTriageReasons({ ...base, partsCount: 19, processCount: 39 })).toEqual([]);
    expect(buildTriageReasons({ ...base, partsCount: 20, processCount: 40 })).toEqual([
      { code: 'LARGE_PART_COUNT', message: '未完了部品が多いです（20件）' },
      { code: 'LARGE_PROCESS_COUNT', message: '未完了工程が多いです（40件）' }
    ]);
  });

  it.each(['LSLH', 'カニゼン', '塗装'])('flags surface priority for %s', (topProcessingType) => {
    expect(buildTriageReasons({ ...base, topProcessingType })).toEqual([
      { code: 'SURFACE_PRIORITY', message: `表面処理優先ルール対象（${topProcessingType}）` }
    ]);
  });

  it.each(['その他01', 'lslh', ' LSLH', ''])('does not flag surface priority for %j', (topProcessingType) => {
    expect(buildTriageReasons({ ...base, topProcessingType })).toEqual([]);
  });

  it('orders reasons as due date, parts, process, surface', () => {
    const codes = buildTriageReasons({
      dueDateText: '2026-11-04',
      daysUntilDue: 0,
      partsCount: 25,
      processCount: 45,
      topProcessingType: '塗装'
    }).map((r) => r.code);
    expect(codes).toEqual(['DUE_DATE_TODAY', 'LARGE_PART_COUNT', 'LARGE_PROCESS_COUNT', 'SURFACE_PRIORITY']);
  });
});
