// Deterministic Japanese period parser. Bounds are inclusive calendar dates.
// chrono-node 2.10.1 (unpacked ~2.7MB) leaves 今年/去年/年度/先月/直近Nか月/以降 empty.

const ERAS = { 令和: 2018, 平成: 1988, 昭和: 1925, 大正: 1911, 明治: 1867 };
const KANJI_DIGIT = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

export function referenceDate(now) {
  if (now instanceof Date && !Number.isNaN(now.getTime())) {
    return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(now ?? ''));
  if (match) return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  const date = new Date();
  return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
}

function iso(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function shiftMonth(ref, delta) {
  const index = ref.y * 12 + (ref.m - 1) + delta;
  const y = Math.floor(index / 12);
  const m = index % 12 + 1;
  return { y, m, from: iso(y, m, 1), to: iso(y, m, daysInMonth(y, m)) };
}

function addDays(ref, delta) {
  const date = new Date(Date.UTC(ref.y, ref.m - 1, ref.d + delta));
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

function addMonthsClamped(ref, delta) {
  const shifted = shiftMonth(ref, delta);
  const d = Math.min(ref.d, daysInMonth(shifted.y, shifted.m));
  return { y: shifted.y, m: shifted.m, d };
}

export function previousIsoDay(value) {
  const ref = referenceDate(value);
  const day = addDays(ref, -1);
  return iso(day.y, day.m, day.d);
}

export function nextIsoDay(value) {
  const ref = referenceDate(value);
  const day = addDays(ref, 1);
  return iso(day.y, day.m, day.d);
}

function yearBounds(y) {
  return { from: iso(y, 1, 1), to: iso(y, 12, 31) };
}

function fiscalYear(startYear) {
  return { from: iso(startYear, 4, 1), to: iso(startYear + 1, 3, 31) };
}

function currentFiscalStart(ref) {
  return ref.m >= 4 ? ref.y : ref.y - 1;
}

function monthBounds(y, m) {
  return { from: iso(y, m, 1), to: iso(y, m, daysInMonth(y, m)) };
}

function dayBounds(y, m, d) {
  const day = iso(y, m, d);
  return { from: day, to: day };
}

function labelOf(bounds) {
  return `${bounds.from ?? ''}..${bounds.to ?? ''}`;
}

function withLabel(bounds) {
  return { ...bounds, label: labelOf(bounds) };
}

function parseCount(text) {
  const ascii = String(text ?? '').normalize('NFKC');
  if (/^\d+$/u.test(ascii)) return Number(ascii);
  if (ascii === '十') return 10;
  const ten = /^([一二三四五六七八九])?十([一二三四五六七八九])?$/u.exec(ascii);
  if (ten) return (ten[1] ? KANJI_DIGIT[ten[1]] : 1) * 10 + (ten[2] ? KANJI_DIGIT[ten[2]] : 0);
  if (ascii.length === 1 && KANJI_DIGIT[ascii] != null) return KANJI_DIGIT[ascii];
  return null;
}

function eraYear(name, count) {
  const base = ERAS[name];
  const n = count === '元' ? 1 : parseCount(count);
  if (!base || !n) return null;
  return base + n;
}

function bareMonthYear(ref, month) {
  if (month <= ref.m) return [ref.y];
  return [ref.y, ref.y - 1];
}

function interpretUnit(kind, ref, count) {
  const n = parseCount(count);
  if (!n || n > 366) return [];
  if (kind === 'year') {
    const start = addMonthsClamped(ref, -12 * n);
    return [withLabel({ from: iso(start.y, start.m, start.d), to: iso(ref.y, ref.m, ref.d) })];
  }
  if (kind === 'month') {
    const start = addMonthsClamped(ref, -n);
    return [withLabel({ from: iso(start.y, start.m, start.d), to: iso(ref.y, ref.m, ref.d) })];
  }
  if (kind === 'week') {
    const start = addDays(ref, -7 * n);
    return [withLabel({ from: iso(start.y, start.m, start.d), to: iso(ref.y, ref.m, ref.d) })];
  }
  const start = addDays(ref, -n);
  return [withLabel({ from: iso(start.y, start.m, start.d), to: iso(ref.y, ref.m, ref.d) })];
}

function resolveAtom(text, ref) {
  const normalized = text.normalize('NFKC').replace(/[〜～]/gu, 'から').replace(/\s+/gu, '');
  let match = /^(令和|平成|昭和|大正|明治)(元|\d+|[〇零一二三四五六七八九十]+)年度$/u.exec(normalized);
  if (match) {
    const year = eraYear(match[1], match[2]);
    return year ? [withLabel(fiscalYear(year))] : [];
  }
  match = /^(令和|平成|昭和|大正|明治)(元|\d+|[〇零一二三四五六七八九十]+)年$/u.exec(normalized);
  if (match) {
    const year = eraYear(match[1], match[2]);
    return year ? [withLabel(yearBounds(year))] : [];
  }
  match = /^(\d{4})年度$/u.exec(normalized);
  if (match) return [withLabel(fiscalYear(Number(match[1])))];
  match = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/u.exec(normalized);
  if (match) return [withLabel(dayBounds(Number(match[1]), Number(match[2]), Number(match[3])))];
  match = /^(\d{4})年(\d{1,2})月$/u.exec(normalized);
  if (match) return [withLabel(monthBounds(Number(match[1]), Number(match[2])))];
  match = /^(\d{4})年$/u.exec(normalized);
  if (match) return [withLabel(yearBounds(Number(match[1])))];
  match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/u.exec(normalized);
  if (match) return [withLabel(dayBounds(Number(match[1]), Number(match[2]), Number(match[3])))];
  if (normalized === '今年度' || normalized === '本年度') return [withLabel(fiscalYear(currentFiscalStart(ref)))];
  if (normalized === '昨年度' || normalized === '前年度') return [withLabel(fiscalYear(currentFiscalStart(ref) - 1))];
  if (normalized === '来年度') return [withLabel(fiscalYear(currentFiscalStart(ref) + 1))];
  if (normalized === '今年' || normalized === '本年') return [withLabel(yearBounds(ref.y))];
  if (normalized === '去年' || normalized === '昨年') return [withLabel(yearBounds(ref.y - 1))];
  if (normalized === '一昨年') return [withLabel(yearBounds(ref.y - 2))];
  if (normalized === '来年') return [withLabel(yearBounds(ref.y + 1))];
  if (normalized === '今月') return [withLabel(monthBounds(ref.y, ref.m))];
  if (normalized === '来月') {
    const next = shiftMonth(ref, 1);
    return [withLabel({ from: next.from, to: next.to })];
  }
  if (normalized === '先月') {
    const prev = shiftMonth(ref, -1);
    return [withLabel({ from: prev.from, to: prev.to })];
  }
  if (normalized === '先々月') {
    const prev = shiftMonth(ref, -2);
    return [withLabel({ from: prev.from, to: prev.to })];
  }
  match = /^(今年|本年|去年|昨年|一昨年|来年)の(\d{1,2})月$/u.exec(normalized);
  if (match) {
    const year = match[1] === '来年' ? ref.y + 1 : match[1] === '去年' || match[1] === '昨年' ? ref.y - 1 : match[1] === '一昨年' ? ref.y - 2 : ref.y;
    return [withLabel(monthBounds(year, Number(match[2])))];
  }
  match = /^(\d{1,2})月(\d{1,2})日$/u.exec(normalized);
  if (match) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    return bareMonthYear(ref, month).map((year) => withLabel(dayBounds(year, month, day)));
  }
  match = /^(\d{1,2})月$/u.exec(normalized);
  if (match) {
    const month = Number(match[1]);
    return bareMonthYear(ref, month).map((year) => withLabel(monthBounds(year, month)));
  }
  match = /^(?:直近|過去)(\d+|[〇零一二三四五六七八九十]+)(?:か|ヶ|ケ|ヵ)?月$/u.exec(normalized);
  if (match) return interpretUnit('month', ref, match[1]);
  match = /^(?:直近|過去)(\d+|[〇零一二三四五六七八九十]+)年$/u.exec(normalized);
  if (match) return interpretUnit('year', ref, match[1]);
  match = /^(?:直近|過去)(\d+|[〇零一二三四五六七八九十]+)週間$/u.exec(normalized);
  if (match) return interpretUnit('week', ref, match[1]);
  match = /^(?:直近|過去)(\d+|[〇零一二三四五六七八九十]+)日$/u.exec(normalized);
  if (match) return interpretUnit('day', ref, match[1]);
  return [];
}

const ATOM = '(?:(?:令和|平成|昭和|大正|明治)(?:元|\\d+|[〇零一二三四五六七八九十]+)年(?:度)?|今年度|本年度|昨年度|前年度|来年度|(?:今年|本年|去年|昨年|一昨年|来年)の\\d{1,2}月|今年|本年|去年|昨年|一昨年|来年|今月|来月|先月|先々月|\\d{4}年度|\\d{4}年\\d{1,2}月\\d{1,2}日|\\d{4}年\\d{1,2}月|\\d{4}年|\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}|\\d{1,2}月\\d{1,2}日|\\d{1,2}月|(?:直近|過去)(?:\\d+|[〇零一二三四五六七八九十]+)(?:か|ヶ|ケ|ヵ)?月|(?:直近|過去)(?:\\d+|[〇零一二三四五六七八九十]+)年|(?:直近|過去)(?:\\d+|[〇零一二三四五六七八九十]+)週間|(?:直近|過去)(?:\\d+|[〇零一二三四五六七八九十]+)日)';
const SPAN = new RegExp(`${ATOM}(?:(?:から|〜|～)${ATOM})?(?:以降|以前|まで)?`, 'gu');

function applyEdge(bounds, edge) {
  if (!bounds) return [];
  if (edge === '以降') return [withLabel({ from: bounds.from, to: null })];
  if (edge === '以前' || edge === 'まで') return [withLabel({ from: null, to: bounds.to })];
  return [withLabel(bounds)];
}

function resolveSpan(text, ref) {
  const normalized = text.normalize('NFKC');
  const edge = /(?:以降|以前|まで)$/u.exec(normalized)?.[0] ?? '';
  const body = edge ? normalized.slice(0, -edge.length) : normalized;
  const parts = body.split(/から|[〜～]/u).filter(Boolean);
  if (parts.length === 2) {
    const left = resolveAtom(parts[0], ref);
    const leftYear = left[0]?.from?.slice(0, 4);
    const right = left.length === 1 && leftYear && /^\d{1,2}月/u.test(parts[1].normalize('NFKC'))
      ? resolveAtom(`${leftYear}年${parts[1]}`, ref)
      : resolveAtom(parts[1], ref);
    if (left.length === 1 && right.length === 1 && left[0].from && right[0].to) {
      if (edge === '以降') return [withLabel({ from: left[0].from, to: null })];
      return [withLabel({ from: left[0].from, to: right[0].to })];
    }
    return [];
  }
  return resolveAtom(body, ref).flatMap((bounds) => applyEdge(bounds, edge));
}

export function parsePeriods(text, now) {
  const ref = referenceDate(now);
  const source = String(text ?? '');
  const matches = [];
  for (const found of source.normalize('NFKC').matchAll(SPAN)) {
    const start = found.index ?? 0;
    const end = start + found[0].length;
    if (matches.some((item) => start < item.end && end > item.start)) continue;
    const interpretations = resolveSpan(found[0], ref);
    if (!interpretations.length) continue;
    matches.push({ start, end, text: found[0], interpretations });
  }
  return matches;
}

export function periodSpans(text) {
  return parsePeriods(text, '2026-01-01').map((item) => ({ start: item.start, end: item.end }));
}
