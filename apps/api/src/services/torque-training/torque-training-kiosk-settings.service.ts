import { ApiError } from '../../lib/errors.js';
import {
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
  verifyDueManagementAccessPassword
} from '../production-schedule/production-schedule-settings.service.js';
import { TorqueWrenchMasterService } from '../torque-wrenches/torque-wrench-master.service.js';
import {
  type TrainingProgramInput,
  TorqueTrainingService
} from './torque-training.service.js';
import type { TorqueTrainingSettingsAuditContext } from './torque-training-settings-audit.js';

export type TorqueTrainingKioskSettingsClient = {
  id: string;
  name: string;
};

/**
 * Shared four-digit operation-password boundary for the kiosk settings panel.
 * Every endpoint calls this service; the browser's in-memory gate is only UX.
 */
export class TorqueTrainingKioskSettingsService {
  constructor(
    private readonly trainingService = new TorqueTrainingService(),
    private readonly wrenchService = new TorqueWrenchMasterService()
  ) {}

  async requireAccessPassword(password: string | undefined): Promise<void> {
    const result = await verifyDueManagementAccessPassword({
      location: SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
      password: password ?? ''
    });
    if (!result.success) {
      throw new ApiError(403, 'トルク訓練設定の操作パスワードが違います', undefined, 'TORQUE_TRAINING_SETTINGS_ACCESS_DENIED');
    }
  }

  async snapshot(accessPassword: string | undefined) {
    await this.requireAccessPassword(accessPassword);
    const [programs, results, capabilityGroups, wrenchProfiles] = await Promise.all([
      this.trainingService.listPrograms(true),
      this.trainingService.listAdminResults(),
      this.wrenchService.listCapabilityGroups(true),
      this.wrenchService.listProfiles(true)
    ]);
    return { programs, results, capabilityGroups, wrenchProfiles };
  }

  async createProgram(
    accessPassword: string | undefined,
    client: TorqueTrainingKioskSettingsClient,
    input: TrainingProgramInput
  ) {
    await this.requireAccessPassword(accessPassword);
    return this.trainingService.createProgram(input, this.auditContext(client));
  }

  async reviseProgram(
    accessPassword: string | undefined,
    client: TorqueTrainingKioskSettingsClient,
    programId: string,
    input: Omit<TrainingProgramInput, 'code'>
  ) {
    await this.requireAccessPassword(accessPassword);
    return this.trainingService.reviseProgram(programId, input, this.auditContext(client));
  }

  async deactivateProgram(
    accessPassword: string | undefined,
    client: TorqueTrainingKioskSettingsClient,
    programId: string,
    reason: string
  ) {
    await this.requireAccessPassword(accessPassword);
    return this.trainingService.deactivateProgram(programId, reason, this.auditContext(client));
  }

  async excludeSession(
    accessPassword: string | undefined,
    client: TorqueTrainingKioskSettingsClient,
    sessionId: string,
    reason: string
  ) {
    await this.requireAccessPassword(accessPassword);
    // The admin actor fields remain explicit so the legacy JWT route keeps its
    // existing audit meaning. Kiosk PIN actions are recorded by the separate
    // terminal audit row and do not invent a user identity.
    return this.trainingService.excludeSession(
      sessionId,
      reason,
      null,
      this.auditContext(client)
    );
  }

  private auditContext(client: TorqueTrainingKioskSettingsClient): TorqueTrainingSettingsAuditContext {
    return {
      clientDeviceId: client.id,
      clientDeviceName: client.name
    };
  }
}
