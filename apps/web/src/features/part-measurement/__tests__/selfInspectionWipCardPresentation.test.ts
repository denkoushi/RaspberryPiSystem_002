import { describe, expect, it } from 'vitest';

import { presentSelfInspectionWipCard } from '../selfInspectionWipCardPresentation';

describe('presentSelfInspectionWipCard', () => {
  it('formats participant names and progress', () => {
    const card = presentSelfInspectionWipCard({
      productNo: 'PO-001',
      fhincd: 'FH-1',
      fhinmei: '品名テスト',
      resourceCd: '581',
      plannedQuantity: 10,
      fseiban: 'S-1',
      completedEntryCount: 2,
      requiredEntryCount: 5,
      participantEmployeeNames: ['山田太郎', '佐藤花子']
    });

    expect(card.productNo).toBe('PO-001');
    expect(card.metaLine).toContain('FH-1');
    expect(card.participantNamesLine).toBe('山田太郎 / 佐藤花子');
    expect(card.participantNamesTitle).toBe('山田太郎 / 佐藤花子');
    expect(card.progressLine).toBe('2 / 5 件');
  });

  it('uses dash when no participant names', () => {
    const card = presentSelfInspectionWipCard({
      productNo: 'PO-002',
      fhincd: 'FH-2',
      fhinmei: '品名',
      resourceCd: '582',
      plannedQuantity: 1,
      fseiban: null,
      completedEntryCount: 1,
      requiredEntryCount: 1,
      participantEmployeeNames: []
    });

    expect(card.participantNamesLine).toBe('—');
    expect(card.participantNamesTitle).toBeNull();
    expect(card.fseibanLine).toBeNull();
  });
});
