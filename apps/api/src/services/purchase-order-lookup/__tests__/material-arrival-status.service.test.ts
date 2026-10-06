import { describe, expect, it } from 'vitest';

import {
  isMaterialPurchasePartCode,
  materialArrivalLookupKey,
  resolveMaterialArrivalStatus,
  resolveMaterialArrivalByPart,
} from '../material-arrival-status.service.js';

describe('isMaterialPurchasePartCode', () => {
  it('treats (A), -001 and -002 as material orders', () => {
    expect(isMaterialPurchasePartCode('MD000025310(A)')).toBe(true);
    expect(isMaterialPurchasePartCode('MD100024231-001')).toBe(true);
    expect(isMaterialPurchasePartCode('MD100586740-002')).toBe(true);
    expect(isMaterialPurchasePartCode('MD100586740-001-1')).toBe(true);
  });

  it('does not treat the part itself, pattern costs or rework as material', () => {
    expect(isMaterialPurchasePartCode('MD100024231')).toBe(false);
    expect(isMaterialPurchasePartCode('MD100024231-003')).toBe(false);
    expect(isMaterialPurchasePartCode('MD100024231-016')).toBe(false);
    expect(isMaterialPurchasePartCode('MD100024231-048')).toBe(false);
    expect(isMaterialPurchasePartCode('MD100024231(FM)')).toBe(false);
    expect(isMaterialPurchasePartCode('MD100024231(KIGATA)')).toBe(false);
  });
});

describe('resolveMaterialArrivalStatus', () => {
  it('maps FKOBAIST to a status', () => {
    expect(resolveMaterialArrivalStatus(['C'])).toBe('received');
    expect(resolveMaterialArrivalStatus(['S'])).toBe('partial');
    expect(resolveMaterialArrivalStatus(['R'])).toBe('ordered');
    expect(resolveMaterialArrivalStatus(['O'])).toBe('unordered');
    expect(resolveMaterialArrivalStatus(['P'])).toBe('unordered');
  });

  it('shows the most delayed status when several material rows exist', () => {
    expect(resolveMaterialArrivalStatus(['C', 'R'])).toBe('ordered');
    expect(resolveMaterialArrivalStatus(['C', 'S'])).toBe('partial');
    expect(resolveMaterialArrivalStatus(['S', 'P', 'C'])).toBe('unordered');
  });

  it('ignores deleted (X), unknown and not-yet-imported rows', () => {
    expect(resolveMaterialArrivalStatus(['X', 'C'])).toBe('received');
    expect(resolveMaterialArrivalStatus(['X'])).toBeNull();
    expect(resolveMaterialArrivalStatus([null, '?'])).toBeNull();
    expect(resolveMaterialArrivalStatus([])).toBeNull();
  });
});

describe('materialArrivalLookupKey', () => {
  it('joins seiban with the FHINCD match key', () => {
    expect(materialArrivalLookupKey(' CA1S1M11 ', 'MD100024231')).toBe('CA1S1M11\tMD100024231');
  });
});

describe('resolveMaterialArrivalByPart', () => {
  const row = (raw: string, purchaseStatus: string | null) => ({ raw, purchaseStatus, matchKey: 'MD1' });

  it('uses the slowest undecorated part status only when material is deleted', () => {
    expect(resolveMaterialArrivalByPart([row('MD1(A)', 'X'), row('MD1-001', 'X'), row(' MD1 ', 'C'), row('MD1', 'R')]))
      .toEqual({ status: 'ordered', basis: 'part' });
  });

  it('keeps the material basis when any material status resolves', () => {
    expect(resolveMaterialArrivalByPart([row('MD1-001', 'X'), row('MD1(A)', 'C'), row('MD1', 'R')]))
      .toEqual({ status: 'received', basis: 'material' });
  });

  it.each([
    [row('MD1', 'C')],
    [row('MD1-001', null), row('MD1', 'C')],
    [row('MD1-001', 'X')],
    [row('MD1-001', 'X'), row('MD1', 'X')],
    [row('MD1-001', 'X'), row('MD1', null)],
    [row('MD1-001', 'X'), row('MD1-003', 'C')],
    [row('MD1-001', 'X'), row('MD1(FM)', 'C')]
  ])('does not resolve ineligible or unresolved substitute rows (%j)', (...rows) => {
    expect(resolveMaterialArrivalByPart(rows)).toBeNull();
  });

  it('allows X mixed with null and trims the match key', () => {
    expect(resolveMaterialArrivalByPart([row('MD1-001', null), row('MD1(A)', ' x '), { ...row(' MD1 ', 'S'), matchKey: ' MD1 ' }]))
      .toEqual({ status: 'partial', basis: 'part' });
  });
});
