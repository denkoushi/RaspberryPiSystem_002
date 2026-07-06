import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

import { useKioskConfig } from '../api/hooks';
import { resolveKioskInitialRedirectDecision } from '../features/kiosk/kioskInitialRedirect';

/**
 * キオスク画面の初期表示をdefaultModeに応じてリダイレクトするコンポーネント
 */
export function KioskRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: config, isLoading, error, refetch } = useKioskConfig();
  const lastRouteSignatureRef = useRef<string | undefined>(undefined);

  // 設定変更を監視してリフェッチ（設定変更時に即座に反映されるように）
  useEffect(() => {
    // ウィンドウフォーカス時にリフェッチ
    const handleFocus = () => {
      refetch();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refetch]);

  useEffect(() => {
    // デバッグログの出力制御（環境変数で制御可能、デフォルトは開発中は常に出力）
    const enableDebugLogs = import.meta.env.VITE_ENABLE_DEBUG_LOGS !== 'false';
    
    const lastKioskPath = sessionStorage.getItem('kiosk-last-path') || '';

    const decision = resolveKioskInitialRedirectDecision({
      pathname: location.pathname,
      isLoading,
      hasError: Boolean(error),
      config,
      lastKioskPath,
      lastRouteSignature: lastRouteSignatureRef.current
    });

    if (enableDebugLogs) {
      console.log('[KioskRedirect] Decision:', decision, 'config:', config, 'pathname:', location.pathname);
    }

    if (error && decision.reason === 'error') {
      console.error('[KioskRedirect] Error loading config:', error);
    }

    if (decision.nextRouteSignature !== undefined) {
      lastRouteSignatureRef.current = decision.nextRouteSignature;
    }

    if (decision.targetPath) {
      navigate(decision.targetPath, { replace: true });
    }
  }, [config, isLoading, error, navigate, location.pathname]);

  // ローディング中は何も表示しない
  return null;
}
