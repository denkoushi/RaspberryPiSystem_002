import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InspectionDrawingCreateHeaderBand } from '../InspectionDrawingCreateHeaderBand';
import { InspectionDrawingCreateMetadataRow } from '../InspectionDrawingCreateMetadataRow';
import {
  inspectionDrawingCreateMetadataSlotClassName,
  inspectionDrawingMetadataGridClassName
} from '../inspectionDrawingKioskUi';

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
});
