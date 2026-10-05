import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TagDeskRecordForm } from './TagDeskRecordForm';

import type { TagDeskKind, TagDeskOptions } from '../../../api/domains/tag-desk';

const options: TagDeskOptions = {
  divisions: ['製造部', '管理部'],
  sections: [{ division: '製造部', name: '機械課' }, { division: '管理部', name: '総務課' }],
  departments: ['機械課'],
  genres: []
};

function renderForm(kind: TagDeskKind, record: Record<string, string>) {
  const onSave = vi.fn();
  render(<TagDeskRecordForm kind={kind} record={record} name="対象" options={options} saving={false} deleting={false} onSave={onSave} onDelete={vi.fn()} onCancel={vi.fn()} />);
  return onSave;
}

describe('TagDeskRecordForm', () => {
  it.each(['employee', 'item', 'instrument', 'rigging'] as const)('preserves an unknown current select value for %s', (kind) => {
    const onSave = renderForm(kind, {
      employeeCode: '0001', lastName: '山田', firstName: '太郎', itemCode: 'T-1',
      managementNumber: 'R-1', name: '対象', status: 'LEGACY_STATUS', department: '旧部門', section: '旧部署', genreId: '旧ジャンル'
    });
    const status = screen.getByLabelText('状態');
    expect(status).toHaveValue('LEGACY_STATUS');
    expect(within(status).getAllByRole('option').at(-1)).toHaveValue('LEGACY_STATUS');
    if (kind === 'employee') {
      expect(screen.getByLabelText('部門')).toHaveValue('旧部門');
      expect(screen.getByLabelText('部署')).toHaveValue('旧部署');
    } else if (kind !== 'item') {
      expect(screen.getByLabelText('部署')).toHaveValue('旧部門');
      if (kind === 'instrument') expect(screen.getByLabelText('ジャンル')).toHaveValue('旧ジャンル');
    }
    fireEvent.submit(screen.getByRole('form'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      status: 'LEGACY_STATUS',
      ...(kind === 'employee' ? { department: '旧部門', section: '旧部署' } : {}),
      ...(kind === 'instrument' ? { department: '旧部門', genreId: '旧ジャンル' } : {}),
      ...(kind === 'rigging' ? { department: '旧部門' } : {})
    }));
  });

  it('resets the section through the model when the employee division changes', () => {
    const onSave = renderForm('employee', { employeeCode: '0001', lastName: '山田', firstName: '太郎', department: '製造部', section: '機械課', status: 'ACTIVE' });
    fireEvent.change(screen.getByLabelText('部門'), { target: { value: '管理部' } });
    const section = screen.getByLabelText('部署');
    expect(section).toHaveValue('');
    expect(within(section).queryByRole('option', { name: '機械課' })).not.toBeInTheDocument();
    fireEvent.change(section, { target: { value: '総務課' } });
    fireEvent.submit(screen.getByRole('form'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ department: '管理部', section: '総務課' }));
    fireEvent.change(screen.getByLabelText('部門'), { target: { value: '' } });
    expect(section).toHaveValue('');
    expect(within(section).getAllByRole('option')).toHaveLength(1);
  });
});
