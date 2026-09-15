import { describe, expect, it } from 'vitest';

import { validateOrganizedNote, type ReadyKnowledgeSource } from '../knowledge-source.js';
import { renderKnowledgeDocument } from '../render-knowledge-document.js';

const record: ReadyKnowledgeSource = {
  source: { id: '123e4567-e89b-42d3-a456-426614174000', text: 'マスキングを先に練習。\n乾燥時間は要確認。', capturedAt: '2026-09-15T00:00:00.000Z', images: [] },
  organized: { title: 'マスキング練習', summary: '練習と乾燥時間の確認が必要。', category: '実技準備', quotes: ['乾燥時間は要確認。'], photos: [] },
};

describe('Knowledge source projection', () => {
  it('retains unabridged originals and source identity alongside AI text', () => {
    const result = renderKnowledgeDocument([record]);
    expect(result.markdown).toContain('> マスキングを先に練習。\n> 乾燥時間は要確認。');
    expect(result.markdown).toContain(record.source.id);
    expect(result.markdown).toContain('AIが整理した内容');
  });

  it('makes retries deterministic regardless of repository return order', () => {
    const second = { ...record, source: { ...record.source, id: '123e4567-e89b-42d3-a456-426614174001', capturedAt: '2026-09-16T00:00:00.000Z' } };
    expect(renderKnowledgeDocument([record, second])).toEqual(renderKnowledgeDocument([second, record]));
    expect(renderKnowledgeDocument([record]).markdown).not.toBe(renderKnowledgeDocument([record, second]).markdown);
  });

  it('escapes HTML and image directives supplied as source or model text', () => {
    const input = '<script>alert(1)</script>\n![x](https://external.test/a)';
    const result = renderKnowledgeDocument([{ source: { ...record.source, text: input }, organized: { ...record.organized, title: input, summary: input, quotes: [] } }]);
    expect(result.markdown).not.toContain('<script>');
    expect(result.markdown).not.toContain('![x]');
    expect(result.markdown).toContain('&lt;script&gt;');
  });

  it('rejects invented quotations and missing/foreign/duplicate photo references', () => {
    expect(() => validateOrganizedNote({ ...record.organized, quotes: ['推測で追加した手順'] }, record.source)).toThrow('quotation');
    expect(() => validateOrganizedNote({ ...record.organized, photos: [{ id: 'foreign', description: '写真' }] }, record.source)).toThrow('Photo');
    const source = { ...record.source, images: [{ id: 'a'.repeat(64), originalKey: `knowledge-assets/${'a'.repeat(64)}/original`, displayKey: `knowledge-assets/${'a'.repeat(64)}/display.jpg` }] };
    expect(() => validateOrganizedNote(record.organized, source)).toThrow('Photo');
    expect(() => validateOrganizedNote({ ...record.organized, photos: [{ id: 'a'.repeat(64), description: 'A' }, { id: 'a'.repeat(64), description: 'B' }] }, source)).toThrow('Photo');
  });

  it('rejects duplicated source rows and a batch exceeding the pilot bound', () => {
    expect(() => renderKnowledgeDocument([record, record])).toThrow('Duplicate');
    expect(() => renderKnowledgeDocument(Array.from({ length: 21 }, () => record))).toThrow('1–20');
  });

  it('preserves PDF page provenance and unreadable-page notice in Markdown and the report', () => {
    const imageId = 'a'.repeat(64);
    const pdf = { assetId: 'b'.repeat(64), filename: '準備.pdf', pageNumber: 2, extraction: 'unreadable' as const };
    const result = renderKnowledgeDocument([{
      source: { ...record.source, text: '', pdf, images: [{ id: imageId, originalKey: `knowledge-assets/${imageId}/original`, displayKey: `knowledge-assets/${imageId}/display.jpg` }] },
      organized: { ...record.organized, quotes: [], photos: [{ id: imageId, description: 'PDFのページ画像' }] },
    }]);
    expect(result.report.sections[0]?.pdf).toEqual(pdf);
    expect(result.markdown).toContain('PDFから抽出した文章');
    expect(result.markdown).toContain('文字の抽出結果なし');
    expect(result.markdown).toContain('2ページ');
    expect(result.markdown).toContain(`knowledge-image:${imageId}`);
  });
});
