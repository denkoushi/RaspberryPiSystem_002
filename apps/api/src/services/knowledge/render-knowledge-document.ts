import { knowledgeSourceSchema, PILOT_TOPIC, validateOrganizedNote, type ReadyKnowledgeSource } from './knowledge-source.js';
import type { KnowledgeDocument } from './knowledge-document.js';

/** Escape user/model text as text: no HTML, image/link directives or raw source URLs. */
export function escapeMarkdownText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_{}[\]()#+.!|~-])/g, '\\$1');
}

/** Pure projection: the publisher, storage keys and credentials are not consulted here. */
export function renderKnowledgeDocument(records: readonly ReadyKnowledgeSource[]): KnowledgeDocument {
  if (records.length === 0 || records.length > 20) throw new Error('Pilot knowledge requires 1–20 sources');
  if (new Set(records.map(record => record.source.id)).size !== records.length) throw new Error('Duplicate sources');
  const sorted = [...records].sort((a, b) => a.source.capturedAt.localeCompare(b.source.capturedAt) || a.source.id.localeCompare(b.source.id));
  const blocks = sorted.map(({ source, organized }) => {
    knowledgeSourceSchema.parse(source);
    validateOrganizedNote(organized, source);
    const quote = (text: string) => text.split('\n').map(line => `> ${escapeMarkdownText(line)}`).join('\n');
    return [
      `## ${escapeMarkdownText(organized.category)}：${escapeMarkdownText(organized.title)}`,
      escapeMarkdownText(organized.summary),
      ...organized.photos.map(photo => `![${escapeMarkdownText(photo.description).replace(/\n/g, ' ')}](knowledge-image:${photo.id})\n\n写真説明（AI整理）：${escapeMarkdownText(photo.description)}`),
      source.pdf ? '### PDFから抽出した文章' : '### 元のメモ',
      quote(source.text || (source.pdf ? '（文字の抽出結果なし。ページ画像を確認してください）' : '（写真のみ）')),
      ...(source.pdf ? [`PDF出典：${escapeMarkdownText(source.pdf.filename)} / ${source.pdf.pageNumber}ページ  \nPDF ID：${source.pdf.assetId}  \n抽出方法：${source.pdf.extraction}${source.pdf.extraction !== 'embedded' ? '（ページ画像で内容を確認してください）' : ''}`] : []),
      `記録日時：${escapeMarkdownText(source.capturedAt)}  \n出典ID：${source.id}`,
    ].join('\n\n');
  });
  const content = [`# ${PILOT_TOPIC.title}`, 'AIが整理した内容です。判断の際は元のメモと写真を確認してください。', ...blocks].join('\n\n');
  return {
    markdown: content,
    report: {
      formatVersion: 1, topicId: PILOT_TOPIC.id, title: PILOT_TOPIC.title,
      sections: sorted.map(({ source, organized }) => ({
        sourceId: source.id, capturedAt: source.capturedAt, title: organized.title, category: organized.category,
        summary: organized.summary, originalText: source.text,
        ...(source.pdf ? { pdf: source.pdf } : {}),
        photos: organized.photos.map(photo => ({ imageId: photo.id, description: photo.description })),
      })),
    },
  };
}
