import { describe, expect, it } from 'vitest';

import { calculateProductionScheduleDataHash, productionScheduleKeyColumnsForRow } from '../constants.js';
import { buildMaxProductNoWinnerCondition } from '../max-product-no-sql.js';
import { resolveToMaxProductNoPerLogicalKey } from '../max-product-no-resolver.js';
import {
  buildMaxProductNoLogicalKeyMatchAndSql,
  buildMaxProductNoLogicalKeyPartitionExprs,
} from '../max-product-no-winner-spec.js';

const base = { FSEIBAN: 'BA1SC381', FHINCD: 'MD005279290', FSIGENCD: '200', FKOJUN: '10' };

describe('製造オーダー番号をすべて残す(取り込み)', () => {
  it('同じ4列キーで ProductNo が違う2行は、確定製番でも2行とも保存される', () => {
    const rows = resolveToMaxProductNoPerLogicalKey([
      { data: { ...base, ProductNo: '0004146538' } },
      { data: { ...base, ProductNo: '0004146555' } },
    ]);
    expect(rows.map((row) => row.data.ProductNo)).toEqual(['0004146538', '0004146555']);
  });

  it('ProductNo が違えばハッシュも違い、完全に同じ5要素なら重複として1行になる', () => {
    const a = { ...base, ProductNo: '0004146538' };
    const b = { ...base, ProductNo: '0004146555' };
    expect(calculateProductionScheduleDataHash(a)).not.toBe(calculateProductionScheduleDataHash(b));
    expect(productionScheduleKeyColumnsForRow()).toEqual(['FSEIBAN', 'FHINCD', 'FSIGENCD', 'FKOJUN', 'ProductNo']);

    const deduped = resolveToMaxProductNoPerLogicalKey([{ data: a }, { data: { ...a } }, { data: b }]);
    expect(deduped).toHaveLength(2);
  });
});

describe('製造オーダー番号をすべて残す(SQL の定義)', () => {
  it('キーは常に ProductNo で比べ、仮製番の CASE を持たない', () => {
    const partition = buildMaxProductNoLogicalKeyPartitionExprs('r');
    const match = buildMaxProductNoLogicalKeyMatchAndSql('r2', 'r');
    for (const sql of [partition, match]) {
      expect(sql).toContain(`"rowData"->>'ProductNo'`);
      expect(sql).not.toContain('********');
      expect(sql).not.toContain('CASE');
    }
  });

  it('winner 条件は、印の付いた行を外側でも内側でも除く', () => {
    const sql = buildMaxProductNoWinnerCondition('CsvDashboardRow').sql;
    expect(sql).toContain(`"CsvDashboardRow"."supersededAt" IS NULL`);
    expect(sql).toContain(`"r2"."supersededAt" IS NULL`);
  });
});
