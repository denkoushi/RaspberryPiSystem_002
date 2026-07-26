import { describe, expect, it } from 'vitest';

import {
  BOTTOM_RIGHT_KIOSK_HEADER_REVEAL_HOT_ZONE,
  isPointerInKioskHeaderRevealHotZone,
  KIOSK_HEADER_REVEAL_HOT_ZONE_SIZE_PX
} from './kioskHeaderRevealHotZone';

const VIEW_W = 900;
const VIEW_H = 600;

const bottomRight = {
  ...BOTTOM_RIGHT_KIOSK_HEADER_REVEAL_HOT_ZONE,
  viewportWidth: VIEW_W,
  viewportHeight: VIEW_H
};

describe('isPointerInKioskHeaderRevealHotZone', () => {
  it('is true inside the bottom-right 24x24 zone', () => {
    expect(
      isPointerInKioskHeaderRevealHotZone({
        ...bottomRight,
        clientX: VIEW_W - 1,
        clientY: VIEW_H - 1
      })
    ).toBe(true);
  });

  it('is true at the top-left boundary of the zone', () => {
    expect(
      isPointerInKioskHeaderRevealHotZone({
        ...bottomRight,
        clientX: VIEW_W - KIOSK_HEADER_REVEAL_HOT_ZONE_SIZE_PX,
        clientY: VIEW_H - KIOSK_HEADER_REVEAL_HOT_ZONE_SIZE_PX
      })
    ).toBe(true);
  });

  it('is false just above the zone', () => {
    expect(
      isPointerInKioskHeaderRevealHotZone({
        ...bottomRight,
        clientX: VIEW_W - 1,
        clientY: VIEW_H - KIOSK_HEADER_REVEAL_HOT_ZONE_SIZE_PX - 1
      })
    ).toBe(false);
  });

  it('is false just left of the zone', () => {
    expect(
      isPointerInKioskHeaderRevealHotZone({
        ...bottomRight,
        clientX: VIEW_W - KIOSK_HEADER_REVEAL_HOT_ZONE_SIZE_PX - 1,
        clientY: VIEW_H - 1
      })
    ).toBe(false);
  });

  it('is false at the bottom center', () => {
    expect(
      isPointerInKioskHeaderRevealHotZone({
        ...bottomRight,
        clientX: VIEW_W / 2,
        clientY: VIEW_H - 1
      })
    ).toBe(false);
  });

  it('false at top of viewport', () => {
    expect(
      isPointerInKioskHeaderRevealHotZone({
        ...bottomRight,
        clientX: VIEW_W - 1,
        clientY: 0
      })
    ).toBe(false);
  });

  it('false when viewport dimensions are zero', () => {
    expect(
      isPointerInKioskHeaderRevealHotZone({
        ...bottomRight,
        viewportWidth: 0,
        viewportHeight: VIEW_H,
        clientX: 0,
        clientY: VIEW_H - 1
      })
    ).toBe(false);
  });

  it('supports top edge full width', () => {
    expect(
      isPointerInKioskHeaderRevealHotZone({
        edge: 'top',
        bandDepthPx: 14,
        horizontalBand: 'full',
        viewportWidth: VIEW_W,
        viewportHeight: VIEW_H,
        clientX: 0,
        clientY: 0
      })
    ).toBe(true);
  });
});
