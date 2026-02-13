import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ItemStatus } from '@prisma/client';
import { ItemService } from '../item.service.js';
import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';

// Prismaのモック
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    item: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

describe('ItemService', () => {
  let itemService: ItemService;

  beforeEach(() => {
    vi.clearAllMocks();
    itemService = new ItemService();
  });

  describe('findAll', () => {
    it('全アイテムを取得する', async () => {
      const mockItems = [
        {
          id: 'item-1',
          itemCode: 'ITEM001',
          name: 'Item 1',
          description: 'Description 1',
          nfcTagUid: 'UID1',
          category: 'Category 1',
          storageLocation: 'Location 1',
          status: ItemStatus.AVAILABLE,
          notes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'item-2',
          itemCode: 'ITEM002',
          name: 'Item 2',
          description: 'Description 2',
          nfcTagUid: 'UID2',
          category: 'Category 2',
          storageLocation: 'Location 2',
          status: ItemStatus.AVAILABLE,
          notes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(prisma.item.findMany).mockResolvedValue(mockItems as any);

      const result = await itemService.findAll({});

      expect(result).toEqual(mockItems);
      expect(prisma.item.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { name: 'asc' },
      });
    });

    it('検索クエリでフィルタリングされる', async () => {
      const mockItems: any[] = [];

      vi.mocked(prisma.item.findMany).mockResolvedValue(mockItems);

      await itemService.findAll({ search: 'Test' });

      expect(prisma.item.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { name: { contains: 'Test', mode: 'insensitive' } },
            { itemCode: { contains: 'Test', mode: 'insensitive' } },
          ],
        },
        orderBy: { name: 'asc' },
      });
    });

    it('ステータスでフィルタリングされる', async () => {
      const mockItems: any[] = [];

      vi.mocked(prisma.item.findMany).mockResolvedValue(mockItems);

      await itemService.findAll({ status: ItemStatus.AVAILABLE });

      expect(prisma.item.findMany).toHaveBeenCalledWith({
        where: { status: ItemStatus.AVAILABLE },
        orderBy: { name: 'asc' },
      });
    });

    it('検索クエリとステータスを同時に指定できる', async () => {
      vi.mocked(prisma.item.findMany).mockResolvedValue([]);

      await itemService.findAll({ search: 'ITEM', status: ItemStatus.IN_USE });

      expect(prisma.item.findMany).toHaveBeenCalledWith({
        where: {
          status: ItemStatus.IN_USE,
          OR: [
            { name: { contains: 'ITEM', mode: 'insensitive' } },
            { itemCode: { contains: 'ITEM', mode: 'insensitive' } },
          ],
        },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('findById', () => {
    it('IDでアイテムを取得する', async () => {
      const mockItem = {
        id: 'item-1',
        itemCode: 'ITEM001',
        name: 'Item 1',
        description: 'Description 1',
        nfcTagUid: 'UID1',
        category: 'Category 1',
        storageLocation: 'Location 1',
        status: ItemStatus.AVAILABLE,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.item.findUnique).mockResolvedValue(mockItem as any);

      const result = await itemService.findById('item-1');

      expect(result).toEqual(mockItem);
      expect(prisma.item.findUnique).toHaveBeenCalledWith({
        where: { id: 'item-1' },
      });
    });

    it('アイテムが見つからない場合、404エラーを投げる', async () => {
      vi.mocked(prisma.item.findUnique).mockResolvedValue(null);

      await expect(itemService.findById('non-existent')).rejects.toThrow(ApiError);
      await expect(itemService.findById('non-existent')).rejects.toThrow(
        'アイテムが見つかりません',
      );
    });
  });

  describe('findByNfcTagUid', () => {
    it('NFCタグUIDでアイテムを取得する', async () => {
      const mockItem = {
        id: 'item-1',
        itemCode: 'ITEM001',
        name: 'Item 1',
        description: 'Description 1',
        nfcTagUid: 'UID1',
        category: 'Category 1',
        storageLocation: 'Location 1',
        status: ItemStatus.AVAILABLE,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.item.findFirst).mockResolvedValue(mockItem as any);

      const result = await itemService.findByNfcTagUid('UID1');

      expect(result).toEqual(mockItem);
      expect(prisma.item.findFirst).toHaveBeenCalledWith({
        where: { nfcTagUid: 'UID1' },
      });
    });

    it('アイテムが見つからない場合、nullを返す', async () => {
      vi.mocked(prisma.item.findFirst).mockResolvedValue(null);

      const result = await itemService.findByNfcTagUid('INVALID_UID');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('アイテムを作成する', async () => {
      const input = {
        itemCode: 'ITEM001',
        name: 'New Item',
        description: 'New Description',
        nfcTagUid: 'UID1',
        category: 'Category 1',
        storageLocation: 'Location 1',
        status: ItemStatus.AVAILABLE,
        notes: 'Notes',
      };

      const mockItem = {
        id: 'item-1',
        ...input,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.item.create).mockResolvedValue(mockItem as any);

      const result = await itemService.create(input);

      expect(result).toEqual(mockItem);
      expect(prisma.item.create).toHaveBeenCalledWith({
        data: {
          itemCode: 'ITEM001',
          name: 'New Item',
          description: 'New Description',
          nfcTagUid: 'UID1',
          category: 'Category 1',
          storageLocation: 'Location 1',
          status: ItemStatus.AVAILABLE,
          notes: 'Notes',
        },
      });
    });

    it('オプショナルフィールドがnullの場合、undefinedとして扱う', async () => {
      const input = {
        itemCode: 'ITEM001',
        name: 'New Item',
        description: null,
        nfcTagUid: null,
        category: null,
        storageLocation: null,
        notes: null,
      };

      const mockItem = {
        id: 'item-1',
        itemCode: 'ITEM001',
        name: 'New Item',
        description: null,
        nfcTagUid: null,
        category: null,
        storageLocation: null,
        status: ItemStatus.AVAILABLE,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.item.create).mockResolvedValue(mockItem as any);

      await itemService.create(input);

      expect(prisma.item.create).toHaveBeenCalledWith({
        data: {
          itemCode: 'ITEM001',
          name: 'New Item',
          description: undefined,
          nfcTagUid: undefined,
          category: undefined,
          storageLocation: undefined,
          status: 'AVAILABLE',
          notes: undefined,
        },
      });
    });
  });

  describe('update', () => {
    it('アイテムを更新する', async () => {
      const input = {
        name: 'Updated Item',
        category: 'Updated Category',
      };

      const mockItem = {
        id: 'item-1',
        itemCode: 'ITEM001',
        name: 'Updated Item',
        description: 'Description 1',
        nfcTagUid: 'UID1',
        category: 'Updated Category',
        storageLocation: 'Location 1',
        status: ItemStatus.AVAILABLE,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.item.update).mockResolvedValue(mockItem as any);

      const result = await itemService.update('item-1', input);

      expect(result).toEqual(mockItem);
      expect(prisma.item.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: input,
      });
    });
  });

  describe('delete', () => {
    it('アイテムを削除する', async () => {
      const mockItem = {
        id: 'item-1',
        itemCode: 'ITEM001',
        name: 'Item 1',
        description: 'Description 1',
        nfcTagUid: 'UID1',
        category: 'Category 1',
        storageLocation: 'Location 1',
        status: ItemStatus.AVAILABLE,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.item.delete).mockResolvedValue(mockItem as any);

      const result = await itemService.delete('item-1');

      expect(result).toEqual(mockItem);
      expect(prisma.item.delete).toHaveBeenCalledWith({
        where: { id: 'item-1' },
      });
    });
  });
});

