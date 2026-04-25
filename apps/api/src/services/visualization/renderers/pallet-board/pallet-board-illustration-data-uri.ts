import { PalletMachineIllustrationStorage } from '../../../../lib/pallet-machine-illustration-storage.js';

/**
 * 管理画面登録の加工機イラストを data URI へ解決。読み取り失敗・不正 URL 時は `null`。
 */
export async function resolvePalletMachineIllustrationDataUri(relativeUrl: string | null | undefined): Promise<string | null> {
  if (relativeUrl == null || String(relativeUrl).trim() === '') {
    return null;
  }
  try {
    const { buffer, contentType } = await PalletMachineIllustrationStorage.readIllustration(String(relativeUrl).trim());
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}
