import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';

import { validateDraftMeasurementPayload } from '../entry-draft-validation.js';
import {
  countConfirmedEntries,
  isConfirmed,
  serializePersistenceStatus
} from '../entry-persistence-status.js';
import type { SelfInspectionTemplate } from '../shared.js';

const template = {
  id: 'tpl-1',
  items: [
    {
      id: 'item-1',
      sortOrder: 0,
      allowNegative: false,
      decimalPlaces: 2,
      lowerLimit: new Prisma.Decimal(9),
      upperLimit: new Prisma.Decimal(11),
      nominalValue: new Prisma.Decimal(10)
    },
    {
      id: 'item-2',
      sortOrder: 1,
      allowNegative: false,
      decimalPlaces: 2,
      lowerLimit: new Prisma.Decimal(9),
      upperLimit: new Prisma.Decimal(11),
      nominalValue: new Prisma.Decimal(10)
    }
  ]
} as unknown as SelfInspectionTemplate;

describe('entry-persistence-status', () => {
  it('counts only CONFIRMED entries', () => {
    expect(
      countConfirmedEntries([
        { persistenceStatus: 'CONFIRMED' },
        { persistenceStatus: 'DRAFT' },
        { persistenceStatus: 'CONFIRMED' }
      ])
    ).toBe(2);
  });

  it('serializes API lowercase status', () => {
    expect(serializePersistenceStatus('CONFIRMED')).toBe('confirmed');
    expect(serializePersistenceStatus('DRAFT')).toBe('draft');
    expect(isConfirmed('CONFIRMED')).toBe(true);
    expect(isConfirmed('DRAFT')).toBe(false);
  });
});

describe('validateDraftMeasurementPayload', () => {
  it('allows partial and blank values', () => {
    const normalized = validateDraftMeasurementPayload(template, [
      { templateItemId: 'item-1', value: '10.00' },
      { templateItemId: 'item-2', value: '' }
    ]);
    expect(normalized).toHaveLength(2);
    expect(normalized[0]?.value?.toString()).toBe('10');
    expect(normalized[1]?.value).toBeNull();
    expect(normalized.every((row) => row.reviewStatus === 'NOT_REQUIRED')).toBe(true);
  });

  it('allows omitting template items entirely', () => {
    const normalized = validateDraftMeasurementPayload(template, [
      { templateItemId: 'item-1', value: '10.5' }
    ]);
    expect(normalized).toHaveLength(1);
  });

  it('rejects invalid numbers', () => {
    expect(() =>
      validateDraftMeasurementPayload(template, [{ templateItemId: 'item-1', value: 'abc' }])
    ).toThrowError(/測定値は数値/);
  });

  it('rejects unknown template item ids', () => {
    expect(() =>
      validateDraftMeasurementPayload(template, [{ templateItemId: 'missing', value: '1' }])
    ).toThrowError(/測定点の指定が不正/);
  });
});
