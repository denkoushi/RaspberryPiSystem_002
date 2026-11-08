import { ApiError } from '../../lib/errors.js';
import {
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
  verifyDueManagementAccessPassword,
  type AccessPasswordCaller
} from '../production-schedule/production-schedule-settings.service.js';

/** 自主検査登録ポリシー変更に限定した共有管理パスワード境界。 */
export class SelfInspectionRegistrationPolicyAccessService {
  async requireAccessPassword(password: string | undefined, caller: AccessPasswordCaller = {}): Promise<void> {
    const result = await verifyDueManagementAccessPassword({
      location: SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
      clientDeviceId: caller.clientDeviceId,
      ip: caller.ip,
      password: password ?? ''
    });
    if (!result.success) {
      throw new ApiError(403, '自主検査登録ポリシーの管理パスワードが違います');
    }
  }
}
