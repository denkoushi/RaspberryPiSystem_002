import type { ItemStatus, MeasuringInstrumentStatus, RiggingStatus } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { MeasuringInstrumentService } from '../measuring-instruments/measuring-instrument.service.js';
import { RiggingGearService } from '../rigging/rigging-gear.service.js';
import { ItemService } from './item.service.js';

const jaCollator = new Intl.Collator('ja');

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

    // 3カテゴリは互いに独立しているため並列に取得し、結合順（工具→計測機器→吊具）は維持する
    const [tools, instruments, riggings] = await Promise.all([
      category === 'ALL' || category === 'TOOLS' ? this.listTools(query) : [],
      category === 'ALL' || category === 'MEASURING_INSTRUMENTS' ? this.listInstruments(query) : [],
      category === 'ALL' || category === 'RIGGING_GEARS' ? this.listRiggingGears(query) : []
    ]);

    const results: UnifiedItem[] = [...tools, ...instruments, ...riggings];
    // localeCompare(..., 'ja') と同じ順序。Collator を使い回して比較ごとの生成コストを避ける
    results.sort((a, b) => jaCollator.compare(a.name, b.name));
    return results;
  }

  private async listTools(query: UnifiedInventoryListQuery): Promise<UnifiedItem[]> {
    const items = await this.itemService.findAll({
      search: query.search,
      status: query.itemStatus
    });
    return items.map((item) => ({
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
    }));
  }

  private async listInstruments(query: UnifiedInventoryListQuery): Promise<UnifiedItem[]> {
    const instruments = await this.instrumentService.findAll({
      search: query.search,
      status: query.instrumentStatus
    });

    const instrumentTagMap = await this.getMeasuringInstrumentTagMap(
      instruments.map((instrument) => instrument.id)
    );

    return instruments.map((instrument) => ({
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
    }));
  }

  private async listRiggingGears(query: UnifiedInventoryListQuery): Promise<UnifiedItem[]> {
    const riggings = await this.riggingService.findAll({
      search: query.search,
      status: query.riggingStatus
    });

    const riggingTagMap = await this.getRiggingGearTagMap(riggings.map((gear) => gear.id));

    return riggings.map((gear) => ({
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
    }));
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
