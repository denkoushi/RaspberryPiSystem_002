import JSZip from 'jszip';

/** 同じ1文字を並べた XML を持つ ZIP。小さく圧縮でき、展開すると size バイトになる。 */
export async function makeRepeatedZip(size: number, entries = 1, method: 'DEFLATE' | 'STORE' = 'DEFLATE'): Promise<Buffer> {
  const zip = new JSZip();
  const body = '<a>' + 'x'.repeat(size) + '</a>';
  for (let index = 0; index < entries; index++) zip.file(`xl/part${index}.xml`, body);
  return zip.generateAsync({ type: 'nodebuffer', compression: method });
}

/** 既定の展開上限(48 MiB)を少し超える ZIP。 */
export const makeOverDefaultBudgetZip = () => makeRepeatedZip(50 * 1024 * 1024);
