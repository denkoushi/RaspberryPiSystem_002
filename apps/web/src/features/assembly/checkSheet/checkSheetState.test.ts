import { describe, expect, it } from 'vitest';

import { makeCheckSheetFixture, makeStamp } from './checkSheet.fixture';
import { canComplete, emptyDraft, nextOpenItem, stageScale, stampInput } from './checkSheetState';

describe('check-sheet input and navigation', () => {
  it('requires valid numbers and all field keys but allows missing measurements for NG', () => {
    const item = makeCheckSheetFixture().revision.items.find((entry) => entry.id === '6-3')!;
    expect(stampInput(item, { ...emptyDraft(), result: 'OK', values: { value0: 'x' } }, undefined, 'tag')).toBeNull();
    expect(stampInput(item, { ...emptyDraft(), result: 'OK', values: { value0: '0' } }, undefined, 'tag')?.values).toEqual({ value0: 0 });
    expect(stampInput(item, { ...emptyDraft(), result: 'NG', ngAction: 'pause' }, undefined, 'tag')?.flagged).toBe(false);
    expect(stampInput(item, { ...emptyDraft(), result: 'NG', ngAction: 'flag' }, undefined, 'tag')).toBeNull();
  });
  it('requires conditional acknowledgement and a valid choice', () => {
    const item = makeCheckSheetFixture().revision.items.find((entry) => entry.id === '7-4')!;
    const draft = { ...emptyDraft(), result: 'OK' as const, values: { result: '有', value0: 'A', value1: 'B' } };
    expect(stampInput(item, draft, undefined, 'tag')).toBeNull();
    expect(stampInput(item, draft, 'applies', 'tag')?.values.result).toBe('有');
    expect(stampInput(item, { ...draft, values: { ...draft.values, result: '別' } }, 'applies', 'tag')).toBeNull();
  });
  it('wraps navigation and prevents completion with flags or a paused sheet', () => {
    const sheet = makeCheckSheetFixture();
    expect(nextOpenItem(sheet, '22-1')).toBe('6-3');
    expect(canComplete(sheet)).toBe(false);
    sheet.stamps = sheet.revision.items.map((item) => makeStamp(item.id));
    expect(canComplete(sheet)).toBe(true);
    expect(nextOpenItem(sheet, '22-1')).toBeNull();
    sheet.stamps[0].result = 'NG';
    expect(nextOpenItem(sheet, '22-1')).toBe('1-1');
    expect(canComplete(sheet)).toBe(false);
    sheet.status = 'PAUSED';
    expect(canComplete(sheet)).toBe(false);
  });
  it('only shrinks the 1920x1080 stage', () => {
    expect(stageScale(1280, 720)).toBe(2 / 3);
    expect(stageScale(2560, 1440)).toBe(1);
  });
});
