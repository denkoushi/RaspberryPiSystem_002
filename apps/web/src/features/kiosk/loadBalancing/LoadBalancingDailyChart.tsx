import { Bar, BarChart, Cell, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';

import { LoadBalancingChartContainer } from './LoadBalancingChartContainer';
import { formatHours } from './loadBalancingFormat';
import { loadBalancingTooltipStyle, loadBalancingVisibleBarProps } from './loadBalancingRechartsDefaults';

type Props = {
  days: Array<{ date: string; requiredMinutes: number }>;
  capacityMinutesPerDay: number | null;
};

/** 1 資源・1 か月の日別負荷。能力線を超える日を赤くする */
export function LoadBalancingDailyChart({ days, capacityMinutesPerDay }: Props) {
  const data = days.map((day) => ({
    day: String(Number(day.date.slice(8, 10))),
    hours: Math.round((day.requiredMinutes / 60) * 10) / 10,
    over: capacityMinutesPerDay != null && day.requiredMinutes > capacityMinutesPerDay + 1
  }));
  const capacityHours = capacityMinutesPerDay == null ? null : capacityMinutesPerDay / 60;

  return (
    <LoadBalancingChartContainer heightClassName="h-[170px] w-full min-w-0">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={4}>
        <XAxis dataKey="day" interval={0} tick={{ fill: 'rgba(248,250,252,0.55)', fontSize: 12 }} tickLine={false} />
        <YAxis width={36} tick={{ fill: 'rgba(248,250,252,0.55)', fontSize: 12 }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={loadBalancingTooltipStyle}
          cursor={{ fill: 'rgba(255,255,255,0.06)' }}
          formatter={(value) => [`${value}H`, '負荷']}
          labelFormatter={(label) => `${label}日`}
        />
        {capacityHours != null ? (
          <ReferenceLine
            y={capacityHours}
            stroke="#34d399"
            strokeWidth={2}
            strokeDasharray="6 4"
            label={{ value: formatHours(capacityMinutesPerDay!), position: 'insideTopLeft', fill: '#6ee7b7', fontSize: 12 }}
          />
        ) : null}
        <Bar dataKey="hours" radius={[3, 3, 0, 0]} {...loadBalancingVisibleBarProps}>
          {data.map((row) => (
            <Cell key={row.day} fill={row.over ? '#f43f5e' : '#38bdf8'} />
          ))}
        </Bar>
      </BarChart>
    </LoadBalancingChartContainer>
  );
}
