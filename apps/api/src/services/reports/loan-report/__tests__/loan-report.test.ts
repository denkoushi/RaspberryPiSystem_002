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
      overdueOpenInstrumentCount: 1,
      periodBorrowCount: 25,
      periodReturnCount: 23,
    },
    {
      employeeId: 'e2',
      displayName: '佐藤 花子',
      employeeCode: 'E002',
      openInstrumentCount: 1,
      overdueOpenInstrumentCount: 0,
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
    expect(vm.itemAxis[0]).toMatchObject({
      name: 'ノギス',
      demand: 24,
      stock: 2,
      unitsTotal: 2,
      unitsOut: 0,
    });
    expect(vm.personAxis[0]).toMatchObject({ name: '山田 太郎', borrowed: 25, open: 2, overdue: 1 });
  });

  it('does not describe removed supply UI (dual bar / inner gauge) in findings', () => {
    const svc = new LoanReportEvaluationService();
    const vm = svc.buildViewModel({
      category: 'measuring',
      normalized: { kind: 'measuring', response: baseMeasuringResponse() },
    });
    expect(vm.findings.body).not.toContain('二段バー');
    expect(vm.findings.body).not.toContain('左内');
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
    expect(html).toContain('supply-treemap-svg');
  });

  it('fills group monthly borrow from category shape when periodEvents lack per-group detail', () => {
    const response = baseMeasuringResponse();
    response.periodEvents = [];
    const svc = new LoanReportEvaluationService();
    const vm = svc.buildViewModel({
      category: 'measuring',
      normalized: { kind: 'measuring', response },
    });
    expect(vm.supply.groupTimeseries).not.toBeNull();
    expect(vm.supply.groupTimeseries?.groupLabel).toBe('ノギス');
    expect(vm.supply.groupTimeseries?.borrowByMonth.reduce((a, b) => a + b, 0)).toBe(24);
    const html = new LoanReportHtmlRenderer().renderDocument(vm);
    expect(html).toContain('loan-report:supply-pane');
    expect(html).toContain('content="treemap-hero-v1"');
    expect(html).toContain('supply-treemap-svg');
  });

  it('adds name-group monthly borrow series and bottleneck strip to supply eval and HTML', () => {
    const response = baseMeasuringResponse();
    response.meta.periodFrom = '2026-02-01T00:00:00.000Z';
    response.meta.periodTo = '2026-04-18T23:59:59.000Z';
    response.periodEvents = [
      {
        kind: 'BORROW',
        eventAt: '2026-02-05T10:00:00.000Z',
        assetId: 'i1',
        assetLabel: 'M-001 ノギス',
        actorDisplayName: '山田',
        actorEmployeeId: 'e1',
      },
      {
        kind: 'BORROW',
        eventAt: '2026-02-08T11:00:00.000Z',
        assetId: 'i1',
        assetLabel: 'M-001 ノギス',
        actorDisplayName: '山田',
        actorEmployeeId: 'e1',
      },
      {
        kind: 'BORROW',
        eventAt: '2026-03-01T09:00:00.000Z',
        assetId: 'i1',
        assetLabel: 'M-001 ノギス',
        actorDisplayName: '佐藤',
        actorEmployeeId: 'e2',
      },
      {
        kind: 'BORROW',
        eventAt: '2026-03-12T09:00:00.000Z',
        assetId: 'i2',
        assetLabel: 'M-002 マイクロメータ',
        actorDisplayName: '佐藤',
        actorEmployeeId: 'e2',
      },
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
    ];
    const svc = new LoanReportEvaluationService();
    const vm = svc.buildViewModel({
      category: 'measuring',
      normalized: { kind: 'measuring', response },
    });
    expect(vm.supply.groupTimeseries).not.toBeNull();
    expect(vm.supply.groupTimeseries?.groupLabel).toBe('ノギス');
    expect(vm.supply.groupTimeseries?.borrowByMonth).toEqual([2, 1, 2]);
    expect(vm.supply.groupTimeseries?.totalBorrowByMonth).toEqual([30, 40, 50]);
    expect(vm.supply.bottleneckTop2[0]?.label).toBe('ノギス');
    expect(vm.supply.bottleneckTop2[1]?.label).toBe('マイクロメータ');
    expect(vm.findings.body).toContain('名寄せ「ノギス」');

    const html = new LoanReportHtmlRenderer().renderDocument(vm);
    expect(html).toContain('supply-treemap-svg');
    expect(html).toContain('計測機器（名寄せ）');
  });

  it('calculates safety cover days with same-day range as one day window', async () => {
    const svc = new LoanReportEvaluationService();
    const response = baseMeasuringResponse();
    response.meta.periodFrom = '2026-04-18T00:00:00.000Z';
    response.meta.periodTo = '2026-04-18T00:00:00.000Z';
    response.summary.totalInstrumentsActive = 10;
    response.summary.openLoanCount = 2;
    response.summary.periodBorrowCount = 2;
    response.byInstrument = [
      {
        instrumentId: 'i1',
        managementNumber: 'M-001',
        name: 'ノギス',
        status: 'AVAILABLE',
        isOutNow: false,
        currentBorrowerDisplayName: null,
        dueAt: null,
        periodBorrowCount: 1,
        periodReturnCount: 1,
        openIsOverdue: false,
      },
      {
        instrumentId: 'i2',
        managementNumber: 'M-002',
        name: 'マイクロメータ',
        status: 'AVAILABLE',
        isOutNow: false,
        currentBorrowerDisplayName: null,
        dueAt: null,
        periodBorrowCount: 1,
        periodReturnCount: 1,
        openIsOverdue: false,
      },
    ];
    const vm = svc.buildViewModel({
      category: 'measuring',
      normalized: { kind: 'measuring', response },
      site: '本社',
      author: 'admin',
    });
    const safetyCoverChip = vm.supply.chips.find((c) => c.k === '安全在庫カバー');
    expect(safetyCoverChip?.v).toBe('4.0日');
    expect(vm.metrics.out).toBe(2);
    expect(vm.metrics.returned).toBe(2);
    expect(vm.metrics.returnRate).toBe(50);
    expect(vm.compliance.score).toBe(50);
    expect(vm.compliance.state).toBe('要改善');
    expect(vm.compliance.chips.find((c) => c.k === '返却/持出')?.v).toBe('2/2');
    expect(vm.findings.body).toContain('スコア 50');
    expect(vm.supply.vitalsSparkPct).toHaveLength(5);
    expect(vm.supply.balanceViz).toEqual({ slackPct: 80, pressurePct: 58 });
  });

  it('sets return/compliance score to 0 when there is no borrow in period', async () => {
    const svc = new LoanReportEvaluationService();
    const response = baseMeasuringResponse();
    response.summary.periodBorrowCount = 0;
    response.summary.periodReturnCount = 7;
    response.summary.openLoanCount = 0;
    response.summary.overdueOpenCount = 0;
    response.byEmployee = [];
    response.byInstrument = [];
    const vm = svc.buildViewModel({
      category: 'measuring',
      normalized: { kind: 'measuring', response },
      site: '本社',
      author: 'admin',
    });
    expect(vm.metrics.returnRate).toBe(0);
    expect(vm.compliance.score).toBe(0);
    expect(vm.compliance.state).toBe('データなし');
    expect(vm.compliance.chips.find((c) => c.k === '期限遵守率')?.v).toBe('N/A');
    expect(vm.findings.overall).toEqual({ text: '判定保留', cls: 'warn' });
    expect(vm.findings.trend).toEqual({ text: 'データなし', cls: 'warn' });
  });

  it('sets monthly compliance to 0 on zero-borrow month', async () => {
    const svc = new LoanReportEvaluationService();
    const response = baseMeasuringResponse();
    response.monthlyTrend = [
      { yearMonth: '2026-02', borrowCount: 0, returnCount: 5 },
      { yearMonth: '2026-03', borrowCount: 10, returnCount: 9 },
    ];
    const vm = svc.buildViewModel({
      category: 'measuring',
      normalized: { kind: 'measuring', response },
      site: '本社',
      author: 'admin',
    });
    expect(vm.trend.compliance[0]).toBe(0);
    expect(vm.trend.compliance[1]).toBe(90);
  });
});
