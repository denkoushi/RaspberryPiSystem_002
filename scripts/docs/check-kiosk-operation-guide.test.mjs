import test from 'node:test';
import assert from 'node:assert/strict';

import { checkGuide, parseInlineList, parseKioskRoutes } from './check-kiosk-operation-guide.mjs';

const APP = `
<Routes>
  <Route path="/kiosk" element={<KioskRedirect />} />
  <Route path="/kiosk/tag" element={lazyRouteElement(<KioskBorrowPage />)} />
  <Route
    path="/kiosk/assembly/templates/:templateId/edit"
    element={lazyRouteElement(<KioskAssemblyTemplateEditorPage />)}
  />
  <Route path="/kiosk/mobile-placement/register" element={<Navigate to="/kiosk/mobile-placement" replace />} />
  <Route path="/admin" element={<AdminPage />} />
</Routes>
`;

function guide(relPath, { routes, body, extra = '' }) {
  return {
    relPath,
    text: [
      '---',
      'title: 試験用',
      `routes: [${routes.join(', ')}]`,
      'keywords: [タグ, 社員証, かざす]',
      'audience: [operators]',
      'category: kiosk-operation-guide',
      'last-verified: 2026-10-14',
      extra,
      '---',
      '# 試験用',
      body
    ].filter((line) => line !== '').join('\n')
  };
}

const FULL_BODY = '\n## この画面でできること\n本文\n\n## 基本の手順\n1. 手順\n\n## よくある困りごととその場の対処\n- 例\n\n## それでも直らないとき\nお問い合わせから送る\n';

test('parseKioskRoutes keeps kiosk routes only and marks redirects', () => {
  const routes = parseKioskRoutes(APP);
  assert.deepEqual([...routes.keys()], ['/kiosk', '/kiosk/tag', '/kiosk/assembly/templates/:templateId/edit', '/kiosk/mobile-placement/register']);
  assert.equal(routes.get('/kiosk').redirect, true);
  assert.equal(routes.get('/kiosk/mobile-placement/register').redirect, true);
  assert.equal(routes.get('/kiosk/tag').redirect, false);
});

test('parseInlineList accepts inline lists only', () => {
  assert.deepEqual(parseInlineList('[a, "b", c]'), ['a', 'b', 'c']);
  assert.deepEqual(parseInlineList('[]'), []);
  assert.equal(parseInlineList('- a'), null);
});

test('a complete guide set passes', () => {
  const result = checkGuide({
    appSource: APP,
    guides: [
      guide('borrow-return.md', { routes: ['/kiosk/tag'], body: FULL_BODY }),
      guide('assembly-template-editor.md', { routes: ['/kiosk/assembly/templates/:templateId/edit'], body: FULL_BODY }),
      guide('common/troubleshooting.md', { routes: [], body: '\n## タグが反応しない\n対処\n\n## それでも直らないとき\n送る\n' })
    ]
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.redirectCount, 2);
});

test('missing screens, unknown routes and heading order are reported', () => {
  const result = checkGuide({
    appSource: APP,
    guides: [
      guide('borrow-return.md', { routes: ['/kiosk/tag', '/kiosk/nope'], body: '\n## 基本の手順\n\n## この画面でできること\n' }),
      guide('common/x.md', { routes: ['/kiosk/tag'], body: '\n## a\n' })
    ]
  });
  const joined = result.errors.join('\n');
  assert.match(joined, /\/kiosk\/nope は apps\/web\/src\/App\.tsx にありません/);
  assert.match(joined, /見出し「## 基本の手順」がこの順にありません/);
  assert.match(joined, /画面 \/kiosk\/assembly\/templates\/:templateId\/edit の文書がありません/);
  assert.match(joined, /common\/ の文書は routes を空/);
  assert.deepEqual(result.missing, ['/kiosk/assembly/templates/:templateId/edit']);
});

test('frontmatter problems are reported per field', () => {
  const result = checkGuide({
    appSource: APP,
    guides: [{ relPath: 'bad.md', text: '# 見出しだけ\n' }, {
      relPath: 'bad2.md',
      text: '---\ntitle: x\nroutes: [/kiosk/tag]\nkeywords: [a]\naudience: [operators]\ncategory: other\nlast-verified: 2026/10/14\n---\n# x' + FULL_BODY
    }]
  });
  const joined = result.errors.join('\n');
  assert.match(joined, /bad\.md: frontmatter がありません/);
  assert.match(joined, /keywords は 3 語以上/);
  assert.match(joined, /category は kiosk-operation-guide/);
  assert.match(joined, /last-verified は YYYY-MM-DD/);
});
