import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { BUSINESS_HERMES_SOURCE_DEFINITION_VERSION, type BusinessHermesSourceDefinition } from './business-hermes-source-adapters.js';

export type KioskOperationGuideMatch = 'screen' | 'keyword' | 'none';

export type KioskOperationGuideSection = {
  id: string;
  file: string;
  screen: string;
  routes: string[];
  keywords: string[];
  heading: string;
  body: string;
};

function parseFrontmatter(text: string) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const end = lines.findIndex((line, index) => index > 0 && line === '---');
  if (end === -1) return null;
  const fields: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (match) fields[match[1]!] = match[2]!.trim();
  }
  return { fields, body: lines.slice(end + 1).join('\n') };
}

function parseInlineList(value: string | undefined): string[] | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1).trim();
  return inner === '' ? [] : inner.split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

// Exact terms only: 超硬チップ (a carbide insert) must not become a tag-screen question.
const QUESTION_TERM_SYNONYMS: Record<string, string> = { 'チップ': 'タグ', 'icチップ': 'タグ' };
const HOW_TO_SUFFIXES = ['手順', 'やり方', '方法', '始め方', '使い方'];
const HOW_TO_SUFFIX_PATTERN = new RegExp(HOW_TO_SUFFIXES.join('|'), 'u');
const QUESTION_SUFFIX_PATTERN = new RegExp(`(?:教えて|ください|したい|${HOW_TO_SUFFIXES.join('|')}|とは|ですか|できない|しない|ない)+$`, 'u');
const QUESTION_TERM_SEPARATOR = /から|まで|より|って|や(?!り方)|[のをがはにでとへ、。？！?!\s・]+/;

export function isOperationHowToQuestion(question: string): boolean {
  const normalized = question.normalize('NFKC').toLowerCase();
  return /どうやって|どうすれば|仕方|操作/u.test(normalized)
    || normalized.split(QUESTION_TERM_SEPARATOR).some((term) => {
      const removed = normalize(term).match(QUESTION_SUFFIX_PATTERN)?.[0];
      return removed !== undefined && HOW_TO_SUFFIX_PATTERN.test(removed);
    });
}

function questionTerms(question: string): string[] {
  const terms = question.normalize('NFKC').toLowerCase()
    .split(QUESTION_TERM_SEPARATOR)
    .map((term) => normalize(term).replace(QUESTION_SUFFIX_PATTERN, ''))
    .map((term) => QUESTION_TERM_SYNONYMS[term] ?? term)
    .filter((term) => term.length >= 2);
  const whole = normalize(question);
  return [...new Set(terms.length ? terms : whole ? [whole] : [])];
}

function scoreSection(section: KioskOperationGuideSection, terms: string[]) {
  const title = normalize(section.screen);
  const keywords = section.keywords.map(normalize);
  const heading = normalize(section.heading);
  const body = normalize(section.body);
  let score = 0;
  let screenHit = false;
  let keywordHit = false;
  for (const term of terms) {
    if (title.includes(term)) {
      score += title === term ? 6 : 3;
      screenHit = true;
    }
    if (keywords.some((keyword) => keyword.includes(term))) {
      score += 3;
      keywordHit = true;
    }
    if (heading.includes(term)) score += 2;
    if (body.includes(term)) score += 1;
  }
  return { score, screenHit, keywordHit };
}

export class KioskOperationGuideIndex {
  private constructor(private readonly sections: KioskOperationGuideSection[]) {}

  static empty(): KioskOperationGuideIndex {
    return new KioskOperationGuideIndex([]);
  }

  static fromDirectory(dir: string): KioskOperationGuideIndex {
    const files: string[] = [];
    const visit = (relativeDir: string) => {
      for (const entry of readdirSync(path.join(dir, relativeDir), { withFileTypes: true })) {
        const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) visit(relativePath);
        else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md') files.push(relativePath);
      }
    };
    visit('');
    const sections: KioskOperationGuideSection[] = [];
    for (const file of files.sort()) {
      const parsed = parseFrontmatter(readFileSync(path.join(dir, file), 'utf8'));
      const routes = parseInlineList(parsed?.fields.routes);
      const keywords = parseInlineList(parsed?.fields.keywords);
      if (!parsed?.fields.title || !routes || !keywords) {
        logger.warn({ file }, 'Skipping kiosk operation guide with invalid frontmatter');
        continue;
      }
      const headings = [...parsed.body.matchAll(/^## (.+)$/gm)];
      for (const [index, match] of headings.entries()) {
        sections.push({
          id: `${file}#${index}`, file, screen: parsed.fields.title, routes, keywords,
          heading: match[1]!.trim(),
          body: parsed.body.slice(match.index! + match[0].length, headings[index + 1]?.index).trim()
        });
      }
    }
    return new KioskOperationGuideIndex(sections);
  }

  isEnabled(): boolean {
    return this.sections.length > 0;
  }

  search(query: string, limit: number): {
    results: Array<KioskOperationGuideSection & { truncated: boolean; score: number }>;
    total: number;
    hasMore: boolean;
  } {
    const ranked = this.rank(query);
    const results = ranked.slice(0, limit).map(({ section, score }) => ({
      ...section, body: section.body.slice(0, 600), truncated: section.body.length > 600, score
    }));
    return { results, total: ranked.length, hasMore: results.length < ranked.length };
  }

  private rank(query: string) {
    const terms = questionTerms(query);
    return this.sections.map((section, index) => ({ section, index, ...scoreSection(section, terms) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index);
  }

  /**
   * The single section to answer with, or null when the question cannot be
   * attributed to one screen: a keyword-only top score shared with a section of
   * another file (e.g. 登録 alone). A screen-name hit keeps the first file in
   * order even when several screen names share the word (持出 and 吊具 持出).
   */
  bestSection(query: string): KioskOperationGuideSection | null {
    const ranked = this.rank(query);
    const top = ranked[0];
    if (!top) return null;
    const rival = ranked.find(({ section }) => section.file !== top.section.file);
    if (!top.screenHit && rival?.score === top.score) return null;
    return top.section;
  }

  detail(id: string): (KioskOperationGuideSection & { siblings: Array<{ id: string; heading: string }> }) | null {
    const section = this.sections.find((entry) => entry.id === id);
    return section ? {
      ...section,
      siblings: this.sections.filter((entry) => entry.file === section.file && entry.id !== id)
        .map(({ id: siblingId, heading }) => ({ id: siblingId, heading }))
    } : null;
  }

  /**
   * How strongly a question looks like a system-operation question: 'screen' when a
   * term names a guide screen, 'keyword' when it only hits a screen's keywords (these
   * include generic words such as 品番, so record questions can land here), else 'none'.
   */
  matchStrength(question: string): KioskOperationGuideMatch {
    const terms = questionTerms(question);
    let strength: KioskOperationGuideMatch = 'none';
    for (const section of this.sections) {
      const { screenHit, keywordHit } = scoreSection(section, terms);
      if (screenHit) return 'screen';
      if (keywordHit) strength = 'keyword';
    }
    return strength;
  }
}

let singleton: KioskOperationGuideIndex | undefined;

export function kioskOperationGuide(): KioskOperationGuideIndex {
  if (singleton) return singleton;
  try {
    singleton = env.KIOSK_OPERATION_GUIDE_DIR
      ? KioskOperationGuideIndex.fromDirectory(env.KIOSK_OPERATION_GUIDE_DIR)
      : KioskOperationGuideIndex.empty();
  } catch (err) {
    logger.warn({ err }, 'Unable to load kiosk operation guide');
    singleton = KioskOperationGuideIndex.empty();
  }
  return singleton;
}

export function resetKioskOperationGuideForTests(): void {
  singleton = undefined;
}

export const kioskOperationGuideSourceDefinition: BusinessHermesSourceDefinition = {
  version: BUSINESS_HERMES_SOURCE_DEFINITION_VERSION,
  kind: 'system_operation_guide',
  description: 'キオスク端末のシステム操作の説明(画面ごとの基本の手順と困ったときの対処)。製品の作業要領書や不適合記録ではない。',
  requestHints: ['操作', '使い方', 'やり方', '始め方', 'ログイン', '画面', 'ボタン', '反応しない'],
  recordUnit: '1件 = 1つの画面文書の1つの見出し(節)',
  identity: { primary: 'id（file#節番号）', lookup: 'business_hermes_get_detail kind=system_operation_guide id=...で節を取得する' },
  fields: [
    { name: 'id', meaning: '節の識別子（file#節番号）' },
    { name: 'screen', meaning: '画面名', searchable: true },
    { name: 'routes', meaning: '画面のルート' },
    { name: 'heading', meaning: '節の見出し', searchable: true },
    { name: 'keywords', meaning: '画面の検索語', searchable: true },
    { name: 'body', meaning: '節の操作説明本文', searchable: true }
  ],
  candidateFields: [],
  relationKeys: [],
  operations: [
    { name: 'business_hermes_search', use: 'business_hermes_search kind=system_operation_guide query=...で操作説明を検索する' },
    { name: 'business_hermes_get_detail', use: 'business_hermes_get_detail kind=system_operation_guide id=...で節の全文を取得する' }
  ],
  constraints: ['操作説明だけを返す', '製品の品番や不適合番号の条件は使えない', '該当が無ければ推測で手順を作らない']
};
