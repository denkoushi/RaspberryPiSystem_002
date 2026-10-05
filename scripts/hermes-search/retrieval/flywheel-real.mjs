// Real kiosk questions; only questions, receipt metadata, and record ids leave the receipts.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { bareId } from './flywheel-pairs.mjs';

export function realId(question) {
  return `r-${createHash('sha1').update(question.normalize('NFKC').trim()).digest('hex').slice(0, 16)}`;
}

export function readRealRows(text) {
  return String(text ?? '').split('\n').flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

async function readRows(file) {
  try {
    return readRealRows(await readFile(file, 'utf8'));
  } catch {
    return [];
  }
}

export async function readReceiptQuestions({ receiptsDir, days }) {
  const questions = new Map();
  for (const day of days) {
    for (const row of await readRows(path.join(receiptsDir, `receipts-${day}.jsonl`))) {
      const receipt = row?.hermesReceipt;
      const question = receipt?.question;
      const semanticQuery = receipt?.plan?.semanticQuery;
      if (typeof question !== 'string' || !question.trim()
        || typeof semanticQuery !== 'string' || !semanticQuery.trim()
        || !['answer', 'no_result', 'no_other'].includes(receipt.outcome)) continue;
      const id = realId(question);
      if (questions.has(id)) continue;
      questions.set(id, {
        id, question, receiptAt: row.at, dayOutcome: receipt.outcome,
        dayShown: Array.isArray(row.recordIds) ? row.recordIds.map(bareId) : [],
      });
    }
  }
  return [...questions.values()];
}

export function realPath(dir, night) {
  return path.join(dir, `real-${night}.jsonl`);
}

export async function existingRealIds(dir) {
  const ids = new Set();
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return ids;
  }
  for (const name of names.filter((item) => /^real-\d{4}-\d{2}-\d{2}\.jsonl$/u.test(item))) {
    for (const row of await readRows(path.join(dir, name))) if (row?.id) ids.add(row.id);
  }
  return ids;
}
