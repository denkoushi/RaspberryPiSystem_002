import type { Loan } from '@prisma/client';
import { MeasuringInstrumentStatus, TransactionAction } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { MeasuringInstrumentService } from './measuring-instrument.service.js';
import { EmployeeService } from '../tools/employee.service.js';

export interface InstrumentBorrowInput {
  instrumentTagUid: string;
  employeeTagUid: string;
  clientId?: string;
  dueAt?: Date;
  note?: string | null;
}

export interface InstrumentReturnInput {
  loanId: string;
  clientId?: string;
  performedByUserId?: string;
  note?: string | null;
}

interface LoanWithRelations extends Loan {
  measuringInstrument: {
    id: string;
    managementNumber: string;
    name: string;
  } | null;
  employee: {
    id: string;
    employeeCode: string;
    displayName: string;
  } | null;
  client?: { id: string; name: string; location: string | null } | null;
}

export class MeasuringInstrumentLoanService {
  private instrumentService: MeasuringInstrumentService;
  private employeeService: EmployeeService;

  constructor() {
    this.instrumentService = new MeasuringInstrumentService();
    this.employeeService = new EmployeeService();
  }

  async borrow(input: InstrumentBorrowInput): Promise<LoanWithRelations> {
    logger.info(
      { instrumentTagUid: input.instrumentTagUid, employeeTagUid: input.employeeTagUid, clientId: input.clientId },
      'Instrument borrow request started'
    );

    const instrument = await this.instrumentService.findByTagUid(input.instrumentTagUid);
    if (!instrument) {
      throw new ApiError(404, '計測機器が登録されていません');
    }
    if (instrument.status === MeasuringInstrumentStatus.RETIRED) {
      throw new ApiError(400, '廃棄済みの計測機器は持出できません');
    }

    const employee = await this.employeeService.findByNfcTagUid(input.employeeTagUid);
    if (!employee) {
      throw new ApiError(404, '従業員が登録されていません');
    }

    const existingLoan = await prisma.loan.findFirst({
      where: { measuringInstrumentId: instrument.id, returnedAt: null }
    });
    if (existingLoan) {
      throw new ApiError(400, 'この計測機器はすでに貸出中です');
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

    const loan = await prisma.$transaction(async (tx) => {
      const createdLoan = await tx.loan.create({
        data: {
          measuringInstrumentId: instrument.id,
          employeeId: employee.id,
          clientId: input.clientId,
          dueAt: input.dueAt,
          notes: input.note ?? undefined
        },
        include: { measuringInstrument: true, employee: true, client: true }
      });

      await tx.measuringInstrument.update({
        where: { id: instrument.id },
        data: { status: MeasuringInstrumentStatus.IN_USE }
      });

      await tx.transaction.create({
        data: {
          loanId: createdLoan.id,
          action: TransactionAction.BORROW,
          actorEmployeeId: employee.id,
          clientId: input.clientId,
          details: {
            note: input.note ?? null,
            instrumentSnapshot,
            employeeSnapshot
          }
        }
      });

      return createdLoan;
    });

    logger.info({ loanId: loan.id, instrumentId: instrument.id, employeeId: employee.id }, 'Instrument borrow completed');
    return loan as LoanWithRelations;
  }

  async return(input: InstrumentReturnInput): Promise<LoanWithRelations> {
    logger.info({ loanId: input.loanId, clientId: input.clientId }, 'Instrument return request started');

    const loan = await prisma.loan.findUnique({ where: { id: input.loanId }, include: { measuringInstrument: true } });
    if (!loan || !loan.measuringInstrumentId) {
      throw new ApiError(404, '計測機器の貸出が見つかりません');
    }
    if (loan.returnedAt) {
      throw new ApiError(400, 'すでに返却済みです');
    }

    const updatedLoan = await prisma.$transaction(async (tx) => {
      const result = await tx.loan.update({
        where: { id: input.loanId },
        data: { returnedAt: new Date(), notes: input.note ?? undefined },
        include: { measuringInstrument: true, employee: true, client: true }
      });

      if (loan.measuringInstrumentId) {
        await tx.measuringInstrument.update({
          where: { id: loan.measuringInstrumentId },
          data: { status: MeasuringInstrumentStatus.AVAILABLE }
        });
      }

      await tx.transaction.create({
        data: {
          loanId: loan.id,
          action: TransactionAction.RETURN,
          actorEmployeeId: loan.employeeId ?? undefined,
          clientId: input.clientId ?? loan.clientId ?? undefined,
          details: {
            note: input.note ?? null
          }
        }
      });

      return result;
    });

    logger.info({ loanId: updatedLoan.id }, 'Instrument return completed');
    return updatedLoan as LoanWithRelations;
  }
}
