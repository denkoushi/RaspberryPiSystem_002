import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useKioskConfig } from '../api/hooks';

/**
 * キオスク画面の初期表示をdefaultModeに応じてリダイレクトするコンポーネント
 */
export function KioskRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: config, isLoading, error, refetch } = useKioskConfig();
  const lastDefaultModeRef = useRef<string | undefined>(undefined);

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
    
    // 現在のパスを正規化（末尾のスラッシュを除去）
    const normalizedPath = location.pathname.replace(/\/$/, '');
    const isOnRoot = normalizedPath === '';
    const isWithinKiosk = isOnRoot || normalizedPath.startsWith('/kiosk');
    const isOnKioskRoot = normalizedPath === '/kiosk';
    
    // / または /kiosk 配下でのみ動作する
    if (!isWithinKiosk) {
      if (enableDebugLogs) {
        console.log('[KioskRedirect] Not on root or kiosk path, skipping:', normalizedPath);
      }
      return;
    }
    
    // ローディング中はリダイレクトしない
    if (isLoading) {
      if (enableDebugLogs) {
        console.log('[KioskRedirect] Loading config...');
      }
      return;
    }

    const isOnPhotoPage = normalizedPath === '/kiosk/photo';
    const isOnTagPage = normalizedPath === '/kiosk/tag';
    const isOnReturnPage = normalizedPath === '/kiosk/return';
    
    // 返却ページにいる場合はリダイレクトしない（エラー時やconfigがnullでもリダイレクトしない）
    if (isOnReturnPage) {
      return;
    }

    if (error) {
      // エラーログは常に出力（問題の特定に必要）
      console.error('[KioskRedirect] Error loading config:', error);
      // エラー時はデフォルトでtagにリダイレクト
      navigate('/kiosk/tag', { replace: true });
      return;
    }

    if (!config) {
      if (enableDebugLogs) {
        console.log('[KioskRedirect] Config is null, redirecting to tag');
      }
      navigate('/kiosk/tag', { replace: true });
      return;
    }

    const currentDefaultMode = config.defaultMode;
    const lastDefaultMode = lastDefaultModeRef.current;
    
    if (enableDebugLogs) {
      console.log('[KioskRedirect] Config loaded:', config, 'defaultMode:', currentDefaultMode, 'lastDefaultMode:', lastDefaultMode, 'pathname:', location.pathname);
    }
    
    // defaultModeが変更された場合、または初回ロード時、または/kioskにいる場合にリダイレクト
    if (currentDefaultMode !== lastDefaultMode || lastDefaultMode === undefined || isOnKioskRoot || isOnRoot) {
      lastDefaultModeRef.current = currentDefaultMode;
      
      // 現在のパスとdefaultModeが一致しない場合のみリダイレクト
      const shouldRedirectToPhoto = currentDefaultMode === 'PHOTO';
      const shouldRedirectToTag = currentDefaultMode !== 'PHOTO';
      
      if (shouldRedirectToPhoto && !isOnPhotoPage) {
        if (enableDebugLogs) {
          console.log('[KioskRedirect] Redirecting to /kiosk/photo');
        }
        navigate('/kiosk/photo', { replace: true });
      } else if (shouldRedirectToTag && !isOnTagPage) {
        if (enableDebugLogs) {
          console.log('[KioskRedirect] Redirecting to /kiosk/tag');
        }
        navigate('/kiosk/tag', { replace: true });
      }
    }
  }, [config, isLoading, error, navigate, location.pathname]);

  // ローディング中は何も表示しない
  return null;
}

