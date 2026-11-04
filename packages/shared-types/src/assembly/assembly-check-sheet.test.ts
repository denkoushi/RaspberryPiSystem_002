import { describe, expect, it } from 'vitest';

import {
  assemblyCheckSheetActorSchema,
  assemblyCheckSheetConditionSchema,
  assemblyCheckSheetItemSchema,
  assemblyCheckSheetProposalSchema,
  assemblyCheckSheetSaveSchema,
  assemblyCheckSheetStampSchema,
  type AssemblyCheckSheetItemProposal,
  type AssemblyCheckSheetProposal
} from './assembly-check-sheet.js';

const IMPORT_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';

function item(overrides: Partial<AssemblyCheckSheetItemProposal> = {}): AssemblyCheckSheetItemProposal {
  return {
    groupNo: 1,
    itemKey: 'item-1',
    sortOrder: 0,
    label: 'ボルト締結確認',
    note: null,
    inputKind: 'OK_NG',
    inputSpec: {},
    roleKeys: [],
    conditionKey: null,
    conditionLabel: null,
    sourceRows: [5],
    stampCell: 'H5',
    valueTarget: { mode: 'cell', cell: 'G5' },
    warnings: [],
    ...overrides
  };
}

function proposal(overrides: Partial<AssemblyCheckSheetProposal> = {}): AssemblyCheckSheetProposal {
  return {
    documentNo: 'DOC-1',
    title: '組立チェックシート',
    modelCode: 'M1',
    revisionLabel: 'A',
    sourceSheetName: 'Sheet1',
    headerCellMap: { modelCode: 'B2' },
    stampColumn: 'H',
    departmentRoleMembers: {},
    groups: [{ groupNo: 1, label: '組立', sortOrder: 0 }],
    items: [item()],
    ...overrides
  };
}

function issueMessages(result: { success: boolean; error?: { issues: { message: string }[] } }): string[] {
  return result.error?.issues.map((issue) => issue.message) ?? [];
}

describe('assemblyCheckSheetItemSchema', () => {
  it('accepts a minimal OK_NG item', () => {
    expect(assemblyCheckSheetItemSchema.safeParse(item()).success).toBe(true);
  });

  it.each(['A1', 'XFD1048576', 'ZZZ9999999'])('accepts cell address %s', (cell) => {
    expect(assemblyCheckSheetItemSchema.safeParse(item({ stampCell: cell })).success).toBe(true);
  });

  it.each(['a1', 'A0', 'A01', 'AAAA1', 'A12345678', '1A', 'A'])('rejects cell address %s', (cell) => {
    expect(assemblyCheckSheetItemSchema.safeParse(item({ stampCell: cell })).success).toBe(false);
  });

  it('requires at least one input field for NUMBER and TEXT', () => {
    for (const inputKind of ['NUMBER', 'TEXT'] as const) {
      const result = assemblyCheckSheetItemSchema.safeParse(item({ inputKind, inputSpec: {} }));
      expect(result.success).toBe(false);
      expect(issueMessages(result)).toContain('Input fields are required');
      expect(
        assemblyCheckSheetItemSchema.safeParse(item({ inputKind, inputSpec: { fields: [{ key: 'torque', label: 'トルク', unit: 'N·m' }] } }))
          .success
      ).toBe(true);
    }
  });

  it('rejects duplicate field keys and invalid key shapes', () => {
    const duplicate = assemblyCheckSheetItemSchema.safeParse(
      item({ inputKind: 'NUMBER', inputSpec: { fields: [{ key: 'a', label: 'A' }, { key: 'a', label: 'B' }] } })
    );
    expect(issueMessages(duplicate)).toContain('Field keys must be unique');
    expect(
      assemblyCheckSheetItemSchema.safeParse(item({ inputKind: 'NUMBER', inputSpec: { fields: [{ key: '1st', label: 'A' }] } })).success
    ).toBe(false);
  });

  it('requires at least two options for CHOICE', () => {
    const one = assemblyCheckSheetItemSchema.safeParse(item({ inputKind: 'CHOICE', inputSpec: { options: ['有'] } }));
    expect(issueMessages(one)).toContain('Choice options are required');
    expect(assemblyCheckSheetItemSchema.safeParse(item({ inputKind: 'CHOICE', inputSpec: { options: ['有', '無'] } })).success).toBe(
      true
    );
  });

  it('requires condition key and label to be supplied together', () => {
    const keyOnly = assemblyCheckSheetItemSchema.safeParse(item({ conditionKey: 'opt', conditionLabel: null }));
    const labelOnly = assemblyCheckSheetItemSchema.safeParse(item({ conditionKey: null, conditionLabel: 'オプション時' }));
    expect(issueMessages(keyOnly)).toContain('Condition key and label must be supplied together');
    expect(issueMessages(labelOnly)).toContain('Condition key and label must be supplied together');
    expect(assemblyCheckSheetItemSchema.safeParse(item({ conditionKey: 'opt', conditionLabel: 'オプション時' })).success).toBe(true);
  });

  it('enforces sourceRows bounds and valueTarget discriminator', () => {
    expect(assemblyCheckSheetItemSchema.safeParse(item({ sourceRows: [] })).success).toBe(false);
    expect(assemblyCheckSheetItemSchema.safeParse(item({ sourceRows: [0] })).success).toBe(false);
    expect(assemblyCheckSheetItemSchema.safeParse(item({ sourceRows: [1048576] })).success).toBe(true);
    expect(assemblyCheckSheetItemSchema.safeParse(item({ sourceRows: [1048577] })).success).toBe(false);
    expect(
      assemblyCheckSheetItemSchema.safeParse(item({ valueTarget: { mode: 'inline', cell: 'C5', template: '{{value}} mm' } })).success
    ).toBe(true);
    expect(
      assemblyCheckSheetItemSchema.safeParse(item({ valueTarget: { mode: 'inline', cell: 'C5' } as never })).success
    ).toBe(false);
  });
});

describe('assemblyCheckSheetProposalSchema', () => {
  const consistencyMessage = 'Groups, item keys and stamp cells must be unique and consistent';

  it('accepts a consistent proposal', () => {
    expect(assemblyCheckSheetProposalSchema.safeParse(proposal()).success).toBe(true);
  });

  it('rejects duplicate stamp cells across items', () => {
    const result = assemblyCheckSheetProposalSchema.safeParse(
      proposal({ items: [item(), item({ itemKey: 'item-2', stampCell: 'H5' })] })
    );
    expect(issueMessages(result)).toContain(consistencyMessage);
  });

  it('rejects duplicate group numbers', () => {
    const result = assemblyCheckSheetProposalSchema.safeParse(
      proposal({ groups: [{ groupNo: 1, label: 'A', sortOrder: 0 }, { groupNo: 1, label: 'B', sortOrder: 1 }] })
    );
    expect(issueMessages(result)).toContain(consistencyMessage);
  });

  it('rejects sheet names longer than the Excel limit of 31 characters and bad stamp columns', () => {
    expect(assemblyCheckSheetProposalSchema.safeParse(proposal({ sourceSheetName: 'x'.repeat(31) })).success).toBe(true);
    expect(assemblyCheckSheetProposalSchema.safeParse(proposal({ sourceSheetName: 'x'.repeat(32) })).success).toBe(false);
    expect(assemblyCheckSheetProposalSchema.safeParse(proposal({ stampColumn: 'H1' })).success).toBe(false);
  });
});

describe('assemblyCheckSheetSaveSchema department roles', () => {
  it('allows knowledge position ranks without department members', () => {
    const payload = { importId: IMPORT_ID, proposal: proposal({ items: [item({ roleKeys: ['leader', 'manager'] })] }) };
    expect(assemblyCheckSheetSaveSchema.safeParse(payload).success).toBe(true);
  });

  it('requires at least one member for each non-rank department role', () => {
    const missing = assemblyCheckSheetSaveSchema.safeParse({
      importId: IMPORT_ID,
      proposal: proposal({ items: [item({ roleKeys: ['品証'] })] })
    });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0]).toMatchObject({
      path: ['proposal', 'departmentRoleMembers', '品証'],
      message: '部署役割「品証」の社員を1人以上選択してください'
    });

    const empty = assemblyCheckSheetSaveSchema.safeParse({
      importId: IMPORT_ID,
      proposal: proposal({ items: [item({ roleKeys: ['品証'] })], departmentRoleMembers: { 品証: [] } })
    });
    expect(empty.success).toBe(false);

    const filled = assemblyCheckSheetSaveSchema.safeParse({
      importId: IMPORT_ID,
      proposal: proposal({ items: [item({ roleKeys: ['品証'] })], departmentRoleMembers: { 品証: [MEMBER_ID] } })
    });
    expect(filled.success).toBe(true);
  });

  it('does not treat inherited object keys as configured roles', () => {
    const result = assemblyCheckSheetSaveSchema.safeParse({
      importId: IMPORT_ID,
      proposal: proposal({ items: [item({ roleKeys: ['toString'] })] })
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-uuid importId', () => {
    expect(assemblyCheckSheetSaveSchema.safeParse({ importId: 'not-a-uuid', proposal: proposal() }).success).toBe(false);
  });
});

describe('assembly check sheet actor/stamp schemas', () => {
  it('trims the NFC tag uid and rejects whitespace-only values', () => {
    expect(assemblyCheckSheetActorSchema.parse({ nfcTagUid: '  04A1B2  ' })).toEqual({ nfcTagUid: '04A1B2' });
    expect(assemblyCheckSheetActorSchema.safeParse({ nfcTagUid: '   ' }).success).toBe(false);
  });

  it('defaults values/flagged and trims ngReason', () => {
    expect(assemblyCheckSheetStampSchema.parse({ nfcTagUid: 'tag', itemId: ITEM_ID, result: 'NG', ngReason: '  傷あり ' })).toEqual({
      nfcTagUid: 'tag',
      itemId: ITEM_ID,
      result: 'NG',
      values: {},
      flagged: false,
      ngReason: '傷あり'
    });
  });

  it('rejects NA results (only OK/NG can be stamped) and non-finite numeric values', () => {
    expect(assemblyCheckSheetStampSchema.safeParse({ nfcTagUid: 'tag', itemId: ITEM_ID, result: 'NA' }).success).toBe(false);
    expect(
      assemblyCheckSheetStampSchema.safeParse({ nfcTagUid: 'tag', itemId: ITEM_ID, result: 'OK', values: { torque: Number.POSITIVE_INFINITY } })
        .success
    ).toBe(false);
  });

  it('only accepts applies=false for condition updates', () => {
    expect(assemblyCheckSheetConditionSchema.safeParse({ nfcTagUid: 'tag', conditionKey: 'opt', applies: false }).success).toBe(true);
    expect(assemblyCheckSheetConditionSchema.safeParse({ nfcTagUid: 'tag', conditionKey: 'opt', applies: true }).success).toBe(false);
  });
});
