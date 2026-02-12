import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadAlertsDispatcherConfig, resolveRouteKey } from '../alerts-config.js';

describe('alerts-config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('resolveRouteKey falls back to default route when type is undefined', () => {
    const route = resolveRouteKey(undefined, {
      byTypePrefix: { 'ansible-update-': 'deploy' },
      defaultRoute: 'ops',
    });

    expect(route).toBe('ops');
  });

  it('resolveRouteKey resolves prefix match first', () => {
    const route = resolveRouteKey('ansible-update-failed', {
      byTypePrefix: { 'ansible-update-': 'deploy', 'kiosk-support': 'support' },
      defaultRoute: 'ops',
    });

    expect(route).toBe('deploy');
  });

  it('returns base config when ALERTS_CONFIG_PATH is invalid', async () => {
    process.env.ALERTS_CONFIG_PATH = '/path/not/found/config.json';
    process.env.ALERTS_DISPATCHER_ENABLED = 'true';
    process.env.ALERTS_DB_DISPATCHER_ENABLED = 'true';

    const config = await loadAlertsDispatcherConfig();

    expect(config.enabled).toBe(true);
    expect(config.dbDispatcher.enabled).toBe(true);
    expect(config.routing.defaultRoute).toBe('ops');
    expect(config.slack.enabled).toBe(true);
  });
});
