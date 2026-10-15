import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { isOperationHowToQuestion, kioskOperationGuide, KioskOperationGuideIndex, resetKioskOperationGuideForTests } from './kiosk-operation-guide.service.js';

vi.mock('../../config/env.js', () => ({ env: { KIOSK_OPERATION_GUIDE_DIR: undefined } }));
vi.mock('../../lib/logger.js', () => ({ logger: { warn: vi.fn() } }));

const longBody = `自主検査を始めるには開始ボタンを押します。\n${'記録を確認します。'.repeat(80)}`;
const headings = ['この画面でできること', '基本の手順', 'よくある困りごととその場の対処', 'それでも直らないとき'];

function screenDocument(title: string, body: string): string {
  return `---\ntitle: ${title}\nroutes: ["/kiosk/example"]\nkeywords: ['${title}', 端末, ABC]\naudience: 作業者\ncategory: kiosk-operation-guide\nlast-verified: 2026-10-14\n---\n# ${title}\n`
    + headings.map((heading, index) => `\n## ${heading}\n${index === 1 ? body : '画面を確認してください。'}\n`).join('');
}

describe('isOperationHowToQuestion', () => {
  it.each([
    ['チップの登録手順', true], ['タグのやり方', true], ['登録方法', true],
    ['自主検査の始め方', true], ['タグの使い方', true], ['登録手順を教えてください', true],
    ['登録方法教えてください', true], ['どうやって登録する', true], ['どうすれば登録できる', true],
    ['登録の仕方', true], ['画面操作', true], ['社員証の登録', false],
    ['不適合の原因', false], ['方法書', false], ['', false]
  ])('classifies %s as %s', (question, expected) => {
    expect(isOperationHowToQuestion(question)).toBe(expected);
  });
});

describe('KioskOperationGuideIndex', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(fileURLToPath(new URL('../../../.kiosk-operation-guide-test-', import.meta.url)));
    mkdirSync(path.join(dir, 'common'));
    writeFileSync(path.join(dir, 'self-inspection.md'), screenDocument('自主検査', longBody));
    writeFileSync(path.join(dir, 'loan.md'), screenDocument('貸出', '工具を選択します。'));
    writeFileSync(path.join(dir, 'common/troubleshooting.md'), '---\ntitle: 共通の対処\nroutes: []\nkeywords: [端末]\n---\n# 共通の対処\n## 接続の確認\n不適合の原因はこの説明の対象外です。');
    writeFileSync(path.join(dir, 'README.md'), screenDocument('除外', '除外'));
    writeFileSync(path.join(dir, 'without-frontmatter.md'), '# 無効\n## 操作\n読み込まない');
    writeFileSync(path.join(dir, 'invalid-list.md'), '---\ntitle: 無効\nroutes: /invalid\nkeywords: []\n---\n## 操作\n読み込まない');
    resetKioskOperationGuideForTests();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    env.KIOSK_OPERATION_GUIDE_DIR = undefined;
    resetKioskOperationGuideForTests();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('loads recursive Markdown sections in file order, excluding README and invalid frontmatter', () => {
    const index = KioskOperationGuideIndex.fromDirectory(dir);
    const found = index.search('端末', 20);
    expect(index.isEnabled()).toBe(true);
    expect(found.total).toBe(9);
    expect(found.hasMore).toBe(false);
    expect(found.results.map(({ id }) => id)).toEqual([
      'common/troubleshooting.md#0', ...headings.map((_, i) => `loan.md#${i}`), ...headings.map((_, i) => `self-inspection.md#${i}`)
    ]);
    expect(found.results[0]).toMatchObject({ screen: '共通の対処', routes: [], heading: '接続の確認' });
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('ranks matching screens and procedure bodies, bounds excerpts, and reports remaining results', () => {
    const index = KioskOperationGuideIndex.fromDirectory(dir);
    const found = index.search('自主検査の始め方', 5);
    expect(found.total).toBe(4);
    expect(found.results.every(({ file }) => file === 'self-inspection.md')).toBe(true);
    expect(found.results.map(({ heading }) => heading)).toEqual([headings[1], headings[0], headings[2], headings[3]]);
    expect(found.results[0]).toMatchObject({ id: 'self-inspection.md#1', body: longBody.slice(0, 600), truncated: true, score: 10 });
    expect(found.results[1]?.truncated).toBe(false);
    expect(index.search('自主検査の始め方', 1)).toMatchObject({ total: 4, hasMore: true, results: [found.results[0]] });
  });

  it.each(['チップの登録', 'icチップの登録', 'ＩＣチップの登録手順', '工具チップの登録', 'チップのやり方'])('maps %s to a tag screen', (question) => {
    writeFileSync(path.join(dir, 'tag-desk.md'), screenDocument('タグ管理', 'タグを登録します。'));
    writeFileSync(path.join(dir, 'assembly-library.md'), screenDocument('手順書', '登録します。'));
    const index = KioskOperationGuideIndex.fromDirectory(dir);
    expect(index.search(question, 1).results[0]).toMatchObject({ file: 'tag-desk.md', screen: 'タグ管理' });
    expect(index.matchStrength(question)).toBe('screen');
  });

  it('returns null for a top-score tie across files, including after ties within one file', () => {
    const index = KioskOperationGuideIndex.fromDirectory(dir);
    const found = index.search('ABC', 20);
    expect(found.results.slice(0, 5).map(({ file }) => file)).toEqual([
      'loan.md', 'loan.md', 'loan.md', 'loan.md', 'self-inspection.md'
    ]);
    expect(found.results.every(({ score }) => score === 3)).toBe(true);
    expect(index.bestSection('ABC')).toBeNull();
    expect(index.bestSection('該当しない質問')).toBeNull();
    expect(KioskOperationGuideIndex.empty().bestSection('ABC')).toBeNull();
  });

  it('returns the first section for a tie within one file and preserves full text', () => {
    const index = KioskOperationGuideIndex.fromDirectory(dir);
    expect(index.bestSection('貸出')).toMatchObject({ id: 'loan.md#0' });
    expect(index.bestSection('自主検査')).toMatchObject({ id: 'self-inspection.md#1', body: longBody });
  });

  it('requires title or keyword hits for matching and normalizes case, width and request terms', () => {
    const index = KioskOperationGuideIndex.fromDirectory(dir);
    expect(index.matchStrength('自主検査の始め方')).toBe('screen');
    expect(index.matchStrength('　ＡＢＣ　を教えてください！')).toBe('keyword');
    expect(index.search('不適合の原因を知りたい', 5).total).toBeGreaterThan(0);
    expect(index.matchStrength('不適合の原因を知りたい')).toBe('none');
    expect(index.matchStrength('')).toBe('none');
    expect(index.search('   ', 5).total).toBe(0);
  });

  it('returns full section text and siblings from the same document only', () => {
    const index = KioskOperationGuideIndex.fromDirectory(dir);
    expect(index.detail('self-inspection.md#1')).toEqual({
      id: 'self-inspection.md#1', file: 'self-inspection.md', screen: '自主検査', routes: ['/kiosk/example'],
      keywords: ['自主検査', '端末', 'ABC'], heading: '基本の手順', body: longBody,
      siblings: [0, 2, 3].map((i) => ({ id: `self-inspection.md#${i}`, heading: headings[i] }))
    });
    expect(index.detail('common/troubleshooting.md#0')?.siblings).toEqual([]);
    expect(index.detail('../missing.md#0')).toBeNull();
    expect(KioskOperationGuideIndex.empty().isEnabled()).toBe(false);
  });

  it('does not read any directory when unset and caches the empty singleton', () => {
    const read = vi.spyOn(KioskOperationGuideIndex, 'fromDirectory');
    const first = kioskOperationGuide();
    expect(first.isEnabled()).toBe(false);
    expect(kioskOperationGuide()).toBe(first);
    expect(read).not.toHaveBeenCalled();
  });

  it('loads a configured directory only once and fails closed on a read error', () => {
    env.KIOSK_OPERATION_GUIDE_DIR = dir;
    const read = vi.spyOn(KioskOperationGuideIndex, 'fromDirectory');
    const first = kioskOperationGuide();
    expect(first.isEnabled()).toBe(true);
    expect(kioskOperationGuide()).toBe(first);
    expect(read).toHaveBeenCalledTimes(1);
    resetKioskOperationGuideForTests();
    env.KIOSK_OPERATION_GUIDE_DIR = path.join(dir, 'missing');
    expect(kioskOperationGuide().isEnabled()).toBe(false);
    expect(logger.warn).toHaveBeenLastCalledWith({ err: expect.any(Error) }, 'Unable to load kiosk operation guide');
  });
});
