#!/usr/bin/env node
/**
 * テスト用CSVファイルをDropboxにアップロードするスクリプト
 * 
 * 使用方法:
 * docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api node /app/scripts/test/upload-test-csv-to-dropbox.js
 */

const fs = require('fs');
const path = require('path');

async function uploadTestCsvToDropbox() {
  try {
    // 設定ファイルを読み込む
    const configPath = '/app/config/backup.json';
    const configData = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configData);

    // Dropbox設定を取得
    const storageConfig = config.storage;
    if (!storageConfig || storageConfig.provider !== 'dropbox') {
      console.error('Error: Dropbox storage is not configured');
      process.exit(1);
    }

    const accessToken = storageConfig.options?.accessToken;
    const basePath = storageConfig.options?.basePath || '/backups';

    if (!accessToken) {
      console.error('Error: Dropbox access token is not configured');
      process.exit(1);
    }

    // DropboxStorageProviderを動的にインポート
    // 注意: コンパイル済みのJavaScriptファイルを使用
    // パスを確認してからインポート
    const providerPath = '/app/apps/api/dist/services/backup/storage/dropbox-storage.provider.js';
    if (!fs.existsSync(providerPath)) {
      console.error(`Error: DropboxStorageProvider not found at ${providerPath}`);
      console.log('Trying alternative path...');
      // 代替パスを試す
      const altPath = '/app/dist/services/backup/storage/dropbox-storage.provider.js';
      if (fs.existsSync(altPath)) {
        const { DropboxStorageProvider } = require(altPath);
        return { DropboxStorageProvider };
      }
      throw new Error('DropboxStorageProvider not found');
    }
    const { DropboxStorageProvider } = require(providerPath);

    // ストレージプロバイダーを作成
    const storageProvider = new DropboxStorageProvider({
      accessToken,
      basePath: '/test' // テスト用フォルダ
    });

    // テスト用CSVファイルを読み込む
    const employeesCsvPath = '/app/test-data/employees-test.csv';
    const itemsCsvPath = '/app/test-data/items-test.csv';

    if (!fs.existsSync(employeesCsvPath)) {
      console.error(`Error: ${employeesCsvPath} not found`);
      console.log('Creating test CSV files...');
      
      // テスト用CSVファイルを作成
      const employeesCsv = `employeeCode,displayName,nfcTagUid,department,contact,status
TEST001,テスト従業員1,04C362E1330289,テスト部,090-1234-5678,ACTIVE
TEST002,テスト従業員2,04B34411340289,テスト部,090-2345-6789,ACTIVE`;

      const itemsCsv = `itemCode,name,nfcTagUid,category,storageLocation,status,notes
TEST001,テスト工具1,04DE8366BC2A81,工具,テスト庫A,AVAILABLE,テスト用
TEST002,テスト工具2,04C393C1330289,工具,テスト庫B,AVAILABLE,テスト用`;

      // ディレクトリを作成
      const testDataDir = '/app/test-data';
      if (!fs.existsSync(testDataDir)) {
        fs.mkdirSync(testDataDir, { recursive: true });
      }

      fs.writeFileSync(employeesCsvPath, employeesCsv, 'utf-8');
      fs.writeFileSync(itemsCsvPath, itemsCsv, 'utf-8');
      console.log('Test CSV files created');
    }

    // CSVファイルをアップロード
    console.log('Uploading employees.csv to Dropbox...');
    const employeesCsvContent = fs.readFileSync(employeesCsvPath, 'utf-8');
    await storageProvider.upload('employees.csv', Buffer.from(employeesCsvContent, 'utf-8'));
    console.log('✅ employees.csv uploaded successfully');

    console.log('Uploading items.csv to Dropbox...');
    const itemsCsvContent = fs.readFileSync(itemsCsvPath, 'utf-8');
    await storageProvider.upload('items.csv', Buffer.from(itemsCsvContent, 'utf-8'));
    console.log('✅ items.csv uploaded successfully');

    console.log('\n✅ All test CSV files uploaded successfully to Dropbox /test/');
    console.log('Files uploaded:');
    console.log('  - /test/employees.csv');
    console.log('  - /test/items.csv');

  } catch (error) {
    console.error('Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

uploadTestCsvToDropbox();
