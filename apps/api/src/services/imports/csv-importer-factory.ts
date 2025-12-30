import type { CsvImportType } from './csv-importer.types.js';
import { getCsvImporterRegistry } from './csv-importer-registry.js';

/**
 * CSVインポータファクトリ
 */
export class CsvImporterFactory {
  /**
   * タイプに応じたインポータを取得する
   */
  static create(type: CsvImportType) {
    const registry = getCsvImporterRegistry();
    const importer = registry.get(type);
    
    if (!importer) {
      throw new Error(`CSV importer not found for type: ${type}`);
    }
    
    return importer;
  }

  /**
   * 登録されているすべてのタイプを取得する
   */
  static getRegisteredTypes(): CsvImportType[] {
    const registry = getCsvImporterRegistry();
    return registry.getRegisteredTypes();
  }
}

