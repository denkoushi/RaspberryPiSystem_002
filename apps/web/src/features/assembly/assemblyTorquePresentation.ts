import type { AssemblyTorqueRecordDto, AssemblyWorkSessionDto } from './types';

/** 作業図面上で使う、業務状態から独立した締付マーカーの表示状態。 */
export type AssemblyTorqueMarkerDisplayState =
  | 'pending'
  | 'waiting'
  | 'complete'
  | 'retry'
  | 'unaccepted';

export type AssemblyTorqueRecordResultPresentation = {
  label: 'OK' | 'NG' | '未受付';
  tone: 'ok' | 'ng' | 'unaccepted';
};

export type AssemblyTorqueCurrentFeedback = {
  kind: 'ng' | 'unaccepted';
  record: AssemblyTorqueRecordDto;
  message: string;
};

function timestamp(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/**
 * API配列の順序に左右されないよう、記録日時、作成日時、IDの順で実績の新旧を決める。
 * 同時刻でもIDで決定するため、同じ入力は常に同じ表示結果になる。
 */
export function compareAssemblyTorqueRecordRecency(
  left: AssemblyTorqueRecordDto,
  right: AssemblyTorqueRecordDto
): number {
  const recordedDifference = timestamp(left.recordedAt) - timestamp(right.recordedAt);
  if (recordedDifference !== 0) return recordedDifference;

  const createdDifference = timestamp(left.createdAt) - timestamp(right.createdAt);
  if (createdDifference !== 0) return createdDifference;

  return left.id.localeCompare(right.id);
}

/** 最新順の履歴。元のAPI配列は変更しない。 */
export function newestAssemblyTorqueRecords(records: AssemblyTorqueRecordDto[]): AssemblyTorqueRecordDto[] {
  return [...records].sort((left, right) => compareAssemblyTorqueRecordRecency(right, left));
}

/** ボルトごとの最新実績。 */
export function latestAssemblyTorqueRecordByBolt(
  records: AssemblyTorqueRecordDto[]
): Map<string, AssemblyTorqueRecordDto> {
  const latest = new Map<string, AssemblyTorqueRecordDto>();
  for (const record of records) {
    const current = latest.get(record.templateBoltId);
    if (!current || compareAssemblyTorqueRecordRecency(record, current) > 0) {
      latest.set(record.templateBoltId, record);
    }
  }
  return latest;
}

export function assemblyTorqueRecordResultPresentation(
  record: Pick<AssemblyTorqueRecordDto, 'judgement' | 'accepted'>
): AssemblyTorqueRecordResultPresentation {
  if (record.judgement === 'ok' && record.accepted) return { label: 'OK', tone: 'ok' };
  if (record.judgement === 'ng') return { label: 'NG', tone: 'ng' };
  return { label: '未受付', tone: 'unaccepted' };
}

function markerStateForRecord(record: AssemblyTorqueRecordDto): AssemblyTorqueMarkerDisplayState {
  const result = assemblyTorqueRecordResultPresentation(record);
  if (result.tone === 'ok') return 'complete';
  if (result.tone === 'ng') return 'retry';
  return 'unaccepted';
}

/**
 * 現在位置と最新実績から図面の表示状態を導出する。
 * 現在位置のNG・未受付を「入力待ち」で上書きしないことが重要。
 */
export function assemblyTorqueMarkerStates(
  session: Pick<AssemblyWorkSessionDto, 'currentBoltId' | 'torqueRecords'>
): Map<string, AssemblyTorqueMarkerDisplayState> {
  const states = new Map<string, AssemblyTorqueMarkerDisplayState>();
  const latest = latestAssemblyTorqueRecordByBolt(session.torqueRecords);

  for (const [boltId, record] of latest) {
    states.set(boltId, markerStateForRecord(record));
  }

  if (session.currentBoltId) {
    const currentState = states.get(session.currentBoltId);
    states.set(
      session.currentBoltId,
      currentState === 'retry' || currentState === 'unaccepted' ? currentState : 'waiting'
    );
  }
  return states;
}

export function assemblyTorqueMarkerStateLabel(state: AssemblyTorqueMarkerDisplayState): string {
  switch (state) {
    case 'waiting':
      return '入力待ち';
    case 'complete':
      return '入力完了';
    case 'retry':
      return 'NG・再入力';
    case 'unaccepted':
      return '未受付';
    default:
      return '未入力';
  }
}

export function assemblyTorqueCurrentFeedback(
  session: Pick<AssemblyWorkSessionDto, 'currentBoltId' | 'torqueRecords'>
): AssemblyTorqueCurrentFeedback | null {
  if (!session.currentBoltId) return null;
  const record = latestAssemblyTorqueRecordByBolt(session.torqueRecords).get(session.currentBoltId);
  if (!record) return null;

  const result = assemblyTorqueRecordResultPresentation(record);
  if (result.tone === 'ok') return null;

  const value = record.value == null ? '値なし' : `${record.value}${record.inputUnit ? ` ${record.inputUnit}` : ''}`;
  if (result.tone === 'ng') {
    return { kind: 'ng', record, message: `NG ${value}。同じ丸数字を再入力してください。` };
  }
  return {
    kind: 'unaccepted',
    record,
    message: `未受付：${record.ignoredReason?.trim() || 'この入力は工程実績として受け付けませんでした。'}`
  };
}
