import { MeasuringInstrumentStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  assertMeasuringInstrumentAvailableForSelfInspection,
  isMeasuringInstrumentAvailableForSelfInspection
} from '../self-inspection-measuring-instrument-eligibility.js';

describe('self-inspection-measuring-instrument-eligibility', () => {
  it('rejects retired instruments', () => {
    expect(isMeasuringInstrumentAvailableForSelfInspection(MeasuringInstrumentStatus.RETIRED)).toBe(false);
    expect(() =>
      assertMeasuringInstrumentAvailableForSelfInspection({ status: MeasuringInstrumentStatus.RETIRED })
    ).toThrow('廃棄済みの計測機器は自主検査に使用できません');
  });

  it('allows available instruments', () => {
    expect(isMeasuringInstrumentAvailableForSelfInspection(MeasuringInstrumentStatus.AVAILABLE)).toBe(true);
  });
});
