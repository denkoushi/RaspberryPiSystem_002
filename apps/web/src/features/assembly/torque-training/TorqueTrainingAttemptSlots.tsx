export type TorqueTrainingSlotJudgement = 'OK' | 'UNDER' | 'OVER' | 'IGNORED';

export type TorqueTrainingSlotItem = {
  key: string;
  /** 数値文字列（N·m換算済み）。 */
  valueNm: string | null;
  judgement: TorqueTrainingSlotJudgement;
  /** 例: "差 +2.9%"。 */
  detail?: string | null;
};

export type TorqueTrainingAttemptSlotsProps = {
  /** 1本目から順に。未記録はnull。 */
  items: Array<TorqueTrainingSlotItem | null>;
  /** 次に締め付ける枠を強調する（締付中だけ）。 */
  highlightNext: boolean;
  outOfSequenceItems?: TorqueTrainingSlotItem[];
};

const JUDGEMENT_TEXT: Record<TorqueTrainingSlotJudgement, string> = {
  OK: 'OK',
  UNDER: '弱い',
  OVER: '強い',
  IGNORED: '記録外'
};

const SLOT_TONE: Record<TorqueTrainingSlotJudgement, { border: string; text: string }> = {
  OK: { border: 'border-emerald-300/50', text: 'text-emerald-300' },
  UNDER: { border: 'border-amber-300/50', text: 'text-amber-300' },
  OVER: { border: 'border-rose-300/50', text: 'text-rose-300' },
  IGNORED: { border: 'border-white/10', text: 'text-slate-300' }
};

function formatValue(valueNm: string | null): string {
  if (valueNm === null || valueNm === '') return '-';
  const numeric = Number(valueNm);
  return Number.isFinite(numeric) ? String(Math.round(numeric * 100) / 100) : valueNm;
}

/** 5本分の枠を横に並べ、値と判定を大きく見せる。 */
export function TorqueTrainingAttemptSlots({ items, highlightNext, outOfSequenceItems = [] }: TorqueTrainingAttemptSlotsProps) {
  const nextIndex = items.findIndex((item) => item === null);
  return (
    <section className="min-w-0" aria-label="訓練試行履歴" data-testid="torque-training-attempt-history">
      <ol className="flex flex-wrap gap-3">
        {items.map((item, index) => {
          const attemptNo = index + 1;
          if (!item) {
            const next = highlightNext && index === nextIndex;
            return (
              <li
                key={`empty-${attemptNo}`}
                className={`grid h-40 w-40 grid-rows-[auto_1fr] rounded-lg bg-slate-800/80 p-3 2xl:w-44 ${next ? 'border-2 border-dashed border-cyan-300' : 'border border-white/10'}`}
                data-testid={`torque-training-attempt-${attemptNo}`}
              >
                <span className="text-sm font-bold text-white/60">{attemptNo}本目</span>
                <span className={`self-center ${next ? 'text-xl font-bold text-cyan-300' : 'text-3xl text-slate-500'}`}>
                  {next ? '締付待ち' : '—'}
                </span>
              </li>
            );
          }
          const tone = SLOT_TONE[item.judgement];
          return (
            <li
              key={item.key}
              className={`grid h-40 w-40 grid-rows-[auto_1fr_auto] rounded-lg border bg-slate-800/80 p-3 2xl:w-44 ${tone.border}`}
              data-testid={`torque-training-attempt-${attemptNo}`}
            >
              <span className="text-sm font-bold text-white/60">{attemptNo}本目</span>
              <span className="self-center whitespace-nowrap text-4xl font-black tabular-nums">
                {formatValue(item.valueNm)}
                <span className="ml-1 text-base font-medium text-white/60">N·m</span>
              </span>
              <span className="flex items-baseline justify-between gap-2">
                <span className={`text-xl font-black ${tone.text}`}>{JUDGEMENT_TEXT[item.judgement]}</span>
                {item.detail ? <span className="truncate text-xs text-white/60" title={item.detail}>{item.detail}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      {outOfSequenceItems.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm text-white/70">
          {outOfSequenceItems.map((item) => (
            <li key={item.key} data-testid={`torque-training-attempt-out-of-sequence-${item.key}`}>
              記録外: {formatValue(item.valueNm)} N·m {JUDGEMENT_TEXT[item.judgement]}{item.detail ? ` / ${item.detail}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
