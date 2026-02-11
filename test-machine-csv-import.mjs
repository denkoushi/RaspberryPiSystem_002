import { MachineCsvImporter } from './apps/api/src/services/imports/importers/machine.js';
import { CsvImportConfigService } from './apps/api/src/services/imports/csv-import-config.service.js';
import fs from 'fs';

const csvBuffer = fs.readFileSync('/Users/tsudatakashi/Downloads/加工機_マスター.csv');
const configService = new CsvImportConfigService();
const importer = new MachineCsvImporter(configService);

try {
  const rows = await importer.parse(csvBuffer);
  console.log('✅ CSVパース成功！');
  console.log('行数:', rows.length);
  console.log('最初の行:', JSON.stringify(rows[0], null, 2));
  console.log('最後の行:', JSON.stringify(rows[rows.length - 1], null, 2));
} catch (error) {
  console.error('❌ CSVパースエラー:');
  console.error(error.message);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
}
