import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureTextCandidateDialog } from './AssemblyProcedureTextCandidateDialog';

import type { AssemblyProcedureTextCandidateDto } from '../types';

const candidate: AssemblyProcedureTextCandidateDto = {
  text: '組立手順を確認する',
  confidence: 0.94,
  bounds: null,
  pageIndex: 0,
  source: 'coordinate-ocr'
};

describe('AssemblyProcedureTextCandidateDialog', () => {
  it('keeps candidate details and cancel action visible on the white dialog panel', () => {
    render(
      <AssemblyProcedureTextCandidateDialog
        candidates={[candidate]}
        isOpen
        onSelect={vi.fn()}
        onManual={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const candidateButton = screen.getByRole('option', { name: /組立手順を確認する/ });
    expect(candidateButton).toHaveClass('bg-slate-50', 'text-slate-900', 'border-slate-200');
    expect(screen.getByText('確度 94%')).toHaveClass('text-slate-600');

    const cancelButton = screen.getByRole('button', { name: 'キャンセル' });
    expect(cancelButton).toHaveClass('text-slate-800');
    expect(candidateButton).not.toHaveClass('text-white/90');
    expect(cancelButton).not.toHaveClass('text-white/90');
  });

  it('preserves candidate selection, manual entry, and cancel callbacks', () => {
    const onSelect = vi.fn();
    const onManual = vi.fn();
    const onClose = vi.fn();
    render(
      <AssemblyProcedureTextCandidateDialog
        candidates={[candidate]}
        isOpen
        onSelect={onSelect}
        onManual={onManual}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole('option', { name: /組立手順を確認する/ }));
    fireEvent.click(screen.getByRole('button', { name: '手入力で追加' }));
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));

    expect(onSelect).toHaveBeenCalledWith(candidate);
    expect(onManual).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
