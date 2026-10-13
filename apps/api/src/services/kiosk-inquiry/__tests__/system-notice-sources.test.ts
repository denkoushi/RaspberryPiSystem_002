import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ device: vi.fn(), deliver: vi.fn(), expire: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { clientDevice: { findFirst: mocks.device } } }));
vi.mock('../system-notice.service.js', async (original) => ({ ...await original<object>(), deliverSystemNotice: mocks.deliver, resolveInactiveFileNotices: mocks.expire }));
import { deliverFileAlertNotice, deliverTelemetryNotice, expireFileAlertNotice } from '../system-notice-sources.js';
import { FILE_NOTICE_EXPIRY_MS } from '../system-notice.service.js';
const now = new Date('2026-10-13T00:00:00Z');
beforeEach(() => { vi.resetAllMocks(); mocks.device.mockResolvedValue({ name: '端末', location: 'StoneBase01' }); });
describe('alert notice bridges', () => {
  it('keeps terminal keys stable across episodes and recovers with Japanese text', async () => {
    for (const action of ['unhealthy', 'recovery']) await deliverTelemetryNotice('stone', { level: 'INFO', message: '',
      context: { category: 'terminal_agent_health', agent: 'barcode', signal: 'heartbeat', action, episodeId: action } });
    const [opened, recovered] = mocks.deliver.mock.calls.map(([notice]) => notice);
    expect(opened).toMatchObject({ title: 'StoneBase01 バーコードリーダー', body: 'バーコードリーダーが応答しません。', state: 'open' });
    expect(recovered).toMatchObject({ key: opened.key, state: 'recovered' });
  });
  it('uses terminal plus signal for storage and falls back to device name', async () => {
    mocks.device.mockResolvedValue({ name: '予備端末', location: ' ' });
    await deliverTelemetryNotice('stone', { level: 'WARN', message: '', context: { category: 'storage_health', signal: 'io' } });
    expect(mocks.deliver).toHaveBeenCalledWith(expect.objectContaining({ key: '["storage_health","stone","io"]', title: '予備端末 保存装置' }));
  });
  it('ignores old files and uses event time, so repeated polling is not recurrence', async () => {
    await deliverFileAlertNotice('rkhunter-warning', new Date(now.getTime() - FILE_NOTICE_EXPIRY_MS), now);
    expect(mocks.deliver).not.toHaveBeenCalled();
    const timestamp = new Date(now.getTime() - 1000);
    await deliverFileAlertNotice('rkhunter-warning', timestamp, now);
    expect(mocks.deliver).toHaveBeenCalledWith(expect.objectContaining({ key: 'file:rkhunter-warning' }), timestamp);
  });
  it('checks the previous file occurrence at event time before storage', async () => {
    await expireFileAlertNotice('rkhunter-warning', now);
    expect(mocks.expire).toHaveBeenCalledWith(now, 'rkhunter-warning');
    mocks.expire.mockRejectedValue(new Error('unavailable'));
    await expect(expireFileAlertNotice('rkhunter-warning', now)).resolves.toBeUndefined();
  });
  it('catches delivery failures for both alert sources', async () => {
    mocks.deliver.mockRejectedValue(new Error('unavailable'));
    await expect(deliverFileAlertNotice('rkhunter-warning', now, now)).resolves.toBeUndefined();
    await expect(deliverTelemetryNotice('stone', { level: 'WARN', message: '', context: { category: 'storage_health', signal: 'io' } })).resolves.toBeUndefined();
  });
});
