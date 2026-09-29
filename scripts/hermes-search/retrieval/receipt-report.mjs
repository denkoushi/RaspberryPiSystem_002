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
      if (row && typeof row === 'object' && row.hermesReceipt) rows.push(row);
    } catch {
      // A torn last line from a copy in progress is skipped.
    }
  }
  return rows;
}

export function summarizeReceipts(rows) {
  const summary = { total: rows.length, outcome: {}, vectorStatus: {}, turn: {}, byDay: {}, review: [] };
  for (const row of rows) {
    const receipt = row.hermesReceipt;
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
  return summary;
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
