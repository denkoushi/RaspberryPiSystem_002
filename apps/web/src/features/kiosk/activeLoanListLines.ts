import type { Loan } from '../../api/types';

export type ActiveLoanCardKind = 'instrument' | 'rigging' | 'item';

export type ActiveLoanListLines = {
  kind: ActiveLoanCardKind;
  primaryLine: string;
  nameLine?: string;
  idNumLine?: string;
};

export function presentActiveLoanListLines(loan: Loan): ActiveLoanListLines {
  if (loan.measuringInstrument) {
    return {
      kind: 'instrument',
      primaryLine: loan.measuringInstrument.managementNumber ?? '管理番号なし',
      nameLine: loan.measuringInstrument.name ?? '計測機器'
    };
  }

  if (loan.riggingGear) {
    const idNum = loan.riggingGear.idNum?.trim();
    return {
      kind: 'rigging',
      primaryLine: loan.riggingGear.managementNumber ?? '管理番号なし',
      nameLine: loan.riggingGear.name ?? '吊具',
      idNumLine: `旧番号: ${idNum && idNum.length > 0 ? idNum : '-'}`
    };
  }

  const itemName = loan.item?.name ?? (loan.photoUrl ? '写真撮影モード' : 'アイテム');
  return {
    kind: 'item',
    primaryLine: itemName
  };
}
