import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TableBoardForm } from './TableBoardForm';

import type { CsvDashboard } from '../../../api/client';
import type { CsvDashboardEditor } from '../csv-dashboards/useCsvDashboardEditor';
const auth = vi.hoisted(() => ({ role: 'ADMIN' }));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: auth.role } }) }));
vi.mock('../csv-dashboards/CsvDashboardUploadSection', () => ({ CsvDashboardUploadSection: () => null }));
vi.mock('../csv-dashboards/CsvDashboardPreviewSection', () => ({ CsvDashboardPreviewSection: () => null }));
describe('subject pattern input', () => {
  it.each(['ADMIN', 'MANAGER', 'VIEWER'])('is editable only by ADMIN (%s)', (role) => {
    auth.role = role;
    const editor = { normalizedColumnDefinitions: [], tableDisplayColumns: [], updateMutation: {}, gmailSubjectPattern: 'saved', setGmailSubjectPattern: vi.fn() } as unknown as CsvDashboardEditor;
    render(<TableBoardForm editor={editor} selected={{ templateType: 'TABLE' } as CsvDashboard} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: '取り込み' }));
    const input = screen.getByLabelText('Gmail の件名（この件名のメールから CSV を取り込む）');
    if (role === 'ADMIN') {
      expect(input).toBeEnabled();
      fireEvent.change(input, { target: { value: 'changed' } });
      expect(editor.setGmailSubjectPattern).toHaveBeenCalledWith('changed');
    } else expect(input).toBeDisabled();
    expect(input).toHaveValue('saved');
  });
});
