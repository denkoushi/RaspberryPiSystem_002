import { describe, expect, it } from 'vitest';

import {
  decodeContentChoice,
  encodeContentChoice,
  fullChoiceValue,
  sameDays,
  splitChoiceValue,
  validateScheduleDraft,
  type ScheduleDraftForValidation,
} from './scheduleDraftModel';

const draft = (partial: Partial<ScheduleDraftForValidation> = {}): ScheduleDraftForValidation => ({
  name: '午後のKPI',
  dayOfWeek: [1, 2, 3],
  startTime: '13:00',
  endTime: '17:00',
  isChatLayout: false,
  layoutType: 'FULL',
  fullChoice: 'builtin:loans',
  leftChoice: 'builtin:loans',
  rightChoice: 'pdf:p1',
  fullSlotKind: 'loans',
  kioskDeviceScopeKey: '',
  leaderOrderDeviceScopeKey: '',
  leaderOrderResourceCdsText: '',
  selfInspectionTargetMode: 'kiosk_active_sessions',
  selfInspectionMachineName: '',
  ...partial,
});

describe('content choice encoding', () => {
  it('round-trips builtin kinds and id-based content, rejects unknown values', () => {
    expect(decodeContentChoice(encodeContentChoice({ type: 'builtin', kind: 'loans' }))).toEqual({ type: 'builtin', kind: 'loans' });
    expect(decodeContentChoice(encodeContentChoice({ type: 'web_page', id: 'cap-1' }))).toEqual({ type: 'web_page', id: 'cap-1' });
    expect(decodeContentChoice('builtin:unknown')).toBeNull();
    expect(decodeContentChoice('pdf:')).toBeNull();
    expect(decodeContentChoice('')).toBeNull();
  });

  it('derives the selected value from editor state', () => {
    const base = { fullPdfId: null, fullCsvDashboardId: null, fullVisualizationDashboardId: null, fullWebCaptureId: null };
    expect(fullChoiceValue({ ...base, fullSlotKind: 'web_page', fullWebCaptureId: 'cap-1' })).toBe('web_page:cap-1');
    expect(fullChoiceValue({ ...base, fullSlotKind: 'web_page' })).toBe('');
    expect(fullChoiceValue({ ...base, fullSlotKind: 'kiosk_leader_order_cards' })).toBe('builtin:kiosk_leader_order_cards');
    expect(splitChoiceValue('pdf', { pdfId: 'p1', csvDashboardId: null, visualizationDashboardId: null })).toBe('pdf:p1');
    expect(splitChoiceValue('loans', { pdfId: null, csvDashboardId: null, visualizationDashboardId: null })).toBe('builtin:loans');
  });
});

describe('validateScheduleDraft', () => {
  it('accepts a complete draft', () => {
    expect(validateScheduleDraft(draft())).toBeNull();
  });

  it.each([
    [{ name: '  ' }, '名前'],
    [{ dayOfWeek: [] }, '曜日'],
    [{ endTime: '13:00' }, '終わりの時刻'],
    [{ startTime: '' }, '時間'],
    [{ fullChoice: '' }, '表示するもの'],
    [{ layoutType: 'SPLIT' as const, rightChoice: '' }, '左右'],
    [{ fullSlotKind: 'kiosk_progress_overview' as const, fullChoice: 'builtin:kiosk_progress_overview' }, 'スコープキー'],
    [
      { fullSlotKind: 'kiosk_leader_order_cards' as const, leaderOrderDeviceScopeKey: 'x', fullChoice: 'builtin:kiosk_leader_order_cards' },
      '資源CD',
    ],
    [
      { fullSlotKind: 'self_inspection_machine_board' as const, selfInspectionTargetMode: 'manual_machine_name' as const },
      '機種名',
    ],
  ])('reports %j', (partial, expected) => {
    expect(validateScheduleDraft(draft(partial))).toContain(expected);
  });

  it('only checks name, days and time for a Chat-made layout', () => {
    expect(validateScheduleDraft(draft({ isChatLayout: true, fullChoice: '' }))).toBeNull();
  });
});

describe('sameDays', () => {
  it('ignores order', () => {
    expect(sameDays([5, 1, 3, 2, 4], [1, 2, 3, 4, 5])).toBe(true);
    expect(sameDays([1, 2], [1, 2, 3])).toBe(false);
    expect(sameDays(undefined, [])).toBe(true);
  });
});
