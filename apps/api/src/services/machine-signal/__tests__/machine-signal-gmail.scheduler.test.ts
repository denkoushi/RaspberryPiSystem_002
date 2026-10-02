import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ loadConfig: vi.fn(), runOnce: vi.fn() }));

vi.mock('../../backup/backup-config.loader.js', () => ({ BackupConfigLoader: { load: mocks.loadConfig } }));

import { MachineSignalGmailScheduler } from '../machine-signal-gmail.scheduler.js';

const gmail = { storage: { provider: 'gmail', options: { gmail: { clientId: 'id', refreshToken: 'token' } } } };

describe('MachineSignalGmailScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runOnce.mockResolvedValue({ scanned: 0, processed: 0, skipped: 0, runs: [] });
  });
  const scheduler = () => new MachineSignalGmailScheduler({ runOnce: mocks.runOnce } as never);

  it('checks the mail on schedule without waiting for the Gmail quota', async () => {
    const config = { ...gmail, csvImports: [] };
    mocks.loadConfig.mockResolvedValue(config);
    await scheduler().runScheduled();
    expect(mocks.runOnce).toHaveBeenCalledWith({ config, allowWait: false });
  });

  it('stands down when the CSV import list has a machine signal row, even a disabled one', async () => {
    mocks.loadConfig.mockResolvedValue({
      ...gmail,
      csvImports: [
        { id: 'any', schedule: '17 6 * * *', enabled: false, targets: [{ type: 'machineSignalGmail', source: 'AirGridFlexSignal' }] },
      ],
    });
    await scheduler().runScheduled();
    expect(mocks.runOnce).not.toHaveBeenCalled();
  });

  it('does nothing where Gmail is not connected', async () => {
    mocks.loadConfig.mockResolvedValue({ storage: { provider: 'local', options: {} }, csvImports: [] });
    await scheduler().runScheduled();
    expect(mocks.runOnce).not.toHaveBeenCalled();
  });
});
