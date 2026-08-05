import assert from 'node:assert/strict';
import test from 'node:test';

import { assertNoManualTarget, resolveSingleVisibleTarget } from './capture-contract.mjs';
import { chromiumLaunchOptions, generatorVersion } from './capture-runtime.mjs';
import { resolveInspectionDrawingCaptureAdapter } from './inspection-drawing-capture-adapter.mjs';

const context = { scenarioId: 'edit', sheetId: 'edit-basics', targetId: 'save-revision' };
const rect = { left: 10, top: 20, width: 30, height: 40 };

test('accepts one visible, non-zero DOM target', () => {
  assert.deepEqual(resolveSingleVisibleTarget([{ visible: true, rect }], context), rect);
});

test('rejects missing, duplicate, hidden, and zero-sized DOM targets', () => {
  assert.throws(() => resolveSingleVisibleTarget([], context), /found 0/);
  assert.throws(() => resolveSingleVisibleTarget([{ visible: true, rect }, { visible: true, rect }], context), /found 2/);
  assert.throws(() => resolveSingleVisibleTarget([{ visible: false, rect }], context), /not visible/);
  assert.throws(() => resolveSingleVisibleTarget([{ visible: true, rect: { ...rect, width: 0 } }], context), /zero dimensions/);
});

test('rejects source definitions with handwritten coordinates', () => {
  assert.throws(() => assertNoManualTarget({ target: { x: 0.5, y: 0.5 } }, context), /forbidden/);
  assert.doesNotThrow(() => assertNoManualTarget({ targetId: 'save-revision' }, context));
});

test('rejects unregistered fixture and sheet identifiers', () => {
  assert.throws(() => resolveInspectionDrawingCaptureAdapter('missing-fixture'), /Unregistered.*fixture/);
  assert.throws(
    () => resolveInspectionDrawingCaptureAdapter('inspection-drawing-edit-v1').assertSupportedSheet('missing-sheet'),
    /Unregistered.*sheet/
  );
  assert.throws(
    () => resolveInspectionDrawingCaptureAdapter('inspection-drawing-library-v1').assertSupportedSheet('edit-basics'),
    /Unregistered.*sheet/
  );
});

test('pins CPU-independent Chromium text rasterization', () => {
  assert.equal(generatorVersion, '1.3.0');
  assert.ok(chromiumLaunchOptions.args.includes('--disable-skia-runtime-opts'));
  assert.ok(chromiumLaunchOptions.args.includes('--disable-lcd-text'));
  assert.ok(chromiumLaunchOptions.args.includes('--disable-font-subpixel-positioning'));
  assert.ok(chromiumLaunchOptions.args.includes('--font-render-hinting=none'));
});
