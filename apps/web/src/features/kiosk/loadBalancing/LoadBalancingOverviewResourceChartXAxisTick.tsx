import {
  formatOverviewChartAxisDisplayName,
  loadBalancingOverviewXAxisLayout,
  parseRechartsAxisTickPosition
} from './loadBalancingOverviewChartAxis';

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

/** 棒グラフ X 軸: 上段=資源CD、下段=表示名（縦書き -90°）。ペイン外寸は lbChart.container で固定。 */
export function LoadBalancingOverviewResourceChartXAxisTick({
  x,
  y,
  payload,
  displayNameByCd
}: Props) {
  const cd = payload?.value ?? '';
  const displayName = displayNameByCd[cd] ?? '';
  const { x: xPos, y: yPos } = parseRechartsAxisTickPosition(x, y);
  const nameText = formatOverviewChartAxisDisplayName(displayName);
  const { resourceCd, displayName: nameStyle } = loadBalancingOverviewXAxisLayout;

  return (
    <g transform={`translate(${xPos},${yPos})`}>
      <text
        textAnchor="middle"
        fill={resourceCd.fill}
        fontSize={resourceCd.fontSize}
        fontFamily={resourceCd.fontFamily}
        dy={resourceCd.dy}
      >
        {cd}
      </text>
      {nameText ? (
        <text
          textAnchor="start"
          fill={nameStyle.fill}
          fontSize={nameStyle.fontSize}
          transform={`rotate(${nameStyle.rotationDeg})`}
          x={0}
          y={0}
          dx={nameStyle.dx}
          dy={nameStyle.dy}
        >
          {nameText}
        </text>
      ) : null}
    </g>
  );
}
