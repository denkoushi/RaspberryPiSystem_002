import { logger } from '../../../../lib/logger.js';

const DEFAULT_MIN = 1;

export function clampPositiveInt(
  value: unknown,
  fallback: number,
  options?: { min?: number; max?: number },
): number {
  const min = options?.min ?? DEFAULT_MIN;
  const max = options?.max ?? Number.MAX_SAFE_INTEGER;
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;
  const resolved = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(min, Math.min(max, resolved));
}

export function resolveJstDayRange(date?: string): { date: string; start: Date; end: Date } {
  const resolvedDate = date ?? formatJstDate(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resolvedDate)) {
    throw new Error('dateはYYYY-MM-DD形式で指定してください');
  }
  const start = new Date(`${resolvedDate}T00:00:00+09:00`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { date: resolvedDate, start, end };
}

export async function withDataSourceTiming<T>(
  dataSourceType: string,
  handler: () => Promise<T>,
  options?: { warnThresholdMs?: number },
): Promise<T> {
  const warnThresholdMs = options?.warnThresholdMs ?? 2000;
  const started = Date.now();
  const result = await handler();
  const durationMs = Date.now() - started;
  if (durationMs >= warnThresholdMs) {
    logger.warn({ dataSourceType, durationMs }, 'Visualization data source is slow');
  }
  return result;
}

function formatJstDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${year}-${month}-${day}`;
}
