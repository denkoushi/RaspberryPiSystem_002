import { ApiError } from '../../lib/errors.js';
import {
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
  verifyDueManagementAccessPassword,
  type AccessPasswordCaller
} from '../production-schedule/production-schedule-settings.service.js';

export class AssemblyTemplateAccessService {
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
      throw new ApiError(403, '組立テンプレート編集パスワードが違います');
    }
  }
}
