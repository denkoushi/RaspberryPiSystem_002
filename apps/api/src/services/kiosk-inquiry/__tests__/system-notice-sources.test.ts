import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ device: vi.fn(), deliver: vi.fn(), expire: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { clientDevice: { findFirst: mocks.device } } }));
vi.mock('../system-notice.service.js', async (original) => ({ ...await original<object>(), deliverSystemNotice: mocks.deliver, resolveInactiveFileNotices: mocks.expire }));
import { deliverFileAlertNotice, deliverTelemetryNotice, expireFileAlertNotice } from '../system-notice-sources.js';
import { FILE_NOTICE_EXPIRY_MS } from '../system-notice.service.js';
const now = new Date('2026-10-13T00:00:00Z');
afterEach(() => { vi.unstubAllEnvs(); });
beforeEach(() => {
  vi.stubEnv('CLIENT_HEARTBEAT_CLIENT_ID_PATTERN', '');
  vi.stubEnv('CLIENT_HEARTBEAT_ALERT_ENABLED', 'false');
  vi.resetAllMocks(); mocks.device.mockResolvedValue({ name: '端末', location: 'StoneBase01' });
});
describe('alert notice bridges', () => {
  it.each([
    ['os_security_update_failed', 'OSの安全更新を入れられませんでした。'],
    ['os_security_updates_stale', 'OSの安全更新が2週間以上入っていません。']
  ])('opens and recovers OS notice %s under its own stable key', async (signal, body) => {
    for (const action of ['unhealthy', 'recovery']) {
      await deliverTelemetryNotice('raspi5-server', {
        level: action === 'recovery' ? 'INFO' : 'WARN', message: '',
        context: { category: 'os_update_health', action, signal }
      });
    }
    const key = JSON.stringify(['os_update_health', 'raspi5-server', signal]);
    expect(mocks.deliver).toHaveBeenNthCalledWith(1, { key, title: 'StoneBase01 OS更新', body, state: 'open' });
    expect(mocks.deliver).toHaveBeenNthCalledWith(2, { key, title: 'StoneBase01 OS更新', body, state: 'recovered' });
  });
  it.each(['api_timeout', 'api_network', 'api_5xx'])('uses the matching kiosk notice text for %s', async (kind) => {
    await deliverTelemetryNotice('raspi4-stone', { level: 'ERROR', message: '', context: { category: 'kiosk_ui_error', kind, clientDeviceId: 'device-1' } });
    const screen = kind === 'api_5xx';
    expect(mocks.deliver).toHaveBeenCalledExactlyOnceWith({
      key: JSON.stringify(['kiosk_ui_error', 'raspi4-stone', 'device-1', ...(screen ? [] : ['network'])]), title: `StoneBase01 ${screen ? '画面' : '回線'}`,
      body: screen ? '画面でエラーが続いています。' : '回線が遅い・つながりにくい状態です。画面自体の異常を示す通知ではありません。', state: 'open'
    });
  });
  it.each(['mac-kiosk-1', 'zero2w-home'])('ignores telemetry from %s', async (clientId) => {
    await deliverTelemetryNotice(clientId, { level: 'ERROR', message: '', context: { category: 'storage_health', signal: 'io' } });
    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(mocks.device).not.toHaveBeenCalled();
  });
  it('uses the configured heartbeat client-id pattern', async () => {
    vi.stubEnv('CLIENT_HEARTBEAT_CLIENT_ID_PATTERN', '^custom-');
    await deliverTelemetryNotice('custom-terminal', { level: 'ERROR', message: '', context: { category: 'storage_health', signal: 'io' } });
    expect(mocks.deliver).toHaveBeenCalledOnce();
  });
  it('keeps terminal keys stable across episodes and recovers with Japanese text', async () => {
    for (const action of ['unhealthy', 'recovery']) await deliverTelemetryNotice('raspi4-stone', { level: 'INFO', message: '',
      context: { category: 'terminal_agent_health', agent: 'barcode', signal: 'heartbeat', action, episodeId: action } });
    const [opened, recovered] = mocks.deliver.mock.calls.map(([notice]) => notice);
    expect(opened).toMatchObject({ title: 'StoneBase01 バーコードリーダー', body: 'バーコードリーダーが応答しません。', state: 'open' });
    expect(recovered).toMatchObject({ key: opened.key, state: 'recovered' });
  });
  it('uses terminal plus signal for storage and falls back to device name', async () => {
    mocks.device.mockResolvedValue({ name: '予備端末', location: ' ' });
    await deliverTelemetryNotice('raspi4-stone', { level: 'WARN', message: '', context: { category: 'storage_health', signal: 'io' } });
    expect(mocks.deliver).toHaveBeenCalledWith(expect.objectContaining({ key: '["storage_health","raspi4-stone","io"]', title: '予備端末（raspi4-stone） 保存装置', body: '保存装置の確認が必要です。' }));
  });
  it.each([
    ['root_filesystem_read_only', 'SDカード', 'SDカードに書き込めなくなっています。'],
    ['kernel_storage_error', 'SDカード', 'SDカードで読み書きの失敗が出ています。'],
    ['ext4_errors_recorded', 'SDカード', 'SDカードに異常の記録があります。'],
    ['storage_write_rate_high', 'SDカード', 'SDカードへの書き込みが多くなっています。'],
    ['power_undervoltage_current', '電源', '電源の電圧が下がっています。'],
    ['power_undervoltage_since_boot', '電源', '電源の電圧が下がっています。'],
    ['power_throttled_current', '電源', '電源の電圧が下がっています。'],
    ['root_inode_usage_high', '空き容量', '保存できるファイル数の残りが少なくなっています。']
  ])('uses specific storage text for %s without changing the key', async (signal, subject, body) => {
    await deliverTelemetryNotice('raspi4-stone', { level: 'ERROR', message: '', context: { category: 'storage_health', signal } });
    expect(mocks.deliver).toHaveBeenCalledExactlyOnceWith({
      key: JSON.stringify(['storage_health', 'raspi4-stone', signal]), title: `StoneBase01 ${subject}`, body, state: 'open'
    });
  });
  it('leaves disk usage notices to the periodic evaluator', async () => {
    await deliverTelemetryNotice('raspi4-stone', { level: 'ERROR', message: '',
      context: { category: 'storage_health', signal: 'root_disk_usage_high' } });
    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(mocks.device).not.toHaveBeenCalled();
  });
  it('keeps generic storage text and key when the signal is missing', async () => {
    await deliverTelemetryNotice('raspi4-stone', { level: 'WARN', message: '', context: { category: 'storage_health' } });
    expect(mocks.deliver).toHaveBeenCalledWith({ key: '["storage_health","raspi4-stone","unknown_signal"]',
      title: 'StoneBase01 保存装置', body: '保存装置の確認が必要です。', state: 'open' });
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
    await expect(deliverTelemetryNotice('raspi4-stone', { level: 'WARN', message: '', context: { category: 'storage_health', signal: 'io' } })).resolves.toBeUndefined();
  });
});
