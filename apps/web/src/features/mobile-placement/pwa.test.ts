import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { haizenPhoneColors } from './ui/haizenPhoneTokens';

const webRoot = process.cwd();
const manifest = JSON.parse(readFileSync(join(webRoot, 'public/manifest.webmanifest'), 'utf8'));

describe('配膳 install manifest', () => {
  it('is linked from index.html with the phone background as theme color', () => {
    const html = new DOMParser().parseFromString(readFileSync(join(webRoot, 'index.html'), 'utf8'), 'text/html');
    expect(html.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe('/manifest.webmanifest');
    expect(html.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(haizenPhoneColors.bg);
  });

  it('starts without credentials and keeps all kiosk sub-screens in standalone scope', () => {
    expect(manifest).toMatchObject({
      name: '配膳', short_name: '配膳',
      start_url: '/kiosk/mobile-placement', scope: '/kiosk/',
      display: 'standalone', orientation: 'portrait', lang: 'ja',
      background_color: haizenPhoneColors.bg, theme_color: haizenPhoneColors.bg
    });
    expect('/kiosk/purchase-order-lookup'.startsWith(manifest.scope)).toBe(true);
  });

  it('ships real PNG icons with the required sizes and separate maskable purpose', () => {
    expect(manifest.icons).toEqual([
      { src: '/icons/haizen-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/haizen-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/haizen-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]);
    for (const icon of manifest.icons) {
      const png = readFileSync(join(webRoot, 'public', icon.src));
      expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(png.toString('ascii', 12, 16)).toBe('IHDR');
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
    }
  });
});
