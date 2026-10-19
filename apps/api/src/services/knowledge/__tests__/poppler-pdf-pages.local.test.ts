import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { PopplerPdfPagesAdapter } from '../poppler-pdf-pages.adapter.js';

function syntheticPdf(): Buffer {
  const content = 'BT /F1 12 Tf 20 100 Td (MASKING PRACTICE) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 150] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 150] /Resources << >> >>',
  ];
  let text = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}

describe.skipIf(process.env.KNOWLEDGE_REAL_PDF_TEST !== '1')('Real Poppler PDF contract', () => {
  it('extracts embedded text and renders every page, including a page without text', async () => {
    const pages = [];
    for await (const page of new PopplerPdfPagesAdapter().extract(syntheticPdf())) pages.push(page);
    expect(pages).toHaveLength(2);
    expect(pages[0]?.text).toBe('MASKING PRACTICE');
    expect(pages[1]?.text).toBe('');
    for (const page of pages) {
      const metadata = await sharp(page.jpeg).metadata();
      expect(metadata.format).toBe('jpeg');
      expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(1600);
    }
  });
});
