import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

const loadService = async () => {
  vi.resetModules();
  return import('../actual-hours-location-scope.service.js');
};

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('actual-hours-location-scope.service', () => {
  it('shared fallbackが無効な場合はactor locationのみ返す', async () => {
    process.env.ACTUAL_HOURS_SHARED_FALLBACK_ENABLED = 'false';
    const service = await loadService();

    expect(service.resolveActualHoursLocationCandidates('第2工場 - RoboDrill01')).toEqual([
      '第2工場 - RoboDrill01'
    ]);
  });

  it('shared fallbackが有効な場合はactor優先で候補を返す', async () => {
    process.env.ACTUAL_HOURS_SHARED_FALLBACK_ENABLED = 'true';
    const service = await loadService();

    expect(service.resolveActualHoursLocationCandidates('第2工場 - RoboDrill01')).toEqual([
      '第2工場 - RoboDrill01',
      'shared-global-rank'
    ]);
  });

  it('同一キーで複数locationの行がある場合は優先locationを採用する', async () => {
    const service = await loadService();
    const selected = service.pickActualHoursRowsByLocationPriority(
      [
        {
          location: 'shared-global-rank',
          fhincd: 'X',
          resourceCd: 'R01',
          medianPerPieceMinutes: 11.0
        },
        {
          location: '第2工場 - RoboDrill01',
          fhincd: 'X',
          resourceCd: 'R01',
          medianPerPieceMinutes: 7.5
        },
        {
          location: 'shared-global-rank',
          fhincd: 'Y',
          resourceCd: 'R02',
          medianPerPieceMinutes: 4.0
        }
      ],
      ['第2工場 - RoboDrill01', 'shared-global-rank']
    );

    const keyMap = new Map(selected.map((row) => [`${row.fhincd}:${row.resourceCd}`, row] as const));
    expect(keyMap.get('X:R01')?.location).toBe('第2工場 - RoboDrill01');
    expect(keyMap.get('Y:R02')?.location).toBe('shared-global-rank');
  });

  it('候補locationに存在しない行は採用しない（結果0件）', async () => {
    const service = await loadService();
    const selected = service.pickActualHoursRowsByLocationPriority(
      [
        {
          location: 'unknown-location',
          fhincd: 'X',
          resourceCd: 'R01',
          medianPerPieceMinutes: 8.1
        }
      ],
      ['第2工場 - RoboDrill01', 'shared-global-rank']
    );

    expect(selected).toEqual([]);
  });
});
