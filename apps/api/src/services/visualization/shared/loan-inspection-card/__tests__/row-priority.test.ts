import { describe, expect, it } from 'vitest';

import { sortLoanInspectionRowsForDisplay } from '../row-priority.js';

describe('sortLoanInspectionRowsForDisplay', () => {
  it('sorts zero-loan rows by inspection count desc when inspectionCountColumn is set', () => {
    const rows = [
      { 従業員名: '石井 和也', 点検件数: 3, 貸出中吊具数: 0 },
      { 従業員名: '矢田 彗遥', 点検件数: 12, 貸出中吊具数: 0 },
      { 従業員名: '芦沢 剛', 点検件数: 11, 貸出中吊具数: 0 },
    ];

    const sorted = sortLoanInspectionRowsForDisplay(rows, '貸出中吊具数', {
      inspectionCountColumn: '点検件数',
    });

    expect(sorted.map((row) => row['従業員名'])).toEqual(['矢田 彗遥', '芦沢 剛', '石井 和也']);
  });

  it('keeps loan-active rows ahead of zero-loan rows', () => {
    const rows = [
      { 従業員名: '点検のみ', 点検件数: 99, 貸出中吊具数: 0 },
      { 従業員名: '貸出あり', 点検件数: 1, 貸出中吊具数: 2 },
    ];

    const sorted = sortLoanInspectionRowsForDisplay(rows, '貸出中吊具数', {
      inspectionCountColumn: '点検件数',
    });

    expect(sorted.map((row) => row['従業員名'])).toEqual(['貸出あり', '点検のみ']);
  });

  it('falls back to name sort among zero-loan rows without inspectionCountColumn', () => {
    const rows = [
      { 従業員名: '山田 太郎', 点検件数: 5, 貸出中吊具数: 0 },
      { 従業員名: '佐藤 花子', 点検件数: 1, 貸出中吊具数: 0 },
    ];

    const sorted = sortLoanInspectionRowsForDisplay(rows, '貸出中吊具数');

    expect(sorted.map((row) => row['従業員名'])).toEqual(['佐藤 花子', '山田 太郎']);
  });
});
