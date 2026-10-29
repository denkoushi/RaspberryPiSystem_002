import { assemblyCheckSheetSaveSchema } from '@raspi-system/shared-types';
import { describe, expect, it } from 'vitest';

import { addField, buildSavePayload, departmentRoleKeys, removeField, removeItem, updateField, updateItem } from './editor';
import { importedSheet, savedSheet } from './testFixtures';

describe('check sheet editor', () => {
  it('updates a row and a field without changing the imported proposal or other rows', () => {
    const original = importedSheet().proposal;
    const updated = updateField(updateItem(original, 0, { label: '変更後' }), 0, 'torque', { unit: 'N·m' });
    expect(updated.items[0]).toMatchObject({ label: '変更後', inputSpec: { fields: [{ key: 'torque', unit: 'N·m' }] } });
    expect(original.items[0].label).toBe('締結トルク');
    expect(original.items[0].inputSpec.fields?.[0].unit).toBe('Nm');
    expect(updated.items[1]).toBe(original.items[1]);
  });

  it('adds unique fields even after deleting a field in the middle', () => {
    let proposal = importedSheet().proposal;
    proposal.departmentRoleMembers = { 制御設計担当: ['33333333-3333-4333-8333-333333333333'] };
    proposal = addField(addField(proposal, 0), 0);
    proposal = addField(removeField(proposal, 0, 'field1'), 0);
    expect(proposal.items[0].inputSpec.fields?.map((field) => field.key)).toEqual(['torque', 'field2', 'field1']);
    expect(assemblyCheckSheetSaveSchema.safeParse(buildSavePayload(importedSheet().importId, proposal)).success).toBe(true);
  });

  it('excludes a row while preserving the remaining source mappings and warning evidence', () => {
    const original = importedSheet().proposal;
    const proposal = removeItem(original, 1);
    expect(proposal.items).toEqual([original.items[0]]);
    expect(original.items).toHaveLength(2);
  });

  it('builds new/revision payloads with header removals and edited choices/roles', () => {
    const { importId, proposal } = importedSheet();
    proposal.headerCellMap = { date: ' d3 ', customer: '' };
    proposal.items[0].roleKeys = [' leader ', '', 'leader', '制御設計担当'];
    proposal.items[1].inputSpec.options = [' 有 ', '無', ''];
    proposal.departmentRoleMembers = { 制御設計担当: ['33333333-3333-4333-8333-333333333333'] };
    const payload = buildSavePayload(importId, proposal);
    expect(payload).not.toHaveProperty('revisionRootId');
    expect(payload.proposal.headerCellMap).toEqual({ date: 'D3' });
    expect(payload.proposal.items[0].roleKeys).toEqual(['leader', '制御設計担当']);
    expect(payload.proposal.items[1].inputSpec.options).toEqual(['有', '無']);
    expect(payload.proposal.departmentRoleMembers).toEqual(proposal.departmentRoleMembers);
    expect(payload.proposal.items[0].valueTarget).toEqual(proposal.items[0].valueTarget);
    expect(assemblyCheckSheetSaveSchema.safeParse(payload).success).toBe(true);
    expect(buildSavePayload(importId, proposal, savedSheet().revisionRootId).revisionRootId).toBe(savedSheet().revisionRootId);
  });

  it('derives department pickers from edited roles and existing assignments, excluding ranks', () => {
    const proposal = importedSheet().proposal;
    proposal.items[1].roleKeys = ['section_chief', ' 検査担当 ', ''];
    proposal.departmentRoleMembers = { 保全担当: [] };
    expect(departmentRoleKeys(proposal)).toEqual(['保全担当', '制御設計担当', '検査担当']);
  });
});
