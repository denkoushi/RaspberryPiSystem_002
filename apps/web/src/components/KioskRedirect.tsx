import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useKioskConfig } from '../api/hooks';

/**
 * キオスク画面の初期表示をdefaultModeに応じてリダイレクトするコンポーネント
 */
export function KioskRedirect() {
  const navigate = useNavigate();
  const { data: config, isLoading, error } = useKioskConfig();

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

    console.log('[KioskRedirect] Config loaded:', config, 'defaultMode:', config.defaultMode);
    
    if (config.defaultMode === 'PHOTO') {
      console.log('[KioskRedirect] Redirecting to /kiosk/photo');
      navigate('/kiosk/photo', { replace: true });
    } else {
      console.log('[KioskRedirect] Redirecting to /kiosk/tag');
      navigate('/kiosk/tag', { replace: true });
    }
  }, [config, isLoading, error, navigate]);

  // ローディング中は何も表示しない
  return null;
}

