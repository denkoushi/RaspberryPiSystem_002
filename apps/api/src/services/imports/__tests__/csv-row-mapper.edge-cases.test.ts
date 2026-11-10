import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import type { ColumnDefinition } from '../../csv-dashboard/csv-dashboard.types.js';
import { CsvRowMapper } from '../csv-row-mapper.js';

const def = (internalName: string, candidates: string[], extra: Partial<ColumnDefinition> = {}): ColumnDefinition => ({
  internalName,
  displayName: `${internalName}表示`,
  csvHeaderCandidates: candidates,
  dataType: 'string',
  order: 0,
  ...extra,
});

const map = (text: string, defs: ColumnDefinition[]) => new CsvRowMapper().mapBuffer(Buffer.from(text, 'utf-8'), defs);

describe('CsvRowMapper edge cases', () => {
  it('returns [] for an empty buffer and for a header-only CSV', () => {
    expect(new CsvRowMapper().mapBuffer(Buffer.alloc(0), [def('code', ['code'])])).toEqual([]);
    expect(map('code\n', [def('code', ['code'])])).toEqual([]);
  });

  it('matches headers ignoring BOM, ASCII/full-width surrounding spaces and letter case', () => {
    const rows = map('﻿　Code　, NAME \nA1,ボルト\n', [def('code', ['code']), def('name', ['Name'])]);
    expect(rows).toEqual([{ code: 'A1', name: 'ボルト' }]);
  });

  it('matches candidate strings that carry stray quotes or full-width spaces', () => {
    const rows = map('社員コード,氏名\n001,山田\n', [def('code', ['"社員コード"']), def('name', ['　氏名　'])]);
    expect(rows).toEqual([{ code: '001', name: '山田' }]);
  });

  it('does not treat full-width and half-width letters as the same header', () => {
    expect(() => map('ＣＯＤＥ\nA1\n', [def('code', ['CODE'])])).toThrow(ApiError);
  });

  it('uses whichever candidate matches and maps by header position, not definition order', () => {
    const rows = map('氏名,ID\n佐藤,9\n', [def('id', ['employeeCode', 'ID']), def('name', ['名前', '氏名'])]);
    expect(rows).toEqual([{ id: '9', name: '佐藤' }]);
  });

  it('picks the first matching CSV column when a header appears twice', () => {
    const rows = map('code,code\nfirst,second\n', [def('code', ['code'])]);
    expect(rows).toEqual([{ code: 'first' }]);
  });

  it('throws a 400 describing the missing required column and the first 5 actual headers', () => {
    let caught: unknown;
    try {
      map('a,b,c,d,e,f\n1,2,3,4,5,6\n', [def('code', ['社員コード', 'employeeCode'], { displayName: '社員コード' })]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiError);
    const apiError = caught as ApiError;
    expect(apiError.statusCode).toBe(400);
    expect(apiError.message).toContain('見つからなかった列: 社員コード (内部名: code)');
    expect(apiError.message).toContain('候補: 社員コード, employeeCode');
    expect(apiError.message).toContain('実際のCSVヘッダー: a, b, c, d, e...');
    expect(apiError.message).not.toContain(', f');
  });

  it('does not append an ellipsis when there are 5 or fewer headers', () => {
    expect(() => map('a,b\n1,2\n', [def('code', ['code'])])).toThrow(/実際のCSVヘッダー: a, b 対応:/);
  });

  it('omits optional columns that are missing instead of emitting empty strings', () => {
    const rows = map('code\nA1\n', [def('code', ['code']), def('note', ['note'], { required: false })]);
    expect(rows).toEqual([{ code: 'A1' }]);
    expect(rows[0]).not.toHaveProperty('note');
  });

  it('treats required: undefined as required', () => {
    expect(() => map('code\nA1\n', [def('code', ['code']), def('note', ['note'])])).toThrow(ApiError);
  });

  it('fills short rows with empty strings and ignores extra cells', () => {
    const rows = map('code,name,qty\nA1\nA2,ナット,3,extra\n', [def('code', ['code']), def('name', ['name']), def('qty', ['qty'])]);
    expect(rows).toEqual([
      { code: 'A1', name: '', qty: '' },
      { code: 'A2', name: 'ナット', qty: '3' },
    ]);
  });

  it('skips blank lines, keeps quoted commas/newlines and trims values', () => {
    const rows = map('code,name\n\n A1 ,"ボルト, M8"\n\nA2,"複数\n行"\n', [def('code', ['code']), def('name', ['name'])]);
    expect(rows).toEqual([
      { code: 'A1', name: 'ボルト, M8' },
      { code: 'A2', name: '複数\n行' },
    ]);
  });

  it('handles CRLF line endings', () => {
    const rows = map('code,name\r\nA1,ボルト\r\n', [def('code', ['code']), def('name', ['name'])]);
    expect(rows).toEqual([{ code: 'A1', name: 'ボルト' }]);
  });
});
