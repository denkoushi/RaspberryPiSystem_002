export type TorqueTrainingJudgement = 'OK' | 'UNDER' | 'OVER';

const DOT_CLASS: Record<TorqueTrainingJudgement, string> = {
  OK: 'bg-emerald-300',
  UNDER: 'bg-amber-300',
  OVER: 'bg-rose-300'
};

const JUDGEMENT_LABEL: Record<TorqueTrainingJudgement, string> = {
  OK: 'OK',
  UNDER: '弱い',
  OVER: '強い'
};

/** 1回分（5本）の判定を色つきの点で並べる。 */
export function TorqueTrainingJudgementDots({ judgements }: { judgements: TorqueTrainingJudgement[] }) {
  return (
    <span className="flex gap-1.5" aria-label={judgements.map((judgement) => JUDGEMENT_LABEL[judgement]).join('、')}>
      {judgements.map((judgement, index) => (
        <i key={index} className={`block h-4 w-4 rounded-full ${DOT_CLASS[judgement]}`} />
      ))}
    </span>
  );
}

/** 点の色の凡例。 */
export function TorqueTrainingJudgementLegend() {
  return (
    <span className="flex items-center gap-3 text-sm text-white/60" aria-hidden="true">
      {(Object.keys(DOT_CLASS) as TorqueTrainingJudgement[]).map((judgement) => (
        <span key={judgement} className="inline-flex items-center gap-1.5">
          <i className={`block h-3 w-3 rounded-full ${DOT_CLASS[judgement]}`} />
          {JUDGEMENT_LABEL[judgement]}
        </span>
      ))}
    </span>
  );
}
