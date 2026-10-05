import { describe, expect, it, vi } from 'vitest';

import { defaultBackupConfig } from '../../backup/backup-config.js';
import { CsvImportExecutionService } from '../csv-import-execution.service.js';
import { ImportScheduleAdminService } from '../import-schedule-admin.service.js';
import { ensureProductionScheduleCsvImportSchedules } from '../fkojunst-import-schedule.ensure.js';
import { ensureProcedureMaterialGmailCsvImportSchedule } from '../procedure-material-import-schedule.policy.js';
import { resolveSystemCsvImportDefaultBuilder } from '../system-csv-import-schedule-builtin-rows.js';

describe('procedure-material builtin schedule', () => {
  it('ensures a disabled five-minute row once and preserves existing schedules/settings', () => {
    const first = ensureProcedureMaterialGmailCsvImportSchedule(defaultBackupConfig);
    const row = first.config.csvImports?.find((r) => r.id === 'procedure-material-gmail');
    expect(row).toMatchObject({ enabled: false, provider: 'gmail', schedule: '*/5 * * * *', targets: [{ type: 'procedureMaterialGmail', source: '[Procedure-material]' }] });
    expect(ensureProcedureMaterialGmailCsvImportSchedule(first.config)).toEqual({ config: first.config, repaired: false });
    expect(resolveSystemCsvImportDefaultBuilder('procedure-material-gmail')?.()).toEqual(row);
    expect(ensureProductionScheduleCsvImportSchedules(defaultBackupConfig).config.csvImports?.some((r) => r.id === 'procedure-material-gmail')).toBe(true);
  });
  it('carries the enabled setting and sender into the new builtin row', () => {
    const config = { ...defaultBackupConfig, procedureMaterialGmailIngest: { enabled: true, subjectTokens: ['[Procedure-material]'], fromEmail: 'sender@example.com' } };
    expect(ensureProcedureMaterialGmailCsvImportSchedule(config).config.csvImports?.find((row) => row.id === 'procedure-material-gmail')).toMatchObject({ enabled: true, metadata: { procedureMaterialFromEmail: 'sender@example.com' } });
  });
  it.each([false, true])('reloads the scheduler when toggling the material row from %s without overwriting other schedules/settings', async (enabled) => {
    const ensured = ensureProductionScheduleCsvImportSchedules(defaultBackupConfig).config;
    const config = { ...ensured, csvImports: ensured.csvImports!.map((row) => row.id === 'procedure-material-gmail' ? { ...row, enabled } : row),
      procedureMaterialGmailIngest: { enabled: false, subjectTokens: ['[Procedure-material]'], fromEmail: 'sender@example.com' } };
    const unrelated = config.csvImports!.filter((row) => row.id !== 'procedure-material-gmail');
    const store = { load: vi.fn().mockResolvedValue(config), save: vi.fn().mockResolvedValue(undefined) };
    const scheduler = { reload: vi.fn().mockResolvedValue(undefined), runImport: vi.fn() };
    const service = new ImportScheduleAdminService(store, () => scheduler);
    const result = await service.updateSchedule('procedure-material-gmail', { enabled: !enabled });
    expect(result.schedule.enabled).toBe(!enabled);
    expect(store.save).toHaveBeenCalledOnce();
    expect(scheduler.reload).toHaveBeenCalledOnce();
    expect(store.save.mock.invocationCallOrder[0]).toBeLessThan(scheduler.reload.mock.invocationCallOrder[0]!);
    expect(config.csvImports!.filter((row) => row.id !== 'procedure-material-gmail')).toEqual(unrelated);
    expect(config.procedureMaterialGmailIngest.fromEmail).toBe('sender@example.com');
  });
  it('routes builtin execution directly to material ingestion without parsing CSV or creating a provider', async () => {
    const createFromConfig = vi.fn(); const processCsvImportFromTargets = vi.fn();
    const runOnce = vi.fn().mockResolvedValue({ saved: 2, processed: 1, messages: [] });
    const service = new CsvImportExecutionService({
      storageProviderFactory: { createFromConfig }, configStore: { load: vi.fn(), save: vi.fn() },
      createProcedureMaterialGmailIngestionService: () => ({ runOnce }), processCsvImportFromTargets,
    });
    const row = resolveSystemCsvImportDefaultBuilder('procedure-material-gmail')!();
    const summary = await service.execute({ config: defaultBackupConfig, importSchedule: { ...row, enabled: true }, skipRetry: true });
    expect(summary.procedureMaterialGmail).toEqual({ saved: 2, processed: 1, messages: [] });
    expect(runOnce).toHaveBeenCalledWith(expect.objectContaining({ manual: true, allowWait: true, config: expect.objectContaining({ procedureMaterialGmailIngest: { enabled: true, subjectTokens: ['[Procedure-material]'], fromEmail: undefined } }) }));
    expect(createFromConfig).not.toHaveBeenCalled(); expect(processCsvImportFromTargets).not.toHaveBeenCalled();
  });
});
