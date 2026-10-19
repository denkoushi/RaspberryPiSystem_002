import { describe, expect, it } from 'vitest';

import { machineSignalQueryKeys } from './machineSignal';

describe('machineSignalQueryKeys', () => {
  it('preserves constant keys and invalidation prefix lengths', () => {
    expect(machineSignalQueryKeys.rootAll).toEqual(['machine-signal']);
    expect(machineSignalQueryKeys.dayAll).toEqual(['machine-signal', 'day']);
    expect(machineSignalQueryKeys.settingsAll).toEqual(['machine-signal', 'settings']);
    expect(machineSignalQueryKeys.sensorsAll).toEqual(['machine-signal', 'sensors']);
    expect(machineSignalQueryKeys.importRunsAll).toEqual(['machine-signal', 'import-runs']);
    expect(machineSignalQueryKeys.datesAll).toEqual(['machine-signal', 'dates']);
    expect(machineSignalQueryKeys.adminOverviewAll).toEqual(['machine-signal', 'admin-overview']);
  });

  it('preserves day values, argument order and boundary values', () => {
    expect(machineSignalQueryKeys.day('2026-10-19', 'site-1')).toEqual(['machine-signal', 'day', '2026-10-19', 'site-1']);
    expect(machineSignalQueryKeys.day()).toEqual(['machine-signal', 'day', 'latest', 'all']);
    expect(machineSignalQueryKeys.day(undefined, undefined)).toEqual(['machine-signal', 'day', 'latest', 'all']);
    expect(machineSignalQueryKeys.day(null)).toEqual(['machine-signal', 'day', 'latest', 'all']);
    expect(machineSignalQueryKeys.day('2026-10-19')).toEqual(['machine-signal', 'day', '2026-10-19', 'all']);
    expect(machineSignalQueryKeys.day(undefined, 'site-1')).toEqual(['machine-signal', 'day', 'latest', 'site-1']);
    expect(machineSignalQueryKeys.day('', '')).toEqual(['machine-signal', 'day', '', '']);
    expect(Reflect.apply(machineSignalQueryKeys.day, undefined, [{}, {}])).toEqual(['machine-signal', 'day', {}, {}]);
  });

  it('preserves range values, argument order and boundary values', () => {
    expect(machineSignalQueryKeys.range({ from: '2026-10-01', to: '2026-10-19', site: 'site-1' })).toEqual(['machine-signal', 'range', '2026-10-01', '2026-10-19', 'site-1']);
    expect(machineSignalQueryKeys.range({ from: '', to: '', site: '' })).toEqual(['machine-signal', 'range', '', '', '']);
    expect(machineSignalQueryKeys.range()).toEqual(['machine-signal', 'range', undefined, undefined, 'all']);
    expect(machineSignalQueryKeys.range(undefined)).toEqual(['machine-signal', 'range', undefined, undefined, 'all']);
    expect(machineSignalQueryKeys.range(null)).toEqual(['machine-signal', 'range', undefined, undefined, 'all']);
    expect(Reflect.apply(machineSignalQueryKeys.range, undefined, [{}])).toEqual(['machine-signal', 'range', undefined, undefined, 'all']);
  });

  it('preserves worsening values, argument order and boundary values', () => {
    expect(machineSignalQueryKeys.worsening('2026-10-19', 'site-1')).toEqual(['machine-signal', 'worsening', '2026-10-19', 'site-1']);
    expect(machineSignalQueryKeys.worsening('2026-10-19')).toEqual(['machine-signal', 'worsening', '2026-10-19', 'all']);
    expect(machineSignalQueryKeys.worsening(null)).toEqual(['machine-signal', 'worsening', null, 'all']);
    expect(Reflect.apply(machineSignalQueryKeys.worsening, undefined, [])).toEqual(['machine-signal', 'worsening', undefined, 'all']);
    expect(Reflect.apply(machineSignalQueryKeys.worsening, undefined, [undefined, undefined])).toEqual(['machine-signal', 'worsening', undefined, 'all']);
    expect(Reflect.apply(machineSignalQueryKeys.worsening, undefined, [{}, {}])).toEqual(['machine-signal', 'worsening', {}, {}]);
    expect(machineSignalQueryKeys.worsening('', '')).toEqual(['machine-signal', 'worsening', '', '']);
  });

  it('preserves trend values, argument order and boundary values', () => {
    expect(machineSignalQueryKeys.trend(7, '2026-10-19', 30)).toEqual(['machine-signal', 'trend', 7, '2026-10-19', 30]);
    expect(machineSignalQueryKeys.trend(null, null, 90)).toEqual(['machine-signal', 'trend', null, null, 90]);
    expect(Reflect.apply(machineSignalQueryKeys.trend, undefined, [])).toEqual(['machine-signal', 'trend', undefined, undefined, undefined]);
    expect(Reflect.apply(machineSignalQueryKeys.trend, undefined, [undefined, undefined, undefined])).toEqual(['machine-signal', 'trend', undefined, undefined, undefined]);
    expect(Reflect.apply(machineSignalQueryKeys.trend, undefined, [{}, {}, {}])).toEqual(['machine-signal', 'trend', {}, {}, {}]);
    expect(machineSignalQueryKeys.trend(0, '', 90)).toEqual(['machine-signal', 'trend', 0, '', 90]);
  });
});
