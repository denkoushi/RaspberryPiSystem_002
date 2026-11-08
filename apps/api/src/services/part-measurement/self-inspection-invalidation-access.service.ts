import { ApiError } from '../../lib/errors.js';
import {
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
  verifyDueManagementAccessPassword,
  type AccessPasswordCaller
} from '../production-schedule/production-schedule-settings.service.js';

/** 自主検査アイテムの不可逆な無効化に限定した管理パスワード境界。 */
export class SelfInspectionInvalidationAccessService {
  async requireAccessPassword(password: string, caller: AccessPasswordCaller = {}): Promise<void> {
    const result = await verifyDueManagementAccessPassword({
      location: SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
      clientDeviceId: caller.clientDeviceId,
      ip: caller.ip,
      password
    });
    if (!result.success) {
      throw new ApiError(403, '自主検査削除の管理パスワードが違います');
    }
  }
}
