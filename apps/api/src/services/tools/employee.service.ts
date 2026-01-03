import type { Prisma, Employee, EmployeeStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

export interface EmployeeCreateInput {
  employeeCode: string;
  displayName?: string; // 後方互換性のため残す
  lastName?: string;
  firstName?: string;
  nfcTagUid?: string | null;
  department?: string | null;
  contact?: string | null;
  status?: EmployeeStatus;
}

export interface EmployeeUpdateInput {
  employeeCode?: string;
  displayName?: string; // 後方互換性のため残す
  lastName?: string;
  firstName?: string;
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
    // displayNameを自動生成（lastName + firstName が優先）
    const displayName = data.lastName && data.firstName
      ? `${data.lastName} ${data.firstName}`
      : data.displayName || '';
    
    return await prisma.employee.create({
      data: {
        employeeCode: data.employeeCode,
        displayName,
        lastName: data.lastName ?? null,
        firstName: data.firstName ?? null,
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
    // 既存の従業員データを取得
    const existing = await this.findById(id);
    
    // 更新データを準備
    const updateData: Prisma.EmployeeUpdateInput = {};
    
    if (data.employeeCode !== undefined) {
      updateData.employeeCode = data.employeeCode;
    }
    if (data.lastName !== undefined) {
      updateData.lastName = data.lastName;
    }
    if (data.firstName !== undefined) {
      updateData.firstName = data.firstName;
    }
    if (data.nfcTagUid !== undefined) {
      updateData.nfcTagUid = data.nfcTagUid ?? null;
    }
    if (data.department !== undefined) {
      updateData.department = data.department ?? null;
    }
    if (data.contact !== undefined) {
      updateData.contact = data.contact ?? null;
    }
    if (data.status !== undefined) {
      updateData.status = data.status;
    }
    
    // displayNameを自動生成（lastName + firstName が優先）
    const finalLastName = data.lastName !== undefined ? data.lastName : existing.lastName;
    const finalFirstName = data.firstName !== undefined ? data.firstName : existing.firstName;
    
    if (finalLastName && finalFirstName) {
      updateData.displayName = `${finalLastName} ${finalFirstName}`;
    } else if (data.displayName !== undefined) {
      updateData.displayName = data.displayName;
    }
    // どちらも提供されていない場合は既存のdisplayNameを維持
    
    return await prisma.employee.update({
      where: { id },
      data: updateData
    });
  }

  /**
   * 従業員を削除
   */
  async delete(id: string): Promise<Employee> {
    return await prisma.employee.delete({ where: { id } });
  }
}

