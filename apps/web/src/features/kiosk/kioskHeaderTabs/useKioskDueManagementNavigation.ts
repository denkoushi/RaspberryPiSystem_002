import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { DUE_MANAGEMENT_AUTH_SESSION_KEY, DUE_MANAGEMENT_TOKEN_SESSION_KEY } from '../../../api/domains/production-schedule';
import { useVerifyKioskDueManagementAccessPassword } from '../../../api/hooks';

import { resolveKioskHeaderTabPath } from './kioskHeaderTabRoutes';

export function useKioskDueManagementNavigation() {
  const navigate = useNavigate();
  const verifyDueManagementAccessPasswordMutation = useVerifyKioskDueManagementAccessPassword();
  const navigateToDueManagement = useCallback(async () => {
    const isAuthenticated =
      typeof window !== 'undefined' && window.sessionStorage.getItem(DUE_MANAGEMENT_AUTH_SESSION_KEY) === '1' &&
      Boolean(window.sessionStorage.getItem(DUE_MANAGEMENT_TOKEN_SESSION_KEY));
    if (isAuthenticated) {
      navigate(resolveKioskHeaderTabPath('due_management'));
      return;
    }
    const password = typeof window !== 'undefined' ? window.prompt('納期管理パスワードを入力してください') : null;
    if (!password) return;
    try {
      const result = await verifyDueManagementAccessPasswordMutation.mutateAsync({ password });
      if (!result.success || !result.token) {
        window.alert('パスワードが違います');
        return;
      }
      window.sessionStorage.setItem(DUE_MANAGEMENT_TOKEN_SESSION_KEY, result.token);
      window.sessionStorage.setItem(DUE_MANAGEMENT_AUTH_SESSION_KEY, '1');
      navigate(resolveKioskHeaderTabPath('due_management'));
    } catch {
      window.alert('認証に失敗しました。ネットワーク接続を確認してください。');
    }
  }, [navigate, verifyDueManagementAccessPasswordMutation]);

  return { navigateToDueManagement, isPending: verifyDueManagementAccessPasswordMutation.isPending };
}
