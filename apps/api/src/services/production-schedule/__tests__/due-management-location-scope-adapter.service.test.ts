import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

const loadService = async () => {
  vi.resetModules();
  return import('../due-management-location-scope-adapter.service.js');
};

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('due-management-location-scope-adapter.service', () => {
  it('文字列入力はdevice/site/legacyを同一キーとして解決する', async () => {
    const service = await loadService();
    expect(service.resolveDueManagementLocationScope('第2工場 - kensakuMain')).toEqual({
      deviceScopeKey: '第2工場 - kensakuMain',
      siteKey: '第2工場',
      legacyLocationKey: '第2工場 - kensakuMain'
    });
  });

  it('siteKeyのみ明示された場合もdevice/legacyはfallbackで補完される', async () => {
    const service = await loadService();
    expect(
      service.resolveDueManagementLocationScope({
        siteKey: '第2工場'
      })
    ).toEqual({
      deviceScopeKey: 'default',
      siteKey: '第2工場',
      legacyLocationKey: 'default'
    });
  });

  it('Phase3フラグON時はdeviceScopeKeyをストレージキーとして使う', async () => {
    process.env.LOCATION_SCOPE_PHASE3_ENABLED = 'true';
    const service = await loadService();
    const scope = service.resolveDueManagementLocationScope({
      deviceScopeKey: '第2工場 - RoboDrill01',
      legacyLocationKey: 'legacy-robo'
    });
    expect(service.isLocationScopePhase3Enabled()).toBe(true);
    expect(service.resolveDueManagementStorageLocationKey(scope)).toBe('第2工場 - RoboDrill01');
  });

  it('Phase3フラグOFF時はlegacyLocationKeyをストレージキーとして使う', async () => {
    process.env.LOCATION_SCOPE_PHASE3_ENABLED = 'false';
    const service = await loadService();
    const scope = service.resolveDueManagementLocationScope({
      deviceScopeKey: '第2工場 - RoboDrill01',
      legacyLocationKey: 'legacy-robo'
    });
    expect(service.isLocationScopePhase3Enabled()).toBe(false);
    expect(service.resolveDueManagementStorageLocationKey(scope)).toBe('legacy-robo');
  });
});
