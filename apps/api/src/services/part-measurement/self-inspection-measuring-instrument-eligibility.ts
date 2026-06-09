import { MeasuringInstrumentStatus } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';

export function isMeasuringInstrumentAvailableForSelfInspection(status: MeasuringInstrumentStatus): boolean {
  return status !== MeasuringInstrumentStatus.RETIRED;
}

export function assertMeasuringInstrumentAvailableForSelfInspection(instrument: {
  status: MeasuringInstrumentStatus;
}): void {
  if (!isMeasuringInstrumentAvailableForSelfInspection(instrument.status)) {
    throw new ApiError(400, '廃棄済みの計測機器は自主検査に使用できません');
  }
}
