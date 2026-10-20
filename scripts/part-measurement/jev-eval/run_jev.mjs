// Usage: TYPESAFE_API_KEY=... node run_jev.mjs <manifest.jsonl> <results.jsonl> <instructions-file> [--concurrency N]
// Request shape follows docs/plans/procedure-page-boundary-jev-eval/jev-page-boundary-eval.mjs (hermes-jev-record-pilot.mjs + images).
import { readFile, appendFile } from 'node:fs/promises';
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MODEL = process.env.JEV_MODEL ?? 'jev-1.13.0';
const key = process.env.TYPESAFE_API_KEY;
if (!key) { console.error('TYPESAFE_API_KEY missing'); process.exit(1); }
const [manifest, out, instrFile, ...rest] = process.argv.slice(2);
const conc = rest.includes('--concurrency') ? Number(rest[rest.indexOf('--concurrency') + 1]) : 2;
const instructions = (await readFile(instrFile, 'utf8')).trim();
const cases = (await readFile(manifest, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const done = new Set((await readFile(out, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.error).map((r) => r.id));
async function call(c) {
  const assets = {};
  for (const [ref, path] of Object.entries(c.assets)) assets[ref] = { type: 'image', format: 'jpeg', data_base64: (await readFile(path)).toString('base64') };
  const body = { model: MODEL, state: c.state, questions: { q: { type: 'choice', instructions, criteria: c.criteria } }, assets };
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 120_000); const t0 = performance.now();
  try {
    const res = await fetch(ENDPOINT, { method: 'POST', signal: ctl.signal, headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'Content-Type': 'application/json', 'TypeSafe-Danger-Zone-Images': 'true' }, body: JSON.stringify(body) });
    if (!res.ok) return { id: c.id, error: { http: res.status, detail: (await res.text().catch(() => '')).slice(0, 300) } };
    const j = await res.json();
    return { id: c.id, gold: c.gold, n: c.n, model: MODEL, answer: j.answers?.q, usage: j.usage ?? null, ms: Math.round(performance.now() - t0) };
  } catch (e) { return { id: c.id, error: { failure: e?.name } }; } finally { clearTimeout(t); }
}
const queue = cases.filter((c) => !done.has(c.id));
await Promise.all(Array.from({ length: conc }, async () => {
  while (queue.length) {
    const r = await call(queue.shift());
    await appendFile(out, JSON.stringify(r) + '\n');
    console.log(r.id, r.error ? `ERROR ${JSON.stringify(r.error)}` : `${r.answer?.choice} gold=${r.gold} ${r.usage?.input_tokens} ${r.ms}ms`);
  }
}));
