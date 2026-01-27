import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import type { ColumnDefinition, TableTemplateConfig } from '../csv-dashboard/csv-dashboard.types.js';
import type { CsvImportType } from './csv-importer.types.js';

export type MasterImportType = Exclude<CsvImportType, 'csvDashboards'>;

export type CsvImportConfig = {
  id: string;
  importType: MasterImportType;
  enabled: boolean;
  allowedManualImport: boolean;
  allowedScheduledImport: boolean;
  importStrategy: 'UPSERT' | 'REPLACE';
  columnDefinitions: ColumnDefinition[];
  createdAt: Date;
  updatedAt: Date;
};

type CsvImportConfigInput = {
  enabled: boolean;
  allowedManualImport: boolean;
  allowedScheduledImport: boolean;
  importStrategy: 'UPSERT' | 'REPLACE';
  columnDefinitions: ColumnDefinition[];
};

const MASTER_CONFIG_ID_PREFIX = 'master-config-';

export class CsvImportConfigService {
  private buildId(importType: MasterImportType): string {
    return `${MASTER_CONFIG_ID_PREFIX}${importType}`;
  }

  async list(): Promise<CsvImportConfig[]> {
    const configs = await prisma.csvDashboard.findMany({
      where: { configType: 'MASTER' },
      orderBy: [{ importType: 'asc' }, { name: 'asc' }],
    });

    return configs.map((config) => this.toConfig(config));
  }

  async get(importType: MasterImportType): Promise<CsvImportConfig | null> {
    const config = await prisma.csvDashboard.findUnique({
      where: { id: this.buildId(importType) },
    });
    if (!config || config.configType !== 'MASTER') {
      return null;
    }
    return this.toConfig(config);
  }

  async upsert(importType: MasterImportType, input: CsvImportConfigInput): Promise<CsvImportConfig> {
    this.validateColumnDefinitions(input.columnDefinitions);

    const id = this.buildId(importType);
    const displayColumns = input.columnDefinitions.map((col) => col.internalName);
    const templateConfig: TableTemplateConfig = {
      rowsPerPage: 1,
      fontSize: 14,
      displayColumns,
      headerFixed: true,
    };

    const record = await prisma.csvDashboard.upsert({
      where: { id },
      update: {
        enabled: input.enabled,
        allowedManualImport: input.allowedManualImport,
        allowedScheduledImport: input.allowedScheduledImport,
        importStrategy: input.importStrategy,
        columnDefinitions: input.columnDefinitions as unknown as object[],
        templateType: 'TABLE',
        templateConfig: templateConfig as unknown as object,
      },
      create: {
        id,
        name: `MasterConfig:${importType}`,
        description: `Master import config for ${importType}`,
        configType: 'MASTER',
        importType,
        enabled: input.enabled,
        allowedManualImport: input.allowedManualImport,
        allowedScheduledImport: input.allowedScheduledImport,
        importStrategy: input.importStrategy,
        columnDefinitions: input.columnDefinitions as unknown as object[],
        dateColumnName: null,
        displayPeriodDays: 1,
        emptyMessage: null,
        ingestMode: 'APPEND',
        dedupKeyColumns: [],
        gmailScheduleId: null,
        gmailSubjectPattern: null,
        templateType: 'TABLE',
        templateConfig: templateConfig as unknown as object,
        csvFilePath: null,
      },
    });

    return this.toConfig(record);
  }

  async getEffectiveConfig(importType: MasterImportType): Promise<CsvImportConfig | null> {
    const config = await this.get(importType);
    if (!config || !config.enabled) {
      return null;
    }
    return config;
  }

  private toConfig(record: {
    id: string;
    importType: string;
    enabled: boolean;
    allowedManualImport: boolean;
    allowedScheduledImport: boolean;
    importStrategy: 'UPSERT' | 'REPLACE';
    columnDefinitions: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): CsvImportConfig {
    return {
      id: record.id,
      importType: record.importType as MasterImportType,
      enabled: record.enabled,
      allowedManualImport: record.allowedManualImport,
      allowedScheduledImport: record.allowedScheduledImport,
      importStrategy: record.importStrategy,
      columnDefinitions: (record.columnDefinitions ?? []) as ColumnDefinition[],
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private validateColumnDefinitions(columnDefinitions: ColumnDefinition[]): void {
    if (!columnDefinitions || columnDefinitions.length === 0) {
      throw new ApiError(400, '列定義が空です');
    }

    const internalNames = new Set<string>();
    const orders = new Set<number>();

    for (const col of columnDefinitions) {
      if (!col.internalName || !col.displayName) {
        throw new ApiError(400, '列定義に内部名または表示名がありません');
      }
      if (!col.csvHeaderCandidates || col.csvHeaderCandidates.length === 0) {
        throw new ApiError(400, `CSVヘッダー候補が空です（${col.internalName}）`);
      }
      if (internalNames.has(col.internalName)) {
        throw new ApiError(400, `内部名 "${col.internalName}" が重複しています`);
      }
      if (orders.has(col.order)) {
        throw new ApiError(400, `順序 "${col.order}" が重複しています`);
      }
      internalNames.add(col.internalName);
      orders.add(col.order);
    }
  }
}
