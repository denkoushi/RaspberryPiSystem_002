import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SelfInspectionWorkflowModal, type SelfInspectionWorkflowTarget } from './SelfInspectionWorkflowModal';

const target: SelfInspectionWorkflowTarget = {
  productNo: 'PO-1',
  scheduleRowId: 'row-1',
  resourceCd: 'R1',
  fseiban: 'FS-1',
  fhincd: 'PART-1',
  fhinmei: '品名',
  machineName: null,
  selfInspectionTemplateId: 'template-1',
  selfInspectionEntryPath: '/kiosk/part-measurement/self-inspection/start?templateId=template-1',
  selfInspectionResourceCds: ['R1', 'R2'],
  selfInspectionResourceCd: null
};

describe('SelfInspectionWorkflowModal resource selection', () => {
  it('requires an explicit resource choice and locks the saved resource on resume', async () => {
    const onOpenDigitalInput = vi.fn();
    const onOpenPaperPrint = vi.fn();
    const props = {
      target,
      onClose: vi.fn(),
      onOpenDigitalInput,
      onOpenPaperPrint
    };
    const { rerender } = render(<SelfInspectionWorkflowModal {...props} />);

    const digitalButton = screen.getByRole('button', { name: 'デジタル入力' });
    expect(digitalButton).toBeDisabled();
    const resourceSelect = screen.getByLabelText('検査資源') as HTMLSelectElement;
    fireEvent.change(resourceSelect, { target: { value: 'R2' } });
    expect(digitalButton).toBeEnabled();
    fireEvent.click(digitalButton);
    expect(onOpenDigitalInput).toHaveBeenCalledWith(target, 'R2');

    const resumedTarget = { ...target, selfInspectionResourceCd: 'R2' };
    rerender(<SelfInspectionWorkflowModal {...props} target={resumedTarget} />);
    await waitFor(() => expect(resourceSelect).toHaveValue('R2'));
    expect(resourceSelect).toBeDisabled();
    fireEvent.click(digitalButton);
    expect(onOpenDigitalInput).toHaveBeenLastCalledWith(resumedTarget, 'R2');
  });
});
