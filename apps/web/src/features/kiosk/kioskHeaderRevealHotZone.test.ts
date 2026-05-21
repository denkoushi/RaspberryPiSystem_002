import { describe, expect, it } from 'vitest';

import {
  BOTTOM_CENTER_KIOSK_HEADER_REVEAL_HOT_ZONE,
  isPointerInKioskHeaderRevealHotZone,
  KIOSK_HEADER_REVEAL_BAND_DEPTH_PX
} from './kioskHeaderRevealHotZone';

const VIEW_W = 900;
const VIEW_H = 600;

const bottomCenter = {
  ...BOTTOM_CENTER_KIOSK_HEADER_REVEAL_HOT_ZONE,
  viewportWidth: VIEW_W,
  viewportHeight: VIEW_H
};

describe('isPointerInKioskHeaderRevealHotZone', () => {
  it('true at bottom center within band', () => {
    expect(
      isPointerInKioskHeaderRevealHotZone({
        ...bottomCenter,
        clientX: VIEW_W / 2,
        clientY: VIEW_H - 1
      })
    ).toBe(true);
  });

  it('true at top edge of bottom band (y = height - depth)', () => {
    expect(
      isPointerInKioskHeaderRevealHotZone({
        ...bottomCenter,
        clientX: VIEW_W / 2,
        clientY: VIEW_H - KIOSK_HEADER_REVEAL_BAND_DEPTH_PX
      })
    ).toBe(true);
  });

  it('false just above bottom band', () => {
    expect(
      isPointerInKioskHeaderRevealHotZone({
        ...bottomCenter,
        clientX: VIEW_W / 2,
        clientY: VIEW_H - KIOSK_HEADER_REVEAL_BAND_DEPTH_PX - 1
      })
    ).toBe(false);
  });

  it('true at horizontal left boundary (x = width/3)', () => {
    expect(
      isPointerInKioskHeaderRevealHotZone({
        ...bottomCenter,
        clientX: VIEW_W / 3,
        clientY: VIEW_H - 1
      })
    ).toBe(true);
  });

  it('true at horizontal right boundary (x = 2*width/3)', () => {
    expect(
      isPointerInKioskHeaderRevealHotZone({
        ...bottomCenter,
        clientX: (2 * VIEW_W) / 3,
        clientY: VIEW_H - 1
      })
    ).toBe(true);
  });

  it('false in left third at bottom', () => {
    expect(
      isPointerInKioskHeaderRevealHotZone({
        ...bottomCenter,
        clientX: VIEW_W / 3 - 1,
        clientY: VIEW_H - 1
      })
    ).toBe(false);
  });

  it('false in right third at bottom', () => {
    expect(
      isPointerInKioskHeaderRevealHotZone({
        ...bottomCenter,
        clientX: (2 * VIEW_W) / 3 + 1,
        clientY: VIEW_H - 1
      })
    ).toBe(false);
  });

  it('false at top of viewport', () => {
    expect(
      isPointerInKioskHeaderRevealHotZone({
        ...bottomCenter,
        clientX: VIEW_W / 2,
        clientY: 0
      })
    ).toBe(false);
  });

  it('false when viewport dimensions are zero', () => {
    expect(
      isPointerInKioskHeaderRevealHotZone({
        ...bottomCenter,
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
