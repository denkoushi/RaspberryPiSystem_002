import { areaStatusText, progressPercent, progressText } from './assemblySessionPresentation';
import { formatAssemblyTimestamp } from './assemblyUiHelpers';

import type { AssemblyLotSummaryDto, AssemblyWorkSessionSummaryDto } from './types';

export type AssemblyHomeUnitState = 'before' | 'wip' | 'pending' | 'done';

export type AssemblyHomeUnitDetail = {
  label: string;
  value: string;
};

export type AssemblyHomeUnitView = {
  key: string;
  workUnitId: string;
  /** 作業用IDの全体。 */
  workId: string;
  /** 製番を除いた短い表示。 */
  label: string;
  state: AssemblyHomeUnitState;
  stateLabel: string;
  lotId: string | null;
  lotSerialId: string | null;
  sessionId: string | null;
  operatorName: string | null;
  progressText: string | null;
  progressPercent: number;
  details: AssemblyHomeUnitDetail[];
};

export type AssemblyHomeLotRowView = {
  id: string;
  productNo: string;
  machineName: string;
  totalCount: number;
  finishedCount: number;
  units: AssemblyHomeUnitView[];
};

export type AssemblyHomeBoardCounts = Record<AssemblyHomeUnitState, number>;

const STATE_LABEL: Record<AssemblyHomeUnitState, string> = {
  before: '着手前',
  wip: '仕掛中',
  pending: '完了',
  done: '承認済み'
};

export function shortAssemblyWorkIdLabel(productNo: string, workId: string): string {
  const prefix = `${productNo}-`;
  return workId.startsWith(prefix) && workId.length > prefix.length ? workId.slice(prefix.length) : workId;
}

function templateText(template: { name: string; version: number }): string {
  return `${template.name} v${template.version}`;
}

function formalIdText(session: AssemblyWorkSessionSummaryDto): string {
  return session.isTopLevel === false ? 'サブアセンブリ' : session.formalId ?? '未登録';
}

function sessionDetails(session: AssemblyWorkSessionSummaryDto, state: AssemblyHomeUnitState): AssemblyHomeUnitDetail[] {
  const template = `${session.templateName} v${session.templateVersion}・${session.templateProcedurePattern}`;
  if (state === 'wip') {
    return [
      { label: '現在', value: areaStatusText(session) },
      { label: '作業者', value: session.operatorNameSnapshot },
      { label: 'テンプレート', value: template },
      { label: 'トルクレンチ', value: session.torqueWrenchId },
      { label: '開始', value: formatAssemblyTimestamp(session.startedAt) }
    ];
  }
  return [
    { label: '締結', value: `${progressText(session)} (${progressPercent(session)}%)` },
    { label: '作業者', value: session.operatorNameSnapshot },
    { label: 'テンプレート', value: template },
    { label: '正式ID', value: formalIdText(session) },
    { label: '完了', value: formatAssemblyTimestamp(session.completedAt ?? session.updatedAt) }
  ];
}

function sessionState(session: AssemblyWorkSessionSummaryDto): AssemblyHomeUnitState | null {
  if (session.status === 'in_progress') return 'wip';
  if (session.status === 'completed') return session.approval ? 'done' : 'pending';
  return null;
}

function unitFromSession(
  session: AssemblyWorkSessionSummaryDto,
  state: AssemblyHomeUnitState,
  lot: { lotId: string; lotSerialId: string } | null
): AssemblyHomeUnitView {
  const workId = session.workId ?? session.serialNo;
  return {
    key: lot ? lot.lotSerialId : session.id,
    workUnitId: session.workUnitId,
    workId,
    label: shortAssemblyWorkIdLabel(session.productNo, workId),
    state,
    stateLabel: STATE_LABEL[state],
    lotId: lot?.lotId ?? null,
    lotSerialId: lot?.lotSerialId ?? session.lotSerialId,
    sessionId: session.id,
    operatorName: session.operatorNameSnapshot,
    progressText: progressText(session),
    progressPercent: progressPercent(session),
    details: sessionDetails(session, state)
  };
}

function isFinished(unit: AssemblyHomeUnitView): boolean {
  return unit.state === 'pending' || unit.state === 'done';
}

/**
 * ロット1件を1行にまとめ、台ごとの状態を並べる。
 * ロット一覧に載らないセッション（旧データや取得件数の外）は製番ごとの行へ寄せる。
 */
export function presentAssemblyHomeBoard(
  lots: AssemblyLotSummaryDto[],
  wipSessions: AssemblyWorkSessionSummaryDto[],
  completedSessions: AssemblyWorkSessionSummaryDto[]
): AssemblyHomeLotRowView[] {
  const sessions = [...wipSessions, ...completedSessions];
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const usedSessionIds = new Set<string>();

  const lotRows = lots.map<AssemblyHomeLotRowView>((lot) => {
    const units = [...lot.serials]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .flatMap<AssemblyHomeUnitView>((serial) => {
        if (serial.status === 'cancelled') return [];
        const session = serial.workSessionId ? sessionById.get(serial.workSessionId) : undefined;
        const state: AssemblyHomeUnitState =
          serial.status === 'not_started'
            ? 'before'
            : serial.status === 'in_progress'
              ? 'wip'
              : serial.approval
                ? 'done'
                : 'pending';
        if (session && state !== 'before') {
          usedSessionIds.add(session.id);
          return [unitFromSession(session, state, { lotId: lot.id, lotSerialId: serial.id })];
        }
        const workId = serial.workId ?? serial.serialNo;
        return [
          {
            key: serial.id,
            workUnitId: serial.workUnitId,
            workId,
            label: shortAssemblyWorkIdLabel(lot.productNo, workId),
            state,
            stateLabel: STATE_LABEL[state],
            lotId: lot.id,
            lotSerialId: serial.id,
            sessionId: serial.workSessionId,
            operatorName: null,
            progressText: null,
            progressPercent: 0,
            details: [
              { label: 'ロット数量', value: `${lot.expectedQuantity}個` },
              { label: 'テンプレート', value: templateText(lot.template) },
              { label: 'トルクレンチ', value: lot.torqueWrenchId },
              { label: '登録', value: formatAssemblyTimestamp(lot.createdAt) }
            ]
          }
        ];
      });
    return {
      id: lot.id,
      productNo: lot.productNo,
      machineName: lot.targetUnit || lot.template.modelCode,
      totalCount: units.length,
      finishedCount: units.filter(isFinished).length,
      units
    };
  });

  const orphanRows = new Map<string, AssemblyHomeLotRowView>();
  for (const session of sessions) {
    if (usedSessionIds.has(session.id)) continue;
    const state = sessionState(session);
    if (!state) continue;
    const row =
      orphanRows.get(session.productNo) ??
      ({
        id: `session:${session.productNo}`,
        productNo: session.productNo,
        machineName: session.targetUnit || session.templateModelCode,
        totalCount: 0,
        finishedCount: 0,
        units: []
      } satisfies AssemblyHomeLotRowView);
    const unit = unitFromSession(session, state, null);
    row.units.push(unit);
    row.totalCount += 1;
    if (isFinished(unit)) row.finishedCount += 1;
    orphanRows.set(session.productNo, row);
  }

  return [...lotRows.filter((row) => row.units.length > 0), ...orphanRows.values()];
}

export function countAssemblyHomeBoard(rows: AssemblyHomeLotRowView[]): AssemblyHomeBoardCounts {
  const counts: AssemblyHomeBoardCounts = { before: 0, wip: 0, pending: 0, done: 0 };
  for (const row of rows) {
    for (const unit of row.units) counts[unit.state] += 1;
  }
  return counts;
}
