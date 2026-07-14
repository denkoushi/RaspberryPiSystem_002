import { useCallback, useEffect, useRef, useState } from 'react';

import {
  DEPLOY_PRE_NOTICE_MESSAGE,
  formatDeployNoticeCountdown,
  remainingDeployNoticeSeconds
} from '../../features/kiosk/deployPreNotice';
import {
  clampDeployPreNoticeOffset,
  isDeployPreNoticeKeyboardTargetInteractive,
  isDeployPreNoticeMoveKey,
  moveDeployPreNoticeOffset,
  type DeployPreNoticeOffset
} from '../../features/kiosk/deployPreNoticePosition';

interface KioskDeployPreNoticeProps {
  runId?: string;
  scheduledAt?: string;
}

/** A persistent, non-blocking warning shown before kiosk maintenance begins. */
export function KioskDeployPreNotice({ runId, scheduledAt }: KioskDeployPreNoticeProps) {
  const [now, setNow] = useState(() => Date.now());
  const [offset, setOffset] = useState<DeployPreNoticeOffset>({ x: 0, y: 0 });
  const cardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [scheduledAt]);

  useEffect(() => {
    setOffset({ x: 0, y: 0 });
  }, [runId]);

  const clampToViewport = useCallback((next: DeployPreNoticeOffset) => {
    const rect = cardRef.current?.getBoundingClientRect();
    return clampDeployPreNoticeOffset(
      next,
      window.innerWidth,
      window.innerHeight,
      rect?.width ?? 0,
      rect?.height ?? 0
    );
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !isDeployPreNoticeMoveKey(event.key) ||
        isDeployPreNoticeKeyboardTargetInteractive(event.target)
      ) {
        return;
      }
      const direction = event.key;
      event.preventDefault();
      setOffset((current) => clampToViewport(moveDeployPreNoticeOffset(current, direction)));
    };
    const handleResize = () => setOffset((current) => clampToViewport(current));
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [clampToViewport]);

  const remainingSeconds = remainingDeployNoticeSeconds(scheduledAt, now);

  return (
    <section
      ref={cardRef}
      className="pointer-events-none fixed left-1/2 top-1/2 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-lg border-2 border-amber-300 bg-amber-950/95 px-5 py-4 text-center text-white shadow-2xl"
      style={{ transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)` }}
      role="status"
      aria-live="polite"
      data-testid="kiosk-deploy-pre-notice"
    >
      <p className="text-xl font-bold">更新のお知らせ</p>
      <p className="mt-1 text-base text-amber-50">{DEPLOY_PRE_NOTICE_MESSAGE}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-amber-200">
        {formatDeployNoticeCountdown(remainingSeconds)}
      </p>
    </section>
  );
}
