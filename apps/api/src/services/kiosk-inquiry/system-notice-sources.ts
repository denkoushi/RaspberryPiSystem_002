import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { isMonitoredClient, loadHeartbeatAlertConfig } from '../clients/client-heartbeat-alert-policy.js';
import { isKioskNetworkError, type ClientTelemetryLogEntry } from '../clients/client-telemetry-alert-policy.js';

import { deliverSystemNotice, resolveInactiveFileNotices, FILE_NOTICE_EXPIRY_MS, FILE_NOTICE_PREFIX } from './system-notice.service.js';

const storageNoticeText: Record<string, { subject: string; body: string }> = {
  root_filesystem_read_only: { subject: 'SDカード', body: 'SDカードに書き込めなくなっています。' },
  kernel_storage_error: { subject: 'SDカード', body: 'SDカードで読み書きの失敗が出ています。' },
  ext4_errors_recorded: { subject: 'SDカード', body: 'SDカードに異常の記録があります。' },
  storage_write_rate_high: { subject: 'SDカード', body: 'SDカードへの書き込みが多くなっています。' },
  power_undervoltage_current: { subject: '電源', body: '電源の電圧が下がっています。' },
  power_undervoltage_since_boot: { subject: '電源', body: '電源の電圧が下がっています。' },
  power_throttled_current: { subject: '電源', body: '電源の電圧が下がっています。' },
  root_inode_usage_high: { subject: '空き容量', body: '保存できるファイル数の残りが少なくなっています。' }
};

export async function terminalNoticeLabel(clientId: string): Promise<string> {
  const device = await prisma.clientDevice.findFirst({
    where: { statusClientId: clientId }, orderBy: { id: 'asc' }, select: { location: true, name: true }
  });
  // A bare registered name such as "Mac" does not tell staff which machine it is.
  return device?.location?.trim() || (device?.name ? `${device.name}（${clientId}）` : clientId);
}

// Called only for stored alerts (or sanitized terminal recovery events), not a second alert policy.
export async function deliverTelemetryNotice(clientId: string, entry: ClientTelemetryLogEntry): Promise<void> {
  try {
    if (!isMonitoredClient(clientId, loadHeartbeatAlertConfig())) return;
    const context = entry.context;
    if (!context) return;
    const category = context.category;
    const network = category === 'kiosk_ui_error' && isKioskNetworkError(context.kind);
    if (!['terminal_agent_health', 'storage_health', 'kiosk_ui_error'].includes(String(category))) return;
    // Disk usage already has a periodic notice with recovery handling.
    if (category === 'storage_health' && context.signal === 'root_disk_usage_high') return;
    const storageText = storageNoticeText[String(context.signal)];
    const label = await terminalNoticeLabel(clientId);
    const agentNames: Record<string, string> = { barcode: 'バーコードリーダー', nfc: '社員証リーダー', torque: 'トルク測定器' };
    const subject = category === 'terminal_agent_health' ? agentNames[String(context.agent)] ?? '周辺機器'
      : category === 'storage_health' ? storageText?.subject ?? '保存装置' : network ? '回線' : '画面';
    const key = JSON.stringify([category, clientId, ...(category === 'terminal_agent_health' ? [context.agent] : []),
      category === 'kiosk_ui_error' ? context.clientDeviceId ?? clientId : context.signal ?? 'unknown_signal', ...(network ? ['network'] : [])]);
    await deliverSystemNotice({
      key, title: `${label} ${subject}`,
      body: category === 'terminal_agent_health' ? (context.signal === 'queue' ? `${subject}の送信が滞っています。` : `${subject}が応答しません。`)
        : category === 'storage_health' ? storageText?.body ?? '保存装置の確認が必要です。'
          : network ? '回線が遅い・つながりにくい状態です。画面自体の異常を示す通知ではありません。' : '画面でエラーが続いています。',
      state: category === 'terminal_agent_health' && context.action === 'recovery' ? 'recovered' : 'open'
    });
  } catch (err) {
    logger.warn({ err, clientId }, '[SystemNotice] Telemetry notice failed');
  }
}

// Check the persisted previous occurrence before upsert, including after a long API outage.
export async function expireFileAlertNotice(type: string | undefined, timestamp: Date): Promise<void> {
  if (!type?.trim()) return;
  try {
    await resolveInactiveFileNotices(timestamp, type);
  } catch (err) {
    logger.warn({ err, type }, '[SystemNotice] File notice expiry failed');
  }
}

export async function deliverFileAlertNotice(type: string | undefined, timestamp: Date, now = new Date()): Promise<void> {
  if (!type?.trim() || now.getTime() - timestamp.getTime() >= FILE_NOTICE_EXPIRY_MS) return;
  try {
    await deliverSystemNotice({ key: `${FILE_NOTICE_PREFIX}${type}`, state: 'open',
      title: type === 'rkhunter-warning' ? 'システムの安全確認' : 'システムの確認',
      body: type === 'rkhunter-warning' ? '安全確認で注意事項が見つかりました。' : 'システムの確認が必要です。'
    }, timestamp);
  } catch (err) {
    logger.warn({ err, type }, '[SystemNotice] File alert notice failed');
  }
}
