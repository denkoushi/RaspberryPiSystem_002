import { Prisma } from '@prisma/client';

export const parseJstDate = (value: unknown): Date | null => {
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
  const dateTimeMatch = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?$/);
  if (!dateTimeMatch) {
    return null;
  }
  const [, year, month, day, hour = '0', minute = '0'] = dateTimeMatch;
  const yearNum = parseInt(year, 10);
  const monthNum = parseInt(month, 10) - 1;
  const dayNum = parseInt(day, 10);
  const hourNum = parseInt(hour, 10);
  const minuteNum = parseInt(minute, 10);
  const localDate = new Date(yearNum, monthNum, dayNum, hourNum, minuteNum, 0, 0);
  if (isNaN(localDate.getTime())) {
    return null;
  }
  return new Date(localDate.getTime() - 9 * 60 * 60 * 1000);
};

export const resolveUpdatedAt = (rowData: Prisma.JsonValue, fallback: Date): Date => {
  const updatedAt = (rowData as Record<string, unknown> | null | undefined)?.updatedAt;
  return parseJstDate(updatedAt) ?? fallback;
};
