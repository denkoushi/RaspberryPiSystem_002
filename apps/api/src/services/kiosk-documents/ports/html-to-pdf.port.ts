/**
 * キオスク要領書用: HTML 文字列を PDF バイト列へ変換（Gmime 添付の正規化）
 */
export interface HtmlToPdfPort {
  convert(html: string): Promise<Buffer>;
}
