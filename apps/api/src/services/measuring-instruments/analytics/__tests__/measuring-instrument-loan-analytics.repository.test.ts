import { describe, expect, it } from 'vitest';
import {
  dedupeUnifiedEvents,
  MeasuringInstrumentLoanAnalyticsRepository,
  normalizeEmployeeName,
} from '../measuring-instrument-loan-analytics.repository.js';

describe('measuring-instrument-loan-analytics.repository helpers', () => {
  it('氏名正規化でスペース差分と大文字小文字を吸収する', () => {
    expect(normalizeEmployeeName('  山田　太郎  ')).toBe('山田 太郎');
    expect(normalizeEmployeeName('YAMADA TARO')).toBe('yamada taro');
  });

  it('5分窓で同一イベントを統合し、NFCを優先する', () => {
    const result = dedupeUnifiedEvents([
      {
        managementNumber: 'MI-001',
        action: '持ち出し',
        eventAt: new Date('2026-04-10T01:00:00.000Z'),
        source: 'csv',
        borrowerName: '山田太郎',
        instrumentName: 'ノギス',
        expectedReturnAt: null,
      },
      {
        managementNumber: 'MI-001',
        action: '持ち出し',
        eventAt: new Date('2026-04-10T01:02:00.000Z'),
        source: 'nfc',
        borrowerName: '山田 太郎',
        instrumentName: 'ノギス',
        expectedReturnAt: null,
      },
      {
        managementNumber: 'MI-001',
        action: '返却',
        eventAt: new Date('2026-04-10T03:00:00.000Z'),
        source: 'csv',
        borrowerName: '山田太郎',
        instrumentName: 'ノギス',
        expectedReturnAt: null,
      },
    ]);

    expect(result).toHaveLength(2);
    const borrow = result.find((event) => event.action === '持ち出し');
    expect(borrow?.source).toBe('nfc');
    expect(borrow?.eventAt.toISOString()).toBe('2026-04-10T01:02:00.000Z');
  });

  it('5分を超える同種イベントは別イベントとして保持する', () => {
    const result = dedupeUnifiedEvents([
      {
        managementNumber: 'MI-002',
        action: '持ち出し',
        eventAt: new Date('2026-04-10T01:00:00.000Z'),
        source: 'nfc',
        borrowerName: '佐藤花子',
        instrumentName: 'マイクロメータ',
        expectedReturnAt: null,
      },
      {
        managementNumber: 'MI-002',
        action: '持ち出し',
        eventAt: new Date('2026-04-10T01:10:00.000Z'),
        source: 'csv',
        borrowerName: '佐藤花子',
        instrumentName: 'マイクロメータ',
        expectedReturnAt: null,
      },
    ]);

    expect(result).toHaveLength(2);
  });

  it('集計期間より前の持ち出しでも未返却なら現在貸出中として残る', async () => {
    const repository = new MeasuringInstrumentLoanAnalyticsRepository({
      measuringInstrumentLoanEvent: {
        findMany: async () => [
          {
            managementNumber: 'MI-010',
            eventAt: new Date('2026-03-01T00:00:00.000Z'),
            action: '持ち出し',
            raw: {
              borrower: '山田太郎',
              name: 'デプスゲージ',
              expectedReturnAt: '2026-04-15T00:00:00.000Z',
              loanId: 'loan-1',
            },
            sourceCsvDashboardId: null,
          },
        ],
      },
      measuringInstrument: {
        findMany: async () => [
          {
            id: 'inst-1',
            managementNumber: 'MI-010',
            name: 'デプスゲージ',
            status: 'IN_USE',
          },
        ],
      },
      employee: {
        findMany: async () => [
          {
            id: 'emp-1',
            displayName: '山田太郎',
            employeeCode: 'E001',
          },
        ],
      },
      loan: {
        findMany: async () => [],
      },
    } as never);

    const result = await repository.loadAggregate({
      periodFrom: new Date('2026-04-01T00:00:00.000Z'),
      periodTo: new Date('2026-04-30T23:59:59.999Z'),
      monthlyMonths: 6,
      timeZone: 'Asia/Tokyo',
      now: new Date('2026-04-14T00:00:00.000Z'),
    });

    expect(result.openLoanCount).toBe(1);
    expect(result.instrumentRows[0]?.open?.borrowerName).toBe('山田太郎');
  });
});
