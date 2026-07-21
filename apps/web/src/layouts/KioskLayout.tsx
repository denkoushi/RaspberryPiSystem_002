import { DEFAULT_KIOSK_HEADER_TAB_ORDER, normalizeKioskHeaderTabOrder } from '@raspi-system/shared-types';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { getResolvedClientKey, setClientKeyHeader } from '../api/client';
import { acknowledgeDeployStatus } from '../api/domains/system';
import { useDeployStatus, useKioskCallTargets, useKioskConfig } from '../api/hooks';
import { KioskDeployPreNotice } from '../components/kiosk/KioskDeployPreNotice';
import { KioskHeader } from '../components/kiosk/KioskHeader';
import { KioskMaintenanceScreen } from '../components/kiosk/KioskMaintenanceScreen';
import { KioskSupportModal } from '../components/kiosk/KioskSupportModal';
import { KioskRedirect } from '../components/KioskRedirect';
import {
  VIEWPORT_HEIGHT_FULL,
  VIEWPORT_MIN_HEIGHT_FULL
} from '../constants/viewportLayout';
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
import { useKioskBottomCenterHeaderReveal } from '../hooks/useKioskBottomCenterHeaderReveal';

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
  const headerReveal = useKioskBottomCenterHeaderReveal(immersiveKioskLayout);
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
        compiledReleaseSha: import.meta.env.VITE_RELEASE_SHA,
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
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryAttempt = 0;
    const acknowledge = () => {
      if (cancelled) return;
      acknowledgedReadyRef.current = acknowledgementKey;
      void acknowledgeDeployStatus(runId, 'ready', releaseSha, verificationId)
        .catch(() => {
          if (cancelled || acknowledgedReadyRef.current !== acknowledgementKey) return;
          acknowledgedReadyRef.current = null;
          const delay = Math.min(1000 * (2 ** retryAttempt), 10_000);
          retryAttempt += 1;
          retryTimer = setTimeout(acknowledge, delay);
        });
    };
    acknowledge();
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

  // メンテナンス中はメンテナンス画面を表示
  if (deployStatus?.isMaintenance) {
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
        immersiveKioskLayout ? [VIEWPORT_HEIGHT_FULL, 'min-h-0'] : VIEWPORT_MIN_HEIGHT_FULL
      )}
    >
      {/* 設定変更を監視してリダイレクト */}
      <KioskRedirect />
      {deployStatus?.preNotice ? (
        <KioskDeployPreNotice runId={preNoticeRunId} scheduledAt={preNoticeScheduledAt} />
      ) : null}
      {immersiveKioskLayout ? (
        <div
          className={KIOSK_IMMERSIVE_HEADER_HOT_ZONE_CLASS}
          onMouseEnter={headerReveal.onHotZoneEnter}
          aria-hidden
        />
      ) : null}
      <header
        className={clsx(
          'shrink-0 bg-slate-900/80 px-4 py-3 backdrop-blur',
          !immersiveKioskLayout && 'border-b border-white/10',
          immersiveKioskLayout && KIOSK_IMMERSIVE_HEADER_BORDER_CLASS,
          immersiveKioskLayout && KIOSK_IMMERSIVE_HEADER_FIXED_CLASS,
          immersiveKioskLayout &&
            !headerReveal.isVisible &&
            KIOSK_IMMERSIVE_HEADER_HIDDEN_TRANSFORM_CLASS,
          immersiveKioskLayout &&
            headerReveal.isVisible &&
            KIOSK_IMMERSIVE_HEADER_VISIBLE_TRANSFORM_CLASS
        )}
        onMouseEnter={immersiveKioskLayout ? headerReveal.onHeaderMouseEnter : undefined}
        onMouseLeave={immersiveKioskLayout ? headerReveal.onHeaderMouseLeave : undefined}
      >
        <KioskHeader
          clientKey={clientKey}
          clientId={selfClientId}
          onOpenSupport={() => setShowSupportModal(true)}
          defaultMode={kioskConfig?.defaultMode}
          clientStatus={kioskConfig?.clientStatus ?? null}
          pathname={location.pathname}
          navTabOrder={navTabOrder}
        />
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 py-4">
        <h1 className="sr-only">キオスク</h1>
        <Outlet />
      </main>
      <KioskSupportModal isOpen={showSupportModal} onClose={() => setShowSupportModal(false)} />
    </div>
  );
}
