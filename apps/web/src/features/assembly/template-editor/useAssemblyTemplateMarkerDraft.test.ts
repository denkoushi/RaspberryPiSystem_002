import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAssemblyTemplateMarkerDraft } from './useAssemblyTemplateMarkerDraft';

import type { AssemblyBoltCondition } from '../assemblyBoltConditionPalette';
import type { AssemblyEditorPageOption } from '../assemblyTemplateDraft';

const page: AssemblyEditorPageOption = {
  key: 'assembly_procedure_document:doc-1:0',
  label: 'P1',
  source: 'assembly_procedure_document',
  documentId: 'doc-1',
  pageIndex: 0,
  imageRelativePath: '/api/doc-1.png'
};

const m8: AssemblyBoltCondition = {
  nominalDiameter: 'M8',
  boltLengthMm: 25,
  material: 'SCM435',
  strengthClass: '12.9',
  capabilityGroupId: 'group-1',
  nominalTorque: 35.5,
  lowerLimit: 32,
  upperLimit: 39.1,
  unit: 'N·m'
};
const m6: AssemblyBoltCondition = { ...m8, nominalDiameter: 'M6', boltLengthMm: 16, nominalTorque: 12.5, lowerLimit: 11.3, upperLimit: 13.8 };

function renderMarkerDraft() {
  return renderHook(() =>
    useAssemblyTemplateMarkerDraft({
      loadedTemplate: null,
      loading: false,
      onMessage: vi.fn(),
      onOpenInspector: vi.fn(),
      pageOptions: [page],
      procedureSteps: [],
      readOnly: false,
      selectedDocumentId: 'doc-1',
      selectedPage: page,
      selectedPageKey: page.key,
      selectedStep: null
    })
  );
}

describe('useAssemblyTemplateMarkerDraft bolt conditions', () => {
  it('places every new bolt with the active condition and re-assigns the selected bolt on tap', () => {
    const { result } = renderMarkerDraft();

    act(() => result.current.addBoltCondition(m8));
    act(() => result.current.addBoltAt(0.1, 0.1));
    act(() => result.current.addBoltAt(0.2, 0.2));

    expect(result.current.areas[0]!.bolts.map((bolt) => [bolt.nominalDiameter, bolt.nominalTorque, bolt.capabilityGroupId])).toEqual([
      ['M8', 35.5, 'group-1'],
      ['M8', 35.5, 'group-1']
    ]);
    expect(result.current.boltConditionPalette.map((entry) => entry.markerNos)).toEqual([[1, 2]]);

    act(() => result.current.addBoltCondition(m6));
    const m6Key = result.current.activeBoltConditionKey!;
    act(() => result.current.selectBolt(result.current.areas[0]!.bolts[0]!.id));
    act(() => result.current.selectBoltCondition(m6Key));

    expect(result.current.areas[0]!.bolts.map((bolt) => bolt.nominalDiameter)).toEqual(['M6', 'M8']);
    expect(result.current.boltConditionPalette.map((entry) => entry.markerNos)).toEqual([[1], [2]]);

    act(() => result.current.addBoltAt(0.3, 0.3));
    expect(result.current.areas[0]!.bolts[2]).toMatchObject({ nominalDiameter: 'M6', upperLimit: 13.8, boltSpecMode: 'auto' });
  });

  it('keeps the previous inherit-from-selected behaviour when no condition is active', () => {
    const { result } = renderMarkerDraft();

    act(() => result.current.addBoltAt(0.1, 0.1));
    act(() => result.current.setBoltPatch(result.current.areas[0]!.bolts[0]!.id, { nominalDiameter: 'M10', nominalTorque: 70 }));
    act(() => result.current.addBoltAt(0.2, 0.2));

    expect(result.current.activeBoltConditionKey).toBeNull();
    expect(result.current.areas[0]!.bolts[1]).toMatchObject({ nominalDiameter: 'M10', nominalTorque: 70 });
  });
});
