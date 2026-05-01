import { Navigate } from 'react-router-dom';

import { useAuth } from '../../contexts/AuthContext';
import { DgxResourceDashboard } from '../../features/admin/dgx-resource/DgxResourceDashboard';

export function DgxResourceAdminPage() {
  const { user } = useAuth();

  if (!user) {
    return null;
  }

  if (user.role === 'VIEWER') {
    return <Navigate to="/admin" replace />;
  }

  return <DgxResourceDashboard />;
}
