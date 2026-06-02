/**
 * xref / startxref が実バイト位置と一致する最小 PDF（poppler 非依存テスト用）。
 */
export function buildMinimalValidPdfBuffer(): Buffer {
  const header = '%PDF-1.4\n';
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n'
  ];

  let offset = Buffer.byteLength(header, 'utf8');
  const xrefEntries = ['0000000000 65535 f \n'];
  const chunks: Buffer[] = [Buffer.from(header, 'utf8')];

  for (const obj of objects) {
    xrefEntries.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
    const buf = Buffer.from(obj, 'utf8');
    chunks.push(buf);
    offset += buf.length;
  }

  const body = Buffer.concat(chunks);
  const xrefStart = body.length;
  const tail = `xref\n0 4\n${xrefEntries.join('')}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.concat([body, Buffer.from(tail, 'utf8')]);
}
