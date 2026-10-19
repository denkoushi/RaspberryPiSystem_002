import { prisma } from '../../../../lib/prisma.js';
import type { MeasuringInstrumentLoanEventService } from '../../../measuring-instruments/measuring-instrument-loan-event.service.js';
import { saveInspectorEntry, saveInspectorJudgements } from '../inspector-entry.js';
import {
  recordInspectorInstrumentPreUseInspection as recordInspectorInstrumentPreUseInspectionOp,
  recordInstrumentPreUseInspection as recordInstrumentPreUseInspectionOp
} from '../instrument-pre-use-inspection.js';
import {
  createMeasurementActorAuthentication,
  requireMeasurementActorAuthentication
} from '../measurement-actor-authentication.js';
import { lockSessionRow } from '../mutation-guards.js';
import type { SelfInspectionMeasurementPayloadValue } from '../shared.js';

export async function createInspectorEntry(
  sessionId: string,
  input: {
    entryIndex: number;
    values: SelfInspectionMeasurementPayloadValue[];
    measurementActorAuthenticationId: string;
    measuringInstrumentTagUid?: string | null;
    clientDeviceId?: string | null;
  }
) {
  return saveInspectorEntry(sessionId, input);
}

export async function updateInspectorEntry(
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
  return saveInspectorEntry(sessionId, input, {
    entryId,
    ifUnmodifiedSince: input.ifUnmodifiedSince
  });
}

export async function saveInspectorEntryJudgements(
  sessionId: string,
  entryId: string,
  input: {
    judgements: Array<{
      templateItemId: string;
      judgementStatus: 'FINAL_OK' | 'FINAL_NG';
    }>;
  }
) {
  return saveInspectorJudgements(sessionId, entryId, input);
}

export async function recordInspectorInstrumentPreUseInspection(
  loanEventService: MeasuringInstrumentLoanEventService,
  sessionId: string,
  entryIndexInput: number,
  input: {
    instrumentTagUid: string;
    measurementActorAuthenticationId: string;
    clientDeviceId?: string | null;
  }
) {
  const actor = await prisma.$transaction((tx) =>
    requireMeasurementActorAuthentication(tx, {
      sessionId,
      authenticationId: input.measurementActorAuthenticationId,
      mode: 'INSPECTOR',
      clientDeviceId: input.clientDeviceId
    })
  );
  return recordInspectorInstrumentPreUseInspectionOp(
    loanEventService,
    sessionId,
    entryIndexInput,
    {
      ...input,
      employeeTagUid: actor.employeeNfcTagUidSnapshot,
      measurementActorAuthenticationId: actor.id
    }
  );
}

export async function recordInstrumentPreUseInspection(
  loanEventService: MeasuringInstrumentLoanEventService,
  sessionId: string,
  entryIndexInput: number,
  input: {
    instrumentTagUid: string;
    measurementActorAuthenticationId: string;
    clientDeviceId?: string | null;
  }
) {
  const actor = await prisma.$transaction((tx) =>
    requireMeasurementActorAuthentication(tx, {
      sessionId,
      authenticationId: input.measurementActorAuthenticationId,
      mode: 'OPERATOR',
      clientDeviceId: input.clientDeviceId
    })
  );
  return recordInstrumentPreUseInspectionOp(loanEventService, sessionId, entryIndexInput, {
    ...input,
    employeeTagUid: actor.employeeNfcTagUidSnapshot,
    measurementActorAuthenticationId: actor.id
  });
}

export async function authenticateMeasurementActor(
  sessionId: string,
  input: {
    employeeTagUid: string;
    measurementMode: 'operator' | 'inspector';
    clientDeviceId?: string | null;
  }
) {
  return prisma.$transaction(async (tx) => {
    await lockSessionRow(tx, sessionId);
    return createMeasurementActorAuthentication(tx, sessionId, input);
  });
}
