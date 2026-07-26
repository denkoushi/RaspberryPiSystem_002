import { describe, expect, it } from 'vitest';

import {
  assemblyProcedureStepDraftReducer,
  canRemoveProcedureStep,
  createCropStepDraft,
  createFullPageStepDraft,
  orderProcedureItemsByFirstStep,
  transformMarkerForProcedureStep
} from './assemblyProcedureStepDraft';

import type { AssemblyEditorPageOption } from './assemblyTemplateDraft';
import type { AssemblyTemplateProcedureDraftItem } from './assemblyTemplateProcedureDraft';

const primaryPage: AssemblyEditorPageOption = {
  key: 'primary:0',
  label: '主手順書 / 1ページ',
  source: 'assembly_procedure_document',
  documentId: 'primary',
  pageIndex: 0,
  imageRelativePath: '/primary.png'
};
const secondaryPage: AssemblyEditorPageOption = {
  ...primaryPage,
  key: 'secondary:0',
  label: '補助手順書 / 1ページ',
  documentId: 'secondary'
};

describe('assemblyProcedureStepDraftReducer', () => {
  it('adds, duplicates, moves by number, and caps the storyboard at 300', () => {
    const first = createFullPageStepDraft(primaryPage);
    const second = createCropStepDraft(secondaryPage, {
      xRatio: 0.2,
      yRatio: 0.2,
      widthRatio: 0.4,
      heightRatio: 0.4
    });
    let steps = assemblyProcedureStepDraftReducer([], {
      type: 'replace',
      steps: [first, second]
    });
    steps = assemblyProcedureStepDraftReducer(steps, {
      type: 'duplicate',
      localId: second.localId
    });
    expect(steps).toHaveLength(3);
    steps = assemblyProcedureStepDraftReducer(steps, {
      type: 'move_to',
      localId: steps[2]!.localId,
      targetIndex: 0
    });
    expect(steps[0]!.viewMode).toBe('crop');

    const manyPages = Array.from({ length: 400 }, (_, index) => ({
      ...primaryPage,
      key: `primary:${index}`,
      pageIndex: index
    }));
    steps = assemblyProcedureStepDraftReducer(steps, {
      type: 'append_pages',
      pages: manyPages
    });
    expect(steps).toHaveLength(300);
  });

  it('shares markers by source page, maps crop coordinates, and protects the last visible step', () => {
    const crop = createCropStepDraft(primaryPage, {
      xRatio: 0.2,
      yRatio: 0.2,
      widthRatio: 0.4,
      heightRatio: 0.4
    });
    const marker = {
      id: 'marker-1',
      markerNo: 1,
      xRatio: 0.4,
      yRatio: 0.5,
      calloutTipXRatio: 0.8,
      calloutTipYRatio: 0.5,
      assemblyProcedureDocumentId: 'primary',
      pageIndex: 0
    };
    const transformed = transformMarkerForProcedureStep(marker, crop)!;
    expect(transformed.xRatio).toBeCloseTo(0.5);
    expect(transformed.yRatio).toBeCloseTo(0.75);
    expect(transformed.calloutTipXRatio).toBeCloseTo(1);
    expect(
      canRemoveProcedureStep({
        steps: [crop, createFullPageStepDraft(secondaryPage)],
        localId: crop.localId,
        markers: [marker]
      })
    ).toMatchObject({ allowed: false });
  });

  it('derives document collection order from first step appearance', () => {
    const items = [
      {
        localId: 'primary-item',
        documentType: 'assembly_procedure_document',
        kioskDocumentId: null,
        assemblyProcedureDocumentId: 'primary',
        label: '',
        document: { id: 'primary' }
      },
      {
        localId: 'secondary-item',
        documentType: 'assembly_procedure_document',
        kioskDocumentId: null,
        assemblyProcedureDocumentId: 'secondary',
        label: '',
        document: { id: 'secondary' }
      }
    ] as AssemblyTemplateProcedureDraftItem[];
    expect(
      orderProcedureItemsByFirstStep(items, [
        createFullPageStepDraft(secondaryPage),
        createFullPageStepDraft(primaryPage)
      ]).map((item) => item.assemblyProcedureDocumentId)
    ).toEqual(['secondary', 'primary']);
  });
});
