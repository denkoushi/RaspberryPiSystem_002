import { describe, expect, it } from 'vitest';
import { CsvDashboardImportService } from '../csv-dashboard-import.service.js';

describe('CsvDashboardImportService ingest audit message', () => {
  it('audit 行を重複させずに最新状態へ更新する', () => {
    const merged1 = (CsvDashboardImportService as any).mergeAuditMessage({
      currentErrorMessage: null,
      postProcessState: 'failed',
      reason: 'parse error',
    });
    expect(merged1).toContain('[ingest-audit] postProcessState=failed reason=parse error');

    const merged2 = (CsvDashboardImportService as any).mergeAuditMessage({
      currentErrorMessage: `${merged1}\nother-line`,
      postProcessState: 'disposed_non_retriable',
      reason: 'header mismatch',
    });

    const lines = merged2.split('\n');
    expect(lines.filter((line: string) => line.startsWith('[ingest-audit]')).length).toBe(1);
    expect(merged2).toContain('other-line');
    expect(merged2).toContain('postProcessState=disposed_non_retriable');
  });
});

