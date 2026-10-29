import { Prisma } from '@prisma/client';
import { foldPartSearchKana, PART_SEARCH_KANA_FOLD_DELETE, PART_SEARCH_KANA_FOLD_TRANSLATION, partSearchTermVariantsForIlike } from '@raspi-system/part-search-core';
import { describe, expect, it } from 'vitest';

import { wrapJsonTextFieldForPartSearchComparable } from '../part-search-field-comparable-sql.js';

describe('part-search comparable SQL', () => {
  it('binds shared kana mapping and deletions after the sokuon replacements', () => {
    const sql = wrapJsonTextFieldForPartSearchComparable(Prisma.sql`("rowData"->>'FHINMEI')`);
    expect(sql.text).toBe('translate(REPLACE(REPLACE(("rowData"->>\'FHINMEI\'), $1, $2), $3, $4), $5, $6)');
    expect(sql.values).toEqual(['ッ', 'ツ', 'っ', 'つ', PART_SEARCH_KANA_FOLD_TRANSLATION.from + PART_SEARCH_KANA_FOLD_DELETE, PART_SEARCH_KANA_FOLD_TRANSLATION.to]);
  });
  it.each(['テーブル', 'てーぶる', 'ばるぶ', 'パルプ', 'ヴー', 'ゔｰ', 'ナット'])('matches folded DB text with the ILIKE variants: %s', (value) => {
    const sql = wrapJsonTextFieldForPartSearchComparable(Prisma.sql`field`);
    const from = [...String(sql.values[4])];
    const to = [...String(sql.values[5])];
    const sokuon = value.replaceAll('ッ', 'ツ').replaceAll('っ', 'つ');
    // PostgreSQL translate maps by position, deleting surplus source characters.
    const translated = [...sokuon].map((char) => from.includes(char) ? (to[from.indexOf(char)] ?? '') : char).join('');
    expect(translated).toBe(foldPartSearchKana(sokuon));
    expect(partSearchTermVariantsForIlike(value)).toContain(translated);
  });
});
