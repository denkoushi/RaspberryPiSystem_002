import { InspectionResult } from '@prisma/client';

export type RiggingInspectionResultMap =
  | { ok: true; result: InspectionResult }
  | { ok: false; reason: 'empty' | 'unknown' };

export function mapRiggingInspectionResult(raw: unknown): RiggingInspectionResultMap {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) {
    return { ok: false, reason: 'empty' };
  }
  if (value === '正常') {
    return { ok: true, result: InspectionResult.PASS };
  }
  if (value === '異常') {
    return { ok: true, result: InspectionResult.FAIL };
  }
  return { ok: false, reason: 'unknown' };
}
