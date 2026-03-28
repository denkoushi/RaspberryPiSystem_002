import { Navigate } from 'react-router-dom';

import { useAuth } from '../../contexts/AuthContext';
import { LocalLlmChatSection } from '../../features/admin/local-llm/LocalLlmChatSection';
import { LocalLlmStatusSection } from '../../features/admin/local-llm/LocalLlmStatusSection';

export function LocalLlmAdminPage() {
  const { user } = useAuth();

  if (!user) {
    return null;
  }

  if (user.role === 'VIEWER') {
    return <Navigate to="/admin" replace />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">LocalLLM</h1>
        <p className="mt-1 text-sm text-slate-600">
          Pi5 API 経由で Ubuntu 側 LocalLLM の状態確認と試用チャットができます（管理者・マネージャーのみ）。
        </p>
      </div>
      <LocalLlmStatusSection />
      <LocalLlmChatSection />
    </div>
  );
}
