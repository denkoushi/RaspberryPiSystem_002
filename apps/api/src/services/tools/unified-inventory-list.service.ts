import type { ItemStatus, MeasuringInstrumentStatus, RiggingStatus } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { MeasuringInstrumentService } from '../measuring-instruments/measuring-instrument.service.js';
import { RiggingGearService } from '../rigging/rigging-gear.service.js';
import { ItemService } from './item.service.js';

export interface UnifiedItem {
  id: string;
  type: 'TOOL' | 'MEASURING_INSTRUMENT' | 'RIGGING_GEAR';
  name: string;
  code: string;
  category?: string | null;
  storageLocation?: string | null;
  status: string;
  nfcTagUid?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UnifiedInventoryListQuery {
  search?: string;
  category?: 'TOOLS' | 'MEASURING_INSTRUMENTS' | 'RIGGING_GEARS' | 'ALL';
  itemStatus?: ItemStatus;
  instrumentStatus?: MeasuringInstrumentStatus;
  riggingStatus?: RiggingStatus;
}

export class UnifiedInventoryListService {
  constructor(
    private readonly itemService = new ItemService(),
    private readonly instrumentService = new MeasuringInstrumentService(),
    private readonly riggingService = new RiggingGearService()
  ) {}

  async list(query: UnifiedInventoryListQuery): Promise<UnifiedItem[]> {
    const category = query.category ?? 'ALL';
    const results: UnifiedItem[] = [];

    if (category === 'ALL' || category === 'TOOLS') {
      const items = await this.itemService.findAll({
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

    if (category === 'ALL' || category === 'MEASURING_INSTRUMENTS') {
      const instruments = await this.instrumentService.findAll({
        search: query.search,
        status: query.instrumentStatus
      });

      const instrumentTagMap = await this.getMeasuringInstrumentTagMap(
        instruments.map((instrument) => instrument.id)
      );

      results.push(
        ...instruments.map((instrument) => ({
          id: instrument.id,
          type: 'MEASURING_INSTRUMENT' as const,
          name: instrument.name,
          code: instrument.managementNumber,
          category: null,
          storageLocation: instrument.storageLocation,
          status: instrument.status,
          nfcTagUid: instrumentTagMap.get(instrument.id) ?? null,
          createdAt: instrument.createdAt,
          updatedAt: instrument.updatedAt
        }))
      );
    }

    if (category === 'ALL' || category === 'RIGGING_GEARS') {
      const riggings = await this.riggingService.findAll({
        search: query.search,
        status: query.riggingStatus
      });

      const riggingTagMap = await this.getRiggingGearTagMap(riggings.map((gear) => gear.id));

      results.push(
        ...riggings.map((gear) => ({
          id: gear.id,
          type: 'RIGGING_GEAR' as const,
          name: gear.name,
          code: gear.managementNumber,
          category: gear.department ?? null,
          storageLocation: gear.storageLocation,
          status: gear.status,
          nfcTagUid: riggingTagMap.get(gear.id) ?? null,
          createdAt: gear.createdAt,
          updatedAt: gear.updatedAt
        }))
      );
    }

    results.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    return results;
  }

  private async getMeasuringInstrumentTagMap(instrumentIds: string[]): Promise<Map<string, string>> {
    if (instrumentIds.length === 0) {
      return new Map();
    }

    const tags = await prisma.measuringInstrumentTag.findMany({
      where: { measuringInstrumentId: { in: instrumentIds } },
      select: { measuringInstrumentId: true, rfidTagUid: true }
    });

    const tagMap = new Map<string, string>();
    tags.forEach((tag) => {
      if (!tagMap.has(tag.measuringInstrumentId)) {
        tagMap.set(tag.measuringInstrumentId, tag.rfidTagUid);
      }
    });
    return tagMap;
  }

  private async getRiggingGearTagMap(riggingGearIds: string[]): Promise<Map<string, string>> {
    if (riggingGearIds.length === 0) {
      return new Map();
    }

    const tags = await prisma.riggingGearTag.findMany({
      where: { riggingGearId: { in: riggingGearIds } },
      select: { riggingGearId: true, rfidTagUid: true }
    });

    const tagMap = new Map<string, string>();
    tags.forEach((tag) => {
      if (!tagMap.has(tag.riggingGearId)) {
        tagMap.set(tag.riggingGearId, tag.rfidTagUid);
      }
    });
    return tagMap;
  }
}
