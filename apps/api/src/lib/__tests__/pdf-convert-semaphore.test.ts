import { afterEach, describe, expect, it } from 'vitest';

import { ApiError } from '../errors.js';
import { PART_MEASUREMENT_PDF_CONVERT_QUEUE_MAX } from '../part-measurement-drawing-import.constants.js';
import { resetPdfConvertSemaphoreForTests, withPdfConvertSlot } from '../pdf-convert-semaphore.js';

describe('pdf-convert-semaphore', () => {
  afterEach(() => {
    resetPdfConvertSemaphoreForTests();
  });

  it('rejects when wait queue exceeds max', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      void withPdfConvertSlot(
        () =>
          new Promise<void>((resolveSlot) => {
            releaseFirst = resolveSlot;
            resolve();
          })
      );
    });
    await firstStarted;

    const waiters: Promise<unknown>[] = [];
    for (let i = 0; i < PART_MEASUREMENT_PDF_CONVERT_QUEUE_MAX; i++) {
      waiters.push(
        withPdfConvertSlot(
          () =>
            new Promise<void>(() => {
              /* held until test ends */
            })
        )
      );
    }
    await Promise.all(
      waiters.map((p) =>
        Promise.race([
          p,
          new Promise<void>((resolve) => {
            setTimeout(resolve, 50);
          })
        ])
      )
    );

    await expect(withPdfConvertSlot(async () => Buffer.from('unused'))).rejects.toMatchObject({
      statusCode: 503
    });

    releaseFirst?.();
    resetPdfConvertSemaphoreForTests();
  });
});
