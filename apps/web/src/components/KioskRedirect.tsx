import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useKioskConfig } from '../api/hooks';

/**
 * キオスク画面の初期表示をdefaultModeに応じてリダイレクトするコンポーネント
 */
export function KioskRedirect() {
  const navigate = useNavigate();
  const { data: config } = useKioskConfig();

  useEffect(() => {
    if (config?.defaultMode === 'PHOTO') {
      navigate('/kiosk/photo', { replace: true });
    } else {
      navigate('/kiosk/tag', { replace: true });
    }
  }, [config?.defaultMode, navigate]);

  return null;
}

