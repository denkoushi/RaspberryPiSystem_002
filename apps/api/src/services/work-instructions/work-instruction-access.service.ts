import { ApiError } from '../../lib/errors.js';
import {
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
  verifyDueManagementAccessPassword,
  type AccessPasswordCaller
} from '../production-schedule/production-schedule-settings.service.js';

/**
 * Work-instruction editing uses the same shared kiosk management password as
 * the other operational editors, but keeps the boundary local to this domain.
 * Keeping the adapter here avoids coupling the work-instruction service to an
 * assembly-specific access service.
 */
export class WorkInstructionAccessService {
  async verifyAccessPassword(password: string, caller: AccessPasswordCaller = {}): Promise<{ success: boolean }> {
    return verifyDueManagementAccessPassword({
      location: SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
      clientDeviceId: caller.clientDeviceId,
      ip: caller.ip,
      password
    });
  }

  async requireAccessPassword(password: string | undefined, caller: AccessPasswordCaller = {}): Promise<void> {
    const result = await this.verifyAccessPassword(password ?? '', caller);
    if (!result.success) {
      throw new ApiError(403, '作業要領編集の管理パスワードが違います', undefined, 'WORK_INSTRUCTION_ACCESS_PASSWORD_INVALID');
    }
  }
}
