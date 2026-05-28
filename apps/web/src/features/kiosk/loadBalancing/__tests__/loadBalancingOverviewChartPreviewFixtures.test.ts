import { describe, expect, it } from 'vitest';

import { getOverviewChartDisplayNameMaxLength } from '../loadBalancingOverviewChartAxis';
import { buildLoadBalancingOverviewChartPreviewRows } from '../loadBalancingOverviewChartPreviewFixtures';

describe('loadBalancingOverviewChartPreviewFixtures', () => {
  it('本番と同じ mapOverviewResourceChartRows で 48 行を生成する', () => {
    const rows = buildLoadBalancingOverviewChartPreviewRows();
    expect(rows).toHaveLength(48);
    expect(rows[0]?.cd).toBe('589');
    expect(rows[0]?.displayName).toBe('PSG206');
    expect(rows[0]?.req).toBeGreaterThan(rows[1]?.req ?? 0);
    expect(rows.find((row) => row.cd === '051')?.displayName).toBe('立型(FANUCロボドリル1号機)');
  });

  it('長い表示名は軸契約の最大文字数で省略される想定データを含む', () => {
    const rows = buildLoadBalancingOverviewChartPreviewRows();
    const longName = rows.find((row) => row.cd === '051')?.displayName ?? '';
    expect(longName.length).toBeGreaterThan(getOverviewChartDisplayNameMaxLength());
  });
});
