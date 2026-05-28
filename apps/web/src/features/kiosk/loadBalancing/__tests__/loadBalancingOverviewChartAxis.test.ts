import { describe, expect, it } from 'vitest';

import {
  buildOverviewChartDisplayNameByCd,
  formatOverviewChartAxisDisplayName,
  getOverviewChartDisplayNameOffsetY,
  loadBalancingOverviewChartAxisBandHeight,
  loadBalancingOverviewXAxisLayout,
  parseRechartsAxisTickPosition
} from '../loadBalancingOverviewChartAxis';

describe('loadBalancingOverviewChartAxis', () => {
  it('資源CD（横）→ 余白 → 表示名（縦 +90°）のレイアウト契約', () => {
    expect(loadBalancingOverviewChartAxisBandHeight).toBe(108);
    expect(loadBalancingOverviewXAxisLayout.displayName.rotationDeg).toBe(90);
    expect(loadBalancingOverviewXAxisLayout.tickMargin).toBe(6);
    expect(loadBalancingOverviewXAxisLayout.resourceCd.dy).toBe(4);
    expect(loadBalancingOverviewXAxisLayout.gapBelowResourceCd).toBe(10);
    expect(getOverviewChartDisplayNameOffsetY()).toBe(
      loadBalancingOverviewXAxisLayout.resourceCd.dy +
        loadBalancingOverviewXAxisLayout.resourceCd.lineHeight +
        loadBalancingOverviewXAxisLayout.gapBelowResourceCd
    );
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
