import { describe, expect, it, vi } from 'vitest';
import { GmailImportOrchestrator } from '../gmail-import-orchestrator.js';

describe('GmailImportOrchestrator', () => {
  it('runs only enabled gmail csvDashboards schedules', async () => {
    const executeSchedule = vi.fn().mockResolvedValue(undefined);
    const orchestrator = new GmailImportOrchestrator({ executeSchedule });
    const config = {
      storage: { provider: 'dropbox' },
      csvImports: [
        {
          id: 'gmail-1',
          provider: 'gmail',
          enabled: true,
          schedule: '*/10 * * * *',
          targets: [{ type: 'csvDashboards', source: 'a' }],
        },
        {
          id: 'dropbox-1',
          provider: 'dropbox',
          enabled: true,
          schedule: '*/10 * * * *',
          targets: [{ type: 'employees', source: 'a.csv' }],
        },
      ],
    } as any;

    await orchestrator.runCycle({ config, triggerScheduleId: 'gmail-1', isManual: false });

    expect(executeSchedule).toHaveBeenCalledTimes(1);
    expect(executeSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        importSchedule: expect.objectContaining({ id: 'gmail-1' }),
      })
    );
  });
});

