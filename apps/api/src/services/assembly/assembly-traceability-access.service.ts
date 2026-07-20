import { ApiError } from '../../lib/errors.js';
import {
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
  verifyDueManagementAccessPassword
} from '../production-schedule/production-schedule-settings.service.js';

/** 構成・正式IDの変更に限定した管理パスワード境界。 */
export class AssemblyTraceabilityAccessService {
  async verifyAccessPassword(password: string): Promise<{ success: boolean }> {
    return verifyDueManagementAccessPassword({
      location: SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
      password
    });
  }

  async requireAccessPassword(password: string): Promise<void> {
    const result = await this.verifyAccessPassword(password);
    if (!result.success) {
      throw new ApiError(403, '製品構成・正式IDの管理パスワードが違います');
    }
  }
}
