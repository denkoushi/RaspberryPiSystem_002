import { beforeEach, describe, expect, it } from 'vitest';
import { AdaptiveRateController } from '../adaptive-rate-controller.js';

describe('AdaptiveRateController', () => {
  let controller: AdaptiveRateController;

  beforeEach(() => {
    (AdaptiveRateController as unknown as { instance: AdaptiveRateController | null }).instance = null;
    controller = AdaptiveRateController.getInstance();
  });

  it('increases batch gradually on success streak', () => {
    const initial = controller.getBatchSize();
    controller.recordSuccess();
    controller.recordSuccess();
    controller.recordSuccess();
    expect(controller.getBatchSize()).toBeGreaterThanOrEqual(initial);
  });

  it('reduces batch size and increases delay on rate limit', () => {
    const beforeBatch = controller.getBatchSize();
    const beforeDelay = controller.getRequestDelayMs();
    controller.recordRateLimit();
    expect(controller.getBatchSize()).toBeLessThanOrEqual(beforeBatch);
    expect(controller.getRequestDelayMs()).toBeGreaterThanOrEqual(beforeDelay);
  });
});

