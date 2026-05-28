import { describe, expect, it } from 'vitest';

import {
  buildOverviewChartDisplayNameByCd,
  formatOverviewChartAxisDisplayName,
  getOverviewChartDisplayNameClipHeight,
  getOverviewChartDisplayNameMaxLength,
  getOverviewChartDisplayNameOffsetY,
  getOverviewChartMinScrollWidth,
  getOverviewChartPlotMinWidth,
  getOverviewChartYAxisMax,
  loadBalancingOverviewChartAxisBandHeight,
  loadBalancingOverviewChartMinTickSlotWidth,
  loadBalancingOverviewXAxisLayout,
  parseRechartsAxisTickPosition,
  resolveOverviewChartDisplayNameClipWidth
} from '../loadBalancingOverviewChartAxis';

describe('loadBalancingOverviewChartAxis', () => {
  it('資源CD（横）→ 余白 → 表示名（vertical-rl）のレイアウト契約', () => {
    expect(loadBalancingOverviewChartAxisBandHeight).toBe(108);
    expect(loadBalancingOverviewXAxisLayout.displayName.writingMode).toBe('vertical-rl');
    expect(loadBalancingOverviewXAxisLayout.displayName.fontSize).toBe(12);
    expect(loadBalancingOverviewXAxisLayout.displayName.charHeight).toBe(11);
    expect(loadBalancingOverviewXAxisLayout.tickMargin).toBe(2);
    expect(loadBalancingOverviewXAxisLayout.resourceCd.dy).toBe(2);
    expect(loadBalancingOverviewXAxisLayout.gapBelowResourceCd).toBe(5);
    expect(getOverviewChartDisplayNameOffsetY()).toBe(
      loadBalancingOverviewXAxisLayout.resourceCd.dy +
        loadBalancingOverviewXAxisLayout.resourceCd.lineHeight +
        loadBalancingOverviewXAxisLayout.gapBelowResourceCd
    );
    expect(getOverviewChartDisplayNameClipHeight()).toBe(81);
    expect(getOverviewChartDisplayNameMaxLength()).toBe(7);
    expect(resolveOverviewChartDisplayNameClipWidth()).toBe(16);
    expect(resolveOverviewChartDisplayNameClipWidth(24)).toBe(22);
    expect(loadBalancingOverviewChartMinTickSlotWidth).toBe(40);
    expect(getOverviewChartPlotMinWidth(48)).toBe(48 * 40);
    expect(getOverviewChartMinScrollWidth(48)).toBe(48 + 16 + 48 * 40);
  });

  describe('getOverviewChartYAxisMax', () => {
    it('データ最大値の 4% ヘッドルームで上限を返す', () => {
      expect(getOverviewChartYAxisMax([{ req: 72000, cap: 12000 }])).toBe(Math.ceil(72000 * 1.04));
    });
  });

  describe('parseRechartsAxisTickPosition', () => {
    it('数値座標をそのまま返す', () => {
      expect(parseRechartsAxisTickPosition(12, 34)).toEqual({ x: 12, y: 34 });
    });

    it('文字列座標を数値に変換する', () => {
      expect(parseRechartsAxisTickPosition('8', '16')).toEqual({ x: 8, y: 16 });
    });
  });

  describe('formatOverviewChartAxisDisplayName', () => {
    it('空文字はそのまま', () => {
      expect(formatOverviewChartAxisDisplayName('')).toBe('');
    });

    it('maxLength 超過時は末尾に省略記号', () => {
      const long = 'あ'.repeat(20);
      expect(formatOverviewChartAxisDisplayName(long, 10)).toBe(`${'あ'.repeat(9)}…`);
    });
  });

  describe('buildOverviewChartDisplayNameByCd', () => {
    it('displayName がある行のみマップに含める', () => {
      expect(
        buildOverviewChartDisplayNameByCd([
          { cd: '587', displayName: 'FJV50/80' },
          { cd: '999', displayName: '' }
        ])
      ).toEqual({ '587': 'FJV50/80' });
    });
  });
});
