import type { Loan } from '@prisma/client';
import { RiggingStatus, TransactionAction } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { RiggingGearService } from './rigging-gear.service.js';
import { EmployeeService } from '../tools/employee.service.js';

export interface RiggingBorrowInput {
  riggingTagUid?: string;
  riggingGearId?: string;
  employeeTagUid: string;
  clientId?: string;
  dueAt?: Date;
  note?: string | null;
}

export interface RiggingReturnInput {
  loanId: string;
  clientId?: string;
  performedByUserId?: string;
  note?: string | null;
}

interface LoanWithRelations extends Loan {
  riggingGear: {
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

export class RiggingLoanService {
  private gearService: RiggingGearService;
  private employeeService: EmployeeService;

  constructor() {
    this.gearService = new RiggingGearService();
    this.employeeService = new EmployeeService();
  }

  async borrow(input: RiggingBorrowInput): Promise<LoanWithRelations> {
    logger.info({ input }, 'Rigging borrow request started');

    if (!input.riggingTagUid && !input.riggingGearId) {
      throw new ApiError(400, '吊具が選択されていません');
    }

    const gear = input.riggingTagUid
      ? await this.gearService.findByTagUid(input.riggingTagUid)
      : await this.gearService.findById(input.riggingGearId!);
    if (!gear) {
      throw new ApiError(404, '吊具が登録されていません');
    }
    if (gear.status === RiggingStatus.RETIRED) {
      throw new ApiError(400, '廃棄済みの吊具は持出できません');
    }

    const employee = await this.employeeService.findByNfcTagUid(input.employeeTagUid);
    if (!employee) {
      throw new ApiError(404, '従業員が登録されていません');
    }

    const existingLoan = await prisma.loan.findFirst({
      where: { riggingGearId: gear.id, returnedAt: null, cancelledAt: null }
    });
    if (existingLoan) {
      throw new ApiError(400, 'この吊具はすでに貸出中です');
    }

    const gearSnapshot = {
      id: gear.id,
      managementNumber: gear.managementNumber,
      name: gear.name
    };
    const employeeSnapshot = {
      id: employee.id,
      code: employee.employeeCode,
      name: employee.displayName
    };

    const loan = await prisma.$transaction(async (tx) => {
      const createdLoan = await tx.loan.create({
        data: {
          riggingGearId: gear.id,
          employeeId: employee.id,
          clientId: input.clientId,
          dueAt: input.dueAt,
          notes: input.note ?? undefined
        },
        include: { riggingGear: true, employee: true, client: true }
      });

      await tx.riggingGear.update({
        where: { id: gear.id },
        data: { status: RiggingStatus.IN_USE }
      });

      await tx.transaction.create({
        data: {
          loanId: createdLoan.id,
          action: TransactionAction.BORROW,
          actorEmployeeId: employee.id,
          clientId: input.clientId,
          details: {
            note: input.note ?? null,
            riggingSnapshot: gearSnapshot,
            employeeSnapshot
          }
        }
      });

      return createdLoan;
    });

    logger.info({ loanId: loan.id, riggingGearId: gear.id, employeeId: employee.id }, 'Rigging borrow completed');
    return loan as LoanWithRelations;
  }

  async return(input: RiggingReturnInput): Promise<LoanWithRelations> {
    logger.info({ loanId: input.loanId, clientId: input.clientId }, 'Rigging return request started');

    const loan = await prisma.loan.findUnique({ where: { id: input.loanId }, include: { riggingGear: true } });
    if (!loan || !loan.riggingGearId) {
      throw new ApiError(404, '吊具の貸出が見つかりません');
    }
    if (loan.returnedAt) {
      throw new ApiError(400, 'すでに返却済みです');
    }

    const updatedLoan = await prisma.$transaction(async (tx) => {
      const result = await tx.loan.update({
        where: { id: input.loanId },
        data: { returnedAt: new Date(), notes: input.note ?? undefined },
        include: { riggingGear: true, employee: true, client: true }
      });

      if (loan.riggingGearId) {
        await tx.riggingGear.update({
          where: { id: loan.riggingGearId },
          data: { status: RiggingStatus.AVAILABLE }
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

    logger.info({ loanId: updatedLoan.id }, 'Rigging return completed');
    return updatedLoan as LoanWithRelations;
  }
}
