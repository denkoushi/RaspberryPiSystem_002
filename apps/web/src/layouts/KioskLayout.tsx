import { DEFAULT_KIOSK_HEADER_TAB_ORDER, normalizeKioskHeaderTabOrder } from '@raspi-system/shared-types';
import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { getResolvedClientKey, setClientKeyHeader } from '../api/client';
import { acknowledgeDeployStatus } from '../api/domains/system';
import { useDeployStatus, useKioskCallTargets, useKioskConfig } from '../api/hooks';
import { KioskDeployPreNotice } from '../components/kiosk/KioskDeployPreNotice';
import { KioskHeader } from '../components/kiosk/KioskHeader';
import { KioskMaintenanceScreen } from '../components/kiosk/KioskMaintenanceScreen';
import { KioskSupportModal } from '../components/kiosk/KioskSupportModal';
import { KioskRedirect } from '../components/KioskRedirect';
import { readProductionBuildConfig } from '../config/productionBuildConfig';
import {
  VIEWPORT_HEIGHT_FULL,
  VIEWPORT_MIN_HEIGHT_FULL
} from '../constants/viewportLayout';
import { KIOSK_ASSEMBLY_MANUALS_PATH, KIOSK_ASSEMBLY_MANUALS_WORKSHOP_PATH } from '../features/assembly/assemblyRoutes';
import { InventoryNfcRouter } from '../features/kiosk/InventoryNfcRouter';
import {
  KIOSK_IMMERSIVE_HEADER_BORDER_CLASS,
  KIOSK_IMMERSIVE_HEADER_FIXED_CLASS,
  KIOSK_IMMERSIVE_HEADER_HIDDEN_TRANSFORM_CLASS,
  KIOSK_IMMERSIVE_HEADER_HOT_ZONE_CLASS,
  KIOSK_IMMERSIVE_HEADER_VISIBLE_TRANSFORM_CLASS
} from '../features/kiosk/kioskImmersiveHeaderChrome';
import { usesKioskImmersiveLayout } from '../features/kiosk/kioskImmersiveLayoutPolicy';
import { resolveKioskReadyChallenge } from '../features/kiosk/kioskReleaseIdentity';
import {
  advanceKioskWebActivation,
  kioskWebNavigation
} from '../features/kiosk/kioskWebActivation';
import {
  proveNfcRuntimeReady,
  resolveNfcRuntimeContract
} from '../features/nfc/nfcRuntimeContract';
import { useKioskBottomRightHeaderReveal } from '../hooks/useKioskBottomRightHeaderReveal';

import type { TimedHoverRevealCloseReason } from '../hooks/useTimedHoverReveal';

export function KioskLayout() {
  const clientKey = getResolvedClientKey();
  const callTargetsQuery = useKioskCallTargets();
  const selfClientId = callTargetsQuery.data?.selfClientId ?? '';
  const { data: kioskConfig } = useKioskConfig();
  const { data: deployStatus } = useDeployStatus();
  const deployRunId = deployStatus?.runId;
  const deployIsMaintenance = deployStatus?.isMaintenance === true;
  const deployPhase = deployStatus?.phase;
  const deployDesiredReleaseSha = deployStatus?.desiredReleaseSha;
  const deployVerificationId = deployStatus?.verificationId;
  const location = useLocation();
  const [showSupportModal, setShowSupportModal] = useState(false);
  const acknowledgedRunIdRef = useRef<Record<'notice' | 'maintenance', string | null>>({
    notice: null,
    maintenance: null
  });
  const acknowledgedReadyRef = useRef<string | null>(null);
  const [noticeScheduledAt, setNoticeScheduledAt] = useState<{ runId: string; scheduledAt: string } | null>(null);
  const immersiveKioskLayout = usesKioskImmersiveLayout(location.pathname);
  const planningBoardRoute = location.pathname.replace(/\/$/, '') === '/kiosk/production-schedule/planning-board';
  const headerRef = useRef<HTMLElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  // キーボードでドック内を操作している間は、マウスが離れても自動では閉じない。
  const canCloseDock = useCallback((reason: TimedHoverRevealCloseReason = 'manual') => !showSupportModal &&
    !headerRef.current?.querySelector('[data-kiosk-dock-overlay="true"]') &&
    !(reason === 'timer' && headerRef.current?.querySelector(':focus-visible')), [showSupportModal]);
  const headerReveal = useKioskBottomRightHeaderReveal(true, canCloseDock);
  const closeDock = headerReveal.close;

  useEffect(() => {
    if (!headerReveal.isVisible) return;
    const dismissDock = (returnFocus = false) => {
      if (!canCloseDock()) return;
      const restoreFocus = returnFocus && headerRef.current?.contains(document.activeElement);
      closeDock();
      if (restoreFocus) requestAnimationFrame(() => handleRef.current?.focus());
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissDock(true);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node &&
        !headerRef.current?.contains(event.target) && !handleRef.current?.contains(event.target)) dismissDock();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [headerReveal.isVisible, closeDock, canCloseDock]);
  const navTabOrder = normalizeKioskHeaderTabOrder(
    kioskConfig?.navTabOrder ?? DEFAULT_KIOSK_HEADER_TAB_ORDER
  );

  // client-key が空になってもデフォルトを自動で復元する
  useEffect(() => {
    setClientKeyHeader(getResolvedClientKey());
  }, []);

  // 直近のキオスクパスを記録し、/kiosk リロード時に復元できるようにする
  useEffect(() => {
    const path = location.pathname.replace(/\/$/, '');
    if (path.startsWith('/kiosk') && path !== '/kiosk') {
      sessionStorage.setItem('kiosk-last-path', path);
    }
  }, [location.pathname]);

  useEffect(() => {
    const runId = deployStatus?.isMaintenance ? deployStatus.runId : undefined;
    if (!runId || acknowledgedRunIdRef.current.maintenance === runId) return;
    acknowledgedRunIdRef.current.maintenance = runId;
    void acknowledgeDeployStatus(runId, 'maintenance').catch(() => {
      acknowledgedRunIdRef.current.maintenance = null;
    });
  }, [deployStatus?.isMaintenance, deployStatus?.runId]);

  useEffect(() => {
    const runId = deployStatus?.preNotice ? deployStatus.runId : undefined;
    if (!runId || acknowledgedRunIdRef.current.notice === runId) return;
    acknowledgedRunIdRef.current.notice = runId;
    void acknowledgeDeployStatus(runId, 'notice')
      .then((acknowledgement) => {
        if (acknowledgement.scheduledAt) {
          setNoticeScheduledAt({ runId, scheduledAt: acknowledgement.scheduledAt });
        }
      })
      .catch(() => {
        acknowledgedRunIdRef.current.notice = null;
      });
  }, [deployStatus?.preNotice, deployStatus?.runId]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const advance = () => {
      if (cancelled) return;
      let storage: Storage;
      try {
        storage = window.sessionStorage;
      } catch {
        // A stale bundle without bounded retry storage must not navigate or
        // manufacture evidence. The exact-SHA ready check remains separate.
        return;
      }
      const decision = advanceKioskWebActivation({
        status: {
          isMaintenance: deployIsMaintenance,
          phase: deployPhase,
          desiredReleaseSha: deployDesiredReleaseSha,
          verificationId: deployVerificationId
        },
        runId: deployRunId,
        compiledReleaseSha: readProductionBuildConfig().releaseSha,
        currentHref: window.location.href,
        storage
      });
      if (decision.kind === 'reload') {
        kioskWebNavigation.replace(decision.href);
      } else if (decision.kind === 'wait') {
        retryTimer = setTimeout(advance, decision.retryAfterMs);
      }
    };
    advance();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
    };
  }, [
    deployDesiredReleaseSha,
    deployIsMaintenance,
    deployPhase,
    deployRunId,
    deployVerificationId
  ]);

  useEffect(() => {
    const challenge = resolveKioskReadyChallenge({
      isMaintenance: deployIsMaintenance,
      phase: deployPhase,
      desiredReleaseSha: deployDesiredReleaseSha,
      verificationId: deployVerificationId
    });
    const runId = deployRunId;
    if (!runId || !challenge) {
      acknowledgedReadyRef.current = null;
      return;
    }
    const { releaseSha, verificationId } = challenge;
    const acknowledgementKey = `${runId}:${verificationId}:${releaseSha}`;
    if (acknowledgedReadyRef.current === acknowledgementKey) return;
    let cancelled = false;
    const abortController = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryAttempt = 0;
    const acknowledge = async () => {
      if (cancelled) return;
      const nfcReady = await proveNfcRuntimeReady(resolveNfcRuntimeContract(), {
        signal: abortController.signal
      });
      if (cancelled || !nfcReady) {
        if (!cancelled) retryTimer = setTimeout(() => void acknowledge(), 1000);
        return;
      }
      acknowledgedReadyRef.current = acknowledgementKey;
      void acknowledgeDeployStatus(runId, 'ready', releaseSha, verificationId)
        .catch(() => {
          if (cancelled || acknowledgedReadyRef.current !== acknowledgementKey) return;
          acknowledgedReadyRef.current = null;
          const delay = Math.min(1000 * (2 ** retryAttempt), 10_000);
          retryAttempt += 1;
          retryTimer = setTimeout(() => void acknowledge(), delay);
        });
    };
    void acknowledge();
    return () => {
      cancelled = true;
      abortController.abort();
      if (retryTimer !== undefined) clearTimeout(retryTimer);
    };
  }, [
    deployDesiredReleaseSha,
    deployIsMaintenance,
    deployPhase,
    deployRunId,
    deployVerificationId
  ]);

  // A fresh document has no query cache yet. Mounting the routed page before
  // the first deploy-status response can let a synchronous browser dialog in
  // that page (for example window.prompt) block the event loop before this
  // layout can observe a verifying release and acknowledge it. Keep the
  // application route fail-closed until the deployment authority is known.
  if (deployStatus === undefined || deployStatus.isMaintenance) {
    return <KioskMaintenanceScreen />;
  }

  const preNoticeRunId = deployStatus?.preNotice ? deployStatus.runId : undefined;
  const locallyAcknowledgedScheduledAt = noticeScheduledAt && noticeScheduledAt.runId === preNoticeRunId
    ? noticeScheduledAt.scheduledAt
    : undefined;
  const preNoticeScheduledAt = deployStatus?.preNotice?.scheduledAt
    ?? locallyAcknowledgedScheduledAt;

  return (
    <div
      className={clsx(
        'flex flex-col bg-slate-800 text-white',
        immersiveKioskLayout
          ? [VIEWPORT_HEIGHT_FULL, 'min-h-0', planningBoardRoute && 'kiosk-planning-board-route']
          : VIEWPORT_MIN_HEIGHT_FULL
      )}
    >
      {/* 設定変更を監視してリダイレクト */}
      <KioskRedirect />
      <InventoryNfcRouter />
      {deployStatus?.preNotice ? (
        <KioskDeployPreNotice runId={preNoticeRunId} scheduledAt={preNoticeScheduledAt} />
      ) : null}
      <div
        className={KIOSK_IMMERSIVE_HEADER_HOT_ZONE_CLASS}
        onMouseEnter={headerReveal.onHotZoneEnter}
        onMouseLeave={headerReveal.onHeaderMouseLeave}
        aria-hidden
      />
      <button
        ref={handleRef}
        type="button"
        hidden={headerReveal.isVisible}
        className="fixed bottom-0 right-4 z-40 [&[hidden]]:hidden flex h-6 w-14 items-center justify-center rounded-t-lg border border-b-0 border-inv-faint bg-inv-s3 text-inv-text opacity-[.85] hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inv-cyan"
        aria-label="メニューを開く"
        aria-expanded={headerReveal.isVisible}
        aria-controls="kiosk-dock"
        onMouseEnter={headerReveal.onHotZoneEnter}
        onMouseLeave={headerReveal.onHeaderMouseLeave}
        onClick={headerReveal.onHotZoneEnter}
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 15 6-6 6 6" />
        </svg>
      </button>
      <header
        ref={headerRef}
        id="kiosk-dock"
        aria-hidden={!headerReveal.isVisible}
        {...(!headerReveal.isVisible ? { inert: '' } : {})}
        className={clsx(
          'shrink-0 bg-inv-bg px-5 py-[14px]',
          KIOSK_IMMERSIVE_HEADER_BORDER_CLASS,
          KIOSK_IMMERSIVE_HEADER_FIXED_CLASS,
          headerReveal.isVisible
            ? KIOSK_IMMERSIVE_HEADER_VISIBLE_TRANSFORM_CLASS
            : KIOSK_IMMERSIVE_HEADER_HIDDEN_TRANSFORM_CLASS
        )}
        onMouseEnter={headerReveal.onHeaderMouseEnter}
        onMouseLeave={headerReveal.onHeaderMouseLeave}
      >
        <KioskHeader
          clientKey={clientKey}
          clientId={selfClientId}
          onOpenSupport={() => setShowSupportModal(true)}
          defaultMode={kioskConfig?.defaultMode}
          initialKioskRoute={kioskConfig?.initialKioskRoute}
          clientStatus={kioskConfig?.clientStatus ?? null}
          pathname={location.pathname}
          navTabOrder={navTabOrder}
        />
      </header>
      <main className={clsx('flex min-h-0 flex-1 flex-col', [KIOSK_ASSEMBLY_MANUALS_PATH, KIOSK_ASSEMBLY_MANUALS_WORKSHOP_PATH].includes(location.pathname.replace(/\/$/, '')) ? 'overflow-hidden' : 'gap-4 overflow-auto px-4 py-4')}>
        <h1 className="sr-only">キオスク</h1>
        <Outlet />
      </main>
      <KioskSupportModal isOpen={showSupportModal} onClose={() => setShowSupportModal(false)} />
    </div>
  );
}
