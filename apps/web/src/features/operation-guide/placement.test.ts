import { describe, expect, it } from 'vitest';

import { overlaps, placeGuideCard } from './placement';

const viewport = { width: 1920, height: 1080 };
const size = { width: 320, height: 280 };
const icon = { left: 1838, top: 998, width: 58, height: 58 };
describe('guide placement', () => {
  it('keeps the default card above the chat icon', () => {
    const card = placeGuideCard(viewport, size, null, icon);
    expect(card.left).toBe(1576);
    expect(overlaps(card, icon, 12)).toBe(false);
  });
  it.each([
    { left: 1680, top: 800, width: 180, height: 44 },
    { left: 1840, top: 740, width: 44, height: 44 },
    { left: 100, top: 100, width: 1400, height: 850 },
  ])('avoids visible target %j and the icon', target => {
    const card = placeGuideCard(viewport, size, target, icon);
    expect(overlaps(card, target, 24)).toBe(false);
    expect(overlaps(card, icon, 12)).toBe(false);
  });
  it('avoids a dragged icon at the preferred card position', () => {
    const dragged = { left: 1800, top: 710, width: 58, height: 58 };
    expect(overlaps(placeGuideCard(viewport, size, null, dragged), dragged, 12)).toBe(false);
  });
});
