import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRouteReport, parseReceiptLines, summarizeReceipts } from './receipt-report.mjs';

const line = (at, receipt, extra = {}) => JSON.stringify({ at, sessionId: 's1', recordIds: [], ...extra, hermesReceipt: receipt });

test('the report counts outcomes and lists content misses and lost meaning-based search', () => {
  const text = [
    line('2026-09-29T00:16:00Z', { outcome: 'answer', question: 'filter only', plan: { semanticQuery: '' }, timings: { vectorStatus: 'not_requested' }, jev: { turn: 'first' } }),
    line('2026-09-29T00:17:00Z', { outcome: 'no_result', question: 'content miss', plan: { semanticQuery: 'x' }, timings: { vectorStatus: 'ok' }, jev: { turn: 'new_search' } }),
    line('2026-09-29T00:18:00Z', { outcome: 'answer', question: 'slow', plan: { semanticQuery: 'y' }, timings: { vectorStatus: 'timeout' }, jev: { turn: 'refine' } }),
    JSON.stringify({ at: '2026-09-29T00:19:00Z', consultationRoute: { route: 'operation_guide', guideMiss: true, direct: true, question: '印刷の紙が出ない' } }),
    '{"torn',
  ].join('\n');
  const summary = summarizeReceipts(parseReceiptLines(text));
  assert.equal(summary.total, 3);
  assert.deepEqual(summary.outcome, { answer: 2, no_result: 1 });
  assert.deepEqual(summary.vectorStatus, { not_requested: 1, ok: 1, timeout: 1 });
  assert.deepEqual(summary.turn, { first: 1, new_search: 1, refine: 1 });
  assert.deepEqual(summary.routes, { operation_guide: 1 });
  assert.deepEqual(summary.guideMiss, [{ at: '2026-09-29T00:19:00Z', route: 'operation_guide', question: '印刷の紙が出ない' }]);
  assert.deepEqual(summary.review.map((row) => row.question), ['content miss', 'slow']);
  assert.equal(summary.byDay['2026-09-29'], 3);
});

test('route reports show counts, guide misses and the questions in Japanese', () => {
  const rows = [
    ...Array.from({ length: 5 }, () => ({ consultationRoute: { route: 'record_search', guideMiss: true } })),
    ...Array.from({ length: 3 }, (_, index) => ({ at: '2026-10-14T00:00:00Z', consultationRoute: {
      route: 'operation_guide', guideMiss: index === 0, question: '印刷の紙が出ない'
    } })),
    { consultationRoute: { route: 'trouble_report', guideMiss: false } },
  ];
  const summary = summarizeReceipts(parseReceiptLines(rows.map(JSON.stringify).join('\n')));
  assert.equal(summary.total, 0);
  assert.deepEqual(summary.routes, { record_search: 5, operation_guide: 3, trouble_report: 1 });
  assert.deepEqual(summary.guideMiss, [{ at: '2026-10-14T00:00:00Z', route: 'operation_guide', question: '印刷の紙が出ない' }]);
  assert.equal(formatRouteReport('2026-10-14', summary),
    'routes 2026-10-14: 記録検索 5 件, 操作説明 3 件(知識なし 1 件: 『印刷の紙が出ない』), 不具合受付 1 件(知識なし 0 件)');
});

test('route reports retain unknown routes and list each eligible miss', () => {
  const routes = ['handoff', 'custom_route', '__proto__', 'constructor', '__proto__'];
  const rows = routes.map((route) => ({ consultationRoute: { route, guideMiss: true, question: '対象外' } }));
  rows.push(...['紙が出ない', '画面が固まった'].map((question) => ({
    consultationRoute: { route: 'trouble_report', guideMiss: true, question }
  })));
  const summary = summarizeReceipts(rows);
  assert.equal(summary.routes.__proto__, 2);
  assert.equal(summary.guideMiss.length, 2);
  assert.equal(formatRouteReport('2026-10-14', summary),
    'routes 2026-10-14: 人へ引き継ぎ 1 件, custom_route 1 件, __proto__ 2 件, constructor 1 件, 不具合受付 2 件(知識なし 2 件: 『紙が出ない』, 『画面が固まった』)');
  assert.equal(formatRouteReport('2026-10-14', summarizeReceipts([])), 'routes 2026-10-14: none');
});
