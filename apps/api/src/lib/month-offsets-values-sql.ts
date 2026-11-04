import { Prisma } from '@prisma/client';

/**
 * 月次推移 CTE 用の月オフセット表 `(VALUES (n),...) AS <alias>(n)` を返す（n = monthlyMonths-1 … 0）。
 *
 * `generate_series` は行数推定が既定の 1000 行になり、月別 GROUP BY との結合推定が数千万行まで膨らんで
 * JIT 閾値を超える。行数がリテラルで確定する VALUES にすると推定が実件数と一致する。
 * 月初の計算自体は従来どおり SQL 側（`cur_month_start - n * interval '1 month'`）で行う。
 */
export function monthOffsetsValuesSql(monthlyMonths: number, alias: string): Prisma.Sql {
  if (!Number.isInteger(monthlyMonths)) {
    throw new RangeError(`monthlyMonths must be an integer: ${monthlyMonths}`);
  }
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) {
    throw new RangeError(`invalid alias: ${alias}`);
  }
  if (monthlyMonths < 1) {
    return Prisma.raw(`(SELECT 0 AS n WHERE false) AS ${alias}(n)`);
  }
  const rows: string[] = [];
  for (let n = monthlyMonths - 1; n >= 0; n -= 1) {
    rows.push(`(${n})`);
  }
  return Prisma.raw(`(VALUES ${rows.join(', ')}) AS ${alias}(n)`);
}
