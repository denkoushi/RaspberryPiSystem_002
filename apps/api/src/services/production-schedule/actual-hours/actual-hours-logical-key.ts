import { createHash } from 'crypto';

type RawFingerprintInput = {
  fhincd: string;
  resourceCd: string;
  workDate: Date;
  lotQty: number;
  actualMinutes: number;
  processOrder: number | null;
  fseiban: string | null;
  lotNo: string | null;
};

type CanonicalLogicalKeyInput = {
  fhincd: string;
  resourceCd: string;
  workDate: Date;
  processOrder: number | null;
  fseiban: string | null;
  lotNo: string | null;
};

const normalizeString = (value: string | null | undefined): string => (value ?? '').trim().toLowerCase();

const toHash = (parts: Array<string | number>): string =>
  createHash('sha256')
    .update(parts.join('|'))
    .digest('hex');

// Exact-row fingerprint for raw append-only storage (source-independent).
export const buildActualHoursRawFingerprint = (input: RawFingerprintInput): string =>
  toHash([
    normalizeString(input.fhincd),
    normalizeString(input.resourceCd),
    input.workDate.toISOString(),
    String(input.lotQty),
    String(input.actualMinutes),
    String(input.processOrder ?? ''),
    normalizeString(input.fseiban),
    normalizeString(input.lotNo),
  ]);

// Logical-key hash for canonical winner resolution (value-change tolerant).
export const buildActualHoursCanonicalLogicalKeyHash = (input: CanonicalLogicalKeyInput): string =>
  toHash([
    normalizeString(input.fhincd),
    normalizeString(input.resourceCd),
    input.workDate.toISOString(),
    String(input.processOrder ?? ''),
    normalizeString(input.fseiban),
    normalizeString(input.lotNo),
  ]);
