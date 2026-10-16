import { afterEach, describe, expect, it, vi } from 'vitest';

import { env } from '../../../config/env.js';
import { ProcedureVideoScheduler } from '../procedure-video.scheduler.js';
const mocks = vi.hoisted(() => ({ recover: vi.fn().mockResolvedValue(undefined), processing: vi.fn(), autoEdit: vi.fn(), getAutoEdit: vi.fn(), schedule: vi.fn(), stop: vi.fn() }));
vi.mock('../procedure-video-processing.service.js', () => ({ getProcedureVideoProcessingService: () => ({ runOnce: mocks.processing }) }));
vi.mock('../procedure-video-auto-edit.service.js', () => ({ getProcedureVideoAutoEditService: mocks.getAutoEdit, recoverProcedureVideoAutoEdit: mocks.recover }));
vi.mock('node-cron', () => ({ default: { schedule: mocks.schedule } }));
const originalFlag = env.PROCEDURE_VIDEO_AUTO_EDIT_ENABLED;
afterEach(() => { env.PROCEDURE_VIDEO_AUTO_EDIT_ENABLED = originalFlag; vi.resetAllMocks(); });

describe('procedure-video scheduler', () => {
  it('does not initialize or invoke auto edit while disabled', () => {
    env.PROCEDURE_VIDEO_AUTO_EDIT_ENABLED = false; mocks.processing.mockResolvedValue(undefined);
    new ProcedureVideoScheduler().kick();
    expect(mocks.processing).toHaveBeenCalledOnce(); expect(mocks.getAutoEdit).not.toHaveBeenCalled(); expect(mocks.recover).not.toHaveBeenCalled();
  });
  it('runs the independent worker even when video processing fails', async () => {
    env.PROCEDURE_VIDEO_AUTO_EDIT_ENABLED = true; mocks.getAutoEdit.mockReturnValue({ runOnce: mocks.autoEdit });
    mocks.recover.mockResolvedValue(undefined); mocks.autoEdit.mockResolvedValue(undefined); mocks.processing.mockRejectedValue(new Error('encoding failed'));
    new ProcedureVideoScheduler().kick(); await Promise.resolve();
    expect(mocks.recover).toHaveBeenCalledOnce(); expect(mocks.autoEdit).toHaveBeenCalledOnce(); expect(mocks.processing).toHaveBeenCalledOnce();
  });
  it('shares the once-per-minute schedule and stops without adding another cron task', () => {
    mocks.schedule.mockReturnValue({ stop: mocks.stop }); const scheduler = new ProcedureVideoScheduler();
    scheduler.start(); scheduler.start();
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith('* * * * *', expect.any(Function), { timezone: 'Asia/Tokyo', scheduled: true });
    scheduler.stop(); expect(mocks.stop).toHaveBeenCalledOnce();
  });
});
