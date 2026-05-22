import { InspectionResult } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { mapRiggingInspectionResult } from '../rigging-inspection-result-mapper.js';

describe('mapRiggingInspectionResult', () => {
  it('maps 正常 to PASS', () => {
    expect(mapRiggingInspectionResult('正常')).toEqual({ ok: true, result: InspectionResult.PASS });
  });

  it('maps 異常 to FAIL', () => {
    expect(mapRiggingInspectionResult('異常')).toEqual({ ok: true, result: InspectionResult.FAIL });
  });

  it('rejects empty values', () => {
    expect(mapRiggingInspectionResult('')).toEqual({ ok: false, reason: 'empty' });
    expect(mapRiggingInspectionResult('  ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects unknown values', () => {
    expect(mapRiggingInspectionResult('OK')).toEqual({ ok: false, reason: 'unknown' });
  });
});
