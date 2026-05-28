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

/** 棒グラフ X 軸: 資源CD・表示名とも軸下マージン内（+Y）。外寸は lbChart.container 固定。 */
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
        textAnchor={resourceCd.textAnchor}
        fill={resourceCd.fill}
        fontSize={resourceCd.fontSize}
        fontFamily={resourceCd.fontFamily}
        dy={resourceCd.dy}
      >
        {cd}
      </text>
      {nameText ? (
        <text
          textAnchor={nameStyle.textAnchor}
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
