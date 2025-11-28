#!/usr/bin/env node
/**
 * 写真自動削除スクリプト
 * 
 * 1月中に毎日チェックして、2年前のデータを削除する
 * 
 * 使用方法:
 *   # Dockerコンテナ内で実行
 *   docker compose -f infrastructure/docker/docker-compose.server.yml exec api pnpm tsx src/scripts/cleanup-photos.ts
 * 
 *   # または、Node.jsで実行（ビルド後）
 *   node dist/scripts/cleanup-photos.js
 */

import { PhotoStorage } from '../lib/photo-storage.js';

async function main() {
  // 現在の月を取得
  const currentMonth = new Date().getMonth() + 1; // 0-11なので+1

  // 1月でない場合は何もしない
  if (currentMonth !== 1) {
    console.log(`[INFO] 現在は1月ではないため、写真削除処理をスキップします（月: ${currentMonth}）`);
    process.exit(0);
  }

  console.log('[INFO] 写真自動削除処理を開始します');

  // 2年前の年を計算
  const currentYear = new Date().getFullYear();
  const targetYear = currentYear - 2;

  console.log(`[INFO] ${targetYear}年の写真を削除します`);

  try {
    const deletedCount = await PhotoStorage.deletePhotosByYear(targetYear);
    console.log(`[INFO] 削除完了: ${deletedCount}件の写真を削除しました`);
    process.exit(0);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('[ERROR] 写真削除に失敗しました:', err.message);
    process.exit(1);
  }
}

main();

