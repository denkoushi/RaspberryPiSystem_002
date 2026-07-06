import { describe, expect, it } from 'vitest';

import { resolveKioskInitialRedirectDecision } from './kioskInitialRedirect';

describe('resolveKioskInitialRedirectDecision', () => {
  it('redirects /kiosk to an explicit assembly initial route', () => {
    expect(
      resolveKioskInitialRedirectDecision({
        pathname: '/kiosk',
        isLoading: false,
        hasError: false,
        config: { defaultMode: 'TAG', initialKioskRoute: 'assembly' }
      })
    ).toMatchObject({
      targetPath: '/kiosk/assembly',
      nextRouteSignature: 'route:assembly',
      reason: 'initial-route'
    });
  });

  it('redirects /kiosk to the leader order board initial route', () => {
    expect(
      resolveKioskInitialRedirectDecision({
        pathname: '/kiosk',
        isLoading: false,
        hasError: false,
        config: { defaultMode: 'TAG', initialKioskRoute: 'leader_order_board' }
      })
    ).toMatchObject({
      targetPath: '/kiosk/production-schedule/leader-order-board',
      nextRouteSignature: 'route:leader_order_board',
      reason: 'initial-route'
    });
  });

  it('keeps user-operated kiosk subpaths untouched', () => {
    expect(
      resolveKioskInitialRedirectDecision({
        pathname: '/kiosk/production-schedule',
        isLoading: false,
        hasError: false,
        config: { defaultMode: 'TAG', initialKioskRoute: 'assembly' }
      })
    ).toMatchObject({ targetPath: null, reason: 'subpath' });
  });

  it('keeps the borrow tag path untouched even when assembly is the initial route', () => {
    expect(
      resolveKioskInitialRedirectDecision({
        pathname: '/kiosk/tag',
        isLoading: false,
        hasError: false,
        config: { defaultMode: 'TAG', initialKioskRoute: 'assembly' }
      })
    ).toMatchObject({ targetPath: null, reason: 'subpath' });
  });

  it('ignores non-entry paths even when they start with kiosk text', () => {
    expect(
      resolveKioskInitialRedirectDecision({
        pathname: '/kiosk-settings',
        isLoading: false,
        hasError: false,
        config: { defaultMode: 'TAG', initialKioskRoute: 'assembly' }
      })
    ).toMatchObject({ targetPath: null, reason: 'outside-kiosk' });
  });

  it('explicit route wins over last path on root access', () => {
    expect(
      resolveKioskInitialRedirectDecision({
        pathname: '/',
        isLoading: false,
        hasError: false,
        config: { defaultMode: 'TAG', initialKioskRoute: 'assembly' },
        lastKioskPath: '/kiosk/rigging/borrow'
      })
    ).toMatchObject({ targetPath: '/kiosk/assembly', reason: 'initial-route' });
  });

  it('restores last path on root access when no explicit route exists', () => {
    expect(
      resolveKioskInitialRedirectDecision({
        pathname: '/',
        isLoading: false,
        hasError: false,
        config: { defaultMode: 'PHOTO', initialKioskRoute: null },
        lastKioskPath: '/kiosk/rigging/borrow'
      })
    ).toMatchObject({
      targetPath: '/kiosk/rigging/borrow',
      nextRouteSignature: 'default:PHOTO',
      reason: 'last-path'
    });
  });

  it('falls back to defaultMode when initial route is unknown', () => {
    expect(
      resolveKioskInitialRedirectDecision({
        pathname: '/kiosk',
        isLoading: false,
        hasError: false,
        config: { defaultMode: 'PHOTO', initialKioskRoute: 'unknown' }
      })
    ).toMatchObject({
      targetPath: '/kiosk/photo',
      nextRouteSignature: 'default:PHOTO',
      reason: 'initial-route'
    });
  });

  it('does not restore last path when an invalid explicit route is present', () => {
    expect(
      resolveKioskInitialRedirectDecision({
        pathname: '/',
        isLoading: false,
        hasError: false,
        config: { defaultMode: 'PHOTO', initialKioskRoute: 'unknown' },
        lastKioskPath: '/kiosk/rigging/borrow'
      })
    ).toMatchObject({
      targetPath: '/kiosk/photo',
      nextRouteSignature: 'default:PHOTO',
      reason: 'initial-route'
    });
  });

  it('does not navigate while config is loading', () => {
    expect(
      resolveKioskInitialRedirectDecision({
        pathname: '/kiosk',
        isLoading: true,
        hasError: false,
        config: null
      })
    ).toMatchObject({ targetPath: null, reason: 'loading' });
  });
});
