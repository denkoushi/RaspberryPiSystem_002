import { useEffect, useRef, useState } from 'react';
import { Bar, BarChart, Cell, LabelList, Tooltip, XAxis, YAxis } from 'recharts';

import { LoadBalancingChartContainer } from './LoadBalancingChartContainer';
import {
  buildOverviewChartDisplayNameByCd,
  getOverviewChartMinScrollWidth,
  getOverviewChartYAxisMax,
  loadBalancingOverviewChartCategoryGapPx,
  loadBalancingOverviewChartMinTickSlotWidth,
  loadBalancingOverviewXAxisLayout
} from './loadBalancingOverviewChartAxis';
import { LoadBalancingOverviewResourceChartXAxisTick } from './LoadBalancingOverviewResourceChartXAxisTick';
import {
  LOAD_BALANCING_CAP_FILL,
  LOAD_BALANCING_OVER_REQ_FILL,
  LOAD_BALANCING_OVER_REQ_STROKE,
  LOAD_BALANCING_REQ_FILL,
  loadBalancingAxisTick,
  loadBalancingChartMargin,
  loadBalancingOverviewChartXAxisHeight,
  loadBalancingTooltipCursor,
  loadBalancingTooltipStyle,
  loadBalancingVisibleBarProps
} from './loadBalancingRechartsDefaults';
import { lbChart, lbText } from './loadBalancingUiClasses';

import type { OverviewChartRow } from './mapOverviewResourceChartRows';

export type { OverviewChartRow };

type Props = {
  rows: OverviewChartRow[];
  /** X 軸評価用 — 超過ラベル（LabelList）を非表示 */
  showOverLabels?: boolean;
};

const Y_AXIS_WIDTH = 48;

export function LoadBalancingOverviewResourceChart({ rows, showOverLabels = true }: Props) {
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  useEffect(() => {
    const el = scrollViewportRef.current;
    if (!el) return;

    const update = () => setViewportWidth(el.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (rows.length === 0) {
    return <p className={lbText.muted}>表示できるデータがありません（対象月・条件を確認してください）。</p>;
  }

  const displayNameByCd = buildOverviewChartDisplayNameByCd(rows);
  const chartData = rows.map((row) => ({
    ...row,
    overLabel: row.over > 0 ? `+${row.over}` : ''
  }));

  const minScrollWidth = getOverviewChartMinScrollWidth(rows.length, Y_AXIS_WIDTH);
  const chartWidth = Math.max(viewportWidth, minScrollWidth);
  const tickSlotWidth = loadBalancingOverviewChartMinTickSlotWidth;
  const yAxisMax = getOverviewChartYAxisMax(rows);

  return (
    <>
      <div className={lbChart.legend}>
        <span className="inline-flex items-center gap-1.5">
          <span className={lbChart.legendSwatch} style={{ backgroundColor: LOAD_BALANCING_REQ_FILL }} />
          必要分
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={lbChart.legendSwatch} style={{ backgroundColor: LOAD_BALANCING_CAP_FILL }} />
          能力分
        </span>
        <span className="inline-flex items-center gap-1.5 text-amber-200/90">
          <span
            className={lbChart.legendSwatch}
            style={{ backgroundColor: LOAD_BALANCING_OVER_REQ_FILL }}
          />
          超過（必要分）
        </span>
      </div>
      <div ref={scrollViewportRef} className={lbChart.scroll}>
        <div style={{ width: chartWidth, minWidth: '100%' }}>
          <LoadBalancingChartContainer>
            <BarChart
              data={chartData}
              margin={loadBalancingChartMargin}
              maxBarSize={32}
              barGap={3}
              barCategoryGap={loadBalancingOverviewChartCategoryGapPx}
            >
              <XAxis
                dataKey="cd"
                interval={0}
                height={loadBalancingOverviewChartXAxisHeight}
                tickMargin={loadBalancingOverviewXAxisLayout.tickMargin}
                tick={(props) => (
                  <LoadBalancingOverviewResourceChartXAxisTick
                    {...props}
                    displayNameByCd={displayNameByCd}
                    tickSlotWidth={tickSlotWidth}
                  />
                )}
              />
              <YAxis tick={loadBalancingAxisTick} width={Y_AXIS_WIDTH} domain={[0, yAxisMax]} allowDataOverflow />
              <Tooltip contentStyle={loadBalancingTooltipStyle} cursor={loadBalancingTooltipCursor} />
              <Bar dataKey="req" name="必要分" fill={LOAD_BALANCING_REQ_FILL} {...loadBalancingVisibleBarProps}>
                {chartData.map((row) => (
                  <Cell
                    key={`req-${row.cd}`}
                    fill={row.over > 0 ? LOAD_BALANCING_OVER_REQ_FILL : LOAD_BALANCING_REQ_FILL}
                    stroke={row.over > 0 ? LOAD_BALANCING_OVER_REQ_STROKE : undefined}
                    strokeWidth={row.over > 0 ? 2 : 0}
                  />
                ))}
                {showOverLabels ? (
                  <LabelList
                    dataKey="overLabel"
                    position="top"
                    fill="#fde68a"
                    fontSize={13}
                    fontWeight={700}
                  />
                ) : null}
              </Bar>
              <Bar dataKey="cap" name="能力分" fill={LOAD_BALANCING_CAP_FILL} {...loadBalancingVisibleBarProps} />
            </BarChart>
          </LoadBalancingChartContainer>
        </div>
      </div>
    </>
  );
}
