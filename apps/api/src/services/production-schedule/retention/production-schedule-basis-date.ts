const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * "YYYY/M/D" または "YYYY/M/D HH:mm" を JST として解釈し、UTC Date を返す。
 * 例: "2026/1/8 8:13" (JST) -> Date(UTC)
 */
export const parseJstDateLike = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?$/);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour = '0', minute = '0'] = match;
  const yearNum = parseInt(year, 10);
  const monthNum = parseInt(month, 10) - 1;
  const dayNum = parseInt(day, 10);
  const hourNum = parseInt(hour, 10);
  const minuteNum = parseInt(minute, 10);

  // ローカルTZに依存しないよう、UTCのコンポーネントとして組み立ててからJST->UTCへ補正する。
  const utcMsAssumingUtc = Date.UTC(yearNum, monthNum, dayNum, hourNum, minuteNum, 0, 0);
  if (Number.isNaN(utcMsAssumingUtc)) {
    return null;
  }

  return new Date(utcMsAssumingUtc - JST_OFFSET_MS);
};

/**
 * 「より最近の日付」を 1つに定義するための基準日（UTC）を返す。
 * - rowData.updatedAt が解釈できる場合は occurredAt と比較して大きい方
 * - 解釈できない場合は occurredAt
 */
export const computeBasisDateUtc = (params: {
  rowData: unknown;
  occurredAtUtc: Date;
}): Date => {
  const { rowData, occurredAtUtc } = params;
  const updatedAtRaw = (rowData as Record<string, unknown> | null | undefined)?.updatedAt;
  const updatedAtParsed = parseJstDateLike(updatedAtRaw);
  const updatedAtUtc = updatedAtParsed ?? occurredAtUtc;
  return updatedAtUtc.getTime() >= occurredAtUtc.getTime() ? updatedAtUtc : occurredAtUtc;
};

/**
 * 現在時刻（UTC）から「1年前」を JST 基準で計算し、UTC Date を返す。
 * - basisDate は JST を UTC に寄せた値で比較しているため、threshold も同じ座標系に揃える。
 */
export const computeOneYearAgoThresholdUtc = (nowUtc: Date = new Date()): Date => {
  // nowUtc -> nowJst(=UTCに+9hオフセットした瞬間) を「UTCのカレンダー」として扱うことで、
  // ローカルTZに依存せずJSTカレンダー基準の年差分を計算する。
  const nowJstAsUtc = new Date(nowUtc.getTime() + JST_OFFSET_MS);
  const oneYearAgoJstAsUtc = new Date(nowJstAsUtc.getTime());
  oneYearAgoJstAsUtc.setUTCFullYear(nowJstAsUtc.getUTCFullYear() - 1);
  return new Date(oneYearAgoJstAsUtc.getTime() - JST_OFFSET_MS);
};

