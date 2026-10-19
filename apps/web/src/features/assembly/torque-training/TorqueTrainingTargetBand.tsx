export type TorqueTrainingTargetBandPoint = {
  key: string;
  attemptNo: number;
  valueNm: number;
  judgement: 'OK' | 'UNDER' | 'OVER';
};

export type TorqueTrainingTargetBandProps = {
  lowerNm: number;
  nominalNm: number;
  upperNm: number;
  points: TorqueTrainingTargetBandPoint[];
};

const WIDTH = 1000;
const HEIGHT = 170;
const SIDE = 40;
const BAND_TOP = 56;
const BAND_HEIGHT = 56;

const POINT_FILL: Record<TorqueTrainingTargetBandPoint['judgement'], string> = {
  OK: '#6ee7b7',
  UNDER: '#fcd34d',
  OVER: '#fda4af'
};

function formatTick(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * 合格範囲（帯）と目標値の線の上に、5本の結果を番号つきの点で置く。
 * どれがどちらに外れたかを一目で分かるようにする。
 */
export function TorqueTrainingTargetBand({ lowerNm, nominalNm, upperNm, points }: TorqueTrainingTargetBandProps) {
  const span = Math.max(upperNm - lowerNm, Math.abs(nominalNm) * 0.1, 0.01);
  const values = points.map((point) => point.valueNm);
  const domainMin = Math.min(lowerNm - span * 0.25, ...values.map((value) => value - span * 0.05));
  const domainMax = Math.max(upperNm + span * 0.25, ...values.map((value) => value + span * 0.05));
  const x = (value: number) => SIDE + ((value - domainMin) / (domainMax - domainMin)) * (WIDTH - SIDE * 2);
  const ticks = [lowerNm, nominalNm, upperNm];

  return (
    <svg
      className="w-full max-w-5xl"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`合格範囲 ${formatTick(lowerNm)}〜${formatTick(upperNm)} N·m、目標 ${formatTick(nominalNm)} N·m に対する${points.length}本の結果`}
      data-testid="torque-training-target-band"
    >
      <rect x={x(domainMin)} y={BAND_TOP} width={x(lowerNm) - x(domainMin)} height={BAND_HEIGHT} fill="rgba(252,211,77,0.10)" />
      <rect x={x(upperNm)} y={BAND_TOP} width={x(domainMax) - x(upperNm)} height={BAND_HEIGHT} fill="rgba(253,164,175,0.10)" />
      <rect x={x(lowerNm)} y={BAND_TOP} width={x(upperNm) - x(lowerNm)} height={BAND_HEIGHT} fill="rgba(110,231,183,0.16)" stroke="rgba(110,231,183,0.6)" />
      <line x1={x(nominalNm)} x2={x(nominalNm)} y1={BAND_TOP - 10} y2={BAND_TOP + BAND_HEIGHT + 10} stroke="#f1f5f9" strokeWidth={2} strokeDasharray="5 4" />
      <text x={x(nominalNm)} y={BAND_TOP - 18} fill="#f1f5f9" fontSize={18} fontWeight={700} textAnchor="middle">目標 {formatTick(nominalNm)}</text>
      <text x={(x(domainMin) + x(lowerNm)) / 2} y={BAND_TOP - 18} fill="#fcd34d" fontSize={16} fontWeight={700} textAnchor="middle">弱い</text>
      <text x={(x(upperNm) + x(domainMax)) / 2} y={BAND_TOP - 18} fill="#fda4af" fontSize={16} fontWeight={700} textAnchor="middle">強い</text>
      {ticks.map((tick, index) => (
        <g key={index}>
          <line x1={x(tick)} x2={x(tick)} y1={BAND_TOP + BAND_HEIGHT} y2={BAND_TOP + BAND_HEIGHT + 6} stroke="#64748b" />
          <text x={x(tick)} y={BAND_TOP + BAND_HEIGHT + 26} fill="#94a3b8" fontSize={15} textAnchor="middle">{formatTick(tick)}</text>
        </g>
      ))}
      <text x={WIDTH - SIDE} y={HEIGHT - 4} fill="#64748b" fontSize={14} textAnchor="end">N·m</text>
      {points.map((point, index) => {
        const cy = BAND_TOP + 12 + (index % 3) * 16;
        return (
          <g key={point.key}>
            <circle cx={x(point.valueNm)} cy={cy} r={12} fill={POINT_FILL[point.judgement]} stroke="#0f172a" strokeWidth={2} />
            <text x={x(point.valueNm)} y={cy + 5} fill="#0f172a" fontSize={14} fontWeight={900} textAnchor="middle">{point.attemptNo}</text>
          </g>
        );
      })}
    </svg>
  );
}
