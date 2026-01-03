import type { CsvImporter, CsvImportType } from './csv-importer.types.js';

/**
 * CSVインポータレジストリ
 */
class CsvImporterRegistry {
  private importers: Map<CsvImportType, CsvImporter> = new Map();

  /**
   * インポータを登録する
   */
  register(importer: CsvImporter): void {
    this.importers.set(importer.type, importer);
  }

  /**
   * インポータを取得する
   */
  get(type: CsvImportType): CsvImporter | undefined {
    return this.importers.get(type);
  }

  /**
   * 登録されているすべてのタイプを取得する
   */
  getRegisteredTypes(): CsvImportType[] {
    return Array.from(this.importers.keys());
  }

  /**
   * インポータが登録されているか確認する
   */
  has(type: CsvImportType): boolean {
    return this.importers.has(type);
  }
}

// シングルトンインスタンス
let registryInstance: CsvImporterRegistry | null = null;

/**
 * CSVインポータレジストリのインスタンスを取得
 */
export function getCsvImporterRegistry(): CsvImporterRegistry {
  if (!registryInstance) {
    registryInstance = new CsvImporterRegistry();
  }
  return registryInstance;
}

