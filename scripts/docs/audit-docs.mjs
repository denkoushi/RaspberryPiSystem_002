#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const inventoryPath = 'docs/_meta/document-inventory.json';
const summaryPath = 'docs/_meta/document-inventory-summary.md';

const generatedPaths = new Set([inventoryPath, summaryPath]);
const rootDocPaths = new Set([
  '.agent/PLANS.md',
  'AGENTS.md',
  'AI_HANDOFF_PROMPT.txt',
  'EXEC_PLAN.md',
  'README.md',
]);
const textDocExtensions = new Set(['.md', '.mdc', '.mdx', '.txt']);

function usage() {
  return [
    'Usage: node scripts/docs/audit-docs.mjs [--write|--check]',
    '',
    '  --write  Regenerate docs/_meta/document-inventory.* outputs (default)',
    '  --check  Fail when generated outputs are missing or stale',
  ].join('\n');
}

function parseArgs(argv) {
  const args = new Set(argv);
  if (args.has('--help') || args.has('-h')) {
    console.log(usage());
    process.exit(0);
  }
  if (args.has('--write') && args.has('--check')) {
    throw new Error('Use either --write or --check, not both.');
  }
  for (const arg of args) {
    if (!['--write', '--check'].includes(arg)) {
      throw new Error(`Unknown argument: ${arg}\n${usage()}`);
    }
  }
  return { check: args.has('--check') };
}

function gitLsFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  return output.split('\0').filter(Boolean).sort();
}

function isInventoryTarget(filePath) {
  if (generatedPaths.has(filePath)) {
    return false;
  }
  if (rootDocPaths.has(filePath)) {
    return true;
  }
  if (filePath.startsWith('.cursor/rules/') && filePath.endsWith('.mdc')) {
    return true;
  }
  return filePath.startsWith('docs/') && textDocExtensions.has(path.posix.extname(filePath));
}

function countLines(text) {
  if (text.length === 0) {
    return 0;
  }
  const lines = text.split(/\r\n|\n|\r/);
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

function parseFrontmatter(text) {
  const lines = text.split(/\r\n|\n|\r/);
  if (lines[0] !== '---') {
    return null;
  }
  const end = lines.findIndex((line, index) => index > 0 && line === '---');
  if (end === -1) {
    return null;
  }

  const result = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    result[key] = rawValue.replace(/^['"]|['"]$/g, '').trim();
  }
  return result;
}

function firstMarkdownHeading(text) {
  const match = /^#\s+(.+?)\s*#*\s*$/m.exec(text);
  return match ? match[1].trim() : null;
}

function markdownLinks(text, sourcePath, trackedPaths) {
  const sourceDir = path.posix.dirname(sourcePath);
  const links = [];
  const markdownLinkPattern = /(?<!!)\[[^\]]+\]\(([^)]+)\)/g;
  const searchableText = stripMarkdownCode(text);
  let match;

  while ((match = markdownLinkPattern.exec(searchableText)) !== null) {
    const href = sanitizeHref(match[1]);
    if (!href || isExternalHref(href) || href.startsWith('#')) {
      continue;
    }
    const filePart = href.split('#')[0];
    if (!filePart) {
      continue;
    }
    const decodedFilePart = safeDecode(filePart);
    const targetPath = path.posix.normalize(path.posix.join(sourceDir, decodedFilePart));
    links.push({
      href: outputSafe(href),
      targetPath: outputSafe(targetPath),
      exists: trackedPaths.has(targetPath) || existsSync(targetPath),
    });
  }

  return uniqueLinks(links);
}

function outputSafe(value) {
  if (value === null || value === undefined) {
    return value;
  }
  return String(value)
    .replace(/\?{3,}/g, '[question-mark-corruption]')
    .replace(/\uFFFD/g, '[U+FFFD]');
}

function stripMarkdownCode(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]*`/g, '');
}

function sanitizeHref(rawHref) {
  const trimmed = rawHref.trim();
  const withoutTitle = trimmed.startsWith('<')
    ? trimmed.replace(/^<([^>]+)>.*$/, '$1')
    : trimmed.split(/\s+/)[0];
  return withoutTitle.replace(/^<|>$/g, '');
}

function isExternalHref(href) {
  return /^(https?:|mailto:|tel:|ftp:|file:)/i.test(href);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function uniqueLinks(links) {
  const seen = new Set();
  const unique = [];
  for (const link of links) {
    const key = `${link.href}\t${link.targetPath}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(link);
  }
  return unique.sort((a, b) => a.targetPath.localeCompare(b.targetPath) || a.href.localeCompare(b.href));
}

function longLines(text) {
  return text.split(/\r\n|\n|\r/).flatMap((line, index) => {
    const length = [...line].length;
    return length > 1000 ? [{ line: index + 1, length }] : [];
  });
}

function replacementCharacterCount(text) {
  return (text.match(/\uFFFD/g) ?? []).length;
}

function buildInventory() {
  const trackedFiles = gitLsFiles();
  const trackedPaths = new Set(trackedFiles);
  const targetPaths = trackedFiles.filter(isInventoryTarget);

  const documents = targetPaths.map((filePath) => {
    const bytes = readFileSync(filePath);
    const text = bytes.toString('utf8');
    const frontmatter = parseFrontmatter(text);
    const links = markdownLinks(text, filePath, trackedPaths);

    return {
      path: filePath,
      lineCount: countLines(text),
      byteSize: bytes.byteLength,
      hasFrontmatter: frontmatter !== null,
      title: outputSafe(frontmatter?.title || firstMarkdownHeading(text)),
      status: outputSafe(frontmatter?.status || null),
      source_of_truth: outputSafe(frontmatter?.source_of_truth || null),
      localLinks: links,
      inboundCount: 0,
      hasQuestionMarkCorruption: /\?{3,}/.test(text),
      replacementCharacterCount: replacementCharacterCount(text),
      longLines: longLines(text),
      referencesExecPlan: text.includes('EXEC_PLAN.md'),
    };
  });

  const documentPaths = new Set(documents.map((document) => document.path));
  const inboundCounts = new Map(documents.map((document) => [document.path, 0]));
  for (const document of documents) {
    for (const link of document.localLinks) {
      if (documentPaths.has(link.targetPath)) {
        inboundCounts.set(link.targetPath, (inboundCounts.get(link.targetPath) ?? 0) + 1);
      }
    }
  }
  for (const document of documents) {
    document.inboundCount = inboundCounts.get(document.path) ?? 0;
  }

  const summary = summarize(documents);
  return {
    schemaVersion: 1,
    scope: {
      description: 'Tracked text documentation files from docs/, root AI entrypoints, .agent/PLANS.md, and .cursor/rules/*.mdc.',
      source: 'git ls-files',
      excludedGeneratedPaths: [...generatedPaths].sort(),
      includedExtensions: [...textDocExtensions].sort(),
    },
    summary,
    documents,
  };
}

function summarize(documents) {
  const brokenLocalLinks = documents.flatMap((document) =>
    document.localLinks
      .filter((link) => !link.exists)
      .map((link) => ({
        sourcePath: document.path,
        href: link.href,
        targetPath: link.targetPath,
      })),
  );

  return {
    documentCount: documents.length,
    totalLines: documents.reduce((sum, document) => sum + document.lineCount, 0),
    totalBytes: documents.reduce((sum, document) => sum + document.byteSize, 0),
    withFrontmatter: documents.filter((document) => document.hasFrontmatter).length,
    withStatus: documents.filter((document) => document.status !== null).length,
    sourceOfTruthDeclared: documents.filter((document) => document.source_of_truth !== null).length,
    execPlanReferences: documents.filter((document) => document.referencesExecPlan).length,
    questionMarkCorruptionDocuments: documents.filter((document) => document.hasQuestionMarkCorruption).length,
    replacementCharacterDocuments: documents.filter((document) => document.replacementCharacterCount > 0).length,
    longLineDocuments: documents.filter((document) => document.longLines.length > 0).length,
    localLinkCount: documents.reduce((sum, document) => sum + document.localLinks.length, 0),
    brokenLocalLinkCount: brokenLocalLinks.length,
    documentsOver1000Lines: documents.filter((document) => document.lineCount > 1000).length,
    documentsOver3000Lines: documents.filter((document) => document.lineCount > 3000).length,
    brokenLocalLinks,
  };
}

function renderSummary(inventory) {
  const documents = inventory.documents;
  const summary = inventory.summary;
  const largest = [...documents].sort((a, b) => b.lineCount - a.lineCount).slice(0, 15);
  const execPlanReferences = documents.filter((document) => document.referencesExecPlan).slice(0, 20);
  const longLineDocuments = documents.filter((document) => document.longLines.length > 0).slice(0, 20);

  return [
    '# Document Inventory Summary',
    '',
    'Generated by `node scripts/docs/audit-docs.mjs` from `git ls-files`.',
    'This is a machine-generated planning aid, not a source-of-truth document.',
    '',
    '## Scope',
    '',
    inventory.scope.description,
    '',
    '## Metrics',
    '',
    '| Metric | Count |',
    '|--------|------:|',
    `| Documents | ${summary.documentCount} |`,
    `| Total lines | ${summary.totalLines} |`,
    `| Total bytes | ${summary.totalBytes} |`,
    `| With frontmatter | ${summary.withFrontmatter} |`,
    `| With status | ${summary.withStatus} |`,
    `| source_of_truth declared | ${summary.sourceOfTruthDeclared} |`,
    `| References to EXEC_PLAN.md | ${summary.execPlanReferences} |`,
    `| Question-mark corruption documents | ${summary.questionMarkCorruptionDocuments} |`,
    `| Replacement-character documents | ${summary.replacementCharacterDocuments} |`,
    `| Long-line documents | ${summary.longLineDocuments} |`,
    `| Local links | ${summary.localLinkCount} |`,
    `| Broken local links | ${summary.brokenLocalLinkCount} |`,
    `| Documents over 1,000 lines | ${summary.documentsOver1000Lines} |`,
    `| Documents over 3,000 lines | ${summary.documentsOver3000Lines} |`,
    '',
    '## Largest Documents',
    '',
    '| Path | Lines | Bytes |',
    '|------|------:|------:|',
    ...largest.map((document) => `| \`${document.path}\` | ${document.lineCount} | ${document.byteSize} |`),
    '',
    '## EXEC_PLAN References',
    '',
    execPlanReferences.length === 0
      ? 'None.'
      : execPlanReferences.map((document) => `- \`${document.path}\``).join('\n'),
    '',
    '## Long-Line Documents',
    '',
    longLineDocuments.length === 0
      ? 'None.'
      : longLineDocuments
          .map((document) => {
            const preview = document.longLines
              .slice(0, 3)
              .map((line) => `${line.line}:${line.length}`)
              .join(', ');
            return `- \`${document.path}\` (${preview})`;
          })
          .join('\n'),
    '',
    '## Broken Local Links',
    '',
    summary.brokenLocalLinks.length === 0
      ? 'None.'
      : summary.brokenLocalLinks
          .slice(0, 50)
          .map((link) => `- \`${link.sourcePath}\` -> \`${link.href}\` (${link.targetPath})`)
          .join('\n'),
    '',
  ].join('\n');
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeOutputs(inventory, summaryMarkdown) {
  mkdirSync(path.posix.dirname(inventoryPath), { recursive: true });
  writeFileSync(inventoryPath, stableJson(inventory));
  writeFileSync(summaryPath, summaryMarkdown);
}

function assertCurrent(inventory, summaryMarkdown) {
  const expectedInventory = stableJson(inventory);
  const expectedSummary = summaryMarkdown;
  const failures = [];

  if (!existsSync(inventoryPath)) {
    failures.push(`${inventoryPath} is missing`);
  } else if (readFileSync(inventoryPath, 'utf8') !== expectedInventory) {
    failures.push(`${inventoryPath} is stale`);
  }

  if (!existsSync(summaryPath)) {
    failures.push(`${summaryPath} is missing`);
  } else if (readFileSync(summaryPath, 'utf8') !== expectedSummary) {
    failures.push(`${summaryPath} is stale`);
  }

  if (failures.length > 0) {
    throw new Error(`${failures.join('\n')}\nRun: node scripts/docs/audit-docs.mjs --write`);
  }
}

try {
  const { check } = parseArgs(process.argv.slice(2));
  const inventory = buildInventory();
  const summaryMarkdown = renderSummary(inventory);

  if (check) {
    assertCurrent(inventory, summaryMarkdown);
    console.log('Document inventory is current.');
  } else {
    writeOutputs(inventory, summaryMarkdown);
    console.log(`Wrote ${inventoryPath}`);
    console.log(`Wrote ${summaryPath}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
