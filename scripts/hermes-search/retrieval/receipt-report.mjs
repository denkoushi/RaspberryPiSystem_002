// Summarizes answer receipts copied from the Pi 5 (receipts-YYYY-MM-DD.jsonl). Question text stays
// in the owner's private folder; this prints counts and the questions that need a look.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function count(map, key) {
  const name = key ?? 'none';
  map[name] = (map[name] ?? 0) + 1;
}

export function parseReceiptLines(text) {
  const rows = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === 'object' && (row.hermesReceipt || row.consultationRoute)) rows.push(row);
    } catch {
      // A torn last line from a copy in progress is skipped.
    }
  }
  return rows;
}

export function summarizeReceipts(rows) {
  const summary = { total: 0, outcome: {}, vectorStatus: {}, turn: {}, byDay: {}, review: [], routes: {}, guideMiss: [] };
  const routes = new Map();
  for (const row of rows) {
    const consultation = row.consultationRoute;
    if (typeof consultation?.route === 'string') {
      const { route, guideMiss, question } = consultation;
      routes.set(route, (routes.get(route) ?? 0) + 1);
      if (guideMiss === true && (route === 'operation_guide' || route === 'trouble_report')) {
        summary.guideMiss.push({ at: row.at ?? null, route, question: question ?? null });
      }
    }
    const receipt = row.hermesReceipt;
    if (!receipt) continue;
    summary.total += 1;
    const vectorStatus = receipt.timings?.vectorStatus;
    count(summary.outcome, receipt.outcome);
    count(summary.vectorStatus, vectorStatus);
    count(summary.turn, receipt.jev?.turn);
    count(summary.byDay, typeof row.at === 'string' ? row.at.slice(0, 10) : null);
    // A content question with no result, or one that lost meaning-based search, is worth a look.
    const content = typeof receipt.plan?.semanticQuery === 'string' && receipt.plan.semanticQuery.trim() !== '';
    if (content && (receipt.outcome === 'no_result' || vectorStatus === 'timeout' || vectorStatus === 'failed')) {
      summary.review.push({
        at: row.at ?? null,
        sessionId: row.sessionId ?? null,
        outcome: receipt.outcome ?? null,
        vectorStatus: vectorStatus ?? null,
        turn: receipt.jev?.turn ?? null,
        question: receipt.question ?? null,
      });
    }
  }
  summary.routes = Object.fromEntries(routes);
  return summary;
}

export function formatRouteReport(day, summary) {
  const labels = { record_search: '記録検索', operation_guide: '操作説明', trouble_report: '不具合受付', handoff: '人へ引き継ぎ' };
  const parts = Object.entries(summary.routes).map(([route, count]) => {
    const label = Object.hasOwn(labels, route) ? labels[route] : route;
    let part = `${label} ${count} 件`;
    if (route === 'operation_guide' || route === 'trouble_report') {
      const misses = summary.guideMiss.filter((row) => row.route === route);
      part += `(知識なし ${misses.length} 件${misses.length ? `: ${misses.map((row) => `『${row.question}』`).join(', ')}` : ''})`;
    }
    return part;
  });
  return `routes ${day}: ${parts.length ? parts.join(', ') : 'none'}`;
}

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('Usage: node retrieval/receipt-report.mjs <receipts-YYYY-MM-DD.jsonl> [...]');
    process.exit(2);
  }
  const rows = [];
  for (const file of files) rows.push(...parseReceiptLines(await readFile(file, 'utf8')));
  process.stdout.write(`${JSON.stringify(summarizeReceipts(rows), null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
