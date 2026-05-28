import { describe, expect, it } from 'vitest';

import {
  buildOverviewChartDisplayNameByCd,
  formatOverviewChartAxisDisplayName,
  parseRechartsAxisTickPosition
} from '../loadBalancingOverviewChartAxis';

describe('loadBalancingOverviewChartAxis', () => {
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
