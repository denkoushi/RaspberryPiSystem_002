import { describe, expect, it } from 'vitest';

import { resolveEffectiveDueDisplay } from '../due-management-effective-due-display.js';

describe('resolveEffectiveDueDisplay', () => {
  it('prefers manual due over planned end', () => {
    const manual = new Date('2026-01-05T00:00:00.000Z');
    const csv = new Date('2026-02-01T00:00:00.000Z');
    const { displayDueDate, source } = resolveEffectiveDueDisplay({ manualDue: manual, plannedEndDate: csv });
    expect(displayDueDate?.getTime()).toBe(manual.getTime());
    expect(source).toBe('manual');
  });

  it('uses planned end when manual is null', () => {
    const csv = new Date('2026-02-01T00:00:00.000Z');
    const { displayDueDate, source } = resolveEffectiveDueDisplay({ manualDue: null, plannedEndDate: csv });
    expect(displayDueDate?.getTime()).toBe(csv.getTime());
    expect(source).toBe('csv');
  });

  it('returns null when both missing', () => {
    const { displayDueDate, source } = resolveEffectiveDueDisplay({ manualDue: null, plannedEndDate: null });
    expect(displayDueDate).toBeNull();
    expect(source).toBeNull();
  });
});
