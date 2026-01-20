import { prisma } from '../../lib/prisma.js';
import type { CsvImportType } from './csv-importer.types.js';

export interface CsvImportSubjectPatternProvider {
  listEnabledPatterns(importType: Exclude<CsvImportType, 'csvDashboards'>): Promise<string[]>;
}

export class PrismaCsvImportSubjectPatternProvider implements CsvImportSubjectPatternProvider {
  async listEnabledPatterns(importType: Exclude<CsvImportType, 'csvDashboards'>): Promise<string[]> {
    const patterns = await prisma.csvImportSubjectPattern.findMany({
      where: { importType, enabled: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      select: { pattern: true },
    });

    return patterns.map((p) => p.pattern);
  }
}

