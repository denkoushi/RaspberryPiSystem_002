#!/usr/bin/env node
/**
 * 証明書ディレクトリのバックアップターゲットを追加するスクリプト
 * 使用方法: node scripts/server/add-cert-backup-target.js
 * 
 * Pi5上で実行してください。
 * 
 * 注意: このスクリプトはPi5上のDockerコンテナ内で実行する必要があります。
 * 実行方法:
 *   docker compose -f infrastructure/docker/docker-compose.server.yml exec api node /app/scripts/server/add-cert-backup-target.mjs
 */

import { BackupConfigLoader } from '../../apps/api/src/services/backup/backup-config.loader.js';

async function main() {
  try {
    console.log('証明書ディレクトリのバックアップターゲットを追加中...');
    
    // 設定ファイルを読み込む
    const config = await BackupConfigLoader.load();
    
    // 既に証明書ディレクトリのバックアップターゲットが存在するか確認
    const existingCertTarget = config.targets.find(
      (t) => t.kind === 'directory' && t.source === '/app/host/certs'
    );
    
    if (existingCertTarget) {
      console.log('⚠️  証明書ディレクトリのバックアップターゲットは既に存在します。');
      console.log('既存の設定:', JSON.stringify(existingCertTarget, null, 2));
      process.exit(0);
    }
    
    // 新しいターゲットを追加
    const newTarget = {
      kind: 'directory',
      source: '/app/host/certs',
      schedule: '0 4 * * 0', // 週次（日曜日4時）
      enabled: true,
      storage: {
        provider: 'dropbox'
      },
      retention: {
        days: 90,
        maxBackups: 10
      }
    };
    
    config.targets.push(newTarget);
    
    // 設定ファイルを保存
    await BackupConfigLoader.save(config);
    
    console.log('✅ 証明書ディレクトリのバックアップターゲットを追加しました。');
    console.log('');
    console.log('追加された設定:');
    console.log(JSON.stringify(newTarget, null, 2));
    console.log('');
    console.log('次のステップ:');
    console.log('1. APIコンテナを再起動してスケジューラーを再読み込み:');
    console.log('   docker compose -f infrastructure/docker/docker-compose.server.yml restart api');
    console.log('2. 管理コンソールの「バックアップ」タブで追加されたターゲットを確認');
    console.log('3. 手動実行ボタンでバックアップを実行して動作確認');
    
  } catch (error) {
    console.error('❌ エラーが発生しました:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('予期しないエラー:', error);
  process.exit(1);
});
