import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmployeeStatus } from '@prisma/client';
import { EmployeeService } from '../employee.service.js';
import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';

// Prismaのモック
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    employee: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

describe('EmployeeService', () => {
  let employeeService: EmployeeService;

  beforeEach(() => {
    vi.clearAllMocks();
    employeeService = new EmployeeService();
  });

  describe('findAll', () => {
    it('全従業員を取得する', async () => {
      const mockEmployees = [
        {
          id: 'employee-1',
          employeeCode: 'EMP001',
          displayName: 'Employee 1',
          nfcTagUid: 'UID1',
          department: 'Dept 1',
          contact: null,
          status: EmployeeStatus.ACTIVE,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'employee-2',
          employeeCode: 'EMP002',
          displayName: 'Employee 2',
          nfcTagUid: 'UID2',
          department: 'Dept 2',
          contact: null,
          status: EmployeeStatus.ACTIVE,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(prisma.employee.findMany).mockResolvedValue(mockEmployees as any);

      const result = await employeeService.findAll({});

      expect(result).toEqual(mockEmployees);
      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { displayName: 'asc' },
      });
    });

    it('検索クエリでフィルタリングされる', async () => {
      const mockEmployees: any[] = [];

      vi.mocked(prisma.employee.findMany).mockResolvedValue(mockEmployees);

      await employeeService.findAll({ search: 'Test' });

      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { displayName: { contains: 'Test', mode: 'insensitive' } },
            { employeeCode: { contains: 'Test', mode: 'insensitive' } },
          ],
        },
        orderBy: { displayName: 'asc' },
      });
    });

    it('ステータスでフィルタリングされる', async () => {
      const mockEmployees: any[] = [];

      vi.mocked(prisma.employee.findMany).mockResolvedValue(mockEmployees);

      await employeeService.findAll({ status: EmployeeStatus.ACTIVE });

      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: { status: EmployeeStatus.ACTIVE },
        orderBy: { displayName: 'asc' },
      });
    });
  });

  describe('findById', () => {
    it('IDで従業員を取得する', async () => {
      const mockEmployee = {
        id: 'employee-1',
        employeeCode: 'EMP001',
        displayName: 'Employee 1',
        nfcTagUid: 'UID1',
        department: 'Dept 1',
        contact: null,
        status: EmployeeStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.employee.findUnique).mockResolvedValue(mockEmployee as any);

      const result = await employeeService.findById('employee-1');

      expect(result).toEqual(mockEmployee);
      expect(prisma.employee.findUnique).toHaveBeenCalledWith({
        where: { id: 'employee-1' },
      });
    });

    it('従業員が見つからない場合、404エラーを投げる', async () => {
      vi.mocked(prisma.employee.findUnique).mockResolvedValue(null);

      await expect(employeeService.findById('non-existent')).rejects.toThrow(ApiError);
      await expect(employeeService.findById('non-existent')).rejects.toThrow(
        '従業員が見つかりません',
      );
    });
  });

  describe('findByNfcTagUid', () => {
    it('NFCタグUIDで従業員を取得する', async () => {
      const mockEmployee = {
        id: 'employee-1',
        employeeCode: 'EMP001',
        displayName: 'Employee 1',
        nfcTagUid: 'UID1',
        department: 'Dept 1',
        contact: null,
        status: EmployeeStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.employee.findFirst).mockResolvedValue(mockEmployee as any);

      const result = await employeeService.findByNfcTagUid('UID1');

      expect(result).toEqual(mockEmployee);
      expect(prisma.employee.findFirst).toHaveBeenCalledWith({
        where: { nfcTagUid: 'UID1' },
      });
    });

    it('従業員が見つからない場合、nullを返す', async () => {
      vi.mocked(prisma.employee.findFirst).mockResolvedValue(null);

      const result = await employeeService.findByNfcTagUid('INVALID_UID');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('従業員を作成する', async () => {
      const input = {
        employeeCode: 'EMP001',
        displayName: 'New Employee',
        nfcTagUid: 'UID1',
        department: 'Dept 1',
        contact: 'contact@example.com',
        status: EmployeeStatus.ACTIVE,
      };

      const mockEmployee = {
        id: 'employee-1',
        ...input,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.employee.create).mockResolvedValue(mockEmployee as any);

      const result = await employeeService.create(input);

      expect(result).toEqual(mockEmployee);
      expect(prisma.employee.create).toHaveBeenCalledWith({
        data: {
          employeeCode: 'EMP001',
          displayName: 'New Employee',
          nfcTagUid: 'UID1',
          department: 'Dept 1',
          contact: 'contact@example.com',
          status: EmployeeStatus.ACTIVE,
        },
      });
    });

    it('オプショナルフィールドがnullの場合、undefinedとして扱う', async () => {
      const input = {
        employeeCode: 'EMP001',
        displayName: 'New Employee',
        nfcTagUid: null,
        department: null,
        contact: null,
      };

      const mockEmployee = {
        id: 'employee-1',
        employeeCode: 'EMP001',
        displayName: 'New Employee',
        nfcTagUid: null,
        department: null,
        contact: null,
        status: EmployeeStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.employee.create).mockResolvedValue(mockEmployee as any);

      await employeeService.create(input);

      expect(prisma.employee.create).toHaveBeenCalledWith({
        data: {
          employeeCode: 'EMP001',
          displayName: 'New Employee',
          nfcTagUid: undefined,
          department: undefined,
          contact: undefined,
          status: 'ACTIVE',
        },
      });
    });
  });

  describe('update', () => {
    it('従業員を更新する', async () => {
      const input = {
        displayName: 'Updated Employee',
        department: 'Updated Dept',
      };

      const mockEmployee = {
        id: 'employee-1',
        employeeCode: 'EMP001',
        displayName: 'Updated Employee',
        nfcTagUid: 'UID1',
        department: 'Updated Dept',
        contact: null,
        status: EmployeeStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.employee.update).mockResolvedValue(mockEmployee as any);

      const result = await employeeService.update('employee-1', input);

      expect(result).toEqual(mockEmployee);
      expect(prisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'employee-1' },
        data: input,
      });
    });
  });

  describe('delete', () => {
    it('従業員を削除する', async () => {
      const mockEmployee = {
        id: 'employee-1',
        employeeCode: 'EMP001',
        displayName: 'Employee 1',
        nfcTagUid: 'UID1',
        department: 'Dept 1',
        contact: null,
        status: EmployeeStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.employee.delete).mockResolvedValue(mockEmployee as any);

      const result = await employeeService.delete('employee-1');

      expect(result).toEqual(mockEmployee);
      expect(prisma.employee.delete).toHaveBeenCalledWith({
        where: { id: 'employee-1' },
      });
    });
  });
});

