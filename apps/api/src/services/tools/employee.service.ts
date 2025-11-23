import type { Prisma, Employee, EmployeeStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

export interface EmployeeCreateInput {
  employeeCode: string;
  displayName: string;
  nfcTagUid?: string | null;
  department?: string | null;
  contact?: string | null;
  status?: EmployeeStatus;
}

export interface EmployeeUpdateInput {
  employeeCode?: string;
  displayName?: string;
  nfcTagUid?: string | null;
  department?: string | null;
  contact?: string | null;
  status?: EmployeeStatus;
}

export interface EmployeeQuery {
  search?: string;
  status?: EmployeeStatus;
}

export class EmployeeService {
  /**
   * 従業員一覧を取得
   */
  async findAll(query: EmployeeQuery): Promise<Employee[]> {
    const where: Prisma.EmployeeWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { displayName: { contains: query.search, mode: 'insensitive' } },
              { employeeCode: { contains: query.search, mode: 'insensitive' } }
            ]
          }
        : {})
    };

    return await prisma.employee.findMany({
      where,
      orderBy: { displayName: 'asc' }
    });
  }

  /**
   * IDで従業員を取得
   */
  async findById(id: string): Promise<Employee> {
    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) {
      throw new ApiError(404, '従業員が見つかりません');
    }
    return employee;
  }

  /**
   * NFCタグUIDで従業員を取得
   */
  async findByNfcTagUid(nfcTagUid: string): Promise<Employee | null> {
    return await prisma.employee.findFirst({ where: { nfcTagUid } });
  }

  /**
   * 従業員を作成
   */
  async create(data: EmployeeCreateInput): Promise<Employee> {
    return await prisma.employee.create({
      data: {
        employeeCode: data.employeeCode,
        displayName: data.displayName,
        nfcTagUid: data.nfcTagUid ?? undefined,
        department: data.department ?? undefined,
        contact: data.contact ?? undefined,
        status: data.status ?? 'ACTIVE'
      }
    });
  }

  /**
   * 従業員を更新
   */
  async update(id: string, data: EmployeeUpdateInput): Promise<Employee> {
    return await prisma.employee.update({
      where: { id },
      data
    });
  }

  /**
   * 従業員を削除
   */
  async delete(id: string): Promise<Employee> {
    return await prisma.employee.delete({ where: { id } });
  }
}

