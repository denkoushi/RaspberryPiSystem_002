import { createHash } from 'node:crypto';
import { fieldsWithRole } from './catalog.mjs';
import { expectedFilterResults, isFilterOnlyPlan } from './flywheel-filter-check.mjs';
import { parsePeriods } from './period-parse.mjs';
import { createRandom } from './flywheel-seeds.mjs';

const normalize = value => String(value ?? '').normalize('NFKC').trim();
const tokyoDay = date => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

export function followUpId(now, firstTurnId, action, templateId) {
  const hour = now instanceof Date ? Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', hourCycle: 'h23',
  }).format(now)) : 12;
  const night = now instanceof Date ? tokyoDay(hour < 12 ? new Date(now.getTime() - 12 * 3600 * 1000) : now) : now;
  return `fu-${createHash('sha256').update(JSON.stringify([night, firstTurnId, action, templateId])).digest('hex').slice(0, 16)}`;
}

export function sampleFollowUpQuestions({ firstTurns, records, catalog, count, causeById = null, random = createRandom(), now = new Date() }) {
  const organizations = fieldsWithRole(catalog, 'organization');
  if (!organizations.length) organizations.push('originDepartmentName');
  const dateField = fieldsWithRole(catalog, 'date')[0];
  const reference = now instanceof Date ? tokyoDay(now) : now;
  const candidates = [];
  for (const first of firstTurns) {
    const previousPlan = first.live?.plan;
    if (first.kind !== 'filter' || first.filterCheck?.ok !== true || !isFilterOnlyPlan(previousPlan)
      || previousPlan.breakdown || first.seed?.breakdown) continue;
    const push = (action, template, question, expected, extra = {}) => candidates.push({
      id: followUpId(now, first.id, action, template), question, action, firstTurnId: first.id,
      previousPlan, previousShown: first.live.shown ?? [], expected,
      seed: { template, ...extra },
    });
    const result = expectedFilterResults({ plan: previousPlan, records, catalog, causeById });
    if (result.supported) {
      for (const [template, text] of [['count', '何件ある？'], ['count_total', '全部で何件？']]) {
        push('count', template, text, { matchedCount: result.matchedCount });
      }
    }
    const filters = previousPlan.filters ?? [];
    if (dateField && ['recent', 'colloquial', 'short'].includes(first.seed?.template)
      && !filters.some(filter => fieldsWithRole(catalog, 'date').includes(filter.field))) {
      for (const [template, text, phrase] of [['last_month', 'そのうち先月のは？', '先月'], ['this_year', '今年のだけ', '今年']]) {
        const period = parsePeriods(phrase, reference)[0].interpretations[0];
        const dateFilter = { ...(filters.find(filter => organizations.includes(filter.field))?.source ? { source: filters.find(filter => organizations.includes(filter.field)).source } : {}),
          field: dateField, op: 'between', values: [period.from, period.to] };
        push('add', template, text, { plan: { ...previousPlan, filters: [...filters, dateFilter] } }, { period });
      }
    }
    const organization = filters.find(filter => organizations.includes(filter.field) && ['eq', 'in'].includes(filter.op));
    if (!organization) continue;
    const values = [...new Set(records.map(record => normalize(record[organization.field])).filter(value => value
      && !/^[*(（]/u.test(value) && !organization.values.some(old => normalize(old) === value)))].sort();
    if (values.length) {
      const value = values[Math.min(values.length - 1, Math.floor(random() * values.length))];
      push('replace', 'organization', `${value}は？`, { plan: { ...previousPlan,
        filters: filters.map(filter => filter === organization ? { ...filter, values: [value] } : filter) } }, { field: organization.field, value });
    }
    for (const [template, text] of [['all_departments', '全部門で'], ['any_department', '部門は問わず']]) {
      push('drop', template, text, { plan: { ...previousPlan, filters: filters.filter(filter => !organizations.includes(filter.field)), sort: 'recent' } });
    }
  }
  const sampled = [];
  while (sampled.length < count && candidates.length) {
    sampled.push(...candidates.splice(Math.min(candidates.length - 1, Math.floor(random() * candidates.length)), 1));
  }
  return sampled;
}
