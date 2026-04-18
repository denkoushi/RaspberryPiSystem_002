import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LoanReportGmailDraftService } from '../loan-report-gmail-draft.service.js';
import type { LoanReportViewModel } from '../loan-report.types.js';

const { loadBackupConfigMock, resolveGmailClientMock } = vi.hoisted(() => ({
  loadBackupConfigMock: vi.fn(),
  resolveGmailClientMock: vi.fn(),
}));

vi.mock('../../../backup/backup-config.loader.js', () => ({
  BackupConfigLoader: {
    load: loadBackupConfigMock,
  },
}));

vi.mock('../../../gmail/gmail-api-client.factory.js', () => ({
  resolveGmailApiClientFromBackupConfig: resolveGmailClientMock,
}));

function createReportModel(): LoanReportViewModel {
  return {
    key: 'measuring',
    category: '計測機器',
    accent: '#3b82f6',
    pageLabel: '単票レポート — 計測機器',
    reportId: 'RPT-20260418-120000',
    meta: '2026-04-01 ～ 2026-04-18 / 本社 / 作成: admin / 2026-04-18 12:00:00',
    metrics: { assets: 10, out: 5, returned: 4, open: 1, overdue: 0, returnRate: 80 },
    supply: {
      score: 48,
      state: '適正',
      tagClass: 'tag-ok',
      chips: [],
    },
    compliance: {
      score: 92,
      state: '良好',
      tagClass: 'tag-ok',
      chips: [],
    },
    itemAxis: [],
    personAxis: [],
    cross: { x: [], y: [], values: [] },
    trend: { demand: [10], compliance: [92], labels: ['2026/04'] },
    findings: {
      overall: { text: '需給は余力あり', cls: 'good' },
      trend: { text: '横ばい〜改善', cls: 'good' },
      body: '本文',
    },
  };
}

describe('LoanReportGmailDraftService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadBackupConfigMock.mockResolvedValue({ storage: { provider: 'gmail', options: {} } });
  });

  it('creates a Gmail draft via the configured Gmail client', async () => {
    const createDraftFromRawMime = vi.fn().mockResolvedValue({ id: 'draft-1', messageId: 'msg-1' });
    resolveGmailClientMock.mockResolvedValue({ createDraftFromRawMime });

    const service = new LoanReportGmailDraftService();
    const result = await service.createDraft({
      reportModel: createReportModel(),
      htmlDocument: '<html><body>preview</body></html>',
      subject: '【貸出レポート】計測機器',
      to: 'manager@example.com',
    });

    expect(result).toEqual({ draftId: 'draft-1', messageId: 'msg-1' });
    expect(createDraftFromRawMime).toHaveBeenCalledTimes(1);
    expect(createDraftFromRawMime.mock.calls[0][0]).toContain('manager@example.com');
    expect(createDraftFromRawMime.mock.calls[0][0]).toContain('loan-report_measuring_RPT-20260418-120000.html');
  });

  it('maps insufficient scope errors to ApiError', async () => {
    resolveGmailClientMock.mockResolvedValue({
      createDraftFromRawMime: vi.fn().mockRejectedValue(new Error('403 insufficient authentication scopes')),
    });

    const service = new LoanReportGmailDraftService();

    await expect(
      service.createDraft({
        reportModel: createReportModel(),
        htmlDocument: '<html><body>preview</body></html>',
        subject: '【貸出レポート】計測機器',
      })
    ).rejects.toMatchObject({
      name: 'ApiError',
      statusCode: 400,
      code: 'GMAIL_SCOPE_INSUFFICIENT',
    });
  });
});
