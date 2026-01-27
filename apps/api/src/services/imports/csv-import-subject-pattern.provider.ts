import { prisma } from '../../lib/prisma.js';
import type { CsvImportType } from './csv-importer.types.js';

export interface CsvImportSubjectPatternProvider {
  listEnabledPatterns(params: { importType: CsvImportType; dashboardId?: string | null }): Promise<string[]>;
}

export class PrismaCsvImportSubjectPatternProvider implements CsvImportSubjectPatternProvider {
  async listEnabledPatterns(params: { importType: CsvImportType; dashboardId?: string | null }): Promise<string[]> {
    const { importType, dashboardId } = params;
    if (importType === 'csvDashboards' && !dashboardId) {
      return [];
    }
    const patterns = await prisma.csvImportSubjectPattern.findMany({
      where: {
        importType,
        enabled: true,
        ...(importType === 'csvDashboards' ? { dashboardId } : {}),
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      select: { pattern: true },
    });

    return patterns.map((p) => p.pattern);
  }
}

