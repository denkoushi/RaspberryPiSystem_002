import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import pkg from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { ApiError } from '../../../lib/errors.js';
import type { CsvImporter, ImportSummary } from '../csv-importer.types.js';

const { ItemStatus } = pkg;

const itemCsvSchema = z.object({
  itemCode: z.string().regex(/^TO\d{4}$/, '管理番号はTO + 数字4桁である必要があります（例: TO0001）'),
  name: z.string().min(1, '工具名は必須です'),
  nfcTagUid: z.string().optional(),
  category: z.string().optional(),
  storageLocation: z.string().optional(),
  status: z.string().optional(),
  notes: z.string().optional()
});

type ItemCsvRow = z.infer<typeof itemCsvSchema>;

function normalizeItemStatus(value?: string) {
  if (!value || !value.trim()) return ItemStatus.AVAILABLE;
  const upper = value.trim().toUpperCase();
  if (upper in ItemStatus) {
    return ItemStatus[upper as keyof typeof ItemStatus];
  }
  return ItemStatus.AVAILABLE;
}

function parseCsvRows(buffer: Buffer): Record<string, string>[] {
  if (!buffer.length) {
    return [];
  }
  return parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as Record<string, string>[];
}

/**
 * アイテムCSVインポータ
 */
export class ItemCsvImporter implements CsvImporter {
  readonly type = 'items' as const;

  async parse(buffer: Buffer): Promise<ItemCsvRow[]> {
    const parsedRows = parseCsvRows(buffer);
    return parsedRows.map((row, index) => {
      try {
        return itemCsvSchema.parse(row);
      } catch (error) {
        throw new ApiError(400, `アイテムCSVの${index + 2}行目でエラー: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  async import(
    rows: unknown[],
    replaceExisting: boolean,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _logger?: { info: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void }
  ): Promise<ImportSummary> {
    const itemRows = rows as ItemCsvRow[];

    if (itemRows.length === 0) {
      return { processed: 0, created: 0, updated: 0 };
    }

    const result: ImportSummary = {
      processed: itemRows.length,
      created: 0,
      updated: 0
    };

    // replaceExisting=trueの場合: Loanレコードが存在しないアイテムを削除
    if (replaceExisting) {
      const loans = await prisma.loan.findMany({
        select: { itemId: true }
      });
      const itemIdsWithLoans = new Set(
        loans
          .map(l => l.itemId)
          .filter((id): id is string => id !== null)
      );
      
      if (itemIdsWithLoans.size > 0) {
        await prisma.item.deleteMany({
          where: {
            id: {
              notIn: Array.from(itemIdsWithLoans)
            }
          }
        });
      } else {
        await prisma.item.deleteMany();
      }
    }

    // CSV内のnfcTagUid重複チェック
    const itemNfcTagUidMap = new Map<string, string[]>();
    for (const row of itemRows) {
      if (row.nfcTagUid && row.nfcTagUid.trim()) {
        const uid = row.nfcTagUid.trim();
        if (!itemNfcTagUidMap.has(uid)) {
          itemNfcTagUidMap.set(uid, []);
        }
        itemNfcTagUidMap.get(uid)!.push(row.itemCode);
      }
    }
    const duplicateItemNfcTagUids = Array.from(itemNfcTagUidMap.entries())
      .filter(([, codes]) => codes.length > 1)
      .map(([uid, codes]) => ({ uid, itemCodes: codes }));
    if (duplicateItemNfcTagUids.length > 0) {
      const errorMessage = `CSV内でnfcTagUidが重複しています: ${duplicateItemNfcTagUids.map(({ uid, itemCodes }) => `nfcTagUid="${uid}" (itemCode: ${itemCodes.join(', ')})`).join('; ')}`;
      throw new ApiError(400, errorMessage);
    }

    // 各行をループ処理
    await prisma.$transaction(async (tx) => {
      for (const row of itemRows) {
        const updateData = {
          name: row.name,
          description: row.notes || null,
          category: row.category || null,
          storageLocation: row.storageLocation || null,
          nfcTagUid: row.nfcTagUid || null,
          status: normalizeItemStatus(row.status),
          notes: row.notes || null
        };
        const createData = {
          itemCode: row.itemCode,
          ...updateData
        };

        const existing = await tx.item.findUnique({ where: { itemCode: row.itemCode } });
        
        if (existing) {
          // 更新処理
          if (row.nfcTagUid && row.nfcTagUid.trim()) {
            const otherItem = await tx.item.findFirst({
              where: {
                nfcTagUid: row.nfcTagUid.trim(),
                itemCode: { not: row.itemCode }
              }
            });
            if (otherItem) {
              const errorMessage = `nfcTagUid="${row.nfcTagUid}"は既にitemCode="${otherItem.itemCode}"で使用されています。itemCode="${row.itemCode}"では使用できません。`;
              throw new ApiError(400, errorMessage);
            }
          }
          
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id: _ignoredId, createdAt: _ignoredCreatedAt, updatedAt: _ignoredUpdatedAt, itemCode: _ignoredItemCode, ...finalUpdateData } = updateData;
          await tx.item.update({
            where: { itemCode: row.itemCode },
            data: finalUpdateData
          });
          result.updated += 1;
        } else {
          // 作成処理
          if (row.nfcTagUid && row.nfcTagUid.trim()) {
            const existingWithSameNfcTag = await tx.item.findFirst({
              where: {
                nfcTagUid: row.nfcTagUid.trim()
              }
            });
            if (existingWithSameNfcTag) {
              const errorMessage = `nfcTagUid="${row.nfcTagUid}"は既にitemCode="${existingWithSameNfcTag.itemCode}"で使用されています。itemCode="${row.itemCode}"では使用できません。`;
              throw new ApiError(400, errorMessage);
            }
          }
          
          await tx.item.create({
            data: createData
          });
          result.created += 1;
        }
      }
    }, {
      timeout: 30000,
      isolationLevel: 'ReadCommitted'
    });

    return result;
  }
}

