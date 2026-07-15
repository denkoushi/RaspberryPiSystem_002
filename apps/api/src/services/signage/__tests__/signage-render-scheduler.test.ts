import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SignageRenderer } from '../signage.renderer.js';
import { SignageRenderScheduler } from '../signage-render-scheduler.js';

const renderResult = {
  renderedAt: new Date('2026-01-01T00:00:00.000Z'),
  filename: 'current.jpg',
  clientKeysRendered: 0,
};

describe('SignageRenderScheduler deploy lifecycle', () => {
  const schedulers: SignageRenderScheduler[] = [];

  afterEach(async () => {
    while (schedulers.length > 0) {
      await schedulers.pop()?.pauseForDeploy(1_000);
    }
  });

  it('acknowledges in-process resume only after the scheduler is active', async () => {
    const renderer = {
      renderCurrentContent: vi.fn(async () => renderResult),
    } as unknown as SignageRenderer;
    const scheduler = new SignageRenderScheduler(renderer, 3_600);
    schedulers.push(scheduler);

    await scheduler.resumeAfterDeploy();

    expect(scheduler.isRunning()).toBe(true);
    expect(renderer.renderCurrentContent).toHaveBeenCalledOnce();
    await scheduler.pauseForDeploy();
    expect(scheduler.isRunning()).toBe(false);
  });

  it('waits for an in-flight render before acknowledging pause', async () => {
    let completeRender: ((value: typeof renderResult) => void) | undefined;
    const renderer = {
      renderCurrentContent: vi.fn(() => new Promise<typeof renderResult>((resolve) => {
        completeRender = resolve;
      })),
    } as unknown as SignageRenderer;
    const scheduler = new SignageRenderScheduler(renderer, 3_600);
    schedulers.push(scheduler);
    await scheduler.resumeAfterDeploy();

    let pauseCompleted = false;
    const pause = scheduler.pauseForDeploy(1_000).then(() => {
      pauseCompleted = true;
    });
    await Promise.resolve();
    expect(pauseCompleted).toBe(false);

    completeRender?.(renderResult);
    await pause;
    expect(pauseCompleted).toBe(true);
    expect(scheduler.isRunning()).toBe(false);
  });

  it('rejects resume when no scheduler implementation becomes active', async () => {
    const renderer = {
      renderCurrentContent: vi.fn(async () => renderResult),
    } as unknown as SignageRenderer;
    const scheduler = new SignageRenderScheduler(renderer, 3_600);
    schedulers.push(scheduler);
    vi.spyOn(scheduler, 'start').mockImplementation(() => undefined);

    await expect(scheduler.resumeAfterDeploy()).rejects.toThrow(
      'Signage render scheduler did not become active'
    );
  });
});
