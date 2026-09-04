import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  controller: null as Record<string, unknown> | null
}));

vi.mock('./AssemblyTemplateEditorContext', () => ({
  useAssemblyTemplateEditor: () => mocks.controller
}));

vi.mock('./AssemblyTemplateEditorCanvasToolbar', () => ({
  AssemblyTemplateEditorCanvasToolbar: () => <div data-testid="mock-canvas-toolbar" />
}));

vi.mock('../AssemblyProcedureCanvas', () => ({
  AssemblyProcedureCanvas: ({
    onMoveBolt
  }: {
    onMoveBolt?: (id: string, point: { xRatio: number; yRatio: number }) => void;
  }) => (
    <button
      type="button"
      data-testid="mock-full-page-move"
      onClick={() => onMoveBolt?.('bolt-1', { xRatio: 0.4, yRatio: 0.6 })}
    >
      full page
    </button>
  )
}));

vi.mock('../AssemblyProcedureCropView', () => ({
  AssemblyProcedureCropView: ({ overlay }: { overlay?: ReactNode }) => (
    <div data-testid="mock-crop-view">{overlay}</div>
  )
}));

vi.mock('../AssemblyProcedureMarkerLayer', () => ({
  AssemblyProcedureMarkerLayer: ({
    onMoveBolt
  }: {
    onMoveBolt?: (id: string, point: { xRatio: number; yRatio: number }) => void;
  }) => (
    <button
      type="button"
      data-testid="mock-crop-move"
      onClick={() => onMoveBolt?.('bolt-1', { xRatio: 0.25, yRatio: 0.75 })}
    >
      crop move
    </button>
  )
}));

vi.mock('../AssemblyProcedureOverlayLayer', () => ({
  AssemblyProcedureOverlayLayer: () => null
}));

import { AssemblyTemplateEditorCanvasPane } from './AssemblyTemplateEditorCanvasPane';

import type { ReactNode } from 'react';

const crop = {
  xRatio: 0.2,
  yRatio: 0.25,
  widthRatio: 0.6,
  heightRatio: 0.5
};

function createController(overrides: Record<string, unknown> = {}) {
  return {
    addBoltAt: vi.fn(),
    addCheckItemAt: vi.fn(),
    addCurrentCropStep: vi.fn(),
    canvasZoom: { zoom: 1, fitGeneration: 0 },
    cropVisibleBolts: [{ id: 'bolt-1', markerNo: 1, xRatio: 0.5, yRatio: 0.5, label: '締付点1' }],
    cropVisibleCheckItems: [],
    markerMode: 'bolt',
    patchProcedureStep: vi.fn(),
    placementAction: 'place',
    placeOnSelectedCropAt: vi.fn(),
    placeSelectedCalloutAt: vi.fn(),
    readOnly: false,
    selectedBolt: null,
    selectedBoltId: null,
    selectedCheckItem: null,
    selectedCheckItemId: null,
    selectedDocument: {
      id: 'document-1',
      pages: [{ pageIndex: 0, overlays: [] }],
      assets: {}
    },
    selectedPage: {
      source: 'assembly_procedure_document',
      documentId: 'document-1',
      pageIndex: 0,
      imageRelativePath: '/api/procedure-page.png'
    },
    selectedStep: {
      localId: 'step-1',
      viewMode: 'crop',
      crop
    },
    selectedStepPage: { key: 'document-1:0' },
    setBoltPatch: vi.fn(),
    selectBolt: vi.fn(),
    selectCheckItem: vi.fn(),
    showSelectedCrop: true,
    visibleBolts: [],
    visibleCheckItems: [],
    ...overrides
  };
}

describe('AssemblyTemplateEditorCanvasPane bolt movement wiring', () => {
  beforeEach(() => {
    mocks.controller = createController();
  });

  it('maps crop-local movement through the existing inverse projection and patches only position', () => {
    const controller = mocks.controller!;
    render(<AssemblyTemplateEditorCanvasPane />);

    fireEvent.click(screen.getByTestId('mock-crop-move'));

    expect(controller.setBoltPatch).toHaveBeenCalledTimes(1);
    expect(controller.setBoltPatch).toHaveBeenCalledWith('bolt-1', {
      xRatio: 0.35,
      yRatio: 0.625
    });
  });

  it('does not expose a bolt movement callback in readonly mode', () => {
    mocks.controller = createController({ readOnly: true });
    const controller = mocks.controller;
    render(<AssemblyTemplateEditorCanvasPane />);

    fireEvent.click(screen.getByTestId('mock-crop-move'));

    expect(controller.setBoltPatch).not.toHaveBeenCalled();
  });
});
