import {
  formatTrainingPercent,
  formatTrainingRate,
  trainingErrorDelta,
  trainingRateDelta,
  trainingTendency,
  type TorqueTrainingDelta,
  type TorqueTrainingTendencyTone
} from './torqueTrainingKpiPresentation';

import type { TorqueTrainingTeamSummaryApi } from '../../../api/client';
import type { ReactNode } from 'react';

export type TorqueTrainingTeamKpiBandProps = {
  recent: Partial<TorqueTrainingTeamSummaryApi> | null | undefined;
  allTime: Partial<TorqueTrainingTeamSummaryApi> | null | undefined;
};

export const TENDENCY_TEXT_CLASS: Record<TorqueTrainingTendencyTone, string> = {
  center: 'text-emerald-300',
  weak: 'text-amber-300',
  strong: 'text-rose-300',
  none: 'text-white'
};

function DeltaText({ delta }: { delta: TorqueTrainingDelta | null }) {
  if (!delta) return null;
  const tone = delta.improved === null ? 'text-white/60' : delta.improved ? 'text-emerald-300' : 'text-rose-300';
  return <><span className={`font-semibold ${tone}`}>{delta.label}</span> 全期間比</>;
}

type Card = { label: string; value: string; unit?: string; valueClassName?: string; detail: ReactNode };

function KpiGroup({ title, subtitle, cards, testId }: { title: string; subtitle: string; cards: Card[]; testId: string }) {
  return (
    <section
      className="grid min-w-0 grid-cols-[6.5rem_repeat(3,minmax(0,1fr))] gap-2 rounded border border-white/10 bg-slate-900/80 p-3 2xl:grid-cols-[8.5rem_repeat(3,minmax(0,1fr))] 2xl:gap-3"
      aria-label={`訓練KPI ${title}`}
      data-testid={testId}
    >
      <div className="grid content-center gap-1">
        <h2 className="text-lg font-bold 2xl:text-xl">{title}</h2>
        <p className="text-sm text-white/60">{subtitle}</p>
      </div>
      {cards.map((card) => (
        <div key={card.label} className="min-w-0 rounded bg-slate-800/80 px-3 py-2 2xl:px-4">
          <p className="text-sm text-white/60">{card.label}</p>
          <p className={`truncate text-3xl font-black leading-tight tabular-nums 2xl:text-4xl ${card.valueClassName ?? ''}`}>
            {card.value}
            {card.unit ? <span className="ml-0.5 text-base font-bold 2xl:text-lg">{card.unit}</span> : null}
          </p>
          <p className="truncate text-sm text-white/60">{card.detail}</p>
        </div>
      ))}
    </section>
  );
}

function hasValue(value: number | null | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * タグの本人に関係なく、全員分の訓練KPIを常時表示する帯。
 * 左は直近10回、右は全期間。値が無ければ「—」を表示する。
 */
export function TorqueTrainingTeamKpiBand({ recent, allTime }: TorqueTrainingTeamKpiBandProps) {
  const recentTendency = trainingTendency(recent?.meanDeviationPercent);
  const allTimeTendency = trainingTendency(allTime?.meanDeviationPercent);
  const unit = (value: number | null | undefined) => (hasValue(value) ? '%' : undefined);

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" data-testid="torque-training-team-kpi">
      <KpiGroup
        title="直近10回"
        subtitle={`${recent?.operatorCount ?? 0}人 · ${recent?.attemptCount ?? 0}本`}
        testId="torque-training-team-kpi-recent"
        cards={[
          { label: '合格率', value: formatTrainingRate(recent?.passRate), unit: unit(recent?.passRate), detail: <DeltaText delta={trainingRateDelta(recent?.passRate, allTime?.passRate)} /> },
          { label: '平均ずれ', value: formatTrainingPercent(recent?.meanAbsoluteErrorPercent), unit: unit(recent?.meanAbsoluteErrorPercent), detail: <DeltaText delta={trainingErrorDelta(recent?.meanAbsoluteErrorPercent, allTime?.meanAbsoluteErrorPercent)} /> },
          { label: '強弱の傾向', value: recentTendency.label, valueClassName: TENDENCY_TEXT_CLASS[recentTendency.tone], detail: `平均 ${recentTendency.signedLabel}` }
        ]}
      />
      <KpiGroup
        title="全期間"
        subtitle={`${allTime?.operatorCount ?? 0}人 · ${allTime?.sessionCount ?? 0}回`}
        testId="torque-training-team-kpi-all-time"
        cards={[
          { label: '合格率', value: formatTrainingRate(allTime?.passRate), unit: unit(allTime?.passRate), detail: `${(allTime?.attemptCount ?? 0).toLocaleString()}本` },
          { label: '平均ずれ', value: formatTrainingPercent(allTime?.meanAbsoluteErrorPercent), unit: unit(allTime?.meanAbsoluteErrorPercent), detail: '目標からの差' },
          { label: '強弱の傾向', value: allTimeTendency.label, valueClassName: TENDENCY_TEXT_CLASS[allTimeTendency.tone], detail: `平均 ${allTimeTendency.signedLabel}` }
        ]}
      />
    </div>
  );
}
