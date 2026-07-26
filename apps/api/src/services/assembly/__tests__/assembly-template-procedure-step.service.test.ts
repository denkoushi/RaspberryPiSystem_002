import {
  clipAssemblyProcedureLineToCrop,
  cropPointToAssemblyProcedureSourcePoint,
  isAssemblyProcedurePointInCrop,
  normalizeAssemblyProcedureCropRect,
  sourcePointToAssemblyProcedureCropPoint
} from '@raspi-system/shared-types';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import {
  AssemblyTemplateProcedureStepService,
  normalizeAssemblyTemplateProcedureSteps,
  normalizeProcedureItemsForExplicitSteps
} from '../assembly-template-procedure-step.service.js';

const PRIMARY_ID = '11111111-1111-4111-8111-111111111111';
const SECONDARY_ID = '22222222-2222-4222-8222-222222222222';
const KIOSK_ID = '33333333-3333-4333-8333-333333333333';

describe('assembly procedure crop geometry', () => {
  it('normalizes reverse drag, clamps boundaries, and enforces the minimum size', () => {
    expect(
      normalizeAssemblyProcedureCropRect(
        { xRatio: 1.2, yRatio: 0.9 },
        { xRatio: 0.99, yRatio: -0.2 }
      )
    ).toEqual({
      xRatio: 0.98,
      yRatio: 0,
      widthRatio: 0.02,
      heightRatio: 0.9
    });
  });

  it('round-trips source and crop-local coordinates', () => {
    const crop = { xRatio: 0.2, yRatio: 0.3, widthRatio: 0.4, heightRatio: 0.5 };
    const source = { xRatio: 0.44, yRatio: 0.6 };
    const local = sourcePointToAssemblyProcedureCropPoint(source, crop);
    expect(local.xRatio).toBeCloseTo(0.6);
    expect(local.yRatio).toBeCloseTo(0.6);
    expect(cropPointToAssemblyProcedureSourcePoint(local, crop)).toEqual(source);
  });

  it('includes boundary markers, excludes outside markers, and clips callout lines', () => {
    const crop = { xRatio: 0.2, yRatio: 0.2, widthRatio: 0.4, heightRatio: 0.4 };
    expect(isAssemblyProcedurePointInCrop({ xRatio: 0.2, yRatio: 0.6 }, crop)).toBe(true);
    expect(isAssemblyProcedurePointInCrop({ xRatio: 0.19, yRatio: 0.4 }, crop)).toBe(false);
    expect(
      clipAssemblyProcedureLineToCrop(
        {
          start: { xRatio: 0.1, yRatio: 0.4 },
          end: { xRatio: 0.8, yRatio: 0.4 }
        },
        crop
      )
    ).toEqual({
      start: { xRatio: 0, yRatio: 0.5 },
      end: { xRatio: 1, yRatio: 0.5 }
    });
  });
});

describe('assembly template procedure step normalization', () => {
  it('normalizes text and reorders documents by first step occurrence', () => {
    const steps = normalizeAssemblyTemplateProcedureSteps([
      {
        assemblyProcedureDocumentId: PRIMARY_ID,
        pageIndex: 1,
        viewMode: 'CROP',
        cropXRatio: 0.1,
        cropYRatio: 0.2,
        cropWidthRatio: 0.3,
        cropHeightRatio: 0.4,
        title: '  締付確認  ',
        emphasis: 'IMPORTANT'
      },
      {
        kioskDocumentId: KIOSK_ID,
        pageIndex: 0,
        viewMode: 'FULL_PAGE'
      }
    ]);
    const items = normalizeProcedureItemsForExplicitSteps(
      PRIMARY_ID,
      [
        { kioskDocumentId: KIOSK_ID, assemblyProcedureDocumentId: null, label: null },
        {
          kioskDocumentId: null,
          assemblyProcedureDocumentId: PRIMARY_ID,
          label: '主'
        }
      ],
      steps
    );
    expect(steps[0]?.title).toBe('締付確認');
    expect(items.map((item) => item.assemblyProcedureDocumentId ?? item.kioskDocumentId)).toEqual([
      PRIMARY_ID,
      KIOSK_ID
    ]);
  });

  it.each([
    {
      name: 'empty',
      steps: []
    },
    {
      name: 'document xor',
      steps: [
        {
          kioskDocumentId: KIOSK_ID,
          assemblyProcedureDocumentId: PRIMARY_ID,
          pageIndex: 0,
          viewMode: 'FULL_PAGE' as const
        }
      ]
    },
    {
      name: 'full page with crop',
      steps: [
        {
          assemblyProcedureDocumentId: PRIMARY_ID,
          pageIndex: 0,
          viewMode: 'FULL_PAGE' as const,
          cropXRatio: 0,
          cropYRatio: 0,
          cropWidthRatio: 1,
          cropHeightRatio: 1
        }
      ]
    },
    {
      name: 'crop outside page',
      steps: [
        {
          assemblyProcedureDocumentId: PRIMARY_ID,
          pageIndex: 0,
          viewMode: 'CROP' as const,
          cropXRatio: 0.9,
          cropYRatio: 0,
          cropWidthRatio: 0.2,
          cropHeightRatio: 0.5
        }
      ]
    }
  ])('rejects $name', ({ steps }) => {
    expect(() => normalizeAssemblyTemplateProcedureSteps(steps)).toThrow(ApiError);
  });

  it('rejects removal of the last step that contains a marker', () => {
    const service = new AssemblyTemplateProcedureStepService();
    const steps = normalizeAssemblyTemplateProcedureSteps([
      {
        assemblyProcedureDocumentId: PRIMARY_ID,
        pageIndex: 0,
        viewMode: 'CROP',
        cropXRatio: 0,
        cropYRatio: 0,
        cropWidthRatio: 0.2,
        cropHeightRatio: 0.2
      }
    ]);
    expect(() =>
      service.assertMarkersVisible(steps, [
        {
          markerNo: 1,
          xRatio: 0.8,
          yRatio: 0.8,
          assemblyProcedureDocumentId: PRIMARY_ID,
          pageIndex: 0
        }
      ])
    ).toThrow('マーカーが見える表示ステップ');
  });

  it('requires every document and the first assembly document to match the primary', () => {
    const steps = normalizeAssemblyTemplateProcedureSteps([
      {
        assemblyProcedureDocumentId: SECONDARY_ID,
        pageIndex: 0,
        viewMode: 'FULL_PAGE'
      },
      {
        assemblyProcedureDocumentId: PRIMARY_ID,
        pageIndex: 0,
        viewMode: 'FULL_PAGE'
      }
    ]);
    expect(() =>
      normalizeProcedureItemsForExplicitSteps(
        PRIMARY_ID,
        [
          {
            kioskDocumentId: null,
            assemblyProcedureDocumentId: PRIMARY_ID,
            label: null
          },
          {
            kioskDocumentId: null,
            assemblyProcedureDocumentId: SECONDARY_ID,
            label: null
          }
        ],
        steps
      )
    ).toThrow('最初に現れる組立手順書');
  });
});
