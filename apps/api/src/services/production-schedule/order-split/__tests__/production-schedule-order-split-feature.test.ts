import { afterEach, describe, expect, it } from 'vitest';

import {
  isProductionScheduleOrderSplitEnabled,
  resetProductionScheduleOrderSplitPilotRuntimeEnabledForTest,
  setProductionScheduleOrderSplitPilotRuntimeEnabledForTest
} from '../production-schedule-order-split-feature.js';

describe('isProductionScheduleOrderSplitEnabled', () => {
  const original = process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED;
    } else {
      process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED = original;
    }
    resetProductionScheduleOrderSplitPilotRuntimeEnabledForTest();
  });

  it('requires both deployment flag and runtime pilot gate in test mode', () => {
    process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED = 'true';
    expect(isProductionScheduleOrderSplitEnabled()).toBe(true);

    setProductionScheduleOrderSplitPilotRuntimeEnabledForTest(false);
    expect(isProductionScheduleOrderSplitEnabled()).toBe(false);

    setProductionScheduleOrderSplitPilotRuntimeEnabledForTest(true);
    process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED = 'false';
    expect(isProductionScheduleOrderSplitEnabled()).toBe(false);
  });
});
