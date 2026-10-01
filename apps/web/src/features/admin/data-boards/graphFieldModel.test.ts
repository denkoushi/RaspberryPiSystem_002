import { describe, expect, it } from 'vitest';

import { detectGraphTemplate, graphFieldsFor, isEditableJson, readJsonField, writeJsonField } from './graphFieldModel';

describe('detectGraphTemplate', () => {
  it('maps known data sources to templates and everything else to custom', () => {
    expect(detectGraphTemplate('uninspected_machines')).toBe('uninspected');
    expect(detectGraphTemplate(' pallet_visualization_board ')).toBe('pallet');
    expect(detectGraphTemplate('measuring_instruments')).toBe('custom');
    expect(graphFieldsFor('custom')).toEqual([]);
  });
});

describe('JSON field read/write', () => {
  const json = JSON.stringify({ csvDashboardId: 'c1', date: '', maxRows: 30, keep: { nested: true } }, null, 2);

  it('reads strings and numbers, empty for missing or non-scalar values', () => {
    expect(readJsonField(json, 'maxRows')).toBe('30');
    expect(readJsonField(json, 'csvDashboardId')).toBe('c1');
    expect(readJsonField(json, 'keep')).toBe('');
    expect(readJsonField('not json', 'maxRows')).toBe('');
  });

  it('changes one key and keeps every other key and their order', () => {
    const next = writeJsonField(json, { key: 'maxRows', kind: 'number', min: 1, max: 200 }, '45');
    expect(JSON.parse(next)).toEqual({ csvDashboardId: 'c1', date: '', maxRows: 45, keep: { nested: true } });
    expect(Object.keys(JSON.parse(next))).toEqual(['csvDashboardId', 'date', 'maxRows', 'keep']);
  });

  it('clamps numbers, ignores non-numbers and removes the key when cleared', () => {
    const field = { key: 'maxRows', kind: 'number' as const, min: 1, max: 200 };
    expect(JSON.parse(writeJsonField(json, field, '9999')).maxRows).toBe(200);
    expect(writeJsonField(json, field, 'abc')).toBe(json);
    expect('maxRows' in JSON.parse(writeJsonField(json, field, ''))).toBe(false);
  });

  it('writes only well-formed dates and drops the key when cleared', () => {
    const field = { key: 'date', kind: 'date' as const };
    expect(JSON.parse(writeJsonField(json, field, '2026-10-01')).date).toBe('2026-10-01');
    expect(writeJsonField(json, field, '10/01')).toBe(json);
    expect('date' in JSON.parse(writeJsonField(json, field, ''))).toBe(false);
  });

  it('never rewrites broken JSON and reports it as not editable', () => {
    expect(writeJsonField('{ broken', { key: 'maxRows', kind: 'number' }, '5')).toBe('{ broken');
    expect(isEditableJson('{ broken')).toBe(false);
    expect(isEditableJson('')).toBe(true);
    expect(isEditableJson('[1]')).toBe(false);
  });
});
