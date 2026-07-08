import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InspectionDrawingCreateCompactHeader } from '../InspectionDrawingCreateCompactHeader';
import { InspectionDrawingCreateHeaderBand } from '../InspectionDrawingCreateHeaderBand';
import { InspectionDrawingCreateMetadataRow } from '../InspectionDrawingCreateMetadataRow';
import {
  inspectionDrawingCreateMetadataSlotClassName,
  inspectionDrawingMetadataGridClassName
} from '../inspectionDrawingKioskUi';

const drawingSourceControl = (
  <span data-testid="inspection-drawing-create-visual-source">図面</span>
);

const metadataProps = {
  lineageLocked: true,
  fhincd: 'SD000107240',
  onFhincdChange: vi.fn(),
  resourceCd: '033',
  onResourceCdChange: vi.fn(),
  resourceSelectOptions: [{ value: '033', label: '033 (三井HS3A(25号機) / 横型)' }],
  resourceNameMap: {},
  processGroup: 'cutting' as const,
  templateProcessGroup: 'cutting' as const,
  templateName: 'test01',
  onTemplateNameChange: vi.fn(),
  selfInspectionMode: 'single' as const,
  onSelfInspectionModeChange: vi.fn(),
  selfInspectionFixedCount: '',
  onSelfInspectionFixedCountChange: vi.fn(),
  contentReadOnly: true,
  onDrawingFileChange: vi.fn(),
  templateVersion: 2,
  templateIsActive: true
};

describe('InspectionDrawingCreateCompactHeader', () => {
  it('renders flat band direct children without metadataSlot wrapper', () => {
    render(
      <InspectionDrawingCreateCompactHeader
        metadata={metadataProps}
        drawingSourceControl={drawingSourceControl}
        centerSlot={<span data-testid="zoom-controls">zoom</span>}
        toolbar={<div data-testid="toolbar-root">toolbar</div>}
      />
    );

    const band = screen.getByTestId('inspection-drawing-create-header-band');
    const directChildTestIds = Array.from(band.children).map((child) =>
      child.getAttribute('data-testid')
    );

    expect(directChildTestIds).toEqual([
      'inspection-drawing-create-meta-row',
      'inspection-drawing-create-version-badge',
      'inspection-drawing-create-visual-source',
      'inspection-drawing-create-zoom-slot',
      'inspection-drawing-create-toolbar-slot'
    ]);
  });

  it('nests toolbar inside toolbar-slot wrapper', () => {
    render(
      <InspectionDrawingCreateCompactHeader
        metadata={metadataProps}
        drawingSourceControl={drawingSourceControl}
        toolbar={<div data-testid="toolbar-root">toolbar</div>}
      />
    );

    const toolbarSlot = screen.getByTestId('inspection-drawing-create-toolbar-slot');
    expect(toolbarSlot.querySelector('[data-testid="toolbar-root"]')).toBeTruthy();
    expect(toolbarSlot).toHaveClass('flex-1');
    expect(toolbarSlot).toHaveClass('min-w-0');
  });

  it('applies shrink-0 to version badge as a flat band item', () => {
    render(
      <InspectionDrawingCreateCompactHeader
        metadata={metadataProps}
        drawingSourceControl={drawingSourceControl}
        toolbar={<div>tools</div>}
      />
    );

    expect(screen.getByTestId('inspection-drawing-create-version-badge').className).toContain('shrink-0');
  });

  it('does not wrap chips in metadataSlot class', () => {
    render(
      <InspectionDrawingCreateCompactHeader
        metadata={metadataProps}
        drawingSourceControl={drawingSourceControl}
        toolbar={<div>tools</div>}
      />
    );

    const metaRow = screen.getByTestId('inspection-drawing-create-meta-row');
    expect(metaRow.parentElement).toHaveAttribute('data-testid', 'inspection-drawing-create-header-band');
    expect(metaRow.className).toContain('flex-nowrap');
    expect(metaRow.className).not.toContain('flex-1');
  });
});

describe('InspectionDrawingCreateHeaderBand', () => {
  it('uses compact metadata slot when metadataLayout is createCompact', () => {
    render(
      <InspectionDrawingCreateHeaderBand
        metadataLayout="createCompact"
        metadata={<span data-testid="metadata-node">meta</span>}
        toolbar={<span>tools</span>}
      />
    );

    expect(screen.getByTestId('metadata-node').parentElement).toHaveClass(
      ...inspectionDrawingCreateMetadataSlotClassName.split(' ')
    );
  });

  it('uses grid metadata slot by default', () => {
    render(
      <InspectionDrawingCreateHeaderBand
        metadata={<span data-testid="metadata-node">meta</span>}
        toolbar={<span>tools</span>}
      />
    );

    expect(screen.getByTestId('metadata-node').parentElement).toHaveClass(
      ...inspectionDrawingMetadataGridClassName.split(' ')
    );
  });
});

describe('InspectionDrawingCreateMetadataRow', () => {
  it('associates compact controls with accessible labels', () => {
    render(
      <InspectionDrawingCreateMetadataRow
        lineageLocked={false}
        fhincd="MD100469601"
        onFhincdChange={vi.fn()}
        resourceCd="033"
        onResourceCdChange={vi.fn()}
        resourceSelectOptions={[{ value: '033', label: '033 (横型)' }]}
        resourceNameMap={{}}
        processGroup="cutting"
        templateName="7161サドル"
        onTemplateNameChange={vi.fn()}
        selfInspectionMode="fixed_count"
        onSelfInspectionModeChange={vi.fn()}
        selfInspectionFixedCount="3"
        onSelfInspectionFixedCountChange={vi.fn()}
        contentReadOnly={false}
        onDrawingFileChange={vi.fn()}
        templateVersion={2}
        templateIsActive
      />
    );

    expect(screen.getByLabelText('品番')).toHaveValue('MD100469601');
    expect(screen.getByLabelText('資源')).toHaveValue('033');
    expect(screen.getByLabelText('テンプレ')).toHaveValue('7161サドル');
    expect(screen.getByLabelText('検査数')).toHaveValue('fixed_count');
    expect(screen.getByLabelText('指定数')).toHaveValue(3);
  });

  it('renders meta chip text inputs with black-on-white classes', () => {
    render(
      <InspectionDrawingCreateMetadataRow
        lineageLocked={false}
        fhincd="MD100469601"
        onFhincdChange={vi.fn()}
        resourceCd="033"
        onResourceCdChange={vi.fn()}
        resourceSelectOptions={[{ value: '033', label: '033 (横型)' }]}
        resourceNameMap={{}}
        processGroup="cutting"
        templateName="7161サドル"
        onTemplateNameChange={vi.fn()}
        selfInspectionMode="fixed_count"
        onSelfInspectionModeChange={vi.fn()}
        selfInspectionFixedCount="3"
        onSelfInspectionFixedCountChange={vi.fn()}
        contentReadOnly={false}
        onDrawingFileChange={vi.fn()}
        templateVersion={2}
        templateIsActive
      />
    );

    for (const label of ['品番', 'テンプレ', '指定数'] as const) {
      const input = screen.getByLabelText(label);
      expect(input.className).toContain('!bg-white');
      expect(input.className).toContain('!text-black');
    }

    const inspectionModeSelect = screen.getByLabelText('検査数');
    expect(inspectionModeSelect.className).toContain('text-white');
    expect(inspectionModeSelect.className).not.toContain('!text-black');
  });
});
