import type { AssemblyCheckSheetImportPayload, AssemblyCheckSheetRevisionPayload } from '@raspi-system/shared-types';

export function importedSheet(): AssemblyCheckSheetImportPayload {
  return {
    importId: '11111111-1111-4111-8111-111111111111', sheetNames: ['チェックシート'],
    proposal: {
      documentNo: 'TEST-01', title: '組立最終検査', modelCode: 'MODEL-A', revisionLabel: '△1',
      sourceSheetName: 'チェックシート', stampColumn: 'S', headerCellMap: { date: 'D3' }, departmentRoleMembers: {},
      groups: [{ groupNo: 1, label: '締結', sortOrder: 0 }],
      items: [
        {
          groupNo: 1, itemKey: '1-1', sortOrder: 0, label: '締結トルク', note: 'メーカー指定値',
          inputKind: 'NUMBER', inputSpec: { fields: [{ key: 'torque', label: 'トルク', unit: 'Nm' }] },
          roleKeys: ['leader', '制御設計担当'], conditionKey: 'motor', conditionLabel: 'モータ付きの場合',
          sourceRows: [10, 11], stampCell: 'S10', valueTarget: { mode: 'inline', cell: 'F10', template: '締結トルク（{torque} N·m）' },
          warnings: ['単位を確認']
        },
        {
          groupNo: 1, itemKey: '1-2', sortOrder: 1, label: '外観', note: null,
          inputKind: 'CHOICE', inputSpec: { options: ['有', '無'] }, roleKeys: [], conditionKey: null, conditionLabel: null,
          sourceRows: [12], stampCell: 'S12', valueTarget: { mode: 'cell', cell: 'T12' }, warnings: []
        }
      ]
    }
  };
}

export function savedSheet(revisionNumber = 1): AssemblyCheckSheetRevisionPayload {
  const { proposal, importId } = importedSheet();
  return {
    ...proposal, id: `revision-${revisionNumber}`, revisionRootId: '22222222-2222-4222-8222-222222222222',
    revisionNumber, isRevisionHead: true, sourceAssetId: importId, layoutSnapshot: null,
    createdByUserId: 'admin', createdAt: '2026-10-29T00:00:00.000Z',
    groups: proposal.groups.map((group) => ({ ...group, id: 'group' })),
    items: proposal.items.map((item) => ({ ...item, id: item.itemKey, groupId: 'group' }))
  };
}
