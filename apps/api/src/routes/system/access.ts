import { authorizeRoles } from '../../lib/auth.js';

export const canViewSystemDiagnostics = authorizeRoles('ADMIN', 'MANAGER');
