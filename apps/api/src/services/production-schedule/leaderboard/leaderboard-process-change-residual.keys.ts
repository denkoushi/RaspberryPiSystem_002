export type ProcessChangeResidualStrongEvidenceKey = {
  productNo: string;
  fkojun: string;
  resourceCd: string;
};

export type ProcessChangeResidualStrongEvidenceKeyArrays = {
  productNos: string[];
  fkojuns: string[];
  resourceCds: string[];
};

const EMPTY_KEY_ARRAYS: ProcessChangeResidualStrongEvidenceKeyArrays = {
  productNos: [],
  fkojuns: [],
  resourceCds: []
};

export function buildProcessChangeResidualStrongEvidenceKey(parts: {
  productNo: string;
  fkojun: string;
  resourceCd: string;
}): string {
  return `${parts.productNo}\u0000${parts.fkojun}\u0000${parts.resourceCd.toUpperCase()}`;
}

/** PostgreSQL text に渡せる比較用 key。NUL を使わず length-prefix で衝突を避ける。 */
export function buildProcessChangeResidualSqlTextKey(parts: {
  productNo: string;
  fkojun: string;
  resourceCd: string;
}): string {
  const resourceCd = parts.resourceCd.toUpperCase();
  // PostgreSQL の length() は文字数なので、UTF-16 の .length ではなくコードポイント数で揃える。
  const len = (value: string) => Array.from(value).length;
  return `${len(parts.productNo)}:${parts.productNo}|${len(parts.fkojun)}:${parts.fkojun}|${len(resourceCd)}:${resourceCd}`;
}

export function parseProcessChangeResidualStrongEvidenceKey(
  key: string
): ProcessChangeResidualStrongEvidenceKey | null {
  const [productNo, fkojun, resourceCd] = key.split('\u0000');
  if (!productNo || !fkojun || !resourceCd) {
    return null;
  }
  return { productNo, fkojun, resourceCd };
}

export function buildProcessChangeResidualStrongEvidenceKeyArrays(
  keys: ReadonlySet<string>
): ProcessChangeResidualStrongEvidenceKeyArrays {
  if (keys.size === 0) {
    return EMPTY_KEY_ARRAYS;
  }

  const productNos: string[] = [];
  const fkojuns: string[] = [];
  const resourceCds: string[] = [];

  for (const key of keys) {
    const parsed = parseProcessChangeResidualStrongEvidenceKey(key);
    if (parsed == null) {
      continue;
    }
    productNos.push(parsed.productNo);
    fkojuns.push(parsed.fkojun);
    resourceCds.push(parsed.resourceCd);
  }

  return { productNos, fkojuns, resourceCds };
}
