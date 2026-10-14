#!/usr/bin/env node
// Checks that docs/kiosk-operation-guide/ covers every kiosk screen route and
// that each guide file follows the fixed shape the Chat guide relies on.
//
// Usage: node scripts/docs/check-kiosk-operation-guide.mjs [--json]
//
// Rules (see docs/plans/kiosk-chat-system-guide-execplan.md, Milestone 1):
// - every `/kiosk...` route declared in apps/web/src/App.tsx that renders a page
//   (not a <Navigate> or <KioskRedirect> element) is listed in the `routes:` of
//   at least one guide file;
// - every route listed in a guide exists in App.tsx;
// - each guide has frontmatter with title, routes, keywords, audience,
//   category: kiosk-operation-guide and a last-verified date;
// - the body has the four fixed headings in order.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP_ROUTER = path.join(repoRoot, 'apps/web/src/App.tsx');
const GUIDE_DIR = path.join(repoRoot, 'docs/kiosk-operation-guide');
const REQUIRED_HEADINGS = [
  '## この画面でできること',
  '## 基本の手順',
  '## よくある困りごととその場の対処',
  '## それでも直らないとき'
];
const COMMON_HEADINGS_MIN = 2; // common/ files are not screen guides; they need at least a title and two sections.

export function parseKioskRoutes(appSource) {
  const routes = new Map(); // path -> { redirect: boolean }
  const routeTag = /<Route\b([\s\S]*?)\/>/g;
  let match;
  while ((match = routeTag.exec(appSource)) !== null) {
    const attrs = match[1];
    const pathMatch = /\bpath="(\/kiosk[^"]*)"/.exec(attrs);
    if (!pathMatch) continue;
    const redirect = /<Navigate\b|<KioskRedirect\b/.test(attrs);
    routes.set(pathMatch[1], { redirect });
  }
  return routes;
}

export function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const end = lines.findIndex((line, index) => index > 0 && line === '---');
  if (end === -1) return null;
  const result = {};
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (m) result[m[1]] = m[2].trim();
  }
  return { fields: result, body: lines.slice(end + 1).join('\n') };
}

export function parseInlineList(value) {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (inner === '') return [];
  return inner.split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

function listGuideFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listGuideFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md') out.push(full);
  }
  return out.sort();
}

export function checkGuide({ appSource, guides }) {
  const errors = [];
  const routes = parseKioskRoutes(appSource);
  const covered = new Map();
  for (const guide of guides) {
    const rel = guide.relPath;
    const parsed = parseFrontmatter(guide.text);
    if (!parsed) {
      errors.push(`${rel}: frontmatter がありません`);
      continue;
    }
    const { fields, body } = parsed;
    for (const key of ['title', 'routes', 'keywords', 'audience', 'category', 'last-verified']) {
      if (!(key in fields) || fields[key] === '') errors.push(`${rel}: frontmatter に ${key} がありません`);
    }
    if (fields.category && fields.category !== 'kiosk-operation-guide') {
      errors.push(`${rel}: category は kiosk-operation-guide にしてください(現在 ${fields.category})`);
    }
    if (fields['last-verified'] && !/^\d{4}-\d{2}-\d{2}$/.test(fields['last-verified'])) {
      errors.push(`${rel}: last-verified は YYYY-MM-DD で書いてください`);
    }
    const guideRoutes = parseInlineList(fields.routes);
    if (guideRoutes === null) errors.push(`${rel}: routes は [/kiosk/..., ...] の形で書いてください`);
    const keywords = parseInlineList(fields.keywords);
    if (keywords === null) errors.push(`${rel}: keywords は [語, 語, ...] の形で書いてください`);
    else if (keywords.length < 3) errors.push(`${rel}: keywords は 3 語以上にしてください`);

    const isCommon = rel.startsWith('common/');
    if (isCommon) {
      if ((guideRoutes ?? []).length !== 0) errors.push(`${rel}: common/ の文書は routes を空 [] にしてください`);
      const headings = body.split('\n').filter((line) => line.startsWith('## '));
      if (headings.length < COMMON_HEADINGS_MIN) errors.push(`${rel}: 見出し(## )が ${COMMON_HEADINGS_MIN} つ以上必要です`);
    } else {
      if ((guideRoutes ?? []).length === 0) errors.push(`${rel}: 画面の文書には routes を 1 つ以上書いてください`);
      let cursor = 0;
      for (const heading of REQUIRED_HEADINGS) {
        const idx = body.indexOf(`\n${heading}\n`, cursor);
        if (idx === -1) {
          errors.push(`${rel}: 見出し「${heading}」がこの順にありません`);
          break;
        }
        cursor = idx + heading.length;
      }
    }
    for (const route of guideRoutes ?? []) {
      if (!routes.has(route)) errors.push(`${rel}: routes の ${route} は apps/web/src/App.tsx にありません`);
      else covered.set(route, [...(covered.get(route) ?? []), rel]);
    }
  }
  const missing = [];
  for (const [route, info] of routes) {
    if (info.redirect) continue;
    if (!covered.has(route)) missing.push(route);
  }
  for (const route of missing) errors.push(`画面 ${route} の文書がありません(docs/kiosk-operation-guide/ に routes を含む文書を追加)`);
  return { errors, routeCount: routes.size, redirectCount: [...routes.values()].filter((r) => r.redirect).length, guideCount: guides.length, missing };
}

function main() {
  const json = process.argv.includes('--json');
  if (!existsSync(APP_ROUTER)) {
    console.error(`router not found: ${APP_ROUTER}`);
    process.exit(2);
  }
  const appSource = readFileSync(APP_ROUTER, 'utf8');
  const guides = listGuideFiles(GUIDE_DIR).map((full) => ({
    relPath: path.relative(GUIDE_DIR, full).split(path.sep).join('/'),
    text: readFileSync(full, 'utf8')
  }));
  const result = checkGuide({ appSource, guides });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`kiosk routes: ${result.routeCount} (redirect ${result.redirectCount}), guide files: ${result.guideCount}`);
    for (const error of result.errors) console.error(`- ${error}`);
    console.log(result.errors.length === 0 ? 'kiosk operation guide is complete.' : `${result.errors.length} problem(s).`);
  }
  process.exit(result.errors.length === 0 ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
