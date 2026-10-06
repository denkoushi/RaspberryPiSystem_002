export function isEmptyCsvBuffer(buffer: Buffer): boolean {
  return buffer.toString('utf-8').replace(/^\uFEFF+/, '').trim().length === 0;
}
