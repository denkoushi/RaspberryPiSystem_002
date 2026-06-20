import { afterEach, describe, expect, it } from 'vitest';

import { isProductionScheduleOrderSplitEnabled } from '../production-schedule-order-split-feature.js';

describe('isProductionScheduleOrderSplitEnabled', () => {
  const original = process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED;
    } else {
      process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED = original;
    }
  });

  it('reads runtime process.env in test mode', () => {
    process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED = 'true';
    expect(isProductionScheduleOrderSplitEnabled()).toBe(true);

    process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED = 'false';
    expect(isProductionScheduleOrderSplitEnabled()).toBe(false);
  });
});
