/**
 * Gmail 添付ファイル名から要領書の論理キーを生成する。
 * Power Automate / SharePoint 由来の「同一ファイル名＝同一要領書」運用向けに、
 * 比較・一意制約に耐えるよう NFC・大小・区切りを揃える。
 */
export function normalizeKioskGmailLogicalKey(attachmentFilename: string): string {
  const trimmed = attachmentFilename.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.normalize('NFC').replace(/\\/g, '/').toLowerCase();
}
