import { describe, expect, it } from 'vitest';

import type {
  WorkInstructionEditAssetRecord,
  WorkInstructionEditRevisionRecord,
} from '../repositories/prisma-work-instruction-edit.persistence.js';
import {
  overlayToCreateData,
  toEditAssetView,
  toEditRevisionView,
  toOverlayView,
} from '../repositories/prisma-work-instruction-edit.persistence.js';
import type { WorkInstructionSourceVersionRecord } from '../repositories/prisma-work-instruction-version.persistence.js';
import {
  buildSourceVersionStepData,
  sourceVersionStepLike,
  toSourceVersionView,
} from '../repositories/prisma-work-instruction-version.persistence.js';
import type { WorkInstructionStagedAsset, WorkInstructionPacket } from '../domain/types.js';

const now = new Date('2026-08-31T00:00:00.000Z');
const sourceVersionId = '00000000-0000-0000-0000-000000000101';
const revisionId = '00000000-0000-0000-0000-000000000102';
const imageAssetId = '00000000-0000-0000-0000-000000000103';
const fingerprint = 'f'.repeat(64);

type OverlayRecord = WorkInstructionEditRevisionRecord['overlays'][number];

const editAssetRecord = {
  id: imageAssetId,
  storageKey: `work-instruction-assets/editing/${imageAssetId}.png`,
  mimeType: 'image/png',
  sizeBytes: 42,
  sha256: 'a'.repeat(64),
  status: 'ACTIVE',
  origin: 'ROI',
  originSourceVersionId: sourceVersionId,
  originSourceStep: 4n,
  originXRatio: 0.1,
  originYRatio: 0.2,
  originWidthRatio: 0.3,
  originHeightRatio: 0.4,
  ownerRevisionId: revisionId,
  createdAt: now,
  activatedAt: now,
  deletePendingAt: null,
} as unknown as WorkInstructionEditAssetRecord;

function overlayRecord(input: Record<string, unknown>): OverlayRecord {
  return {
    id: '00000000-0000-0000-0000-000000000201',
    sourceStep: 1n,
    migratedFromStep: 1n,
    baseStepFingerprint: fingerprint,
    targetStepFingerprint: fingerprint,
    migrationState: 'MIGRATED',
    xRatio: 0.1,
    yRatio: 0.2,
    widthRatio: 0.3,
    heightRatio: 0.4,
    zIndex: 2,
    opacity: 0.8,
    maskEnabled: false,
    maskColor: null,
    text: null,
    textStyle: null,
    editAssetId: null,
    objectFit: null,
    shapeKind: null,
    strokeColor: null,
    fillColor: null,
    strokeWidthRatio: null,
    shapeStartXRatio: null,
    shapeStartYRatio: null,
    shapeEndXRatio: null,
    shapeEndYRatio: null,
    editAsset: null,
    ...input,
  } as unknown as OverlayRecord;
}

describe('work-instruction persistence converters', () => {
  it('maps edit assets and TEXT/IMAGE/SHAPE overlays in both directions', () => {
    const textRecord = overlayRecord({
      id: '00000000-0000-0000-0000-000000000202',
      maskEnabled: true,
      maskColor: '#fff',
      text: '注意事項',
      textStyle: { fontSizeRatio: 0.04, fontWeight: 'bold' },
      kind: 'TEXT',
    });
    const imageRecord = overlayRecord({
      id: '00000000-0000-0000-0000-000000000203',
      sourceStep: null,
      migratedFromStep: 2n,
      targetStepFingerprint: null,
      migrationState: 'UNASSIGNED',
      kind: 'IMAGE',
      editAssetId: imageAssetId,
      objectFit: 'cover',
      editAsset: editAssetRecord,
    });
    const shapeRecord = overlayRecord({
      id: '00000000-0000-0000-0000-000000000204',
      kind: 'SHAPE',
      shapeKind: 'ARROW',
      strokeColor: '#f00',
      fillColor: '#fff',
      strokeWidthRatio: 0.01,
      shapeStartXRatio: 0.2,
      shapeStartYRatio: 0.3,
      shapeEndXRatio: 0.8,
      shapeEndYRatio: 0.9,
    });

    expect(toEditAssetView(editAssetRecord)).toMatchObject({
      id: imageAssetId,
      originSourceStep: 4,
      originBbox: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.4 },
    });

    const text = toOverlayView(textRecord);
    const image = toOverlayView(imageRecord);
    const shape = toOverlayView(shapeRecord);
    expect(text).toMatchObject({
      kind: 'TEXT',
      sourceStep: 1,
      text: '注意事項',
      style: { fontSizeRatio: 0.04, fontWeight: 'bold' },
      mask: { enabled: true, color: '#fff' },
    });
    expect(image).toMatchObject({
      kind: 'IMAGE',
      sourceStep: null,
      migratedFromStep: 2,
      assetId: imageAssetId,
      objectFit: 'cover',
    });
    expect(shape).toMatchObject({
      kind: 'SHAPE',
      shape: 'ARROW',
      start: { xRatio: 0.2, yRatio: 0.3 },
      end: { xRatio: 0.8, yRatio: 0.9 },
      strokeWidthRatio: 0.01,
    });

    const revisionView = toEditRevisionView({
      id: revisionId,
      sourceVersionId,
      revisionNumber: 2,
      supersedesRevisionId: null,
      copiedFromRevisionId: null,
      isRevisionHead: true,
      status: 'DRAFT',
      editVersion: 3,
      baseContentHash: 'b'.repeat(64),
      createdAt: now,
      updatedAt: now,
      overlays: [textRecord, imageRecord, shapeRecord],
    } as unknown as WorkInstructionEditRevisionRecord);
    expect(revisionView).toMatchObject({
      id: revisionId,
      revisionNumber: 2,
      editVersion: 3,
      overlays: [{ kind: 'TEXT' }, { kind: 'IMAGE', assetId: imageAssetId }, { kind: 'SHAPE', shape: 'ARROW' }],
      assets: { [imageAssetId]: { id: imageAssetId, origin: 'ROI', originSourceStep: 4 } },
    });

    expect(overlayToCreateData(revisionId, text)).toMatchObject({
      id: text.id,
      revisionId,
      kind: 'TEXT',
      sourceStep: 1n,
      migratedFromStep: 1n,
      text: '注意事項',
      textStyle: { fontSizeRatio: 0.04, fontWeight: 'bold' },
      maskEnabled: true,
      maskColor: '#fff',
    });
    expect(overlayToCreateData(revisionId, image)).toMatchObject({
      id: image.id,
      revisionId,
      kind: 'IMAGE',
      sourceStep: null,
      migratedFromStep: 2n,
      editAssetId: imageAssetId,
      objectFit: 'cover',
    });
    expect(overlayToCreateData(revisionId, shape)).toMatchObject({
      id: shape.id,
      revisionId,
      kind: 'SHAPE',
      shapeKind: 'ARROW',
      strokeColor: '#f00',
      fillColor: '#fff',
      strokeWidthRatio: 0.01,
      shapeStartXRatio: 0.2,
      shapeStartYRatio: 0.3,
      shapeEndXRatio: 0.8,
      shapeEndYRatio: 0.9,
    });
  });

  it('maps source version views and builds staged step rows by image name', () => {
    const sourceSteps = [
      {
        id: '00000000-0000-0000-0000-000000000301',
        step: 1n,
        text: '画像手順',
        imageName: 'step-1.png',
        imageAssetId: imageAssetId,
        imageSha256: null,
        imageDeletedAt: null,
        imageDeletedBy: null,
        imageAsset: { storageKey: 'work-instruction-assets/source.png', mimeType: 'image/png', sha256: 'c'.repeat(64) },
      },
      {
        id: '00000000-0000-0000-0000-000000000302',
        step: 2n,
        text: 'テキスト手順',
        imageName: null,
        imageAssetId: null,
        imageSha256: 'd'.repeat(64),
        imageDeletedAt: now,
        imageDeletedBy: 'admin',
        imageAsset: null,
      },
    ];
    const sourceRecord = {
      id: sourceVersionId,
      rowId: '00000000-0000-0000-0000-000000000303',
      sourceModified: now,
      partNumber: 'MD004',
      shootingTarget: '研削',
      rawManifest: { schema_version: 1 },
      contentHash: 'e'.repeat(64),
      createdAt: now,
      steps: sourceSteps,
    } as unknown as WorkInstructionSourceVersionRecord;

    expect(sourceVersionStepLike(sourceSteps[0]!)).toEqual({
      step: 1n,
      text: '画像手順',
      imageName: 'step-1.png',
      imageSha256: null,
    });
    expect(toSourceVersionView(sourceRecord)).toMatchObject({
      id: sourceVersionId,
      rowId: '00000000-0000-0000-0000-000000000303',
      partNumber: 'MD004',
      steps: [
        {
          step: 1,
          imageName: 'step-1.png',
          imageStorageKey: 'work-instruction-assets/source.png',
          imageMimeType: 'image/png',
          imageSha256: 'c'.repeat(64),
        },
        {
          step: 2,
          imageName: null,
          imageStorageKey: null,
          imageMimeType: null,
          imageSha256: 'd'.repeat(64),
          imageDeletedBy: 'admin',
        },
      ],
    });

    const stagedAssets = [{
      assetId: imageAssetId,
      imageName: 'step-1.png',
      storageKey: 'work-instruction-assets/staged.png',
      mimeType: 'image/png',
      sizeBytes: 42,
      sha256: 'c'.repeat(64),
      status: 'STAGED' as const,
      createdAt: now,
    }] satisfies ReadonlyArray<WorkInstructionStagedAsset>;
    const packet = {
      source: { system: 'SharePoint', list: 'WorkInstructions', itemId: 303, modified: now },
      partNumber: 'MD004',
      shootingTarget: '研削',
      rawManifest: { schema_version: 1 },
      contentHash: 'e'.repeat(64),
      steps: [
        { step: 1, text: '画像手順', imageName: 'step-1.png' },
        { step: 2, text: 'ハッシュ手順', imageName: 'step-2.png', imageHash: 'd'.repeat(64) },
        { step: 3, text: 'テキスト手順', imageName: null },
      ],
    } satisfies WorkInstructionPacket;

    const stepData = buildSourceVersionStepData(packet, stagedAssets);
    expect(stepData).toHaveLength(3);
    expect(stepData.map(({ id }) => id)).toEqual([
      expect.stringMatching(/^[0-9a-f-]{36}$/),
      expect.stringMatching(/^[0-9a-f-]{36}$/),
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    ]);
    expect(stepData).toEqual([
      expect.objectContaining({
        step: 1n,
        text: '画像手順',
        imageName: 'step-1.png',
        imageAssetId: imageAssetId,
        imageSha256: 'c'.repeat(64),
      }),
      expect.objectContaining({
        step: 2n,
        text: 'ハッシュ手順',
        imageName: 'step-2.png',
        imageAssetId: null,
        imageSha256: 'd'.repeat(64),
      }),
      expect.objectContaining({
        step: 3n,
        text: 'テキスト手順',
        imageName: null,
        imageAssetId: null,
        imageSha256: null,
      }),
    ]);
  });
});
