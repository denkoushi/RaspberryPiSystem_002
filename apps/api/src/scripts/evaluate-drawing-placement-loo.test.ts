import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(), disconnect: vi.fn(), complete: vi.fn(), select: vi.fn(), delay: vi.fn(),
  settings: vi.fn()
}));
vi.mock('../lib/prisma.js', () => ({ prisma: {
  partMeasurementVisualTemplate: { findMany: mocks.findMany }, $disconnect: mocks.disconnect
} }));
vi.mock('../services/inference/inference-runtime.js', () => ({ getInferenceRuntime: () => ({ createTextCompletionPort: () => ({ complete: mocks.complete }) }) }));
vi.mock('../services/part-measurement/inspection-drawing-measurement-label-settings.service.js', () => ({
  InspectionDrawingMeasurementLabelSettingsService: class { listSettings = mocks.settings; }
}));
vi.mock('../services/part-measurement/part-measurement-drawing-sibling-selection.js', () => ({
  drawingSiblingSelectionDeps: {}, selectDrawingSiblings: mocks.select
}));
vi.mock('../services/part-measurement/part-measurement-drawing-ocr.service.js', () => ({ getPartMeasurementDrawingOcrService: vi.fn() }));
vi.mock('../services/part-measurement/part-measurement-drawing-dimension-map.service.js', () => ({ getPartMeasurementDrawingDimensionMapService: vi.fn() }));
vi.mock('node:timers/promises', () => ({ setTimeout: mocks.delay }));

import {
  encodePartMeasurementDrawingDimensionMapPayload, PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION
} from '../services/part-measurement/part-measurement-drawing-dimension-map-payload.js';

const originalArgv = process.argv;
const originalExitCode = process.exitCode;
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.spyOn(console, 'table').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const decimal = (value: number) => ({ toNumber: () => value });
  const visuals = await Promise.all(['target', 'same-machine', 'cross-machine'].map(async (id, index) => ({
    id, name: `${index === 2 ? '7161' : '3351-MD1'} 台`, drawingImageRelativePath: `${id}.png`,
    dimensionMaps: [{ status: 'COMPLETED', drawingImageFingerprint: id, payloadEncoding: 'gzip+json',
      payloadCompressed: await encodePartMeasurementDrawingDimensionMapPayload({
        schemaVersion: 1, analysisVersion: PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION, createdAt: '2026-10-26',
        image: { width: 100, height: 100 }, tiles: [], dimensions: [{
          text: id, nominal: 64, kind: 'len', depth: null, lowerTolerance: null, upperTolerance: null, xRatio: 0.5, yRatio: 0.5, tileId: 'tile'
        }]
      }) }],
    businessTemplates: [{ id: `${id}-template`, processGroup: 'CUTTING', updatedAt: new Date(), items: [{
      id: `${id}-item`, sortOrder: 1, measurementLabel: '全幅', nominalValue: decimal(64), lowerLimit: decimal(63.7), upperLimit: decimal(64.3),
      depthMode: 'MEASURED', valueKind: 'NUMERIC', markerXRatio: decimal(0.5), markerYRatio: decimal(0.5), calloutTipXRatio: null, calloutTipYRatio: null
    }] }]
  })));
  mocks.findMany.mockResolvedValue(visuals);
  mocks.settings.mockResolvedValue([{ label: '幅', toleranceKind: 'dimension' }]);
  mocks.complete.mockResolvedValue({ rawText: '{"items":[{"i":0,"use":"nominal","label":"幅"}]}', model: 'fake' });
  mocks.select.mockResolvedValue({ status: 'MATCHED', method: 'name', siblings: [{ visualTemplateId: 'cross-machine', confidence: 1 }] });
  process.argv = ['node', 'evaluate', '--process', 'cutting', '--visual-template-id', 'target'];
});
afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

async function evaluate() {
  const finished = new Promise<void>((resolve) => mocks.disconnect.mockImplementationOnce(async () => { resolve(); }));
  await import('./evaluate-drawing-placement-loo.js');
  await finished;
  expect(mocks.disconnect).toHaveBeenCalledOnce();
  expect(console.error).not.toHaveBeenCalled();
  return JSON.parse(vi.mocked(console.log).mock.calls[0][0] as string);
}

it('evaluates reference without writes or sibling inference, excludes the target machine, and retries deferred completions', async () => {
  process.argv.push('--method', 'reference', '--exclude-same-machine');
  const { InferenceDeferredError } = await import('../services/inference/ports/text-completion.port.js');
  mocks.complete.mockRejectedValueOnce(new InferenceDeferredError()).mockRejectedValueOnce(new InferenceDeferredError());
  const summary = await evaluate();
  expect(summary).toMatchObject({ errorRows: 0, proposalCount: 1, matched: 0, nominalMatched: 1, countsByMethod: { reference: 1 } });
  expect(mocks.complete).toHaveBeenCalledTimes(3);
  expect(mocks.delay.mock.calls).toEqual([[20000], [20000]]);
  const prompt = mocks.complete.mock.calls[0][0].messages[1].content;
  expect(prompt).toContain('cross-machine');
  expect(prompt).not.toContain('same-machine');
  expect(prompt).not.toContain('見本 2:');
  expect(mocks.select).not.toHaveBeenCalled();
});

it('records a safe error row after three deferred retries', async () => {
  process.argv.push('--method', 'reference');
  const { InferenceDeferredError } = await import('../services/inference/ports/text-completion.port.js');
  mocks.complete.mockRejectedValue(new InferenceDeferredError());
  expect(await evaluate()).toMatchObject({ evaluatedRows: 0, errorRows: 1, nominalMatched: 0 });
  expect(mocks.complete).toHaveBeenCalledTimes(4);
  expect(mocks.delay).toHaveBeenCalledTimes(3);
  expect(vi.mocked(console.table).mock.calls[0][0]).toMatchObject([{ error: 'Reference inference deferred after 3 retries' }]);
});

it('keeps transfer as the default and reports nominal-only matches', async () => {
  process.argv.push('--vision', 'none');
  expect(await evaluate()).toMatchObject({ errorRows: 0, proposalCount: 1, matched: 1, nominalMatched: 1, countsByMethod: { name: 1 } });
  expect(mocks.complete).not.toHaveBeenCalled();
  expect(mocks.settings).not.toHaveBeenCalled();
});
