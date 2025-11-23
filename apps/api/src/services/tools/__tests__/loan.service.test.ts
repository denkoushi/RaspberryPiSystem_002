import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ItemStatus, TransactionAction } from '@prisma/client';
import { LoanService } from '../loan.service.js';
import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { ItemService } from '../item.service.js';
import { EmployeeService } from '../employee.service.js';

// Prismaと依存サービスのモック
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    clientDevice: {
      findUnique: vi.fn(),
    },
    loan: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    item: {
      update: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../item.service.js', () => ({
  ItemService: vi.fn(),
}));

vi.mock('../employee.service.js', () => ({
  EmployeeService: vi.fn(),
}));

vi.mock('../../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('LoanService', () => {
  let loanService: LoanService;
  let mockItemService: ItemService;
  let mockEmployeeService: EmployeeService;

  beforeEach(() => {
    vi.clearAllMocks();

    // モックサービスのインスタンスを作成
    mockItemService = {
      findByNfcTagUid: vi.fn(),
    } as unknown as ItemService;

    mockEmployeeService = {
      findByNfcTagUid: vi.fn(),
    } as unknown as EmployeeService;

    // LoanServiceのコンストラクタをモックして依存サービスを注入
    loanService = new LoanService();
    (loanService as any).itemService = mockItemService;
    (loanService as any).employeeService = mockEmployeeService;
  });

  describe('resolveClientId', () => {
    it('clientIdが指定されている場合、クライアントを取得してIDを返す', async () => {
      const clientId = 'client-123';
      const mockClient = { id: clientId, name: 'Test Client', apiKey: 'test-key' };

      vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue(mockClient as any);

      const result = await loanService.resolveClientId(clientId, undefined);

      expect(result).toBe(clientId);
      expect(prisma.clientDevice.findUnique).toHaveBeenCalledWith({
        where: { id: clientId },
      });
    });

    it('clientIdが存在しない場合、404エラーを投げる', async () => {
      const clientId = 'non-existent';

      vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue(null);

      await expect(loanService.resolveClientId(clientId, undefined)).rejects.toThrow(
        ApiError,
      );
      await expect(loanService.resolveClientId(clientId, undefined)).rejects.toThrow(
        '指定されたクライアントが存在しません',
      );
    });

    it('apiKeyHeaderが指定されている場合、APIキーでクライアントを取得', async () => {
      const apiKey = 'test-api-key';
      const mockClient = { id: 'client-456', name: 'Test Client', apiKey };

      vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue(mockClient as any);

      const result = await loanService.resolveClientId(undefined, apiKey);

      expect(result).toBe('client-456');
      expect(prisma.clientDevice.findUnique).toHaveBeenCalledWith({
        where: { apiKey },
      });
    });

    it('apiKeyHeaderが不正な場合、401エラーを投げる', async () => {
      const apiKey = 'invalid-key';

      vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue(null);

      await expect(loanService.resolveClientId(undefined, apiKey)).rejects.toThrow(ApiError);
      await expect(loanService.resolveClientId(undefined, apiKey)).rejects.toThrow(
        'クライアント API キーが不正です',
      );
    });

    it('clientIdもapiKeyHeaderも指定されていない場合、undefinedを返す', async () => {
      const result = await loanService.resolveClientId(undefined, undefined);

      expect(result).toBeUndefined();
    });
  });

  describe('borrow', () => {
    const mockItem = {
      id: 'item-123',
      itemCode: 'ITEM001',
      name: 'Test Item',
      nfcTagUid: '04DE8366BC2A81',
      status: ItemStatus.AVAILABLE,
    };

    const mockEmployee = {
      id: 'employee-123',
      employeeCode: 'EMP001',
      displayName: 'Test Employee',
      nfcTagUid: '04C362E1330289',
    };

    const mockLoan = {
      id: 'loan-123',
      itemId: 'item-123',
      employeeId: 'employee-123',
      clientId: 'client-123',
      borrowedAt: new Date(),
      returnedAt: null,
      item: mockItem,
      employee: mockEmployee,
      client: { id: 'client-123', name: 'Test Client', location: null },
    };

    it('正常に持出処理が完了する', async () => {
      const input = {
        itemTagUid: '04DE8366BC2A81',
        employeeTagUid: '04C362E1330289',
        clientId: 'client-123',
      };

      vi.mocked(mockItemService.findByNfcTagUid).mockResolvedValue(mockItem as any);
      vi.mocked(mockEmployeeService.findByNfcTagUid).mockResolvedValue(mockEmployee as any);
      vi.mocked(prisma.loan.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          loan: {
            create: vi.fn().mockResolvedValue(mockLoan),
          },
          item: {
            update: vi.fn().mockResolvedValue(mockItem),
          },
          transaction: {
            create: vi.fn().mockResolvedValue({
              id: 'transaction-123',
              loanId: 'loan-123',
              action: TransactionAction.BORROW,
            }),
          },
        };
        return callback(tx);
      });

      const result = await loanService.borrow(input, 'client-123');

      expect(result).toEqual(mockLoan);
      expect(mockItemService.findByNfcTagUid).toHaveBeenCalledWith('04DE8366BC2A81');
      expect(mockEmployeeService.findByNfcTagUid).toHaveBeenCalledWith('04C362E1330289');
      expect(prisma.loan.findFirst).toHaveBeenCalledWith({
        where: { itemId: 'item-123', returnedAt: null },
      });
    });

    it('アイテムが見つからない場合、404エラーを投げる', async () => {
      const input = {
        itemTagUid: 'INVALID_UID',
        employeeTagUid: '04C362E1330289',
      };

      vi.mocked(mockItemService.findByNfcTagUid).mockResolvedValue(null);

      await expect(loanService.borrow(input)).rejects.toThrow(ApiError);
      await expect(loanService.borrow(input)).rejects.toThrow(
        '対象アイテムが登録されていません',
      );
    });

    it('廃棄済みアイテムの場合、400エラーを投げる', async () => {
      const input = {
        itemTagUid: '04DE8366BC2A81',
        employeeTagUid: '04C362E1330289',
      };

      const retiredItem = { ...mockItem, status: ItemStatus.RETIRED };

      vi.mocked(mockItemService.findByNfcTagUid).mockResolvedValue(retiredItem as any);

      await expect(loanService.borrow(input)).rejects.toThrow(ApiError);
      await expect(loanService.borrow(input)).rejects.toThrow(
        '廃棄済みアイテムは持出できません',
      );
    });

    it('従業員が見つからない場合、404エラーを投げる', async () => {
      const input = {
        itemTagUid: '04DE8366BC2A81',
        employeeTagUid: 'INVALID_UID',
      };

      vi.mocked(mockItemService.findByNfcTagUid).mockResolvedValue(mockItem as any);
      vi.mocked(mockEmployeeService.findByNfcTagUid).mockResolvedValue(null);

      await expect(loanService.borrow(input)).rejects.toThrow(ApiError);
      await expect(loanService.borrow(input)).rejects.toThrow(
        '対象従業員が登録されていません',
      );
    });

    it('既に貸出中のアイテムの場合、400エラーを投げる', async () => {
      const input = {
        itemTagUid: '04DE8366BC2A81',
        employeeTagUid: '04C362E1330289',
      };

      const existingLoan = {
        id: 'existing-loan-123',
        itemId: 'item-123',
        returnedAt: null,
      };

      vi.mocked(mockItemService.findByNfcTagUid).mockResolvedValue(mockItem as any);
      vi.mocked(mockEmployeeService.findByNfcTagUid).mockResolvedValue(mockEmployee as any);
      vi.mocked(prisma.loan.findFirst).mockResolvedValue(existingLoan as any);

      await expect(loanService.borrow(input)).rejects.toThrow(ApiError);
      await expect(loanService.borrow(input)).rejects.toThrow(
        'このアイテムはすでに貸出中です',
      );
    });
  });

  describe('return', () => {
    const mockLoan = {
      id: 'loan-123',
      itemId: 'item-123',
      employeeId: 'employee-123',
      clientId: 'client-123',
      borrowedAt: new Date('2025-01-01'),
      returnedAt: null,
      notes: null,
      item: {
        id: 'item-123',
        itemCode: 'ITEM001',
        name: 'Test Item',
        nfcTagUid: '04DE8366BC2A81',
      },
      employee: {
        id: 'employee-123',
        employeeCode: 'EMP001',
        displayName: 'Test Employee',
        nfcTagUid: '04C362E1330289',
      },
    };

    const mockReturnedLoan = {
      ...mockLoan,
      returnedAt: new Date(),
      client: { id: 'client-123', name: 'Test Client', location: null },
    };

    it('正常に返却処理が完了する', async () => {
      const input = {
        loanId: 'loan-123',
      };

      vi.mocked(prisma.loan.findUnique).mockResolvedValue(mockLoan as any);
      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          loan: {
            update: vi.fn().mockResolvedValue(mockReturnedLoan),
          },
          item: {
            update: vi.fn().mockResolvedValue({
              id: 'item-123',
              status: ItemStatus.AVAILABLE,
            }),
          },
          transaction: {
            create: vi.fn().mockResolvedValue({
              id: 'transaction-123',
              loanId: 'loan-123',
              action: TransactionAction.RETURN,
            }),
          },
        };
        return callback(tx);
      });

      const result = await loanService.return(input, 'client-123');

      expect(result).toEqual(mockReturnedLoan);
      expect(prisma.loan.findUnique).toHaveBeenCalledWith({
        where: { id: 'loan-123' },
        include: { item: true, employee: true },
      });
    });

    it('貸出レコードが見つからない場合、404エラーを投げる', async () => {
      const input = {
        loanId: 'non-existent',
      };

      vi.mocked(prisma.loan.findUnique).mockResolvedValue(null);

      await expect(loanService.return(input)).rejects.toThrow(ApiError);
      await expect(loanService.return(input)).rejects.toThrow('貸出レコードが見つかりません');
    });

    it('既に返却済みの場合、400エラーを投げる', async () => {
      const input = {
        loanId: 'loan-123',
      };

      const alreadyReturnedLoan = {
        ...mockLoan,
        returnedAt: new Date(),
      };

      vi.mocked(prisma.loan.findUnique).mockResolvedValue(alreadyReturnedLoan as any);

      await expect(loanService.return(input)).rejects.toThrow(ApiError);
      await expect(loanService.return(input)).rejects.toThrow('すでに返却済みです');
    });
  });

  describe('findActive', () => {
    it('アクティブな貸出一覧を取得する', async () => {
      const mockLoans = [
        {
          id: 'loan-1',
          itemId: 'item-1',
          employeeId: 'employee-1',
          returnedAt: null,
          item: { id: 'item-1', itemCode: 'ITEM001', name: 'Item 1', nfcTagUid: 'UID1' },
          employee: {
            id: 'employee-1',
            employeeCode: 'EMP001',
            displayName: 'Employee 1',
            nfcTagUid: 'UID2',
          },
          client: null,
        },
      ];

      vi.mocked(prisma.loan.findMany).mockResolvedValue(mockLoans as any);

      const result = await loanService.findActive({});

      expect(result).toEqual(mockLoans);
      expect(prisma.loan.findMany).toHaveBeenCalledWith({
        where: { returnedAt: null },
        include: { item: true, employee: true, client: true },
        orderBy: { borrowedAt: 'desc' },
      });
    });

    it('clientIdが指定されている場合、フィルタリングされる', async () => {
      const mockLoans: any[] = [];

      vi.mocked(prisma.loan.findMany).mockResolvedValue(mockLoans);

      await loanService.findActive({ clientId: 'client-123' });

      expect(prisma.loan.findMany).toHaveBeenCalledWith({
        where: { returnedAt: null, clientId: 'client-123' },
        include: { item: true, employee: true, client: true },
        orderBy: { borrowedAt: 'desc' },
      });
    });
  });
});

