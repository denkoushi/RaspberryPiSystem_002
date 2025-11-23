import type { Prisma, Item, ItemStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

export interface ItemCreateInput {
  itemCode: string;
  name: string;
  description?: string | null;
  nfcTagUid?: string | null;
  category?: string | null;
  storageLocation?: string | null;
  status?: ItemStatus;
  notes?: string | null;
}

export interface ItemUpdateInput {
  itemCode?: string;
  name?: string;
  description?: string | null;
  nfcTagUid?: string | null;
  category?: string | null;
  storageLocation?: string | null;
  status?: ItemStatus;
  notes?: string | null;
}

export interface ItemQuery {
  search?: string;
  status?: ItemStatus;
}

export class ItemService {
  /**
   * アイテム一覧を取得
   */
  async findAll(query: ItemQuery): Promise<Item[]> {
    const where: Prisma.ItemWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { itemCode: { contains: query.search, mode: 'insensitive' } }
            ]
          }
        : {})
    };

    return await prisma.item.findMany({
      where,
      orderBy: { name: 'asc' }
    });
  }

  /**
   * IDでアイテムを取得
   */
  async findById(id: string): Promise<Item> {
    const item = await prisma.item.findUnique({ where: { id } });
    if (!item) {
      throw new ApiError(404, 'アイテムが見つかりません');
    }
    return item;
  }

  /**
   * NFCタグUIDでアイテムを取得
   */
  async findByNfcTagUid(nfcTagUid: string): Promise<Item | null> {
    return await prisma.item.findFirst({ where: { nfcTagUid } });
  }

  /**
   * アイテムを作成
   */
  async create(data: ItemCreateInput): Promise<Item> {
    return await prisma.item.create({
      data: {
        itemCode: data.itemCode,
        name: data.name,
        description: data.description ?? undefined,
        nfcTagUid: data.nfcTagUid ?? undefined,
        category: data.category ?? undefined,
        storageLocation: data.storageLocation ?? undefined,
        status: data.status ?? 'AVAILABLE',
        notes: data.notes ?? undefined
      }
    });
  }

  /**
   * アイテムを更新
   */
  async update(id: string, data: ItemUpdateInput): Promise<Item> {
    return await prisma.item.update({
      where: { id },
      data
    });
  }

  /**
   * アイテムを削除
   */
  async delete(id: string): Promise<Item> {
    return await prisma.item.delete({ where: { id } });
  }
}

