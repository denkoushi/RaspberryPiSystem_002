import { Bar, BarChart, CartesianGrid, Cell, LabelList, Tooltip, XAxis, YAxis } from 'recharts';

import { LoadBalancingChartContainer } from './LoadBalancingChartContainer';
import {
  LOAD_BALANCING_CAP_FILL,
  LOAD_BALANCING_OVER_REQ_FILL,
  LOAD_BALANCING_OVER_REQ_STROKE,
  LOAD_BALANCING_REQ_FILL,
  loadBalancingAxisTick,
  loadBalancingChartMargin,
  loadBalancingGridStroke,
  loadBalancingTooltipStyle,
  loadBalancingVisibleBarProps
} from './loadBalancingRechartsDefaults';
import { lbChart, lbText } from './loadBalancingUiClasses';

export type OverviewChartRow = {
  cd: string;
  req: number;
  cap: number;
  over: number;
};

type Props = {
  rows: OverviewChartRow[];
};

export function LoadBalancingOverviewResourceChart({ rows }: Props) {
  if (rows.length === 0) {
    return <p className={lbText.muted}>表示できるデータがありません（対象月・条件を確認してください）。</p>;
  }

  const chartData = rows.map((row) => ({
    ...row,
    overLabel: row.over > 0 ? `+${row.over}` : ''
  }));

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
      <LoadBalancingChartContainer>
        <BarChart data={chartData} margin={loadBalancingChartMargin} maxBarSize={40} barGap={2} barCategoryGap="12%">
          <CartesianGrid strokeDasharray="3 3" stroke={loadBalancingGridStroke} />
          <XAxis
            dataKey="cd"
            angle={-35}
            textAnchor="end"
            interval={0}
            height={70}
            tick={loadBalancingAxisTick}
          />
          <YAxis tick={loadBalancingAxisTick} width={48} />
          <Tooltip contentStyle={loadBalancingTooltipStyle} />
          <Bar dataKey="req" name="必要分" fill={LOAD_BALANCING_REQ_FILL} {...loadBalancingVisibleBarProps}>
            {chartData.map((row) => (
              <Cell
                key={`req-${row.cd}`}
                fill={row.over > 0 ? LOAD_BALANCING_OVER_REQ_FILL : LOAD_BALANCING_REQ_FILL}
                stroke={row.over > 0 ? LOAD_BALANCING_OVER_REQ_STROKE : undefined}
                strokeWidth={row.over > 0 ? 2 : 0}
              />
            ))}
            <LabelList
              dataKey="overLabel"
              position="top"
              fill="#fde68a"
              fontSize={13}
              fontWeight={700}
            />
          </Bar>
          <Bar dataKey="cap" name="能力分" fill={LOAD_BALANCING_CAP_FILL} {...loadBalancingVisibleBarProps} />
        </BarChart>
      </LoadBalancingChartContainer>
    </>
  );
}
