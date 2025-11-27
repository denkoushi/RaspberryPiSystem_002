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
    // ローディング中はリダイレクトしない
    if (isLoading) {
      console.log('[KioskRedirect] Loading config...');
      return;
    }

    if (error) {
      console.error('[KioskRedirect] Error loading config:', error);
      // エラー時はデフォルトでtagにリダイレクト
      navigate('/kiosk/tag', { replace: true });
      return;
    }

    if (!config) {
      console.log('[KioskRedirect] Config is null, redirecting to tag');
      navigate('/kiosk/tag', { replace: true });
      return;
    }

    const currentDefaultMode = config.defaultMode;
    const lastDefaultMode = lastDefaultModeRef.current;
    
    console.log('[KioskRedirect] Config loaded:', config, 'defaultMode:', currentDefaultMode, 'lastDefaultMode:', lastDefaultMode, 'pathname:', location.pathname);
    
    // 現在のパスを正規化（末尾のスラッシュを除去）
    const normalizedPath = location.pathname.replace(/\/$/, '');
    const isOnKioskRoot = normalizedPath === '/kiosk';
    const isOnPhotoPage = normalizedPath === '/kiosk/photo';
    const isOnTagPage = normalizedPath === '/kiosk/tag';
    
    // defaultModeが変更された場合、または初回ロード時、または/kioskにいる場合にリダイレクト
    if (currentDefaultMode !== lastDefaultMode || lastDefaultMode === undefined || isOnKioskRoot) {
      lastDefaultModeRef.current = currentDefaultMode;
      
      // 現在のパスとdefaultModeが一致しない場合のみリダイレクト
      const shouldRedirectToPhoto = currentDefaultMode === 'PHOTO';
      const shouldRedirectToTag = currentDefaultMode !== 'PHOTO';
      
      if (shouldRedirectToPhoto && !isOnPhotoPage) {
        console.log('[KioskRedirect] Redirecting to /kiosk/photo');
        navigate('/kiosk/photo', { replace: true });
      } else if (shouldRedirectToTag && !isOnTagPage) {
        console.log('[KioskRedirect] Redirecting to /kiosk/tag');
        navigate('/kiosk/tag', { replace: true });
      }
    }
  }, [config, isLoading, error, navigate, location.pathname]);

  // ローディング中は何も表示しない
  return null;
}

