import { useEffect, useState } from 'react';

import { useKioskInquirySummary } from '../../../api/hooks/kiosk';

import { KioskInquiryInbox } from './KioskInquiryInbox';

export function useKioskInquiryEntry(clientKey: string | undefined, pathname: string, open: boolean) {
  const enabled = !!clientKey && pathname.startsWith('/kiosk');
  const summary = useKioskInquirySummary(clientKey, enabled);
  const [selected, setSelected] = useState(false);
  const active = enabled && open && selected;
  const unreadCount = enabled ? summary.data?.unreadCount ?? 0 : 0;
  useEffect(() => { setSelected(false); }, [clientKey, enabled]);
  useEffect(() => { if (!open) setSelected(false); }, [open]);
  return {
    enabled, active, unreadCount,
    select: () => setSelected(true),
    leave: () => setSelected(false),
    onTrigger: () => { if (!open) setSelected(unreadCount > 0); },
    content: active && clientKey ? summary.data ? (
      <KioskInquiryInbox key={`${clientKey}:${summary.data.isReceiver}`} clientKey={clientKey} isReceiver={summary.data.isReceiver} />
    ) : <p className="kiosk-inquiry__empty" role={summary.isError ? 'alert' : 'status'}>
      {summary.isError ? 'お問い合わせを取得できません' : '読込中…'}
    </p> : undefined
  };
}
