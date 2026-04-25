import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSET = 'pallet-card-thumbnail.png';

let cache: string | null | undefined;

/**
 * カード内サムネ用の同梱 PNG を data URL にし、1 プロセス内でキャッシュする。
 * 失敗時は `null`（呼び出し側で線画 SVG にフォールバック）。
 */
export function getPalletCardThumbnailDataUri(): string | null {
  if (cache !== undefined) {
    return cache;
  }
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const fromDistOrSrc = join(moduleDir, 'assets', ASSET);
  if (existsSync(fromDistOrSrc)) {
    try {
      const buf = readFileSync(fromDistOrSrc);
      cache = `data:image/png;base64,${buf.toString('base64')}`;
      return cache;
    } catch {
      // fall through
    }
  }
  cache = null;
  return cache;
}
