import { TorqueResultHistoryRow, type TorqueResultHistoryTone } from './TorqueResultHistoryRow';

export type TorqueTrainingAttemptHistoryItem = {
  key: string;
  attemptNo: number;
  recordedAt: string;
  valueLabel: string;
  resultLabel: string;
  resultTone: TorqueResultHistoryTone;
  details?: string | null;
};

export type TorqueTrainingAttemptHistoryProps = {
  items: Array<TorqueTrainingAttemptHistoryItem | null>;
  recordedCount: number;
  outOfSequenceItems?: Array<Omit<TorqueTrainingAttemptHistoryItem, 'attemptNo'> & { attemptNo: null }>;
};

/**
 * 訓練の5回進捗と実績を1つのコンパクトな一覧へまとめる表示部品。
 * API型を参照せず、親が作った表示用モデルだけを受け取る。
 */
export function TorqueTrainingAttemptHistory({
  items,
  recordedCount,
  outOfSequenceItems = []
}: TorqueTrainingAttemptHistoryProps) {
  return (
    <section className="w-full max-w-lg" aria-label="訓練試行履歴" data-testid="torque-training-attempt-history">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-bold">試行履歴</h3>
        <span className="text-xs text-white/60">記録 {recordedCount} / {items.length}</span>
      </div>
      <div className="mt-2 overflow-hidden rounded border border-white/10 bg-slate-950/70">
        {items.map((item, index) => item ? (
          <TorqueResultHistoryRow
            key={item.key}
            data-testid={`torque-training-attempt-${item.attemptNo}`}
            locationLabel={`${item.attemptNo}回目`}
            recordedAt={item.recordedAt}
            valueLabel={item.valueLabel}
            resultLabel={item.resultLabel}
            resultTone={item.resultTone}
            details={item.details}
          />
        ) : (
          <div
            key={`empty-${index + 1}`}
            className="grid min-h-[4.5rem] grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-center gap-2 border-b border-white/10 px-3 py-2 text-xs last:border-b-0"
            data-testid={`torque-training-attempt-${index + 1}`}
          >
            <span className="font-semibold text-white/65">{index + 1}回目</span>
            <span className="col-span-2 text-sm text-white/45">未記録</span>
          </div>
        ))}
        {outOfSequenceItems.map((item) => (
          <TorqueResultHistoryRow
            key={item.key}
            data-testid={`torque-training-attempt-out-of-sequence-${item.key}`}
            locationLabel="記録外"
            recordedAt={item.recordedAt}
            valueLabel={item.valueLabel}
            resultLabel={item.resultLabel}
            resultTone={item.resultTone}
            details={item.details}
          />
        ))}
      </div>
    </section>
  );
}
