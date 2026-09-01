import { describe, expect, it } from 'vitest';

import {
  KIOSK_INITIAL_ROUTE_IDS,
  KIOSK_INITIAL_ROUTE_LABELS,
  KIOSK_INITIAL_ROUTE_PATHS,
  KIOSK_SELECTABLE_INITIAL_ROUTE_IDS,
  isKioskSelectableInitialRouteId,
  resolveKioskInitialPath
} from './kiosk-initial-route.js';

describe('kiosk initial route contract', () => {
  it('exposes self-inspection as a selectable initial route', () => {
    expect(KIOSK_INITIAL_ROUTE_IDS).toContain('self_inspection');
    expect(KIOSK_SELECTABLE_INITIAL_ROUTE_IDS).toContain('self_inspection');
    expect(KIOSK_INITIAL_ROUTE_LABELS.self_inspection).toBe('自主検査');
    expect(KIOSK_INITIAL_ROUTE_PATHS.self_inspection).toBe(
      '/kiosk/part-measurement/self-inspection'
    );
    expect(isKioskSelectableInitialRouteId('self_inspection')).toBe(true);
  });

  it('resolves self-inspection before the legacy default mode fallback', () => {
    expect(
      resolveKioskInitialPath({ initialRoute: 'self_inspection', defaultMode: 'PHOTO' })
    ).toBe('/kiosk/part-measurement/self-inspection');
  });
});
