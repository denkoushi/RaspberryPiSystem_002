import type { SVGProps } from 'react';

type TickPayload = {
  value: string;
};

type Props = SVGProps<SVGTextElement> & {
  x?: number | string;
  y?: number | string;
  payload?: TickPayload;
  displayNameByCd: Record<string, string>;
};

/** 棒グラフX軸: 1行目=資源CD、2行目=表示名（ペイン外寸は変えず下余白を活用） */
export function LoadBalancingOverviewResourceChartXAxisTick({
  x = 0,
  y = 0,
  payload,
  displayNameByCd
}: Props) {
  const cd = payload?.value ?? '';
  const displayName = displayNameByCd[cd] ?? '';
  const xPos = typeof x === 'number' ? x : Number(x) || 0;
  const yPos = typeof y === 'number' ? y : Number(y) || 0;

  return (
    <g transform={`translate(${xPos},${yPos})`}>
      <text textAnchor="middle" fill="#e2e8f0" fontSize={12} fontFamily="ui-monospace, monospace" dy={14}>
        {cd}
      </text>
      {displayName ? (
        <text textAnchor="middle" fill="#94a3b8" fontSize={11} dy={28}>
          {displayName.length > 10 ? `${displayName.slice(0, 9)}…` : displayName}
        </text>
      ) : null}
    </g>
  );
}
