import { MeasuringInstrumentStatus, TransactionAction } from '@prisma/client';

import { ApiError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import type { MeasuringInstrumentLoanEventService } from '../../measuring-instruments/measuring-instrument-loan-event.service.js';
import { resetSelfInspectionMachineBoardScheduleRowCaches } from '../self-inspection-machine-board-cache-invalidation.js';
import { assertMeasuringInstrumentAvailableForSelfInspection } from '../self-inspection-measuring-instrument-eligibility.js';
import { assertSelfInspectionEntryRegistrationTagUids } from '../self-inspection-registration-tag-validation.js';
import {
  assertEntryIndexAllowed,
  inferEntrySlotKindForIndex
} from '../self-inspection-config.js';
import { templateConfigFromTemplate } from './shared.js';
import {
  assertInspectorRemeasurementNotStarted,
  assertSessionEntryCountWritable,
  loadSessionForMutation,
  lockSessionRow
} from './mutation-guards.js';
import { resolveInspectorEmployeeRequired } from './entry-registration.js';
import {
  loadInspectorEntryForSerialization,
  loadLotEntryForSerialization,
  serializeInspectorEntry,
  serializeInstrumentUsage,
  serializeLotEntry
} from './serialization.js';


export async function recordInspectorInstrumentPreUseInspection(
  loanEventService: MeasuringInstrumentLoanEventService,
  sessionId: string,
  entryIndexInput: number,
  input: {
    instrumentTagUid: string;
    employeeTagUid: string;
    clientDeviceId?: string | null;
  }
) {
  const entryIndex = Math.floor(entryIndexInput);
  const instrumentTagUid = input.instrumentTagUid.trim();
  const employeeTagUid = input.employeeTagUid.trim();
  if (!instrumentTagUid) {
    throw new ApiError(400, '計測機器タグが必要です');
  }
  if (!employeeTagUid) {
    throw new ApiError(400, '氏名タグが必要です');
  }
  await assertSelfInspectionEntryRegistrationTagUids({
    employeeTagUid,
    measuringInstrumentTagUid: instrumentTagUid
  });

  const result = await prisma.$transaction(async (tx) => {
    await lockSessionRow(tx, sessionId);
    const session = await loadSessionForMutation(tx, sessionId);
    assertSessionEntryCountWritable(session);
    if (!session.recordApprovalRequiredAt || !session.inspectorRemeasurementRequiredAt) {
      throw new ApiError(409, 'オペレータの自主検査記録保存後に検査員再測定を開始してください');
    }
    const existingApproval = await tx.selfInspectionRecordApproval.findUnique({
      where: { sessionId },
      select: { id: true }
    });
    if (existingApproval) {
      throw new ApiError(409, '承認済みの検査記録は検査員再測定を変更できません');
    }
    const templateConfig = templateConfigFromTemplate(session.template);
    assertEntryIndexAllowed(templateConfig, session.plannedQuantity, entryIndex);
    const slotKind = inferEntrySlotKindForIndex(
      templateConfig,
      session.plannedQuantity,
      entryIndex
    );

    const operatorEntry = await tx.selfInspectionLotEntry.findUnique({
      where: {
        sessionId_entryIndex: {
          sessionId,
          entryIndex
        }
      },
      select: {
        id: true,
        createdByEmployeeId: true,
        createdByEmployeeNameSnapshot: true
      }
    });
    if (!operatorEntry?.createdByEmployeeId) {
      throw new ApiError(409, 'オペレータの測定者が未登録のため検査員再測定できません');
    }

    const [instrumentTag, employee] = await Promise.all([
      tx.measuringInstrumentTag.findUnique({
        where: { rfidTagUid: instrumentTagUid },
        include: { measuringInstrument: true }
      }),
      resolveInspectorEmployeeRequired(tx, employeeTagUid)
    ]);
    if (!instrumentTag?.measuringInstrument) {
      throw new ApiError(404, '計測機器が登録されていません');
    }
    if (operatorEntry.createdByEmployeeId === employee.id) {
      throw new ApiError(409, '検査員はオペレータ本人とは別の社員を登録してください');
    }
    const instrument = instrumentTag.measuringInstrument;
    assertMeasuringInstrumentAvailableForSelfInspection(instrument);

    let entry = await tx.selfInspectionInspectorEntry.findUnique({
      where: {
        sessionId_entryIndex: {
          sessionId,
          entryIndex
        }
      },
      include: {
        instrumentUsages: true,
        values: true
      }
    });
    if (entry?.inspectorEmployeeId && entry.inspectorEmployeeId !== employee.id) {
      throw new ApiError(409, 'この入力件の検査員と氏名タグが一致しません');
    }
    if (!entry) {
      entry = await tx.selfInspectionInspectorEntry.create({
        data: {
          sessionId,
          entryIndex,
          entrySlotKind: slotKind,
          inspectorEmployeeId: employee.id,
          inspectorEmployeeCodeSnapshot: employee.employeeCode,
          inspectorEmployeeNameSnapshot: employee.displayName,
          inspectorEmployeeNfcTagUidSnapshot: employee.nfcTagUid,
          clientDeviceId: input.clientDeviceId ?? null
        },
        include: {
          instrumentUsages: true,
          values: true
        }
      });
    } else if (!entry.inspectorEmployeeId) {
      entry = await tx.selfInspectionInspectorEntry.update({
        where: { id: entry.id },
        data: {
          inspectorEmployeeId: employee.id,
          inspectorEmployeeCodeSnapshot: employee.employeeCode,
          inspectorEmployeeNameSnapshot: employee.displayName,
          inspectorEmployeeNfcTagUidSnapshot: employee.nfcTagUid,
          clientDeviceId: input.clientDeviceId ?? null
        },
        include: {
          instrumentUsages: true,
          values: true
        }
      });
    }

    const existingUsage = entry.instrumentUsages.find(
      (usage) => usage.measuringInstrumentId === instrument.id
    );
    if (existingUsage) {
      const serializedEntry = await loadInspectorEntryForSerialization(tx, entry.id);
      return {
        entry: serializeInspectorEntry(serializedEntry),
        usage: serializeInstrumentUsage(existingUsage),
        loan: null,
        loanEvent: null,
        reusedExistingUsage: true
      };
    }

    const existingLoan = await tx.loan.findFirst({
      where: {
        measuringInstrumentId: instrument.id,
        returnedAt: null,
        cancelledAt: null
      },
      include: {
        measuringInstrument: true,
        employee: true,
        client: true
      }
    });
    if (existingLoan && existingLoan.employeeId !== employee.id) {
      throw new ApiError(409, 'この計測機器は別の社員が貸出中です');
    }

    const instrumentSnapshot = {
      id: instrument.id,
      managementNumber: instrument.managementNumber,
      name: instrument.name
    };
    const employeeSnapshot = {
      id: employee.id,
      code: employee.employeeCode,
      name: employee.displayName
    };
    const inspectedAt = new Date();
    const loan = existingLoan
      ? existingLoan
      : await tx.loan.create({
          data: {
            measuringInstrumentId: instrument.id,
            employeeId: employee.id,
            clientId: input.clientDeviceId ?? undefined
          },
          include: {
            measuringInstrument: true,
            employee: true,
            client: true
          }
        });

    if (!existingLoan) {
      await tx.measuringInstrument.update({
        where: { id: instrument.id },
        data: { status: MeasuringInstrumentStatus.IN_USE }
      });
      await tx.transaction.create({
        data: {
          loanId: loan.id,
          action: TransactionAction.BORROW,
          actorEmployeeId: employee.id,
          clientId: input.clientDeviceId ?? undefined,
          details: {
            note: null,
            instrumentSnapshot,
            employeeSnapshot,
            source: 'self_inspection_inspector_pre_use_inspection'
          }
        }
      });
    }

    if (!instrument.genreId) {
      throw new ApiError(409, '計測機器ジャンルが未設定のため使用前点検できません');
    }
    const inspectionItems = await tx.inspectionItem.findMany({
      where: { genreId: instrument.genreId },
      orderBy: { order: 'asc' },
      select: { id: true }
    });
    if (inspectionItems.length > 0) {
      await tx.inspectionRecord.createMany({
        data: inspectionItems.map((item) => ({
          measuringInstrumentId: instrument.id,
          loanId: loan.id,
          employeeId: employee.id,
          inspectionItemId: item.id,
          result: 'PASS',
          inspectedAt
        }))
      });
    }

    const usage = await tx.selfInspectionInspectorEntryInstrumentUsage.create({
      data: {
        entryId: entry.id,
        measuringInstrumentId: instrument.id,
        loanId: loan.id,
        measuringInstrumentManagementNumberSnapshot: instrument.managementNumber,
        measuringInstrumentNameSnapshot: instrument.name,
        measuringInstrumentTagUidSnapshot: instrumentTagUid,
        preUseInspectedAt: inspectedAt
      }
    });

    if (!entry.measuringInstrumentId) {
      await tx.selfInspectionInspectorEntry.update({
        where: { id: entry.id },
        data: {
          measuringInstrumentId: instrument.id,
          measuringInstrumentManagementNumberSnapshot: instrument.managementNumber,
          measuringInstrumentNameSnapshot: instrument.name,
          measuringInstrumentTagUidSnapshot: instrumentTagUid
        }
      });
    }
    await tx.selfInspectionSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() }
    });

    const serializedEntry = await loadInspectorEntryForSerialization(tx, entry.id);
    return {
      entry: serializeInspectorEntry(serializedEntry),
      usage: serializeInstrumentUsage(usage),
      loan: {
        id: loan.id,
        reused: Boolean(existingLoan)
      },
      loanEvent: existingLoan
        ? null
        : {
            managementNumber: instrument.managementNumber,
            eventAt: loan.borrowedAt,
            borrowerName: employee.displayName,
            employeeCode: employee.employeeCode,
            instrumentName: instrument.name,
            loanId: loan.id,
            clientId: input.clientDeviceId ?? null
          },
      reusedExistingUsage: false
    };
  });

  if (result.loanEvent) {
    try {
      await loanEventService.recordNfcEvent({
        managementNumber: result.loanEvent.managementNumber,
        action: '持ち出し',
        eventAt: result.loanEvent.eventAt,
        borrowerName: result.loanEvent.borrowerName,
        employeeCode: result.loanEvent.employeeCode,
        instrumentName: result.loanEvent.instrumentName,
        loanId: result.loanEvent.loanId,
        clientId: result.loanEvent.clientId
      });
    } catch (error) {
      logger.warn({ err: error, loanId: result.loanEvent.loanId }, 'Failed to mirror inspector self-inspection instrument loan event');
    }
  }
  resetSelfInspectionMachineBoardScheduleRowCaches();
  return result;
}

export async function recordInstrumentPreUseInspection(
  loanEventService: MeasuringInstrumentLoanEventService,
  sessionId: string,
  entryIndexInput: number,
  input: {
    instrumentTagUid: string;
    employeeTagUid: string;
    clientDeviceId?: string | null;
  }
) {
  const entryIndex = Math.floor(entryIndexInput);
  const instrumentTagUid = input.instrumentTagUid.trim();
  const employeeTagUid = input.employeeTagUid.trim();
  if (!instrumentTagUid) {
    throw new ApiError(400, '計測機器タグが必要です');
  }
  if (!employeeTagUid) {
    throw new ApiError(400, '氏名タグが必要です');
  }
  await assertSelfInspectionEntryRegistrationTagUids({
    employeeTagUid,
    measuringInstrumentTagUid: instrumentTagUid
  });

  const result = await prisma.$transaction(async (tx) => {
    await lockSessionRow(tx, sessionId);
    const session = await loadSessionForMutation(tx, sessionId);
    assertSessionEntryCountWritable(session);
    await assertInspectorRemeasurementNotStarted(tx, sessionId);
    const templateConfig = templateConfigFromTemplate(session.template);
    assertEntryIndexAllowed(templateConfig, session.plannedQuantity, entryIndex);
    const slotKind = inferEntrySlotKindForIndex(
      templateConfig,
      session.plannedQuantity,
      entryIndex
    );

    const [instrumentTag, employee] = await Promise.all([
      tx.measuringInstrumentTag.findUnique({
        where: { rfidTagUid: instrumentTagUid },
        include: { measuringInstrument: true }
      }),
      tx.employee.findFirst({
        where: { nfcTagUid: employeeTagUid },
        select: { id: true, employeeCode: true, displayName: true, nfcTagUid: true }
      })
    ]);
    if (!instrumentTag?.measuringInstrument) {
      throw new ApiError(404, '計測機器が登録されていません');
    }
    if (!employee?.nfcTagUid) {
      throw new ApiError(404, '従業員が登録されていません');
    }
    const instrument = instrumentTag.measuringInstrument;
    assertMeasuringInstrumentAvailableForSelfInspection(instrument);

    let entry = await tx.selfInspectionLotEntry.findUnique({
      where: {
        sessionId_entryIndex: {
          sessionId,
          entryIndex
        }
      },
      include: {
        instrumentUsages: true,
        values: true
      }
    });
    if (entry?.createdByEmployeeId && entry.createdByEmployeeId !== employee.id) {
      throw new ApiError(409, 'この入力件の測定者と氏名タグが一致しません');
    }
    if (!entry) {
      entry = await tx.selfInspectionLotEntry.create({
        data: {
          sessionId,
          entryIndex,
          entrySlotKind: slotKind,
          createdByEmployeeId: employee.id,
          createdByEmployeeNameSnapshot: employee.displayName
        },
        include: {
          instrumentUsages: true,
          values: true
        }
      });
    } else if (!entry.createdByEmployeeId) {
      entry = await tx.selfInspectionLotEntry.update({
        where: { id: entry.id },
        data: {
          createdByEmployeeId: employee.id,
          createdByEmployeeNameSnapshot: employee.displayName
        },
        include: {
          instrumentUsages: true,
          values: true
        }
      });
    }

    const existingUsage = entry.instrumentUsages.find(
      (usage) => usage.measuringInstrumentId === instrument.id
    );
    if (existingUsage) {
      const serializedEntry = await loadLotEntryForSerialization(tx, entry.id);
      return {
        entry: serializeLotEntry(serializedEntry),
        usage: serializeInstrumentUsage(existingUsage),
        loan: null,
        loanEvent: null,
        reusedExistingUsage: true
      };
    }

    const existingLoan = await tx.loan.findFirst({
      where: {
        measuringInstrumentId: instrument.id,
        returnedAt: null,
        cancelledAt: null
      },
      include: {
        measuringInstrument: true,
        employee: true,
        client: true
      }
    });
    if (existingLoan && existingLoan.employeeId !== employee.id) {
      throw new ApiError(409, 'この計測機器は別の社員が貸出中です');
    }

    const instrumentSnapshot = {
      id: instrument.id,
      managementNumber: instrument.managementNumber,
      name: instrument.name
    };
    const employeeSnapshot = {
      id: employee.id,
      code: employee.employeeCode,
      name: employee.displayName
    };
    const inspectedAt = new Date();
    const loan = existingLoan
      ? existingLoan
      : await tx.loan.create({
          data: {
            measuringInstrumentId: instrument.id,
            employeeId: employee.id,
            clientId: input.clientDeviceId ?? undefined
          },
          include: {
            measuringInstrument: true,
            employee: true,
            client: true
          }
        });

    if (!existingLoan) {
      await tx.measuringInstrument.update({
        where: { id: instrument.id },
        data: { status: MeasuringInstrumentStatus.IN_USE }
      });
      await tx.transaction.create({
        data: {
          loanId: loan.id,
          action: TransactionAction.BORROW,
          actorEmployeeId: employee.id,
          clientId: input.clientDeviceId ?? undefined,
          details: {
            note: null,
            instrumentSnapshot,
            employeeSnapshot,
            source: 'self_inspection_pre_use_inspection'
          }
        }
      });
    }

    if (!instrument.genreId) {
      throw new ApiError(409, '計測機器ジャンルが未設定のため使用前点検できません');
    }
    const inspectionItems = await tx.inspectionItem.findMany({
      where: { genreId: instrument.genreId },
      orderBy: { order: 'asc' },
      select: { id: true }
    });
    if (inspectionItems.length > 0) {
      await tx.inspectionRecord.createMany({
        data: inspectionItems.map((item) => ({
          measuringInstrumentId: instrument.id,
          loanId: loan.id,
          employeeId: employee.id,
          inspectionItemId: item.id,
          result: 'PASS',
          inspectedAt
        }))
      });
    }

    const usage = await tx.selfInspectionLotEntryInstrumentUsage.create({
      data: {
        entryId: entry.id,
        measuringInstrumentId: instrument.id,
        loanId: loan.id,
        measuringInstrumentManagementNumberSnapshot: instrument.managementNumber,
        measuringInstrumentNameSnapshot: instrument.name,
        measuringInstrumentTagUidSnapshot: instrumentTagUid,
        preUseInspectedAt: inspectedAt
      }
    });

    if (!entry.measuringInstrumentId) {
      await tx.selfInspectionLotEntry.update({
        where: { id: entry.id },
        data: {
          measuringInstrumentId: instrument.id,
          measuringInstrumentManagementNumberSnapshot: instrument.managementNumber,
          measuringInstrumentNameSnapshot: instrument.name,
          measuringInstrumentTagUidSnapshot: instrumentTagUid
        }
      });
    }

    const serializedEntry = await loadLotEntryForSerialization(tx, entry.id);
    return {
      entry: serializeLotEntry(serializedEntry),
      usage: serializeInstrumentUsage(usage),
      loan: {
        id: loan.id,
        reused: Boolean(existingLoan)
      },
      loanEvent: existingLoan
        ? null
        : {
            managementNumber: instrument.managementNumber,
            eventAt: loan.borrowedAt,
            borrowerName: employee.displayName,
            employeeCode: employee.employeeCode,
            instrumentName: instrument.name,
            loanId: loan.id,
            clientId: input.clientDeviceId ?? null
          },
      reusedExistingUsage: false
    };
  });

  if (result.loanEvent) {
    try {
      await loanEventService.recordNfcEvent({
        managementNumber: result.loanEvent.managementNumber,
        action: '持ち出し',
        eventAt: result.loanEvent.eventAt,
        borrowerName: result.loanEvent.borrowerName,
        employeeCode: result.loanEvent.employeeCode,
        instrumentName: result.loanEvent.instrumentName,
        loanId: result.loanEvent.loanId,
        clientId: result.loanEvent.clientId
      });
    } catch (error) {
      logger.warn({ err: error, loanId: result.loanEvent.loanId }, 'Failed to mirror self-inspection instrument loan event');
    }
  }
  resetSelfInspectionMachineBoardScheduleRowCaches();
  return result;
}
