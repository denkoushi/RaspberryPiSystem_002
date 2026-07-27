import { describe, expect, it } from 'vitest';

import {
  buildAutomaticAssemblyBoltSpec,
  createAssemblyBoltAt,
  dtoBoltToDraft,
  emptyAssemblyArea,
  orderProcedureItemsByFirstStep,
  resolveAssemblyBoltSpec,
  serializeAssemblyTemplateDraftAreas
} from '.';

import type {
  AssemblyProcedureStepDraft,
  AssemblyTemplateProcedureDraftItem
} from '.';
import type { AssemblyTemplateBoltDto } from './types';

function completedArea() {
  const area = emptyAssemblyArea();
  const bolt = createAssemblyBoltAt(area, 0.4, 0.6);
  bolt.nominalDiameter = 'M6';
  bolt.boltLengthMm = 30;
  bolt.material = 'SCM435';
  bolt.strengthClass = '10.9';
  bolt.lowerLimit = 9;
  bolt.nominalTorque = 10;
  bolt.upperLimit = 11;
  bolt.unit = 'N·m';
  area.bolts = [bolt];
  return area;
}

describe('assembly template draft serialization', () => {
  it('keeps numeric blanks nullable and refuses to serialize them as zero', () => {
    const area = emptyAssemblyArea();
    const bolt = createAssemblyBoltAt(area, 0.4, 0.6);
    area.bolts = [bolt];

    expect(bolt.boltLengthMm).toBeNull();
    expect(bolt.nominalTorque).toBeNull();
    expect(() => serializeAssemblyTemplateDraftAreas([area])).toThrow(
      '規定値が未入力'
    );
  });

  it('generates the display name and serializes an explicit override', () => {
    const area = completedArea();
    const bolt = area.bolts[0]!;

    expect(buildAutomaticAssemblyBoltSpec(bolt)).toBe(
      'M6×30 / SCM435 / 10.9'
    );
    expect(resolveAssemblyBoltSpec(bolt)).toBe('M6×30 / SCM435 / 10.9');

    bolt.boltSpecMode = 'custom';
    bolt.boltSpecCustom = '現場表記 M6-30';
    expect(serializeAssemblyTemplateDraftAreas([area])[0]!.bolts[0]!.boltSpec).toBe(
      '現場表記 M6-30'
    );
  });

  it('loads a persisted display name as custom so revision does not erase it', () => {
    const dto = {
      id: 'bolt-1',
      areaId: 'area-1',
      templateId: 'template-1',
      sortOrder: 0,
      tighteningId: 'T-1',
      markerNo: 1,
      xRatio: '0.4',
      yRatio: '0.6',
      calloutTipXRatio: null,
      calloutTipYRatio: null,
      boltSpec: '旧版の独自表記',
      nominalDiameter: 'M6',
      boltLengthMm: '30',
      material: 'SCM435',
      strengthClass: '10.9',
      capabilityGroupId: 'group-1',
      nominalTorque: '10',
      lowerLimit: '9',
      upperLimit: '11',
      unit: 'N·m',
      kioskDocumentId: null,
      assemblyProcedureDocumentId: null,
      pageIndex: 0,
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z'
    } satisfies AssemblyTemplateBoltDto;

    expect(dtoBoltToDraft(dto)).toMatchObject({
      boltSpecMode: 'custom',
      boltSpecCustom: '旧版の独自表記'
    });
  });

  it('orders documents by their first display step and omits unused documents', () => {
    const item = (
      id: string,
      documentId: string
    ): AssemblyTemplateProcedureDraftItem => ({
      localId: id,
      documentType: 'assembly_procedure_document',
      kioskDocumentId: null,
      assemblyProcedureDocumentId: documentId,
      label: '',
      document: {
        id: documentId,
        documentType: 'assembly_procedure_document',
        title: documentId,
        displayTitle: null,
        filename: documentId,
        confirmedDocumentNumber: null,
        confirmedSummaryText: null,
        pageCount: 1,
        enabled: true,
        updatedAt: '2026-07-27T00:00:00.000Z',
        imageRelativePath: '/procedure.png'
      }
    });
    const items = [item('one', 'doc-1'), item('two', 'doc-2'), item('three', 'doc-3')];
    const step = (documentId: string): AssemblyProcedureStepDraft => ({
      localId: `step-${documentId}`,
      kioskDocumentId: null,
      assemblyProcedureDocumentId: documentId,
      pageIndex: 0,
      viewMode: 'full_page',
      crop: null,
      title: '',
      instructionText: '',
      emphasis: 'normal'
    });

    expect(
      orderProcedureItemsByFirstStep(items, [step('doc-2'), step('doc-1')]).map(
        (candidate) => candidate.localId
      )
    ).toEqual(['two', 'one']);
  });
});
