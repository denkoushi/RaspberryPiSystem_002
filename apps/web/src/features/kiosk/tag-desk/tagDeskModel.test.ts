import { describe, expect, it } from 'vitest';

import { FORM_FIELDS, KIND_META, changeRecordField, emptyRecord, shortUid, toPayload, uidBytes } from './tagDeskModel';

import type { TagDeskOptions } from '../../../api/domains/tag-desk';

const options: TagDeskOptions = {
  divisions: ['製造部', '管理部'],
  sections: [
    { division: '製造部', name: '機械課' },
    { division: '製造部', name: '資材課' },
    { division: '管理部', name: '資材課' },
    { division: '管理部', name: '総務課' }
  ],
  departments: ['機械課', '製造担当'],
  positions: [{ name: '班長', approval: 'approver' }, { name: '一般', approval: 'none' }, { name: '主事', approval: 'unmapped' }],
  genres: []
};

describe('tagDeskModel', () => {
  it('puts the position select between section and status with only the configured choices', () => {
    const index = FORM_FIELDS.employee.findIndex((field) => field.key === 'positionName');
    expect(FORM_FIELDS.employee[index - 1].key).toBe('section');
    expect(FORM_FIELDS.employee[index + 1].key).toBe('status');
    expect(FORM_FIELDS.employee[index]).toMatchObject({ label: '職位', type: 'select' });
    expect(FORM_FIELDS.employee[index].options?.(options, {})).toEqual([
      { value: '', label: '未設定' }, { value: '班長', label: '班長' }, { value: '一般', label: '一般' }, { value: '主事', label: '主事' }
    ]);
    expect(emptyRecord('employee').positionName).toBe('');
  });

  it.each([[' 班長 ', '班長'], ['', null], ['   ', null]])('sends employee position %s as %s', (positionName, expected) => {
    expect(toPayload('employee', { ...emptyRecord('employee'), positionName: positionName! }).positionName).toBe(expected);
  });
  it('labels employee organization fields and columns as 部門 and 部署', () => {
    expect(KIND_META.employee).toMatchObject({ subLabel: '部門', sub2Label: '部署' });
    expect(FORM_FIELDS.employee.find((field) => field.key === 'department')).toMatchObject({ label: '部門', type: 'select' });
    expect(FORM_FIELDS.employee.find((field) => field.key === 'section')).toMatchObject({ label: '部署', type: 'select' });
    const department = FORM_FIELDS.employee.find((field) => field.key === 'department')!;
    expect(department.options?.(options, {})).toEqual([
      { value: '', label: '未設定' }, { value: '製造部', label: '製造部' }, { value: '管理部', label: '管理部' }
    ]);
  });

  it('filters employee sections by the selected division, including an unset division', () => {
    const section = FORM_FIELDS.employee.find((field) => field.key === 'section')!;
    expect(section.options?.(options, { department: '製造部' })).toEqual([
      { value: '', label: '未設定' }, { value: '機械課', label: '機械課' }, { value: '資材課', label: '資材課' }
    ]);
    expect(section.options?.(options, { department: '管理部' })).toEqual([
      { value: '', label: '未設定' }, { value: '資材課', label: '資材課' }, { value: '総務課', label: '総務課' }
    ]);
    expect(section.options?.(options, { department: '' })).toEqual([{ value: '', label: '未設定' }]);
  });

  it('resets an incompatible employee section when the division changes without mutating the values', () => {
    const values = { department: '製造部', section: '機械課' };
    expect(changeRecordField('employee', options, values, 'department', '管理部')).toEqual({ department: '管理部', section: '' });
    expect(changeRecordField('employee', options, values, 'department', '')).toEqual({ department: '', section: '' });
    expect(values).toEqual({ department: '製造部', section: '機械課' });
  });

  it('keeps a section valid in the new division and leaves unrelated edits alone', () => {
    expect(changeRecordField('employee', options, { department: '製造部', section: '資材課' }, 'department', '管理部'))
      .toEqual({ department: '管理部', section: '資材課' });
    const values = { department: '旧部門', section: '旧部署' };
    expect(changeRecordField('employee', options, values, 'department', '旧部門')).toEqual(values);
    expect(changeRecordField('employee', options, values, 'firstName', '太郎')).toEqual({ ...values, firstName: '太郎' });
    expect(changeRecordField('rigging', options, values, 'department', '機械課')).toEqual({ department: '機械課', section: '旧部署' });
  });

  it.each(['instrument', 'rigging'] as const)('keeps %s deployment options separate from employee divisions', (kind) => {
    const department = FORM_FIELDS[kind].find((field) => field.key === 'department')!;
    expect(department.label).toBe('部署');
    expect(department.options?.(options, {})).toEqual([
      { value: '', label: '未設定' }, { value: '機械課', label: '機械課' }, { value: '製造担当', label: '製造担当' }
    ]);
  });

  it('splits hex UIDs into bytes and leaves other IDs whole', () => {
    expect(uidBytes('04a1b2c3d45e80')).toEqual(['04', 'A1', 'B2', 'C3', 'D4', '5E', '80']);
    expect(uidBytes('04:A1:B2:C3')).toEqual(['04', 'A1', 'B2', 'C3']);
    expect(uidBytes('TAG_EMP_1')).toEqual(['TAG_EMP_1']);
    expect(shortUid('04A1B2C3D45E80')).toBe('A1:B2:C3:D4');
  });

  it('turns blank optional fields into null and converts numbers', () => {
    const values = { ...emptyRecord('rigging'), name: '吊具A', managementNumber: 'R-1', maxLoadTon: '2.5', storageLocation: '' };
    expect(toPayload('rigging', values)).toMatchObject({
      name: '吊具A',
      managementNumber: 'R-1',
      maxLoadTon: 2.5,
      lengthMm: null,
      storageLocation: null,
      startedAt: null,
      status: 'AVAILABLE'
    });
  });
});
