import { describe, expect, it } from 'vitest';

import {
  cleanOptionValue,
  compareOptionValues,
  isOfferedValue,
  toolData,
  TOOL_FIELD_VALUE_MAX_LENGTH,
  usedValueWhere,
} from '../item-inventory.fields.js';
import {
  buildItemInventoryGmailSearchQuery,
  escapeGmailQuotedSearchValue,
  extractEmail,
} from '../item-inventory-ingestion.policy.js';

describe('inventory tool field values', () => {
  it('toolData nulls missing fields on create but leaves them out on partial update', () => {
    expect(toolData({ maker: 'OSG' }, false)).toEqual({ maker: 'OSG', toolName: null, workMaterial: null, toolSize: null });
    expect(toolData({ maker: 'OSG' }, true)).toEqual({ maker: 'OSG' });
  });

  it('toolData normalizes full-width input and turns blank values into null', () => {
    expect(toolData({ toolSize: '　φ２０　', workMaterial: '   ' }, true)).toEqual({ toolSize: 'φ20', workMaterial: null });
  });

  it('cleanOptionValue trims and NFKC-normalizes, rejecting blank and overlong values', () => {
    expect(cleanOptionValue(' ＳＫＤ１１ ')).toBe('SKD11');
    expect(() => cleanOptionValue('　')).toThrow(expect.objectContaining({ statusCode: 400, message: '値を入力してください' }));
    expect(cleanOptionValue('a'.repeat(TOOL_FIELD_VALUE_MAX_LENGTH))).toHaveLength(200);
    expect(() => cleanOptionValue('a'.repeat(TOOL_FIELD_VALUE_MAX_LENGTH + 1))).toThrow(
      expect.objectContaining({ statusCode: 400, message: '値は200文字以内で入力してください' }),
    );
  });

  it('cleanOptionValue checks the length after trimming surrounding spaces', () => {
    expect(cleanOptionValue(` ${'a'.repeat(200)} `)).toHaveLength(200);
  });

  it('compareOptionValues sorts numbers naturally (φ20 before φ100)', () => {
    expect(['φ100', 'φ20', 'φ3'].sort(compareOptionValues)).toEqual(['φ3', 'φ20', 'φ100']);
  });

  it('isOfferedValue hides provisional names only for the name field', () => {
    expect(isOfferedValue('name', 'ItemlistRaspi 12')).toBe(false);
    expect(isOfferedValue('name', 'ItemlistRaspi 12 改')).toBe(true);
    expect(isOfferedValue('model', 'ItemlistRaspi 12')).toBe(true);
    expect(isOfferedValue('maker', '')).toBe(false);
    expect(isOfferedValue('maker', null)).toBe(false);
  });

  it('usedValueWhere skips deleted items and null values except for the required name column', () => {
    expect(usedValueWhere('name')).toEqual({ deletedAt: null });
    expect(usedValueWhere('toolSize')).toEqual({ deletedAt: null, toolSize: { not: null } });
  });
});

describe('item inventory Gmail ingestion policy', () => {
  it('builds an unread-inbox query from the reserved subject token', () => {
    expect(buildItemInventoryGmailSearchQuery({ subjectTokens: ['[ItemlistRaspi-photo]'] })).toBe(
      '(subject:"[ItemlistRaspi-photo]") in:inbox is:unread',
    );
  });

  it('ignores unreserved subject tokens and falls back to the reserved ones', () => {
    expect(buildItemInventoryGmailSearchQuery({ subjectTokens: ['[Other]', 'evil" OR in:sent'] })).toBe(
      '(subject:"[ItemlistRaspi-photo]") in:inbox is:unread',
    );
  });

  it('adds a trimmed from: clause only when a sender is configured', () => {
    expect(buildItemInventoryGmailSearchQuery({ subjectTokens: [], fromEmail: '  ops@example.com ' })).toBe(
      '(subject:"[ItemlistRaspi-photo]") in:inbox is:unread from:ops@example.com',
    );
    expect(buildItemInventoryGmailSearchQuery({ subjectTokens: [], fromEmail: '   ' })).not.toContain('from:');
  });

  it('escapes quotes and backslashes for a quoted Gmail search value', () => {
    expect(escapeGmailQuotedSearchValue('a"b\\c')).toBe('a\\"b\\\\c');
  });

  it('extracts and lower-cases the address from a From header', () => {
    expect(extractEmail('Tanaka <Ops@Example.COM>')).toBe('ops@example.com');
    expect(extractEmail(' Ops@Example.com ')).toBe('ops@example.com');
    expect(extractEmail(undefined)).toBeUndefined();
    expect(extractEmail('')).toBeUndefined();
  });
});
