import { describe, expect, it, vi } from 'vitest';

import {
  createAssemblyBoltAt,
  createAssemblyCheckItemAt,
  draftAreasToInput,
  draftCheckItemsToInput,
  emptyAssemblyArea,
  filterDraftBoltsForPage,
  filterDraftCheckItemsForPage
} from './assemblyTemplateDraft';

describe('assembly template marker callout draft', () => {
  it('round-trips optional callouts for bolt/check and filters them with their page', () => {
    vi.stubGlobal('crypto', { randomUUID: () => `id-${Math.random()}` });
    const pageRef = { source: 'assembly_procedure_document' as const, documentId: 'doc-1', pageIndex: 2 };
    const area = emptyAssemblyArea();
    const bolt = {
      ...createAssemblyBoltAt(area, 0.2, 0.3, pageRef),
      calloutTipXRatio: 0.8,
      calloutTipYRatio: 0.7
    };
    area.bolts = [bolt];
    const check = {
      ...createAssemblyCheckItemAt([], 0.4, 0.5, pageRef),
      calloutTipXRatio: 0.1,
      calloutTipYRatio: 0.9
    };

    expect(draftAreasToInput([area])[0]!.bolts[0]).toMatchObject({
      calloutTipXRatio: 0.8,
      calloutTipYRatio: 0.7
    });
    expect(draftCheckItemsToInput([check])[0]).toMatchObject({
      calloutTipXRatio: 0.1,
      calloutTipYRatio: 0.9
    });
    expect(filterDraftBoltsForPage([area], pageRef, 'doc-1')[0]).toMatchObject({ calloutTipXRatio: 0.8 });
    expect(filterDraftCheckItemsForPage([check], pageRef, 'doc-1')[0]).toMatchObject({ calloutTipYRatio: 0.9 });
  });
});
