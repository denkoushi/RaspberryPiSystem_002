import type {
  KnowledgePositionRank,
  AssemblyCheckSheetItemProposal,
  AssemblyCheckSheetProposal,
  AssemblyCheckSheetSavePayload
} from '@raspi-system/shared-types';

const positionRanks = new Set<string>(['general', 'leader', 'section_chief', 'manager', 'general_manager', 'executive'] satisfies KnowledgePositionRank[]);

type Field = NonNullable<AssemblyCheckSheetItemProposal['inputSpec']['fields']>[number];

export function updateItem(proposal: AssemblyCheckSheetProposal, index: number, patch: Partial<AssemblyCheckSheetItemProposal>) {
  return { ...proposal, items: proposal.items.map((item, i) => i === index ? { ...item, ...patch } : item) };
}

export function removeItem(proposal: AssemblyCheckSheetProposal, index: number) {
  return { ...proposal, items: proposal.items.filter((_, i) => i !== index) };
}

export function updateField(proposal: AssemblyCheckSheetProposal, index: number, key: string, patch: Partial<Field>) {
  const item = proposal.items[index];
  return updateItem(proposal, index, {
    inputSpec: { ...item.inputSpec, fields: (item.inputSpec.fields ?? []).map((field) => field.key === key ? { ...field, ...patch } : field) }
  });
}

export function addField(proposal: AssemblyCheckSheetProposal, index: number) {
  const item = proposal.items[index];
  const fields = item.inputSpec.fields ?? [];
  let number = 1;
  while (fields.some((field) => field.key === `field${number}`)) number++;
  return updateItem(proposal, index, {
    inputSpec: { ...item.inputSpec, fields: [...fields, { key: `field${number}`, label: '', unit: '' }] }
  });
}

export function removeField(proposal: AssemblyCheckSheetProposal, index: number, key: string) {
  const item = proposal.items[index];
  return updateItem(proposal, index, {
    inputSpec: { ...item.inputSpec, fields: (item.inputSpec.fields ?? []).filter((field) => field.key !== key) }
  });
}

export function departmentRoleKeys(proposal: AssemblyCheckSheetProposal) {
  return [...new Set([
    ...Object.keys(proposal.departmentRoleMembers),
    ...proposal.items.flatMap((item) => item.roleKeys.map((key) => key.trim()))
  ])].filter((key) => key && !positionRanks.has(key));
}

export function buildSavePayload(importId: string, proposal: AssemblyCheckSheetProposal, revisionRootId?: string): AssemblyCheckSheetSavePayload {
  return {
    importId,
    ...(revisionRootId ? { revisionRootId } : {}),
    proposal: {
      ...proposal,
      headerCellMap: Object.fromEntries(Object.entries(proposal.headerCellMap)
        .filter(([, cell]) => cell.trim()).map(([key, cell]) => [key, cell.trim().toUpperCase()])),
      items: proposal.items.map((item) => ({
        ...item,
        roleKeys: [...new Set(item.roleKeys.map((key) => key.trim()).filter(Boolean))],
        inputSpec: {
          ...item.inputSpec,
          ...(item.inputSpec.options ? { options: item.inputSpec.options.map((option) => option.trim()).filter(Boolean) } : {})
        }
      }))
    }
  };
}
