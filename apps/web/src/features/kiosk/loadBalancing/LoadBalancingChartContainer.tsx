import { ResponsiveContainer } from 'recharts';

import { lbChart } from './loadBalancingUiClasses';

import type { ReactElement } from 'react';

type Props = {
  heightClassName?: string;
  children: ReactElement;
};

export function LoadBalancingChartContainer({
  heightClassName = lbChart.container,
  children
}: Props) {
  return (
    <div className={`w-full min-w-0 ${heightClassName}`}>
      <ResponsiveContainer width="100%" height="100%" debounce={50}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}
