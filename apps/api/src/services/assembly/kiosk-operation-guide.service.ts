import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { GUIDE_FAMILY_ROUTES, type GuideFamily } from './kiosk-operation-guide-subject.js';
import { BUSINESS_HERMES_SOURCE_DEFINITION_VERSION, type BusinessHermesSourceDefinition } from '../business-hermes/business-hermes-source-adapters.js';

export type KioskOperationGuideMatch = 'screen' | 'keyword' | 'none';
export type KioskOperationGuideLookupOptions = { families?: GuideFamily[] };

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

export function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

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

export function questionTerms(question: string): string[] {
  const terms = question.normalize('NFKC').toLowerCase()
    .split(QUESTION_TERM_SEPARATOR)
    .map((term) => normalize(term).replace(QUESTION_SUFFIX_PATTERN, ''))
    .filter((term) => term.length >= 2);
  const whole = normalize(question);
  return [...new Set(terms.length ? terms : whole ? [whole] : [])];
}

/**
 * A keyword counts only when the question mentions it whole (在庫の数が違う mentions
 * 数が違う; 在庫の補充 does not mention 補充タグ), so a keyword never fires on a
 * fragment of itself and a multi-word keyword still fires across term boundaries.
 */
function keywordMentioned(question: string, keyword: string): boolean {
  return keyword.length > 0 && normalize(question).includes(normalize(keyword));
}

function scoreSection(section: KioskOperationGuideSection, question: string, terms: string[]) {
  const title = normalize(section.screen);
  const heading = normalize(section.heading);
  const body = normalize(section.body);
  let score = 0;
  let screenHit = false;
  for (const term of terms) {
    if (title.includes(term)) {
      score += title === term ? 6 : 3;
      screenHit = true;
    }
    if (heading.includes(term)) score += 2;
    if (body.includes(term)) score += 1;
  }
  const keywordHits = section.keywords.filter((keyword) => keywordMentioned(question, keyword)).length;
  score += keywordHits * 3;
  return { score, screenHit, keywordHit: keywordHits > 0 };
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

  familiesForScreen(screen: string): GuideFamily[] {
    const routes = this.sections.filter((section) => section.screen === screen).flatMap((section) => section.routes);
    return (Object.keys(GUIDE_FAMILY_ROUTES) as GuideFamily[]).filter((family) =>
      routes.some((route) => GUIDE_FAMILY_ROUTES[family].some((prefix) => route === prefix || route.startsWith(prefix + '/'))));
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

  private rank(query: string, families: GuideFamily[] = []) {
    const terms = questionTerms(query);
    const prefixes = families.flatMap((family) => GUIDE_FAMILY_ROUTES[family]);
    const files = families.length ? new Set(this.sections.filter((section) => section.routes.some((route) =>
      prefixes.some((prefix) => route === prefix || route.startsWith(prefix + '/')))).map((section) => section.file)) : undefined;
    return this.sections.filter((section) => !files || files.has(section.file))
      .map((section, index) => ({ section, index, ...scoreSection(section, query, terms) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index);
  }

  /**
   * The single section to answer with, or null when the question cannot be
   * attributed to one screen: a keyword-only top score shared with a section of
   * another file (e.g. 登録 alone). A screen-name hit keeps the first file in
   * order even when several screen names share the word (持出 and 吊具 持出).
   */
  bestSection(query: string, options: KioskOperationGuideLookupOptions = {}): KioskOperationGuideSection | null {
    const restricted = options.families?.length ? this.rank(query, options.families) : [];
    const ranked = restricted.length ? restricted : this.rank(query);
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
  /**
   * Terms of the question that no guide document names in its title or keywords.
   * Only these are looked up in master data: a word the documents know (タグ, 持出)
   * is decided by the documents, a word they do not know (チップ, ノギス) by what
   * the kiosk has registered under that name.
   */
  unknownTerms(question: string): string[] {
    return questionTerms(question).filter((term) => !this.sections.some((section) =>
      normalize(section.screen).includes(term) || section.keywords.some((keyword) => keywordMentioned(term, keyword))));
  }

  familyMatchStrength(question: string, families: GuideFamily[]): KioskOperationGuideMatch {
    if (!families.length) return 'none';
    const ranked = this.rank(question, families);
    if (ranked.some(({ screenHit }) => screenHit)) return 'screen';
    if (ranked.some(({ keywordHit }) => keywordHit)) return 'keyword';
    return 'none';
  }

  matchStrength(question: string, options: KioskOperationGuideLookupOptions = {}): KioskOperationGuideMatch {
    if (options.families?.length) {
      const within = this.familyMatchStrength(question, options.families);
      if (within !== 'none') return within;
    }
    const terms = questionTerms(question);
    let strength: KioskOperationGuideMatch = 'none';
    for (const section of this.sections) {
      const { screenHit, keywordHit } = scoreSection(section, question, terms);
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
