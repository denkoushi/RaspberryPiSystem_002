import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LoanReportGmailSendService } from '../loan-report-gmail-send.service.js';
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
    key: 'rigging',
    category: '吊具',
    accent: '#3b82f6',
    pageLabel: '単票レポート — 吊具',
    reportId: 'RPT-SEND-1',
    meta: 'meta',
    metrics: { assets: 1, out: 0, returned: 0, open: 0, overdue: 0, returnRate: 0 },
    supply: {
      score: 50,
      state: '適正',
      tagClass: 'tag-ok',
      vitalsSparkPct: [10, 20, 30, 40, 50],
      balanceViz: { slackPct: 50, pressurePct: 45 },
      chips: [],
      groupTimeseries: null,
      bottleneckTop2: [],
    },
    compliance: { score: 90, state: '良好', tagClass: 'tag-ok', chips: [] },
    itemAxis: [],
    personAxis: [],
    cross: { x: [], y: [], values: [] },
    trend: { demand: [], compliance: [], labels: [] },
    findings: {
      overall: { text: 'a', cls: 'good' },
      trend: { text: 'b', cls: 'good' },
      body: 'c',
    },
  };
}

describe('LoanReportGmailSendService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadBackupConfigMock.mockResolvedValue({ storage: { provider: 'gmail', options: {} } });
  });

  it('sends a message via Gmail client', async () => {
    const sendMessageFromRawMime = vi.fn().mockResolvedValue({ id: 'msg-sent-1' });
    resolveGmailClientMock.mockResolvedValue({ sendMessageFromRawMime, createDraftFromRawMime: vi.fn() });

    const service = new LoanReportGmailSendService();
    const result = await service.sendMessage({
      reportModel: createReportModel(),
      htmlDocument: '<html><body>x</body></html>',
      subject: '件名',
      to: 'user@example.com',
    });

    expect(result).toEqual({ messageId: 'msg-sent-1' });
    expect(sendMessageFromRawMime).toHaveBeenCalledTimes(1);
    const raw = sendMessageFromRawMime.mock.calls[0][0] as string;
    expect(raw).toContain('user@example.com');
    expect(raw).toContain('loan-report_rigging_RPT-SEND-1.html');
  });

  it('maps insufficient scope errors to ApiError', async () => {
    resolveGmailClientMock.mockResolvedValue({
      sendMessageFromRawMime: vi.fn().mockRejectedValue(new Error('403 insufficient authentication scopes')),
    });

    const service = new LoanReportGmailSendService();

    await expect(
      service.sendMessage({
        reportModel: createReportModel(),
        htmlDocument: '<html><body>x</body></html>',
        subject: '件名',
        to: 'user@example.com',
      })
    ).rejects.toMatchObject({
      name: 'ApiError',
      statusCode: 400,
      code: 'GMAIL_SCOPE_INSUFFICIENT',
    });
  });
});
