import type { FastifyInstance } from 'fastify';
import { RiggingStatus } from '@prisma/client';
import { authorizeRoles } from '../../../lib/auth.js';
import { prisma } from '../../../lib/prisma.js';
import { ItemService } from '../../../services/tools/item.service.js';
import { MeasuringInstrumentService } from '../../../services/measuring-instruments/measuring-instrument.service.js';
import { RiggingGearService } from '../../../services/rigging/rigging-gear.service.js';
import { unifiedQuerySchema } from './schemas.js';

export interface UnifiedItem {
  id: string;
  type: 'TOOL' | 'MEASURING_INSTRUMENT' | 'RIGGING_GEAR';
  name: string;
  code: string; // itemCode or managementNumber
  category?: string | null;
  storageLocation?: string | null;
  status: string;
  nfcTagUid?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function registerUnifiedListRoute(app: FastifyInstance): void {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  const itemService = new ItemService();
  const instrumentService = new MeasuringInstrumentService();
  const riggingService = new RiggingGearService();

  app.get('/unified', { preHandler: canView, config: { rateLimit: false } }, async (request) => {
    const query = unifiedQuerySchema.parse(request.query);

    const results: UnifiedItem[] = [];

    // 工具を取得
    if (query.category === 'ALL' || query.category === 'TOOLS') {
      const items = await itemService.findAll({
        search: query.search,
        status: query.itemStatus
      });
      results.push(
        ...items.map((item) => ({
          id: item.id,
          type: 'TOOL' as const,
          name: item.name,
          code: item.itemCode,
          category: item.category,
          storageLocation: item.storageLocation,
          status: item.status,
          nfcTagUid: item.nfcTagUid,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt
        }))
      );
    }

    // 計測機器を取得
    if (query.category === 'ALL' || query.category === 'MEASURING_INSTRUMENTS') {
      const instruments = await instrumentService.findAll({
        search: query.search,
        status: query.instrumentStatus
      });
      
      // 計測機器のRFIDタグUIDを取得
      const instrumentIds = instruments.map((inst) => inst.id);
      const tags = instrumentIds.length > 0
        ? await prisma.measuringInstrumentTag.findMany({
            where: { measuringInstrumentId: { in: instrumentIds } },
            select: { measuringInstrumentId: true, rfidTagUid: true }
          })
        : [];
      
      const tagMap = new Map<string, string>();
      tags.forEach((tag) => {
        // 複数のタグがある場合は最初の1つを使用
        if (!tagMap.has(tag.measuringInstrumentId)) {
          tagMap.set(tag.measuringInstrumentId, tag.rfidTagUid);
        }
      });
      
      results.push(
        ...instruments.map((instrument) => ({
          id: instrument.id,
          type: 'MEASURING_INSTRUMENT' as const,
          name: instrument.name,
          code: instrument.managementNumber,
          category: null,
          storageLocation: instrument.storageLocation,
          status: instrument.status,
          nfcTagUid: tagMap.get(instrument.id) ?? null,
          createdAt: instrument.createdAt,
          updatedAt: instrument.updatedAt
        }))
      );
    }

    // 吊具を取得
    if (query.category === 'ALL' || query.category === 'RIGGING_GEARS') {
      const riggings = await riggingService.findAll({
        search: query.search,
        status: query.riggingStatus as RiggingStatus | undefined
      });

      const riggingIds = riggings.map((gear) => gear.id);
      const tags = riggingIds.length
        ? await prisma.riggingGearTag.findMany({
            where: { riggingGearId: { in: riggingIds } },
            select: { riggingGearId: true, rfidTagUid: true }
          })
        : [];
      const tagMap = new Map<string, string>();
      tags.forEach((tag) => {
        if (!tagMap.has(tag.riggingGearId)) {
          tagMap.set(tag.riggingGearId, tag.rfidTagUid);
        }
      });

      results.push(
        ...riggings.map((gear) => ({
          id: gear.id,
          type: 'RIGGING_GEAR' as const,
          name: gear.name,
          code: gear.managementNumber,
          category: gear.department ?? null,
          storageLocation: gear.storageLocation,
          status: gear.status,
          nfcTagUid: tagMap.get(gear.id) ?? null,
          createdAt: gear.createdAt,
          updatedAt: gear.updatedAt
        }))
      );
    }

    // 名前でソート
    results.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

    return { items: results };
  });
}
