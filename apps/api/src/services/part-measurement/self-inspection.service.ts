import type { PartMeasurementProcessGroup, Prisma } from '@prisma/client';

import { MeasuringInstrumentLoanEventService } from '../measuring-instruments/measuring-instrument-loan-event.service.js';
import {
  isFullSelfInspectionPlannedQuantityWithinLimit,
  SELF_INSPECTION_FULL_MODE_PLANNED_QUANTITY_LIMIT_MESSAGE,
  SELF_INSPECTION_MAX_EXPECTED_ENTRY_COUNT,
  tryResolveExpectedEntryCount
} from './self-inspection-config.js';
import {
  buildLeaderboardDecorations as buildLeaderboardDecorationsOp,
  type SelfInspectionDecorationCache
} from './self-inspection/decoration.js';
import type {
  SelfInspectionMeasurementPayloadValue,
  SelfInspectionStatusDto
} from './self-inspection/shared.js';
import type {
  SelfInspectionApproverResolveResult,
  SelfInspectionRecordApprovalState
} from './self-inspection/serialization.js';
import {
  authenticateMeasurementActor as authenticateMeasurementActorUseCase,
  createInspectorEntry as createInspectorEntryUseCase,
  recordInspectorInstrumentPreUseInspection as recordInspectorInstrumentPreUseInspectionUseCase,
  recordInstrumentPreUseInspection as recordInstrumentPreUseInspectionUseCase,
  saveInspectorEntryJudgements,
  updateInspectorEntry as updateInspectorEntryUseCase
} from './self-inspection/use-cases/measurement-actor.js';
import {
  createSelfInspectionEntry,
  updateSelfInspectionEntry,
  upsertSelfInspectionDraftEntry
} from './self-inspection/use-cases/operator-entry.js';
import {
  approveSelfInspectionOutOfToleranceReview,
  listPendingSelfInspectionOutOfToleranceReviews
} from './self-inspection/use-cases/out-of-tolerance-review.js';
import {
  approveSelfInspectionRecordApproval,
  getSelfInspectionRecordApprovalSessionDetail,
  listSelfInspectionRecordApprovalSessions,
  resolveSelfInspectionRecordApprovalApprover
} from './self-inspection/use-cases/record-approval.js';
import { completeSelfInspectionSession } from './self-inspection/use-cases/session-completion.js';
import {
  getInspectorMeasurementSessionDetail as getInspectorMeasurementSessionDetailUseCase,
  getSelfInspectionSessionDetail,
  listSelfInspectionSessions
} from './self-inspection/use-cases/session-query.js';
import { resetSelfInspectionSession } from './self-inspection/use-cases/session-reset.js';
import { resolveOrCreateSelfInspectionSession } from './self-inspection/use-cases/session-start.js';

export { LIST_SESSIONS_MAX } from './self-inspection/use-cases/constants.js';

export {
  isFullSelfInspectionPlannedQuantityWithinLimit,
  SELF_INSPECTION_FULL_MODE_PLANNED_QUANTITY_LIMIT_MESSAGE,
  SELF_INSPECTION_MAX_EXPECTED_ENTRY_COUNT,
  tryResolveExpectedEntryCount
};

export {
  createSelfInspectionDecorationCache,
  ensureSelfInspectionSessionsInCache,
  ensureSelfInspectionTemplatesForRows,
  pickSessionForScheduleRow
} from './self-inspection/decoration.js';
export type {
  SelfInspectionDecorationCache,
  SelfInspectionSessionForDecoration
} from './self-inspection/decoration.js';
export {
  resolveLegacyFullSelfInspectionBlockedReason,
  resolveRequiredEntryCountForCompletion
} from './self-inspection/shared.js';
export type {
  SelfInspectionApproverResolveResult,
  SelfInspectionRecordApprovalState
} from './self-inspection/serialization.js';

export class SelfInspectionService {
  private readonly loanEventService = new MeasuringInstrumentLoanEventService();

  async resolveOrCreateSession(input: {
    templateId: string;
    productNo: string;
    processGroup: PartMeasurementProcessGroup;
    resourceCd: string;
    scheduleRowId: string;
    fseiban: string;
    fhincd?: string | null;
    fhinmei?: string | null;
    machineName?: string | null;
    clientDeviceId?: string | null;
  }) {
    return resolveOrCreateSelfInspectionSession(input);
  }

  async listSessions(query: {
    productNo?: string;
    resourceCd?: string;
    processGroup?: PartMeasurementProcessGroup;
    status?: SelfInspectionStatusDto;
  }) {
    return listSelfInspectionSessions(query);
  }

  async listRecordApprovalSessions(query: {
    productNo?: string;
    resourceCd?: string;
    processGroup?: PartMeasurementProcessGroup;
    state?: 'active' | SelfInspectionRecordApprovalState;
  }) {
    return listSelfInspectionRecordApprovalSessions(query);
  }

  async getRecordApprovalSessionDetail(sessionId: string) {
    return getSelfInspectionRecordApprovalSessionDetail(sessionId);
  }

  async resolveRecordApprovalApprover(
    rawUid: string
  ): Promise<SelfInspectionApproverResolveResult> {
    return resolveSelfInspectionRecordApprovalApprover(rawUid);
  }

  async approveRecordApproval(
    sessionId: string,
    input: {
      approverEmployeeTagUid: string;
      comment?: string | null;
      clientDeviceId?: string | null;
    }
  ) {
    return approveSelfInspectionRecordApproval(sessionId, input);
  }

  async getSessionDetail(sessionId: string, options?: { entryIndex?: number }) {
    return getSelfInspectionSessionDetail(sessionId, options);
  }

  async getInspectorMeasurementSessionDetail(
    sessionId: string,
    options?: { entryIndex?: number }
  ) {
    return getInspectorMeasurementSessionDetailUseCase(sessionId, options);
  }

  async createInspectorEntry(
    sessionId: string,
    input: {
      entryIndex: number;
      values: SelfInspectionMeasurementPayloadValue[];
      measurementActorAuthenticationId: string;
      measuringInstrumentTagUid?: string | null;
      clientDeviceId?: string | null;
    }
  ) {
    return createInspectorEntryUseCase(sessionId, input);
  }

  async updateInspectorEntry(
    sessionId: string,
    entryId: string,
    input: {
      entryIndex: number;
      ifUnmodifiedSince: string;
      values: SelfInspectionMeasurementPayloadValue[];
      measurementActorAuthenticationId: string;
      measuringInstrumentTagUid?: string | null;
      clientDeviceId?: string | null;
    }
  ) {
    return updateInspectorEntryUseCase(sessionId, entryId, input);
  }

  async saveInspectorJudgements(
    sessionId: string,
    entryId: string,
    input: {
      judgements: Array<{
        templateItemId: string;
        judgementStatus: 'FINAL_OK' | 'FINAL_NG';
      }>;
    }
  ) {
    return saveInspectorEntryJudgements(sessionId, entryId, input);
  }

  async recordInspectorInstrumentPreUseInspection(
    sessionId: string,
    entryIndexInput: number,
    input: {
      instrumentTagUid: string;
      measurementActorAuthenticationId: string;
      clientDeviceId?: string | null;
    }
  ) {
    return recordInspectorInstrumentPreUseInspectionUseCase(
      this.loanEventService,
      sessionId,
      entryIndexInput,
      input
    );
  }

  async recordInstrumentPreUseInspection(
    sessionId: string,
    entryIndexInput: number,
    input: {
      instrumentTagUid: string;
      measurementActorAuthenticationId: string;
      clientDeviceId?: string | null;
    }
  ) {
    return recordInstrumentPreUseInspectionUseCase(
      this.loanEventService,
      sessionId,
      entryIndexInput,
      input
    );
  }

  async authenticateMeasurementActor(
    sessionId: string,
    input: {
      employeeTagUid: string;
      measurementMode: 'operator' | 'inspector';
      clientDeviceId?: string | null;
    }
  ) {
    return authenticateMeasurementActorUseCase(sessionId, input);
  }

  async createEntry(
    sessionId: string,
    input: {
      entryIndex: number;
      values: SelfInspectionMeasurementPayloadValue[];
      measurementActorAuthenticationId: string;
      measuringInstrumentTagUid?: string | null;
      createdByEmployeeId?: string | null;
      createdByEmployeeNameSnapshot?: string | null;
      clientDeviceId?: string | null;
    }
  ) {
    return createSelfInspectionEntry(sessionId, input);
  }

  async updateEntry(
    sessionId: string,
    entryId: string,
    input: {
      ifUnmodifiedSince: string;
      values: SelfInspectionMeasurementPayloadValue[];
      measurementActorAuthenticationId: string;
      measuringInstrumentTagUid?: string | null;
      clientDeviceId?: string | null;
    }
  ) {
    return updateSelfInspectionEntry(sessionId, entryId, input);
  }

  async upsertDraftEntry(
    sessionId: string,
    input: {
      entryIndex: number;
      values?: SelfInspectionMeasurementPayloadValue[];
      measurementActorAuthenticationId: string;
      measuringInstrumentTagUid?: string | null;
      ifUnmodifiedSince?: string | null;
      clientDeviceId?: string | null;
    }
  ) {
    return upsertSelfInspectionDraftEntry(sessionId, input);
  }

  async completeSession(sessionId: string) {
    return completeSelfInspectionSession(sessionId);
  }

  async listPendingOutOfToleranceReviews() {
    return listPendingSelfInspectionOutOfToleranceReviews();
  }

  async approveOutOfToleranceReview(
    sessionId: string,
    input: { comment?: string | null; actorUserId: string; actorUsername: string }
  ) {
    return approveSelfInspectionOutOfToleranceReview(sessionId, input);
  }

  async resetSession(
    sessionId: string,
    input: {
      confirmDestructiveReset: boolean;
      confirmCompletedSessionReset: boolean;
      requestId: string;
      reason?: string | null;
      clientDeviceId?: string | null;
      actorUserId?: string | null;
      actorUsername?: string | null;
      authMode: 'bearer' | 'client_key';
    }
  ) {
    return resetSelfInspectionSession(sessionId, input);
  }

  async buildLeaderboardDecorations(
    rows: Array<{
      id: string;
      rowData: Prisma.JsonValue;
      plannedQuantity?: number | null;
    }>,
    scope?: { siteKey?: string },
    cache?: SelfInspectionDecorationCache
  ) {
    return buildLeaderboardDecorationsOp(rows, scope, cache);
  }
}
