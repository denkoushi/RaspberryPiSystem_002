import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

test('IndexedDB snapshot replacement is atomic, preserves ordering, and recovers from quota errors', async ({ page }) => {
  const root = process.cwd();
  const load = createRequire(resolve(root, 'package.json'));
  const viteRequire = createRequire(load.resolve('vite/package.json', { paths: [resolve(root, 'apps/web')] }));
  const { build } = viteRequire('esbuild');
  const bundle = await build({ entryPoints: [resolve(root, 'apps/web/src/features/mobile-placement/local-data/mobileLocalDataStore.ts')],
    bundle: true, format: 'esm', platform: 'browser', write: false });
  await page.route('https://mobile-local-data.test/**', (route) => route.fulfill(route.request().url().endsWith('/store.js')
    ? { contentType: 'text/javascript', body: bundle.outputFiles[0].text }
    : { contentType: 'text/html', body: '<!doctype html><title>IndexedDB test</title>' }));
  await page.goto('https://mobile-local-data.test/');
  const result = await page.evaluate(async () => {
    // Run the actual bundled store against browser IndexedDB without a server or network.
    const modulePath = '/store.js';
    const { createMobileLocalDataStore } = await import(/* @vite-ignore */ modulePath) as typeof import('../apps/web/src/features/mobile-placement/local-data/mobileLocalDataStore');
    const name = `mobile-local-data-test-${Date.now()}`;
    const store = createMobileLocalDataStore(name);
    const purchase = { version: 'p1', dataUpdatedAt: '2026-10-27T00:00:00Z', rows: [
      ['1234567890', 'FS1', '品名', 'マスタ', '機種', 'MD1', 'MD1', 'MD1', 2, '2026-11-01']
    ] } as Parameters<typeof store.replace>[0]['purchase'];
    const schedule = { version: 's1', dataUpdatedAt: '2026-10-27T00:00:00Z', knownFseibans: ['FS1', 'FSNOPART'], rows: [
      ['z-first', 'FS1', 'T1', 'MD1', '品名', 'M', 1],
      ['a-second', 'FS1', 'T1', 'OTHER', '別部品', 'M', 2]
    ] } as NonNullable<Parameters<typeof store.replace>[0]['schedule']>;
    await store.replace({ purchase, schedule });
    const initial = await store.verify({ transferOrderBarcodeRaw: 'T1', actualOrderBarcodeRaw: '1234567890', actualFseibanRaw: '' });
    const originalPut = IDBObjectStore.prototype.put;
    let writes = 0;
    IDBObjectStore.prototype.put = function (...args) {
      if (++writes === 2) throw new DOMException('Simulated quota exhaustion', 'QuotaExceededError');
      return originalPut.apply(this, args);
    };
    let rejected = false;
    try {
      await store.replace({ purchase: { ...purchase!, version: 'p2' }, schedule: { ...schedule, version: 's2' } });
    } catch { rejected = true; } finally { IDBObjectStore.prototype.put = originalPut; }
    const afterFailure = await store.versions();
    // A cleanly aborted replace keeps reads on the previous version.
    const fallback = await store.lookupPurchase('1234567890');
    // A fresh page/store still sees the full previous committed version after rollback.
    const reopened = createMobileLocalDataStore(name);
    const retained = await reopened.lookupPurchase('1234567890');
    await store.replace({ purchase: { ...purchase!, version: 'p3', rows: [] } });
    const replaced = await reopened.lookupPurchase('1234567890');
    const native = await reopened.snapNative(['FSNOPART'], '');
    return { initial, rejected, afterFailure, fallback, retained, replaced, native };
  });
  expect(result.initial).toMatchObject({ ok: true, reason: 'match' });
  expect(result.rejected).toBe(true);
  expect(result.afterFailure).toMatchObject({ purchase: { version: 'p1' }, schedule: { version: 's1' } });
  expect(result.fallback?.rows).toHaveLength(1);
  expect(result.retained?.rows).toHaveLength(1);
  expect(result.replaced?.rows).toEqual([]);
  expect(result.native).toMatchObject({ fseiban: 'FSNOPART', fseibanMatch: 'exact' });
});
