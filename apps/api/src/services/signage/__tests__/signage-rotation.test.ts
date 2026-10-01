import { describe, expect, it, vi } from 'vitest';

import { SignageService } from '../signage.service.js';

// 2026-09-30 は水曜（dayOfWeek=3）。05:32:10Z = JST 14:32:10
const NOW = new Date('2026-09-30T05:32:10.000Z');

const schedule = (partial: Record<string, unknown>) => ({
  id: 's',
  name: '予定',
  contentType: 'TOOLS',
  pdfId: null,
  layoutConfig: null,
  targetClientKeys: [],
  dayOfWeek: [1, 2, 3, 4, 5],
  startTime: '00:00',
  endTime: '23:59',
  priority: 0,
  enabled: true,
  ...partial,
});

function serviceWith(schedules: Array<Record<string, unknown>>) {
  const db = { signageSchedule: { findMany: vi.fn().mockResolvedValue(schedules) }, clientDevice: { findMany: vi.fn() } };
  return new SignageService(db as never);
}

describe('SignageService.getRotationForClient', () => {
  it('rotates through the schedules that match now, highest priority first, and reports the time to the next switch', async () => {
    const service = serviceWith([
      schedule({ id: 'low', priority: 0 }),
      schedule({ id: 'high', priority: 5 }),
      schedule({ id: 'morning-only', startTime: '07:30', endTime: '09:00' }),
      schedule({ id: 'other-device', targetClientKeys: ['key-b'] }),
    ]);

    const rotation = await service.getRotationForClient('key-a', NOW);

    expect(rotation.scheduleIds).toEqual(['high', 'low']);
    expect(rotation.isFallback).toBe(false);
    // 30 秒ごとの切り替え：周期 60 秒のうち何秒目かで、表示中と残り秒数が決まる
    const second = Math.floor(NOW.getTime() / 1000) % 60;
    expect(rotation.currentIndex).toBe(Math.floor(second / 30));
    expect(rotation.secondsUntilSwitch).toBe(30 - (second % 30));
  });

  it('has no countdown with a single match and falls back to the first schedule when nothing matches', async () => {
    const single = await serviceWith([schedule({ id: 'only' })]).getRotationForClient('key-a', NOW);
    expect(single).toEqual({ scheduleIds: ['only'], currentIndex: 0, secondsUntilSwitch: null, isFallback: false });

    const fallback = await serviceWith([schedule({ id: 'weekend', dayOfWeek: [0, 6] })]).getRotationForClient('key-a', NOW);
    expect(fallback).toEqual({ scheduleIds: ['weekend'], currentIndex: 0, secondsUntilSwitch: null, isFallback: true });

    const empty = await serviceWith([]).getRotationForClient('key-a', NOW);
    expect(empty.scheduleIds).toEqual([]);
  });
});
