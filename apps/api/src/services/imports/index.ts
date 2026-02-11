/**
 * CSVインポータの初期化
 * アプリケーション起動時にすべてのインポータをレジストリに登録する
 */
import { getCsvImporterRegistry } from './csv-importer-registry.js';
import { EmployeeCsvImporter } from './importers/employee.js';
import { ItemCsvImporter } from './importers/item.js';
import { MeasuringInstrumentCsvImporter } from './importers/measuring-instrument.js';
import { RiggingGearCsvImporter } from './importers/rigging-gear.js';
import { MachineCsvImporter } from './importers/machine.js';

/**
 * CSVインポータを初期化する
 */
export function initializeCsvImporters(): void {
  const registry = getCsvImporterRegistry();
  
  // すべてのインポータを登録
  registry.register(new EmployeeCsvImporter());
  registry.register(new ItemCsvImporter());
  registry.register(new MeasuringInstrumentCsvImporter());
  registry.register(new RiggingGearCsvImporter());
  registry.register(new MachineCsvImporter());
}

