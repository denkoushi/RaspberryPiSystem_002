import {
  formatOverviewChartAxisDisplayName,
  getOverviewChartDisplayNameClipHeight,
  getOverviewChartDisplayNameOffsetY,
  loadBalancingOverviewXAxisLayout,
  parseRechartsAxisTickPosition
} from './loadBalancingOverviewChartAxis';

import type { CSSProperties, SVGProps } from 'react';

type TickPayload = {
  value: string;
};

type Props = SVGProps<SVGTextElement> & {
  x?: number | string;
  y?: number | string;
  index?: number;
  payload?: TickPayload;
  displayNameByCd: Record<string, string>;
  tickSlotWidth?: number;
};

function buildOverviewChartDisplayNameStyle(
  nameStyle: (typeof loadBalancingOverviewXAxisLayout)['displayName'],
  clipHeight: number
): CSSProperties {
  return {
    writingMode: nameStyle.writingMode,
    textOrientation: 'mixed',
    fontSize: `${nameStyle.fontSize}px`,
    lineHeight: 1.05,
    letterSpacing: '0.02em',
    color: nameStyle.fill,
    fontFamily: nameStyle.fontFamily,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxHeight: `${clipHeight}px`
  };
}

/** 棒グラフ X 軸: 資源CD（横）→ 余白 → 表示名（vertical-rl）。tick 原点で中央揃え。 */
export function LoadBalancingOverviewResourceChartXAxisTick({
  x,
  y,
  payload,
  displayNameByCd,
  tickSlotWidth = 40
}: Props) {
  const cd = payload?.value ?? '';
  const displayName = displayNameByCd[cd] ?? '';
  const { x: xPos, y: yPos } = parseRechartsAxisTickPosition(x, y);
  const nameText = formatOverviewChartAxisDisplayName(displayName);
  const { resourceCd, displayName: nameStyle } = loadBalancingOverviewXAxisLayout;
  const displayNameOffsetY = getOverviewChartDisplayNameOffsetY();
  const clipHeight = getOverviewChartDisplayNameClipHeight();

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
        <foreignObject
          x={-tickSlotWidth / 2}
          y={displayNameOffsetY}
          width={tickSlotWidth}
          height={clipHeight}
        >
          <div
            style={{
              boxSizing: 'border-box',
              width: `${tickSlotWidth}px`,
              height: `${clipHeight}px`,
              margin: 0,
              padding: 0,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'flex-start'
            }}
          >
            <div style={buildOverviewChartDisplayNameStyle(nameStyle, clipHeight)}>{nameText}</div>
          </div>
        </foreignObject>
      ) : null}
    </g>
  );
}
