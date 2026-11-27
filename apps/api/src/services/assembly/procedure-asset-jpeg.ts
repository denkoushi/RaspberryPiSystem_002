import sharp from 'sharp';
import { getAssemblyProcedureAssetStorage } from '../assembly-procedure-assets/index.js';
import type { AssemblyProcedureAssetLocation } from '../assembly-procedure-assets/assembly-procedure-asset-storage.port.js';

// 画像 AI に渡すため、要領書の写真を JPEG にそろえて読む。JPEG 以外は向きを直してから変換する。
export async function readAssemblyProcedureAssetAsJpeg(reference: AssemblyProcedureAssetLocation): Promise<Buffer> {
  const imageBytes = await getAssemblyProcedureAssetStorage().read(reference);
  if ((await sharp(imageBytes).metadata()).format === 'jpeg') return imageBytes;
  return sharp(imageBytes).rotate().jpeg().toBuffer();
}
