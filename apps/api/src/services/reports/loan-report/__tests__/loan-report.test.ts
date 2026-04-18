import { describe, expect, it } from 'vitest';
import type { MeasuringInstrumentLoanAnalyticsResponse } from '@raspi-system/shared-types';

import { LoanReportEvaluationService } from '../loan-report-evaluation.service.js';
import { LoanReportHtmlRenderer } from '../loan-report-html-renderer.js';

const baseMeasuringResponse = (): MeasuringInstrumentLoanAnalyticsResponse => ({
  meta: {
    timeZone: 'Asia/Tokyo',
    periodFrom: '2026-04-01T00:00:00.000Z',
    periodTo: '2026-04-18T23:59:59.000Z',
    monthlyMonths: 3,
    generatedAt: '2026-04-18T05:00:00.000Z',
  },
  summary: {
    openLoanCount: 5,
    overdueOpenCount: 1,
    totalInstrumentsActive: 100,
    periodBorrowCount: 120,
    periodReturnCount: 110,
  },
  monthlyTrend: [
    { yearMonth: '2026-02', borrowCount: 30, returnCount: 28 },
    { yearMonth: '2026-03', borrowCount: 40, returnCount: 36 },
    { yearMonth: '2026-04', borrowCount: 50, returnCount: 46 },
  ],
  byInstrument: [
    {
      instrumentId: 'i1',
      managementNumber: 'M-001',
      name: 'ノギス',
      status: 'AVAILABLE',
      isOutNow: false,
      currentBorrowerDisplayName: null,
      dueAt: null,
      periodBorrowCount: 20,
      periodReturnCount: 18,
      openIsOverdue: false,
    },
    {
      instrumentId: 'i2',
      managementNumber: 'M-002',
      name: 'マイクロメータ',
      status: 'IN_USE',
      isOutNow: true,
      currentBorrowerDisplayName: '山田',
      dueAt: '2026-04-10T00:00:00.000Z',
      periodBorrowCount: 10,
      periodReturnCount: 9,
      openIsOverdue: true,
    },
    {
      instrumentId: 'i3',
      managementNumber: 'M-003',
      name: 'ノギス',
      status: 'AVAILABLE',
      isOutNow: false,
      currentBorrowerDisplayName: null,
      dueAt: null,
      periodBorrowCount: 4,
      periodReturnCount: 4,
      openIsOverdue: false,
    },
  ],
  periodEvents: [
    {
      kind: 'BORROW',
      eventAt: '2026-04-05T10:00:00.000Z',
      assetId: 'i1',
      assetLabel: 'M-001 ノギス',
      actorDisplayName: '山田',
      actorEmployeeId: 'e1',
    },
    {
      kind: 'BORROW',
      eventAt: '2026-04-06T11:00:00.000Z',
      assetId: 'i1',
      assetLabel: 'M-001 ノギス',
      actorDisplayName: '佐藤',
      actorEmployeeId: 'e2',
    },
  ],
  byEmployee: [
    {
      employeeId: 'e1',
      displayName: '山田 太郎',
      employeeCode: 'E001',
      openInstrumentCount: 2,
      periodBorrowCount: 25,
      periodReturnCount: 23,
    },
    {
      employeeId: 'e2',
      displayName: '佐藤 花子',
      employeeCode: 'E002',
      openInstrumentCount: 1,
      periodBorrowCount: 10,
      periodReturnCount: 9,
    },
  ],
});

describe('loan report domain', () => {
  it('builds a view model from normalized analytics', () => {
    const svc = new LoanReportEvaluationService();
    const vm = svc.buildViewModel({
      category: 'measuring',
      normalized: { kind: 'measuring', response: baseMeasuringResponse() },
      site: '本社',
      author: 'admin',
    });

    expect(vm.category).toBe('計測機器');
    expect(vm.metrics.assets).toBe(100);
    expect(vm.cross.values.length).toBeGreaterThan(0);
    expect(vm.itemAxis[0]).toMatchObject({ name: 'ノギス', demand: 24, stock: 2 });
  });

  it('renders stable HTML containing category label', () => {
    const svc = new LoanReportEvaluationService();
    const vm = svc.buildViewModel({
      category: 'measuring',
      normalized: { kind: 'measuring', response: baseMeasuringResponse() },
    });
    const html = new LoanReportHtmlRenderer().renderDocument(vm);
    expect(html).toContain('計測機器');
    expect(html).toContain('<!DOCTYPE html>');
  });
});
