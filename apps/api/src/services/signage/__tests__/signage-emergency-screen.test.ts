import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { buildEmergencyBandSvg, buildEmergencyMessageSvg, wrapEmergencyMessage } from '../signage-emergency-screen.js';
import { SignageRenderer } from '../signage.renderer.js';
import type { SignageContentResponse } from '../signage.service.js';

describe('wrapEmergencyMessage', () => {
  it('keeps author line breaks, wraps long lines and caps the line count', () => {
    expect(wrapEmergencyMessage('クレーン点検のため\n第2ベイ 15:00 まで立入禁止', 16)).toEqual([
      'クレーン点検のため',
      '第2ベイ 15:00 まで立入禁止',
    ]);
    expect(wrapEmergencyMessage('あ'.repeat(20), 16)).toEqual(['あ'.repeat(16), 'あ'.repeat(4)]);
    const capped = wrapEmergencyMessage(Array.from({ length: 8 }, (_, i) => `行${i}`).join('\n'), 16);
    expect(capped).toHaveLength(5);
    expect(capped[4].endsWith('…')).toBe(true);
  });
});

describe('emergency SVG', () => {
  it('escapes markup in the message', () => {
    const svg = buildEmergencyMessageSvg('<script>&"', 1920, 1080);
    expect(svg).toContain('&lt;script&gt;&amp;&quot;');
    expect(svg).not.toContain('<script>');
    expect(buildEmergencyBandSvg('a<b', 1920, 1080)).toContain('a&lt;b');
  });
});

/** sharp の stats() は切り出し前の入力全体を測るため、いったんバッファにしてから測る */
async function regionMeans(image: Buffer, left: number, top: number): Promise<number[]> {
  const region = await sharp(image).extract({ left, top, width: 40, height: 40 }).png().toBuffer();
  return (await sharp(region).stats()).channels.map((channel) => channel.mean);
}

type ContentRenderer = {
  renderContent: (content: SignageContentResponse) => Promise<Buffer>;
  renderContentBody: (content: SignageContentResponse) => Promise<Buffer>;
};

describe('SignageRenderer emergency message', () => {
  const base = { contentType: 'TOOLS', displayMode: 'SINGLE' } as unknown as SignageContentResponse;

  it('renders a full red screen for a message-only emergency without rendering other content', async () => {
    const renderer = Object.create(SignageRenderer.prototype) as ContentRenderer;
    const body = vi.spyOn(renderer, 'renderContentBody');
    const output = await renderer.renderContent({ ...base, emergency: { message: '立入禁止', messageOnly: true } });
    const meta = await sharp(output).metadata();
    expect([meta.width, meta.height]).toEqual([1920, 1080]);
    const corner = await regionMeans(output, 1800, 1000);
    expect(corner[0]).toBeGreaterThan(150);
    expect(corner[1]).toBeLessThan(60);
    expect(body).not.toHaveBeenCalled();
  });

  it('overlays a red band on other content, and leaves content untouched without a message', async () => {
    const blue = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#0000ff' } }).jpeg().toBuffer();
    const renderer = Object.create(SignageRenderer.prototype) as ContentRenderer;
    vi.spyOn(renderer, 'renderContentBody').mockResolvedValue(blue);

    const withBand = await renderer.renderContent({ ...base, emergency: { message: '設備停止中', messageOnly: false } });
    const top = await regionMeans(withBand, 1700, 10);
    const bottom = await regionMeans(withBand, 1700, 900);
    expect(top[0]).toBeGreaterThan(150);
    expect(top[2]).toBeLessThan(80);
    expect(bottom[2]).toBeGreaterThan(200);
    expect(bottom[0]).toBeLessThan(80);

    await expect(renderer.renderContent({ ...base, emergency: { message: '  ', messageOnly: true } })).resolves.toBe(blue);
    await expect(renderer.renderContent(base)).resolves.toBe(blue);
  });
});
