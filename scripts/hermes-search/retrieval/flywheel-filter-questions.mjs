import { createHash } from 'node:crypto';
import { fieldsWithRole } from './catalog.mjs';
import { parsePeriods } from './period-parse.mjs';
import { createRandom } from './flywheel-seeds.mjs';

const TEMPLATES = [
  { id: 'recent', text: '${value}の最近の不適合' },
  { id: 'count3', text: '${value}の不適合を3件' },
  { id: 'count5', text: '${value} 直近 5件' },
  { id: 'colloquial', text: '${value}で最近なにかあった？' },
  { id: 'short', text: '${value} 最近 不適合', short: true },
  { id: 'last_month', text: '${value}の先月の不適合', period: '先月' },
  { id: 'this_year', text: '${value} 今年 不適合', period: '今年' },
];

const normalize = (value) => String(value ?? '').normalize('NFKC').trim();
const shortName = (value) => value.slice(value.lastIndexOf('部') + 1).trim() || value;
const tokyoDay = (date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

/** Sample without replacement, including when random always returns the same number. */
export function sampleFilterQuestions({ records, catalog, count, random = createRandom(), now = new Date() }) {
  const field = fieldsWithRole(catalog, 'organization')[0] ?? 'originDepartmentName';
  const values = [...new Set(records.map((record) => normalize(record[field])).filter(Boolean))].sort();
  const shortCounts = new Map();
  for (const value of values) {
    const short = shortName(value);
    shortCounts.set(short, (shortCounts.get(short) ?? 0) + 1);
  }
  const reference = now instanceof Date ? tokyoDay(now) : now;
  // Match the runner's night identity across midnight; periods use the actual reference day.
  const hour = now instanceof Date ? Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', hourCycle: 'h23',
  }).format(now)) : 12;
  const night = hour < 12 ? tokyoDay(new Date(now.getTime() - 12 * 3600 * 1000)) : reference;
  const templates = TEMPLATES.filter((template) => !template.period || fieldsWithRole(catalog, 'date').length);
  const candidates = [];
  const seen = new Set();
  for (const value of values) {
    for (const template of templates) {
      const short = template.short && shortCounts.get(shortName(value)) === 1 ? shortName(value) : null;
      const question = template.text.replace('${value}', short ?? value);
      if (seen.has(question)) continue;
      seen.add(question);
      const period = template.period ? parsePeriods(template.period, reference)[0].interpretations[0] : null;
      const id = `f-${createHash('sha256').update(JSON.stringify([night, template.id, field, value])).digest('hex').slice(0, 16)}`;
      candidates.push({ id, question, seed: { template: template.id, field, value, short, period } });
    }
  }
  const sampled = [];
  while (sampled.length < count && candidates.length) {
    const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
    sampled.push(...candidates.splice(index, 1));
  }
  return sampled;
}
