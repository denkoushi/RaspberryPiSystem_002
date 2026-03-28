import {
  formatClientDeviceLocationLabel,
  PHOTO_LOAN_CARD_PRIMARY_LABEL,
  resolvePhotoLoanToolDisplayLabel,
} from '@raspi-system/shared-types';

import type { Loan } from '../../api/types';

export type ActiveLoanCardKind = 'instrument' | 'rigging' | 'item';

export type ActiveLoanListLines = {
  kind: ActiveLoanCardKind;
  primaryLine: string;
  nameLine?: string;
  clientLocationLine: string;
  /** 吊具のみ。idNum の表示用（プレフィックスなし）。未設定・空は `-`。 */
  idNumLine?: string;
};

export function presentActiveLoanListLines(loan: Loan): ActiveLoanListLines {
  const clientLocationLine = formatClientDeviceLocationLabel(loan.client?.location);

  if (loan.measuringInstrument) {
    return {
      kind: 'instrument',
      primaryLine: loan.measuringInstrument.managementNumber ?? '管理番号なし',
      nameLine: loan.measuringInstrument.name ?? '計測機器',
      clientLocationLine
    };
  }

  if (loan.riggingGear) {
    const idNum = loan.riggingGear.idNum?.trim();
    return {
      kind: 'rigging',
      primaryLine: loan.riggingGear.managementNumber ?? '管理番号なし',
      nameLine: loan.riggingGear.name ?? '吊具',
      clientLocationLine,
      idNumLine: idNum && idNum.length > 0 ? idNum : '-'
    };
  }

  const itemName =
    loan.item?.name ??
    (loan.photoUrl
      ? resolvePhotoLoanToolDisplayLabel({
          humanDisplayName: loan.photoToolHumanDisplayName,
          vlmDisplayName: loan.photoToolDisplayName,
          fallbackLabel: PHOTO_LOAN_CARD_PRIMARY_LABEL,
        })
      : 'アイテム');
  return {
    kind: 'item',
    primaryLine: itemName,
    clientLocationLine
  };
}
