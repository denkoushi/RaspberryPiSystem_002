import { CHANGE_POINT_KIND_LABELS, formatLimit, type ReductionRow } from './selfInspectionReductionViewModel';

import type { SelfInspectionReductionItem, SelfInspectionReductionPart } from '../../../api/client';
import type { SelfInspectionReductionLevelMode, SelfInspectionReductionVerdict } from '@raspi-system/shared-types';
import type { ReactElement } from 'react';



/** 判定ごとの色。SVG でも使うため 16 進で持つ。 */
export const VERDICT_COLORS: Record<SelfInspectionReductionVerdict, string> = {
  reduce: '#34d399',
  almost: '#60a5fa',
  keep: '#94a3b8',
  restore: '#fb7185',
  unjudgeable: '#64748b'
};

const BAND = '#1d3a33';
const BAND_CORE = '#22503f';
const LIMIT_LINE = '#5f7a70';
const NOMINAL_LINE = '#7aa594';
const OUT_DOT = '#fb7185';
const CHANGE_POINT = '#fbbf24';

export function cpkColor(cpk: number | null): string {
  if (cpk == null) return '#72849b';
  if (cpk >= 1.67) return '#34d399';
  if (cpk >= 1.33) return '#6ee7b7';
  if (cpk >= 1) return '#fbbf24';
  return '#fb7185';
}

function isOut(item: SelfInspectionReductionItem, value: number) {
  return value < item.lower || value > item.upper;
}

/** 公差の帯の中に直近の測定値を点で並べる。点が帯の中央に集まるほど余裕がある。 */
export function ToleranceStrip({
  item,
  width = 260,
  height = 30,
  fluid = false
}: {
  item: SelfInspectionReductionItem;
  width?: number;
  height?: number;
  /** 列幅に合わせて横に伸縮する（点はわずかに横長になる）。 */
  fluid?: boolean;
}) {
  const half = (item.upper - item.lower) / 2;
  const lo = item.lower - half * 0.35;
  const hi = item.upper + half * 0.35;
  const x = (value: number) => ((Math.min(Math.max(value, lo), hi) - lo) / (hi - lo)) * width;
  const coreLo = item.lower + half * 0.4;
  const coreHi = item.upper - half * 0.4;
  return (
    <svg
      width={fluid ? '100%' : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fluid ? 'none' : undefined}
      aria-hidden="true"
      className="block"
    >
      <rect x={x(item.lower)} y={3} width={x(item.upper) - x(item.lower)} height={height - 6} rx={4} fill={BAND} />
      <rect x={x(coreLo)} y={3} width={x(coreHi) - x(coreLo)} height={height - 6} fill={BAND_CORE} />
      <line x1={x(item.lower)} x2={x(item.lower)} y1={0} y2={height} stroke={LIMIT_LINE} strokeWidth={1.5} />
      <line x1={x(item.upper)} x2={x(item.upper)} y1={0} y2={height} stroke={LIMIT_LINE} strokeWidth={1.5} />
      {item.nominal != null ? (
        <line x1={x(item.nominal)} x2={x(item.nominal)} y1={5} y2={height - 5} stroke={NOMINAL_LINE} strokeDasharray="2 3" />
      ) : null}
      {item.values.map((point, index) => {
        const out = isOut(item, point.value);
        const y = height / 2 + (((index * 37) % 11) - 5) * ((height - 12) / 12);
        return (
          <circle
            key={`${point.measuredAt}-${index}`}
            cx={x(point.value)}
            cy={y}
            r={out ? 3.4 : 2.2}
            fill={out ? OUT_DOT : '#d9f7ec'}
            fillOpacity={out ? 1 : 0.72}
          />
        );
      })}
      {item.mean != null ? <rect x={x(item.mean) - 1.5} y={1} width={3} height={height - 2} rx={1.5} fill="#fff" /> : null}
    </svg>
  );
}

export function CpkGauge({ cpk, width = 100 }: { cpk: number | null; width?: number }) {
  const max = 2.5;
  const x = (value: number) => (Math.min(Math.max(value, 0), max) / max) * width;
  return (
    <svg width={width} height={8} viewBox={`0 0 ${width} 8`} aria-hidden="true" className="block">
      <rect width={width} height={8} rx={4} fill="#223044" />
      {cpk != null ? <rect width={x(cpk)} height={8} rx={4} fill={cpkColor(cpk)} /> : null}
      {[1, 1.33, 1.67].map((tick) => (
        <rect key={tick} x={x(tick) - 0.5} width={1.5} height={8} fill="#141e2b" />
      ))}
    </svg>
  );
}

export function LotBars({ lots }: { lots: SelfInspectionReductionPart['recentLots'] }) {
  return (
    <span className="flex gap-[2px]" aria-hidden="true">
      {lots.map((lot, index) => (
        <i
          key={`${lot.completedAt}-${index}`}
          className={lot.pass ? 'block h-3 w-1 rounded-[1px] bg-[#2f6f5a]' : 'block h-3 w-1 rounded-[1px] bg-rose-400'}
        />
      ))}
    </span>
  );
}

/** 測定値の推移。帯＝公差、白線＝直近8個の移動平均、黄線＝変化点。 */
export function RunChart({
  item,
  changePoints
}: {
  item: SelfInspectionReductionItem;
  changePoints: SelfInspectionReductionPart['changePoints'];
}) {
  const w = 380;
  const h = 150;
  const pad = { l: 56, r: 8, t: 8, b: 18 };
  const half = (item.upper - item.lower) / 2;
  const lo = item.lower - half * 0.3;
  const hi = item.upper + half * 0.3;
  const values = item.values;
  const n = values.length;
  const x = (index: number) => pad.l + (n <= 1 ? 0.5 : index / (n - 1)) * (w - pad.l - pad.r);
  const y = (value: number) => pad.t + ((hi - Math.min(Math.max(value, lo), hi)) / (hi - lo)) * (h - pad.t - pad.b);
  const coreTop = y(item.upper - half * 0.4);
  const coreBottom = y(item.lower + half * 0.4);

  let average = '';
  values.forEach((_, index) => {
    const window = values.slice(Math.max(0, index - 7), index + 1);
    const mean = window.reduce((sum, point) => sum + point.value, 0) / window.length;
    average += `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(mean).toFixed(1)}`;
  });

  const firstTime = n ? new Date(values[0]!.measuredAt).getTime() : 0;
  const markers = changePoints
    .map((point) => {
      const time = new Date(point.occurredAt).getTime();
      if (!n || time <= firstTime) return null;
      const index = values.findIndex((value) => new Date(value.measuredAt).getTime() >= time);
      return { point, px: index < 0 ? x(n - 1) + 4 : x(index) - 3 };
    })
    .filter((marker): marker is { point: (typeof changePoints)[number]; px: number } => marker != null);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="block h-full w-full" role="img" aria-label={`${item.label}の測定値の推移`}>
      <rect x={pad.l} y={y(item.upper)} width={w - pad.l - pad.r} height={y(item.lower) - y(item.upper)} fill={BAND} />
      <rect x={pad.l} y={coreTop} width={w - pad.l - pad.r} height={coreBottom - coreTop} fill={BAND_CORE} opacity={0.7} />
      {[item.upper, item.lower].map((limit) => (
        <g key={limit}>
          <line x1={pad.l} x2={w - pad.r} y1={y(limit)} y2={y(limit)} stroke={LIMIT_LINE} />
          <text x={pad.l - 6} y={y(limit) + 4} textAnchor="end" fontSize={11} fill="#72849b" className="font-mono">
            {formatLimit(limit, item.decimalPlaces)}
          </text>
        </g>
      ))}
      {item.nominal != null ? (
        <line x1={pad.l} x2={w - pad.r} y1={y(item.nominal)} y2={y(item.nominal)} stroke={NOMINAL_LINE} strokeDasharray="3 4" />
      ) : null}
      {markers.map(({ point, px }) => {
        const label = CHANGE_POINT_KIND_LABELS[point.kind];
        return (
          <g key={point.id}>
            <line x1={px} x2={px} y1={pad.t} y2={h - pad.b} stroke={CHANGE_POINT} strokeWidth={1.5} strokeDasharray="3 3" />
            <rect x={px + 3} y={pad.t} width={label.length * 11 + 10} height={17} rx={4} fill="#3a2f12" />
            <text x={px + 8} y={pad.t + 12.5} fontSize={11} fontWeight={700} fill={CHANGE_POINT}>
              {label}
            </text>
          </g>
        );
      })}
      {n > 1 ? <path d={average} fill="none" stroke="#fff" strokeWidth={2} strokeOpacity={0.85} /> : null}
      {values.map((point, index) => {
        const out = isOut(item, point.value);
        return (
          <circle
            key={`${point.measuredAt}-${index}`}
            cx={x(index)}
            cy={y(point.value)}
            r={out ? 3.6 : 2.2}
            fill={out ? OUT_DOT : '#bfe9d9'}
            fillOpacity={out ? 1 : 0.6}
          />
        );
      })}
      <text x={pad.l} y={h - 4} fontSize={11} fill="#72849b">
        古い
      </text>
      <text x={w - pad.r} y={h - 4} fontSize={11} fill="#72849b" textAnchor="end">
        最新
      </text>
    </svg>
  );
}

const STAIR_MODES: SelfInspectionReductionLevelMode[] = ['full', 'fixed_count', 'first_last', 'single'];
const STAIR_LABELS = ['全数', '指定数', '最初と最後', '1件'];
const STAIR_PIECES = ['全個', '数個', '2個', '1個'];

/**
 * 検査の階段。左が全数（高い段）、右が1件（低い段）。品番を点で置き、
 * 「減らせる」は1段下へ、「増やす」は1段上へ矢印を引く。
 */
export function ReductionStairs({
  rows,
  selectedId,
  onSelect
}: {
  rows: readonly ReductionRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const W = 1356;
  const H = 184;
  const stepW = W / 4 - 10;
  const base = H - 26;
  const heights = [108, 82, 56, 30];
  const x0 = (level: number) => 12 + level * (W / 4);
  const maxDots = Math.floor((stepW - 40) / 30);
  const levelIndex = (mode: SelfInspectionReductionLevelMode) => STAIR_MODES.indexOf(mode);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-full w-full" role="group" aria-label="検査レベルごとの品番">
      <defs>
        <marker id="reduction-arrow-down" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0L10 5L0 10z" fill={VERDICT_COLORS.reduce} />
        </marker>
        <marker id="reduction-arrow-up" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0L10 5L0 10z" fill={VERDICT_COLORS.restore} />
        </marker>
      </defs>
      {STAIR_MODES.map((mode, level) => {
        const x = x0(level);
        const top = base - heights[level]!;
        const onStep = rows.filter((row) => row.part.metrics.level.mode === mode);
        const shown = onStep.slice(0, maxDots);
        return (
          <g key={mode}>
            <rect x={x} y={top} width={stepW} height={heights[level]} rx={6} fill="#1a2738" />
            <rect x={x} y={top} width={stepW} height={3} rx={1.5} fill="#3a4f6b" />
            <text x={x + stepW - 14} y={base - 7} textAnchor="end" fontSize={[34, 30, 24, 18][level]} fontWeight={600} fill="#2c3d55" className="font-mono">
              {STAIR_PIECES[level]}
            </text>
            <text x={x + 14} y={base + 18} fontSize={15} fontWeight={700} fill="#aab8ca">
              {STAIR_LABELS[level]}
            </text>
            <text x={x + stepW - 12} y={base + 18} fontSize={15} textAnchor="end" fill="#72849b" className="font-mono">
              {onStep.length}
            </text>
            {onStep.length > shown.length ? (
              <text x={x + 26 + shown.length * 30} y={top - 13} fontSize={13} fill="#aab8ca">
                +{onStep.length - shown.length}
              </text>
            ) : null}
            {shown.map((row, index) => {
              const cx = x + 26 + index * 30;
              const cy = top - 18;
              const target = row.judgement.target;
              const targetLevel = target ? levelIndex(target.mode) : -1;
              let arrow: ReactElement | null = null;
              if (row.judgement.verdict === 'reduce' && targetLevel > level) {
                const tx = x0(targetLevel) + 26;
                const ty = base - heights[targetLevel]! - 18;
                arrow = (
                  <path
                    d={`M${cx + 8} ${cy - 6} C ${cx + 60} ${cy - 34}, ${tx - 50} ${ty - 40}, ${tx - 4} ${ty - 12}`}
                    fill="none"
                    stroke={VERDICT_COLORS.reduce}
                    strokeWidth={2}
                    strokeDasharray="4 5"
                    opacity={0.55}
                    markerEnd="url(#reduction-arrow-down)"
                  />
                );
              } else if (row.judgement.verdict === 'restore' && targetLevel >= 0 && targetLevel < level) {
                const tx = x0(targetLevel) + stepW - 30;
                const ty = base - heights[targetLevel]! - 18;
                arrow = (
                  <path
                    d={`M${cx - 8} ${cy - 6} C ${cx - 40} ${cy - 30}, ${tx + 50} ${ty - 30}, ${tx + 4} ${ty - 12}`}
                    fill="none"
                    stroke={VERDICT_COLORS.restore}
                    strokeWidth={2}
                    strokeDasharray="4 5"
                    opacity={0.6}
                    markerEnd="url(#reduction-arrow-up)"
                  />
                );
              }
              const selected = row.id === selectedId;
              return (
                <g key={row.id}>
                  {arrow}
                  <g
                    role="button"
                    tabIndex={0}
                    aria-label={`${row.part.key.fhincd} ${row.part.key.resourceCd}`}
                    className="cursor-pointer outline-none"
                    onClick={() => onSelect(row.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') onSelect(row.id);
                    }}
                  >
                    <title>{`${row.part.key.fhincd} ${row.part.fhinmei}`}</title>
                    <circle
                      cx={cx}
                      cy={cy}
                      r={11}
                      fill={VERDICT_COLORS[row.judgement.verdict]}
                      stroke={selected ? '#fff' : 'none'}
                      strokeWidth={selected ? 2.5 : 0}
                    />
                  </g>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
