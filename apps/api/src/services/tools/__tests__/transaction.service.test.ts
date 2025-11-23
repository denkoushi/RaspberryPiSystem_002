import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TransactionAction } from '@prisma/client';
import { TransactionService } from '../transaction.service.js';
import { prisma } from '../../../lib/prisma.js';

// Prismaのモック
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    transaction: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe('TransactionService', () => {
  let transactionService: TransactionService;

  beforeEach(() => {
    vi.clearAllMocks();
    transactionService = new TransactionService();
  });

  describe('findAll', () => {
    it('全トランザクションを取得する', async () => {
      const mockTransactions = [
        {
          id: 'transaction-1',
          loanId: 'loan-1',
          action: TransactionAction.BORROW,
          actorEmployeeId: 'employee-1',
          performedByUserId: null,
          clientId: 'client-1',
          details: {
            itemSnapshot: {
              id: 'item-1',
              code: 'ITEM001',
              name: 'Item 1',
              nfcTagUid: 'UID1',
            },
            employeeSnapshot: {
              id: 'employee-1',
              code: 'EMP001',
              name: 'Employee 1',
              nfcTagUid: 'UID2',
            },
            note: null,
          },
          createdAt: new Date('2025-01-01'),
          loan: {
            id: 'loan-1',
            item: { id: 'item-1', itemCode: 'ITEM001', name: 'Item 1', nfcTagUid: 'UID1' },
            employee: {
              id: 'employee-1',
              employeeCode: 'EMP001',
              displayName: 'Employee 1',
              nfcTagUid: 'UID2',
            },
            client: null,
          },
          actorEmployee: { id: 'employee-1', employeeCode: 'EMP001', displayName: 'Employee 1' },
          performedByUser: null,
          client: null,
        },
      ];

      vi.mocked(prisma.$transaction).mockResolvedValue([2, mockTransactions] as any);

      const result = await transactionService.findAll({});

      expect(result.transactions).toEqual(mockTransactions);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });

    it('日付範囲でフィルタリングされる', async () => {
      const mockTransactions: any[] = [];
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-31');

      vi.mocked(prisma.$transaction).mockResolvedValue([0, mockTransactions] as any);

      const result = await transactionService.findAll({ startDate, endDate });

      expect(result.transactions).toEqual(mockTransactions);
      expect(result.total).toBe(0);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('employeeIdでフィルタリングされる', async () => {
      const mockTransactions: any[] = [];

      vi.mocked(prisma.$transaction).mockResolvedValue([0, mockTransactions] as any);

      const result = await transactionService.findAll({ employeeId: 'employee-1' });

      expect(result.transactions).toEqual(mockTransactions);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('itemIdでフィルタリングされる', async () => {
      const mockTransactions: any[] = [];

      vi.mocked(prisma.$transaction).mockResolvedValue([0, mockTransactions] as any);

      const result = await transactionService.findAll({ itemId: 'item-1' });

      expect(result.transactions).toEqual(mockTransactions);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('ページネーションが機能する', async () => {
      const mockTransactions: any[] = [];

      vi.mocked(prisma.$transaction).mockResolvedValue([100, mockTransactions] as any);

      const result = await transactionService.findAll({ page: 2, pageSize: 10 });

      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(10);
      expect(result.total).toBe(100);
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });
});

