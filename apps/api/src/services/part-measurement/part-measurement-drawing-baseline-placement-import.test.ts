import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    partMeasurementVisualTemplate: { findFirst: vi.fn() },
    partMeasurementDrawingPlacementRun: { findUnique: vi.fn(), upsert: vi.fn() },
    partMeasurementDrawingPlacementProposal: { count: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn()
  }
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: mocks.prisma }));
vi.mock('./part-measurement-drawing-ocr.service.js', () => ({ getPartMeasurementDrawingOcrService: () => ({ getCurrentFingerprint: vi.fn() }) }));

import {
  baselineDecimalPlaces,
  baselinePlacementImportSchema,
  importBaselinePlacementProposals,
  type BaselinePlacementImport
} from './part-measurement-drawing-baseline-placement-import.js';

const db = mocks.prisma;
const proposal = (sortOrder: number, overrides = {}) => ({
  sortOrder, kind: 'dia', measurementLabel: '外径', reason: 'Φ12.5', nominalValue: 12.5, lowerLimit: null, upperLimit: 12.52,
  markerXRatio: 0.4, markerYRatio: 0.3, anchorXRatio: 0.3, anchorYRatio: 0.35, leader: null as [number, number] | null, ...overrides
});
const input = (sha = 'hash-a'): BaselinePlacementImport => ({
  version: 'baseline-v1',
  drawings: [{ visualTemplateId: 'vt-1', imageSha256: sha, proposals: [proposal(1), proposal(2, { leader: [0.1, 0.2], nominalValue: 8, upperLimit: null })] }]
});
const getFingerprint = async () => 'hash-a';

beforeEach(() => {
  vi.resetAllMocks();
  db.partMeasurementVisualTemplate.findFirst.mockResolvedValue({ id: 'vt-1' });
  db.partMeasurementDrawingPlacementRun.findUnique.mockResolvedValue(null);
  db.partMeasurementDrawingPlacementRun.upsert.mockResolvedValue({ id: 'run-1' });
  db.partMeasurementDrawingPlacementProposal.count.mockResolvedValue(0);
  db.$transaction.mockImplementation(async (callback) => callback(db));
});

describe('baselineDecimalPlaces', () => {
  it.each([
    [{ nominalValue: 10, lowerLimit: null, upperLimit: null }, 1],
    [{ nominalValue: 12.5, lowerLimit: 12.48, upperLimit: null }, 2],
    [{ nominalValue: 12.5, lowerLimit: 12.4812, upperLimit: 12.5 }, 3]
  ])('%j -> %i', (value, expected) => expect(baselineDecimalPlaces(value)).toBe(expected));
});

describe('importBaselinePlacementProposals', () => {
  it('dry-run reports counts and writes nothing', async () => {
    const summary = await importBaselinePlacementProposals(input(), { apply: false, getFingerprint });
    expect(summary).toMatchObject({ apply: false, created: 1, replaced: 0, skipped: 0,
      drawings: [{ visualTemplateId: 'vt-1', proposals: 2, result: 'create' }] });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.partMeasurementDrawingPlacementRun.upsert).not.toHaveBeenCalled();
    expect(db.partMeasurementDrawingPlacementProposal.createMany).not.toHaveBeenCalled();
  });

  it('apply upserts the baseline run and replaces its proposals in one transaction', async () => {
    const summary = await importBaselinePlacementProposals(input(), { apply: true, getFingerprint });
    expect(summary).toMatchObject({ created: 1, skipped: 0 });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.partMeasurementDrawingPlacementRun.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        visualTemplateId: 'vt-1', drawingImageFingerprint: 'hash-a', placementVersion: 'baseline-v1', rankingMethod: 'baseline',
        sourceVisualTemplateId: null, sourceTemplateId: null, proposalCount: 2
      })
    }));
    expect(db.partMeasurementDrawingPlacementProposal.deleteMany).toHaveBeenCalledWith({ where: { runId: 'run-1' } });
    const { data } = db.partMeasurementDrawingPlacementProposal.createMany.mock.calls[0][0];
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({
      runId: 'run-1', visualTemplateId: 'vt-1', sourceItemId: 'baseline-v1:1', status: 'PROPOSED', measurementPoint: null,
      decimalPlaces: 2, depthMode: 'MEASURED', valueKind: 'NUMERIC', markerXRatio: 0.4, markerYRatio: 0.3, candidates: [],
      dimension: { reason: 'Φ12.5', xRatio: 0.3, yRatio: 0.35, kind: 'dia', leader: null }
    });
    expect(data[1]).toMatchObject({ sourceItemId: 'baseline-v1:2', decimalPlaces: 1, dimension: { leader: [0.1, 0.2] } });
  });

  it('is idempotent: a second run replaces the same run', async () => {
    db.partMeasurementDrawingPlacementRun.findUnique.mockResolvedValue({ id: 'run-1' });
    const summary = await importBaselinePlacementProposals(input(), { apply: true, getFingerprint });
    expect(summary).toMatchObject({ created: 0, replaced: 1 });
    expect(db.partMeasurementDrawingPlacementRun.upsert).toHaveBeenCalledTimes(1);
  });

  it('skips a drawing whose current fingerprint differs', async () => {
    const summary = await importBaselinePlacementProposals(input('other'), { apply: true, getFingerprint });
    expect(summary.drawings[0]).toMatchObject({ result: 'skipped', reason: 'fingerprint-mismatch' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('skips missing or inactive templates', async () => {
    db.partMeasurementVisualTemplate.findFirst.mockResolvedValue(null);
    const summary = await importBaselinePlacementProposals(input(), { apply: true, getFingerprint });
    expect(summary.drawings[0]).toMatchObject({ result: 'skipped', reason: 'template-missing-or-inactive' });
  });

  it('does not overwrite a run that has decided proposals (apply and dry-run)', async () => {
    db.partMeasurementDrawingPlacementRun.findUnique.mockResolvedValue({ id: 'run-1', proposals: [{ id: 'p' }] });
    db.partMeasurementDrawingPlacementProposal.count.mockResolvedValue(1);
    const dry = await importBaselinePlacementProposals(input(), { apply: false, getFingerprint });
    expect(dry.drawings[0]).toMatchObject({ result: 'skipped', reason: 'has-decided-proposals' });
    const applied = await importBaselinePlacementProposals(input(), { apply: true, getFingerprint });
    expect(applied.drawings[0]).toMatchObject({ result: 'skipped', reason: 'has-decided-proposals' });
    expect(db.partMeasurementDrawingPlacementRun.upsert).not.toHaveBeenCalled();
    expect(db.partMeasurementDrawingPlacementProposal.deleteMany).not.toHaveBeenCalled();
  });
});

describe('baselinePlacementImportSchema duplicates', () => {
  it('rejects a duplicate sortOrder within one drawing', () => {
    const value = { version: 'baseline-v1', drawings: [{ visualTemplateId: 'vt-1', imageSha256: 'h', proposals: [proposal(1), proposal(1)] }] };
    expect(baselinePlacementImportSchema.safeParse(value).success).toBe(false);
  });

  it('rejects a duplicate visualTemplateId across drawings', () => {
    const drawing = { visualTemplateId: 'vt-1', imageSha256: 'h', proposals: [proposal(1)] };
    const result = baselinePlacementImportSchema.safeParse({ version: 'baseline-v1', drawings: [drawing, drawing] });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('duplicate visualTemplateId');
  });

  it('accepts the same sortOrder in different drawings', () => {
    const value = { version: 'baseline-v1', drawings: [
      { visualTemplateId: 'vt-1', imageSha256: 'h', proposals: [proposal(1)] },
      { visualTemplateId: 'vt-2', imageSha256: 'h', proposals: [proposal(1)] }
    ] };
    expect(baselinePlacementImportSchema.safeParse(value).success).toBe(true);
  });
});

describe('importBaselinePlacementProposals apply failures', () => {
  it('records apply-error for a failing drawing and continues with the next one', async () => {
    const two: BaselinePlacementImport = {
      version: 'baseline-v1',
      drawings: [
        { visualTemplateId: 'vt-1', imageSha256: 'hash-a', proposals: [proposal(1)] },
        { visualTemplateId: 'vt-2', imageSha256: 'hash-a', proposals: [proposal(1)] }
      ]
    };
    db.partMeasurementVisualTemplate.findFirst.mockImplementation(async ({ where }) => ({ id: where.id }));
    db.$transaction.mockRejectedValueOnce(new Error('secret detail')).mockImplementation(async (callback) => callback(db));
    const summary = await importBaselinePlacementProposals(two, { apply: true, getFingerprint });
    expect(summary.drawings).toEqual([
      { visualTemplateId: 'vt-1', proposals: 1, result: 'failed', reason: 'apply-error' },
      { visualTemplateId: 'vt-2', proposals: 1, result: 'create' }
    ]);
    expect(summary).toMatchObject({ created: 1, failed: 1, skipped: 0 });
  });
});
