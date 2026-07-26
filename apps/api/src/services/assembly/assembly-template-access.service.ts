import { ApiError } from '../../lib/errors.js';
import {
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
  verifyDueManagementAccessPassword
} from '../production-schedule/production-schedule-settings.service.js';

export class AssemblyTemplateAccessService {
  async verifyAccessPassword(password: string): Promise<{ success: boolean }> {
    return verifyDueManagementAccessPassword({
      location: SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
      password
    });
  }

  async requireAccessPassword(password: string | undefined): Promise<void> {
    const result = await this.verifyAccessPassword(password ?? '');
    if (!result.success) {
      throw new ApiError(403, '組立テンプレート編集パスワードが違います');
    }
  }
}
