import { useEffect, useState } from 'react';

import {
  DEPLOY_PRE_NOTICE_MESSAGE,
  formatDeployNoticeCountdown,
  remainingDeployNoticeSeconds
} from '../../features/kiosk/deployPreNotice';

interface KioskDeployPreNoticeProps {
  scheduledAt?: string;
}

/** A persistent, non-blocking warning shown before kiosk maintenance begins. */
export function KioskDeployPreNotice({ scheduledAt }: KioskDeployPreNoticeProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [scheduledAt]);

  const remainingSeconds = remainingDeployNoticeSeconds(scheduledAt, now);

  return (
    <section
      className="pointer-events-none fixed inset-x-0 top-0 z-50 border-b-4 border-amber-300 bg-amber-950/95 px-6 py-4 text-center text-white shadow-xl"
      role="status"
      aria-live="polite"
      data-testid="kiosk-deploy-pre-notice"
    >
      <p className="text-2xl font-bold">更新のお知らせ</p>
      <p className="mt-1 text-lg text-amber-50">{DEPLOY_PRE_NOTICE_MESSAGE}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-amber-200">
        {formatDeployNoticeCountdown(remainingSeconds)}
      </p>
    </section>
  );
}
