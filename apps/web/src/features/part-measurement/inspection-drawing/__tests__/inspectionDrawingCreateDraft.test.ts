import { describe, expect, it } from 'vitest';

import {
  buildInspectionDrawingCreateDirtySnapshot,
  extractFhincdFromVisualTemplateName,
  inspectionDrawingCreateKeyCollisionMessage,
  inspectionDrawingCreateDirtySnapshotsEqual,
  resolveInspectionDrawingCreateKeyCollision,
  resolveInspectionDrawingCreateKeyCollisionForResources,
  resolveInspectionDrawingCreateSaveBlockReason,
  resolveInspectionDrawingCreateSaveStatus,
  suggestInspectionDrawingTemplateName,
  templateItemsToDraftDrawingPoints,
  templateToCreateDraft
} from '../inspectionDrawingCreateDraft';

import type { PartMeasurementTemplateDto } from '../../types';
import type { InspectionDrawingPoint } from '../types';

function buildTemplate(overrides: Partial<PartMeasurementTemplateDto> = {}): PartMeasurementTemplateDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    fhincd: 'ABC',
    resourceCd: '033',
    processGroup: 'cutting',
    templateScope: 'three_key',
    candidateFhinmei: null,
    name: 'テスト図面',
    version: 1,
    isActive: true,
    selfInspectionMode: 'single',
    selfInspectionFixedCount: null,
    selfInspectionSampleSize: null,
    visualTemplateId: '22222222-2222-4222-8222-222222222222',
    visualTemplate: {
      id: '22222222-2222-4222-8222-222222222222',
      name: '共有図面A',
      drawingImageRelativePath: '/api/storage/part-measurement-drawings/a.png',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    siblingGroupId: null,
    siblingGroup: null,
    items: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        sortOrder: 0,
        datumSurface: 'A',
        measurementPoint: 'P1',
        measurementLabel: '寸法1',
        displayMarker: '1',
        unit: 'mm',
        allowNegative: true,
        decimalPlaces: 3,
        markerXRatio: '0.1',
        markerYRatio: '0.2',
        nominalValue: '10',
        lowerLimit: '9',
        upperLimit: '11'
      }
    ],
    ...overrides
  };
}

const point: InspectionDrawingPoint = {
  id: 'pt-1',
  name: '幅',
  markerNo: 1,
  xRatio: 0.2,
  yRatio: 0.4,
  nominalRaw: '10',
  lowerToleranceRaw: '-0.1',
  upperToleranceRaw: '+0.1',
  testValue: '',
  decimalPlaces: 3
};

function buildSnapshot(points: InspectionDrawingPoint[] = [point]) {
  return buildInspectionDrawingCreateDirtySnapshot({
    templateName: '図面A',
    fhincd: 'abc',
    resourceCds: ['033'],
    processGroup: 'cutting',
    visualSource: 'pickExisting',
    visualTemplateId: 'visual-1',
    uploadPending: false,
    selfInspectionMode: 'full',
    selfInspectionFixedCount: '',
    groupSaveMode: 'single',
    points
  });
}

describe('inspectionDrawingCreateDraft', () => {
  it('templateToCreateDraft returns new point ids without template entity state', () => {
    const draft = templateToCreateDraft(buildTemplate());
    expect(draft.sourceDraft.sourceTemplateId).toBe(buildTemplate().id);
    expect(draft.points).toHaveLength(1);
    expect(draft.points[0]?.id).not.toBe('33333333-3333-4333-8333-333333333333');
    expect(draft.visualTemplateId).toBe(buildTemplate().visualTemplateId);
    expect(draft.visualTemplateName).toBe('共有図面A');
  });

  it('templateItemsToDraftDrawingPoints always assigns fresh ids', () => {
    const template = buildTemplate();
    const first = templateItemsToDraftDrawingPoints(template.items);
    const second = templateItemsToDraftDrawingPoints(template.items);
    expect(first[0]?.id).not.toBe(template.items[0]?.id);
    expect(second[0]?.id).not.toBe(first[0]?.id);
  });

  it('detects same_as_source key collision', () => {
    const reason = resolveInspectionDrawingCreateKeyCollision({
      fhincd: 'ABC',
      processGroup: 'cutting',
      resourceCd: '033',
      sourceDraft: {
        sourceTemplateId: 'src',
        sourceFhincd: 'ABC',
        sourceProcessGroup: 'cutting',
        sourceResourceCd: '033'
      },
      activeExists: false
    });
    expect(reason).toBe('same_as_source');
    expect(inspectionDrawingCreateKeyCollisionMessage('same_as_source')).toContain('工程または資源CD');
  });

  it('treats fhincd case-insensitively for same_as_source', () => {
    const reason = resolveInspectionDrawingCreateKeyCollision({
      fhincd: 'abc',
      processGroup: 'cutting',
      resourceCd: '033',
      sourceDraft: {
        sourceTemplateId: 'src',
        sourceFhincd: 'ABC',
        sourceProcessGroup: 'cutting',
        sourceResourceCd: '033'
      },
      activeExists: false
    });
    expect(reason).toBe('same_as_source');
  });

  it('detects active_exists key collision for normal create', () => {
    const reason = resolveInspectionDrawingCreateKeyCollision({
      fhincd: 'ABC',
      processGroup: 'grinding',
      resourceCd: '033',
      sourceDraft: null,
      activeExists: true
    });
    expect(reason).toBe('active_exists');
  });

  it('suggests template name from visual library display name and fhincd', () => {
    expect(
      suggestInspectionDrawingTemplateName({
        visualTemplateName: '7161テーブル',
        fhincd: 'ABC-123'
      })
    ).toBe('7161テーブル ABC-123');
  });

  it('detects collisions across multiple selected resources', () => {
    const reason = resolveInspectionDrawingCreateKeyCollisionForResources({
      fhincd: 'ABC',
      processGroup: 'cutting',
      resourceCds: ['031', '033', '035'],
      sourceDraft: null,
      activeExistsByResourceCd: { '033': true }
    });
    expect(reason).toBe('active_exists');
  });

  it('keeps save disabled until required fields are ready', () => {
    expect(
      resolveInspectionDrawingCreateSaveBlockReason({
        contentReadOnly: false,
        busy: false,
        fhincd: 'ABC',
        resourceCds: ['033'],
        hasDrawing: true,
        pointCount: 1,
        pointsValid: true,
        selfInspectionValid: true,
        keyCollision: null,
        saveBlockedByPreview: false
      })
    ).toBeNull();
    expect(
      resolveInspectionDrawingCreateSaveBlockReason({
        contentReadOnly: false,
        busy: false,
        fhincd: 'ABC',
        resourceCds: [],
        hasDrawing: true,
        pointCount: 1,
        pointsValid: true,
        selfInspectionValid: true,
        keyCollision: null,
        saveBlockedByPreview: false
      })
    ).toBe('missing_resource');
  });

  it('compares dirty snapshots without transient test values', () => {
    const saved = buildSnapshot();
    const current = buildSnapshot([{ ...point, testValue: '10.01' }]);
    const renamed = buildSnapshot([{ ...point, name: '厚み' }]);
    const supplemented = buildSnapshot([{ ...point, threadNominal: 'M10' }]);

    expect(inspectionDrawingCreateDirtySnapshotsEqual(saved, current)).toBe(true);
    expect(inspectionDrawingCreateDirtySnapshotsEqual(saved, renamed)).toBe(false);
    expect(inspectionDrawingCreateDirtySnapshotsEqual(saved, supplemented)).toBe(false);
  });

  it('resolves save status from block reason and dirty state', () => {
    expect(
      resolveInspectionDrawingCreateSaveStatus({
        contentReadOnly: false,
        busy: false,
        saveBlockReason: null,
        dirty: false
      })
    ).toBe('saved');
    expect(
      resolveInspectionDrawingCreateSaveStatus({
        contentReadOnly: false,
        busy: false,
        saveBlockReason: null,
        dirty: true
      })
    ).toBe('dirty');
    expect(
      resolveInspectionDrawingCreateSaveStatus({
        contentReadOnly: false,
        busy: false,
        saveBlockReason: 'invalid_points',
        dirty: true
      })
    ).toBe('blocked');
    expect(
      resolveInspectionDrawingCreateSaveStatus({
        contentReadOnly: false,
        busy: true,
        saveBlockReason: 'busy',
        dirty: true
      })
    ).toBe('saving');
    expect(
      resolveInspectionDrawingCreateSaveStatus({
        contentReadOnly: true,
        busy: false,
        saveBlockReason: 'content_read_only',
        dirty: true
      })
    ).toBe('read_only');
  });
});

describe('extractFhincdFromVisualTemplateName', () => {
  it('extracts a single fhincd embedded in a drawing name', () => {
    expect(extractFhincdFromVisualTemplateName('7161ストッパー台（1）MD004121651')).toBe(
      'MD004121651'
    );
  });

  it('normalizes full-width alphanumerics before extraction', () => {
    expect(extractFhincdFromVisualTemplateName('７１６１ストッパー台ＭＤ００４１２１６５１')).toBe(
      'MD004121651'
    );
  });

  it('returns null when no fhincd-like token is present', () => {
    expect(extractFhincdFromVisualTemplateName('7161テーブル')).toBeNull();
  });

  it('returns null when multiple distinct fhincd candidates are present', () => {
    expect(
      extractFhincdFromVisualTemplateName('MD004121651とMD0004167150の比較図')
    ).toBeNull();
  });

  it('returns null for empty or missing names', () => {
    expect(extractFhincdFromVisualTemplateName(null)).toBeNull();
    expect(extractFhincdFromVisualTemplateName('')).toBeNull();
  });
});
