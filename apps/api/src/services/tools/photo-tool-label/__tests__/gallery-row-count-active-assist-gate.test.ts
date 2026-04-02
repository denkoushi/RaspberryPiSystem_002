import { describe, expect, it, vi } from 'vitest';

import { GalleryRowCountActiveAssistGate } from '../gallery-row-count-active-assist-gate.js';

describe('GalleryRowCountActiveAssistGate', () => {
  it('active OFF なら常に allowed false', async () => {
    const gallery = { countRowsByCanonicalLabel: vi.fn().mockResolvedValue(10) };
    const gate = new GalleryRowCountActiveAssistGate(gallery as never, {
      activeEnabled: false,
      minGalleryRows: 5,
    });
    const r = await gate.evaluate('ラベル');
    expect(r).toEqual({ allowed: false, rowCount: 10 });
  });

  it('active ON かつ件数が閾値以上なら allowed true', async () => {
    const gallery = { countRowsByCanonicalLabel: vi.fn().mockResolvedValue(5) };
    const gate = new GalleryRowCountActiveAssistGate(gallery as never, {
      activeEnabled: true,
      minGalleryRows: 5,
    });
    const r = await gate.evaluate('ラベル');
    expect(r).toEqual({ allowed: true, rowCount: 5 });
  });

  it('空ラベルは count を呼ばず allowed false', async () => {
    const gallery = { countRowsByCanonicalLabel: vi.fn() };
    const gate = new GalleryRowCountActiveAssistGate(gallery as never, {
      activeEnabled: true,
      minGalleryRows: 1,
    });
    const r = await gate.evaluate('  ');
    expect(r).toEqual({ allowed: false, rowCount: 0 });
    expect(gallery.countRowsByCanonicalLabel).not.toHaveBeenCalled();
  });
});
