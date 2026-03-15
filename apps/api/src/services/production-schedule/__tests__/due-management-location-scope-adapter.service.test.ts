import { describe, expect, it, vi } from 'vitest';

const loadService = async () => {
  vi.resetModules();
  return import('../due-management-location-scope-adapter.service.js');
};

describe('due-management-location-scope-adapter.service', () => {
  it('deviceScopeKey入力はdevice/siteキーを解決する', async () => {
    const service = await loadService();
    expect(
      service.resolveDueManagementLocationScope({
        deviceScopeKey: '第2工場 - kensakuMain'
      })
    ).toEqual({
      deviceScopeKey: '第2工場 - kensakuMain',
      siteKey: '第2工場'
    });
  });

  it('siteKeyのみ明示された場合もdeviceはfallbackで補完される', async () => {
    const service = await loadService();
    expect(
      service.resolveDueManagementLocationScope({
        siteKey: '第2工場'
      })
    ).toEqual({
      deviceScopeKey: 'default',
      siteKey: '第2工場'
    });
  });

  it('常にdeviceScopeKeyをストレージキーとして使う', async () => {
    const service = await loadService();
    const scope = service.resolveDueManagementLocationScope({
      deviceScopeKey: '第2工場 - RoboDrill01'
    });
    expect(service.resolveDueManagementStorageLocationKey(scope)).toBe('第2工場 - RoboDrill01');
  });
});
