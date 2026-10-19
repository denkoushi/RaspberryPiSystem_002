import { Fragment } from 'react';

export const TORQUE_TRAINING_STEPS = ['タグ', 'メニュー', 'レンチ接続', '締付 5本', '結果'] as const;

export type TorqueTrainingStepperProps = {
  /** 0始まりの現在ステップ。 */
  current: number;
};

/** 訓練の進行を5段で示す。説明文の代わりに「いまどこか」を伝える。 */
export function TorqueTrainingStepper({ current }: TorqueTrainingStepperProps) {
  return (
    <ol className="flex min-w-0 items-center justify-center gap-1.5" aria-label="訓練の進行" data-testid="torque-training-stepper">
      {TORQUE_TRAINING_STEPS.map((label, index) => {
        const done = index < current;
        const now = index === current;
        const tone = now
          ? 'bg-cyan-300 font-bold text-slate-900'
          : done
            ? 'text-emerald-300'
            : 'text-slate-500';
        const markTone = now
          ? 'border-slate-900'
          : done
            ? 'border-emerald-300 bg-emerald-300 text-slate-900'
            : 'border-current';
        return (
          <Fragment key={label}>
            {index > 0 ? <li aria-hidden="true" className="h-0.5 w-4 shrink-0 bg-white/10 2xl:w-6" /> : null}
            <li
              className={`flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full pl-2 pr-4 text-base 2xl:text-lg ${tone}`}
              aria-current={now ? 'step' : undefined}
            >
              <span className={`grid h-6 w-6 place-items-center rounded-full border-2 text-sm font-bold ${markTone}`}>
                {done ? '✓' : index + 1}
              </span>
              {label}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
