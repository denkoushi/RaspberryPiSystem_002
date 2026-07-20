import { areaStatusText, progressPercent, progressText } from './assemblySessionPresentation';
import { formatAssemblyTimestamp } from './assemblyUiHelpers';

import type { AssemblyLotSummaryDto, AssemblyWorkSessionSummaryDto } from './types';

export type AssemblyItemDetail = {
  label: string;
  value: string;
};

export type AssemblyHomeItemView = {
  id: string;
  productNo: string;
  serialNo: string;
  machineName: string;
  progressText: string;
  progressPercent: number;
  details: AssemblyItemDetail[];
};

export type NotStartedAssemblyItemView = AssemblyHomeItemView & {
  lotId: string;
  lotSerialId: string;
};

function templateText(template: { name: string; version: number }): string {
  return `${template.name} v${template.version}`;
}

export function presentNotStartedAssemblyItems(lots: AssemblyLotSummaryDto[]): NotStartedAssemblyItemView[] {
  return lots.flatMap((lot) =>
    lot.serials
      .filter((serial) => serial.status === 'not_started')
      .map((serial) => ({
        id: serial.id,
        lotId: lot.id,
        lotSerialId: serial.id,
        productNo: lot.productNo,
        serialNo: serial.workId ?? serial.serialNo,
        machineName: lot.targetUnit || lot.template.modelCode,
        progressText: '0%',
        progressPercent: 0,
        details: [
          { label: 'ロット数量', value: `${lot.expectedQuantity}個` },
          { label: '作業者', value: lot.operatorNameSnapshot },
          { label: 'テンプレート', value: templateText(lot.template) },
          { label: 'トルクレンチ', value: lot.torqueWrenchId },
          { label: '登録', value: formatAssemblyTimestamp(lot.createdAt) },
          { label: '更新', value: formatAssemblyTimestamp(lot.updatedAt) }
        ]
      }))
  );
}

export function presentWipAssemblyItems(sessions: AssemblyWorkSessionSummaryDto[]): AssemblyHomeItemView[] {
  return sessions.map((session) => ({
    id: session.id,
    productNo: session.productNo,
    serialNo: session.workId ?? session.serialNo,
    machineName: session.targetUnit || session.templateModelCode,
    progressText: `${progressText(session)} (${progressPercent(session)}%)`,
    progressPercent: progressPercent(session),
    details: [
      { label: '現在', value: areaStatusText(session) },
      { label: '作業者', value: session.operatorNameSnapshot },
      {
        label: 'テンプレート',
        value: `${session.templateName} v${session.templateVersion}・${session.templateProcedurePattern}`
      },
      { label: 'トルクレンチ', value: session.torqueWrenchId },
      { label: '開始', value: formatAssemblyTimestamp(session.startedAt) },
      { label: '更新', value: formatAssemblyTimestamp(session.updatedAt) }
    ]
  }));
}

export function presentCompletedAssemblyItems(sessions: AssemblyWorkSessionSummaryDto[]): AssemblyHomeItemView[] {
  return sessions.map((session) => ({
    id: session.id,
    productNo: session.productNo,
    serialNo: session.workId ?? session.serialNo,
    machineName: session.targetUnit || session.templateModelCode,
    progressText: `${progressText(session)} (${progressPercent(session)}%)`,
    progressPercent: progressPercent(session),
    details: [
      { label: '締結進捗', value: `${progressText(session)} (${progressPercent(session)}%)` },
      { label: '作業者', value: session.operatorNameSnapshot },
      {
        label: 'テンプレート',
        value: `${session.templateName} v${session.templateVersion}・${session.templateProcedurePattern}`
      },
      { label: 'トルクレンチ', value: session.torqueWrenchId },
      { label: '正式ID', value: session.isTopLevel === false ? 'サブアセンブリ' : session.formalId ?? '未登録' },
      { label: '完了', value: formatAssemblyTimestamp(session.completedAt ?? session.updatedAt) }
    ]
  }));
}
