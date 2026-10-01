import { lighterSelfInspectionLevel, type SelfInspectionReductionPolicy } from '@raspi-system/shared-types';

import {
  REDUCTION_PROCESS_LABELS,
  formatCpk,
  worstItem,
  type ReductionRow
} from './selfInspectionReductionViewModel';

/**
 * 上辺に出す2行の所見。1行目は全体、2行目はいま一番見てほしい1件。
 * 品番ごとの数字の言い換えではなく、どこを見るべきかを示す。
 */

/** 「怪しい」は測定がこの個数以上あり、兆しが2つ以上そろったときだけ挙げる。 */
export const FINDING_SUSPICIOUS_MIN_VALUES = 20;
export const FINDING_SUSPICIOUS_MIN_SIGNS = 2;
/** Cpk がこれ以上下がったら兆しとする。 */
export const FINDING_CPK_DROP = 0.3;
/** 下がった後の Cpk が基準よりこれ以上高ければ、まだ余裕があるので兆しにしない。 */
export const FINDING_CPK_DROP_HEADROOM = 0.33;
/** 直近の値のうち、公差の端からこの割合以内にある値を「端に近い」と数える。 */
export const FINDING_NEAR_LIMIT_RATIO = 0.1;
export const FINDING_NEAR_LIMIT_RECENT = 10;
export const FINDING_NEAR_LIMIT_MIN = 2;
/** 全体の傾向は、前の期間と比べられる品番がこの数以上あるときだけ言う。 */
export const FINDING_TREND_MIN_PARTS = 3;
export const FINDING_TREND_DELTA = 0.1;
/** 同じ資源の品番がそろってこれ以上下がったら、資源の偏りとして挙げる。 */
export const FINDING_RESOURCE_DROP = 0.2;
export const FINDING_MIN_GROUP = 2;

export type ReductionFindingKind = 'empty' | 'shortage' | 'trend' | 'restore' | 'suspicious' | 'almost' | 'calm';
export type ReductionFindingTone = 'good' | 'warn' | 'bad' | 'info' | 'muted';
export type ReductionFindingIcon = 'up' | 'flat' | 'down' | 'wait' | 'warn' | 'flag' | 'raise' | 'check';

export type ReductionFinding = {
  kind: ReductionFindingKind;
  tone: ReductionFindingTone;
  icon: ReductionFindingIcon;
  /** 品番の前に置く言葉。 */
  lead: string;
  fhincd: string | null;
  text: string;
  /** 同じ種類でほかに挙がった件数。 */
  moreCount: number;
  /** 押したときに一覧を絞る品番。先頭を選ぶ。空なら絞らない。 */
  rowIds: string[];
};

export type ReductionFindings = { overall: ReductionFinding; focus: ReductionFinding };

type Blocker = 'sample' | 'cpk' | 'streak' | 'drift' | 'noRecheck' | 'gap';

const BLOCKER_LABELS: Record<Blocker, string> = {
  sample: 'データ不足',
  cpk: '公差の余裕不足',
  streak: '連続合格不足',
  drift: 'ずれの傾向',
  noRecheck: '再測定なし',
  gap: '測り方の差'
};

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** API の reduction-stats.ts と同じ式。前半・後半を比べるために画面側でも計算する。 */
function cpkOf(values: readonly number[], lower: number, upper: number): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
  const nearest = Math.min(upper - mean, mean - lower);
  if (sd === 0) return nearest >= 0 ? 9.99 : 0;
  return Math.min(nearest / (3 * sd), 9.99);
}

/** 減らすのを止めている条件。データ不足のせいで保留になっているだけの Cpk は数えない。 */
function blockersOf(row: ReductionRow, policy: SelfInspectionReductionPolicy): Blocker[] {
  const { checks } = row.judgement;
  const { worstCpk } = row.part.metrics;
  const list: Blocker[] = [];
  if (checks.sample !== 'ok') list.push('sample');
  const cpkHeldBySampleOnly = checks.sample !== 'ok' && worstCpk != null && worstCpk >= policy.cpkThreshold;
  if (checks.cpk !== 'ok' && !cpkHeldBySampleOnly) list.push('cpk');
  if (checks.streak !== 'ok') list.push('streak');
  if (checks.drift !== 'ok') list.push('drift');
  if (checks.gap === 'hold') list.push('noRecheck');
  if (checks.gap === 'ng') list.push('gap');
  return list;
}

function formatEta(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return '';
  if (days < 10) return `（約${Math.max(Math.round(days), 1)}日）`;
  if (days < 56) return `（約${Math.round(days / 7)}週間）`;
  return `（約${Math.round(days / 30)}か月）`;
}

function finding(
  base: Pick<ReductionFinding, 'kind' | 'tone' | 'icon' | 'text'>,
  extra: Partial<Pick<ReductionFinding, 'lead' | 'fhincd' | 'moreCount' | 'rowIds'>> = {}
): ReductionFinding {
  return { lead: '', fhincd: null, moreCount: 0, rowIds: [], ...base, ...extra };
}

function focusOn(
  base: Pick<ReductionFinding, 'kind' | 'tone' | 'icon' | 'text' | 'lead'>,
  rows: readonly ReductionRow[]
): ReductionFinding {
  return {
    ...base,
    fhincd: rows[0]!.part.key.fhincd,
    moreCount: rows.length - 1,
    rowIds: rows.map((row) => row.id)
  };
}

// ---------- 1行目：全体 ----------

function buildOverall(
  rows: readonly ReductionRow[],
  policy: SelfInspectionReductionPolicy,
  options: { periodDays: number; savingsHours: number | null }
): ReductionFinding {
  if (rows.length === 0) {
    return finding({ kind: 'empty', tone: 'muted', icon: 'flat', text: 'この条件の記録はありません' });
  }

  const shortage = rows.filter((row) => row.part.metrics.evaluable && row.judgement.checks.sample !== 'ok');
  if (shortage.length * 2 >= rows.length) {
    return finding(
      {
        kind: 'shortage',
        tone: 'muted',
        icon: 'wait',
        text: `${rows.length}件中${shortage.length}件がデータ不足。傾向はまだ言えない`
      },
      { rowIds: shortage.map((row) => row.id) }
    );
  }

  const comparable = rows.flatMap((row) => {
    const current = row.part.metrics.worstCpk;
    const previous = row.part.previousPeriod;
    if (row.judgement.checks.sample !== 'ok' || current == null) return [];
    if (!previous || previous.worstCpk == null || previous.sampleCount < policy.minimumSampleCount) return [];
    return [{ row, current, previous: previous.worstCpk }];
  });
  const delta =
    comparable.length >= FINDING_TREND_MIN_PARTS
      ? median(comparable.map((entry) => entry.current))! - median(comparable.map((entry) => entry.previous))!
      : null;

  let head = '';
  let icon: ReductionFindingIcon = 'flat';
  let tone: ReductionFindingTone = 'muted';
  if (delta != null) {
    if (delta >= FINDING_TREND_DELTA) [head, icon, tone] = ['全体は上向き', 'up', 'good'];
    else if (delta <= -FINDING_TREND_DELTA) [head, icon, tone] = ['全体は下向き', 'down', 'warn'];
    else head = '全体は横ばい';
  }
  const join = (tail: string) => (head ? `${head}。${tail}` : tail);

  // 同じ資源の品番がそろって下がっていれば、機械側の要因を疑う。
  const byResource = new Map<string, typeof comparable>();
  for (const entry of comparable) {
    const { processGroup, resourceCd } = entry.row.part.key;
    const key = `${processGroup}\u0000${resourceCd}`;
    byResource.set(key, [...(byResource.get(key) ?? []), entry]);
  }
  const falling = [...byResource.values()]
    .filter(
      (entries) =>
        entries.length >= FINDING_MIN_GROUP &&
        entries.every((entry) => entry.current - entry.previous <= -FINDING_RESOURCE_DROP)
    )
    .sort((a, b) => b.length - a.length)[0];
  if (falling) {
    const { processGroup, resourceCd } = falling[0]!.row.part.key;
    return finding(
      {
        kind: 'trend',
        tone: 'warn',
        icon,
        text: join(`${REDUCTION_PROCESS_LABELS[processGroup]} ${resourceCd} の${falling.length}品番がそろって下向き`)
      },
      { rowIds: falling.map((entry) => entry.row.id) }
    );
  }

  const reduce = rows.filter((row) => row.judgement.verdict === 'reduce');
  const awaitingApproval = reduce.filter((row) => !row.part.latestDecision?.awaitingRevision);
  if (awaitingApproval.length > 0) {
    const saving = options.savingsHours == null ? '承認待ち' : `承認で月 −${options.savingsHours.toFixed(1)}時間`;
    return finding(
      { kind: 'trend', tone: 'good', icon, text: join(`減らせる${awaitingApproval.length}件、${saving}`) },
      { rowIds: awaitingApproval.map((row) => row.id) }
    );
  }
  if (reduce.length > 0) {
    return finding(
      { kind: 'trend', tone, icon, text: join(`承認済み${reduce.length}件が改版待ち`) },
      { rowIds: reduce.map((row) => row.id) }
    );
  }

  // どの条件で止まっている品番が多いか。運用を1つ動かせば進む所を示す。
  const stuck = new Map<Blocker, ReductionRow[]>();
  for (const row of rows) {
    if (row.judgement.verdict !== 'almost' && row.judgement.verdict !== 'keep') continue;
    for (const blocker of blockersOf(row, policy)) stuck.set(blocker, [...(stuck.get(blocker) ?? []), row]);
  }
  const top = [...stuck.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (top && top[1].length >= FINDING_MIN_GROUP) {
    return finding(
      { kind: 'trend', tone, icon, text: join(`足止めの最多は${BLOCKER_LABELS[top[0]]} ${top[1].length}件`) },
      { rowIds: top[1].map((row) => row.id) }
    );
  }

  if (delta != null) {
    const sign = delta >= 0 ? '+' : '−';
    return finding({
      kind: 'trend',
      tone,
      icon,
      text: join(`前の${options.periodDays}日よりCpk中央値 ${sign}${Math.abs(delta).toFixed(1)}`)
    });
  }
  return finding({ kind: 'trend', tone: 'muted', icon: 'flat', text: '前の期間と比べる記録がまだ少ない' });
}

// ---------- 2行目：いま一番見てほしい1件 ----------

function restoreCandidates(rows: readonly ReductionRow[]): Array<{ row: ReductionRow; text: string }> {
  const weight = (row: ReductionRow) => row.part.metrics.outOfToleranceCount + row.part.metrics.nonconformityCount;
  const approved = (row: ReductionRow) =>
    row.part.latestDecision?.direction === 'restore' && row.part.latestDecision.awaitingRevision;
  return rows
    .filter((row) => row.judgement.verdict === 'restore')
    // 同点は一覧の並びのままにする（一覧の先頭と所見の品番をそろえる）。
    .sort((a, b) => Number(approved(a)) - Number(approved(b)) || weight(b) - weight(a))
    .map((row) => {
      const { outOfToleranceCount, nonconformityCount, worstCpk } = row.part.metrics;
      const reason =
        outOfToleranceCount > 0
          ? `規格外${outOfToleranceCount}件`
          : nonconformityCount > 0
            ? `不適合${nonconformityCount}件`
            : `Cpk ${formatCpk(worstCpk)}`;
      const action = approved(row) ? '改版待ち' : row.judgement.target ? '1段上げる' : '原因を確認';
      return { row, text: `${reason}。${action}` };
    });
}

function suspiciousCandidates(
  rows: readonly ReductionRow[],
  policy: SelfInspectionReductionPolicy
): Array<{ row: ReductionRow; text: string }> {
  const list: Array<{ row: ReductionRow; text: string; signs: number; drop: number }> = [];
  for (const row of rows) {
    const { verdict, checks } = row.judgement;
    const { metrics, previousPeriod } = row.part;
    if (verdict === 'restore' || verdict === 'unjudgeable') continue;
    if (metrics.sampleCount < FINDING_SUSPICIOUS_MIN_VALUES) continue;

    // Cpk の低下。まず期間内の前半と後半、なければ前の期間と比べる。
    let cpkPair: { from: number; to: number } | null = null;
    const item = worstItem(row.part);
    if (item && item.values.length >= FINDING_SUSPICIOUS_MIN_VALUES) {
      const values = item.values.map((point) => point.value);
      const half = Math.floor(values.length / 2);
      const from = cpkOf(values.slice(0, half), item.lower, item.upper);
      const to = cpkOf(values.slice(half), item.lower, item.upper);
      if (from != null && to != null) cpkPair = { from, to };
    } else if (
      previousPeriod?.worstCpk != null &&
      previousPeriod.sampleCount >= FINDING_SUSPICIOUS_MIN_VALUES &&
      metrics.worstCpk != null
    ) {
      cpkPair = { from: previousPeriod.worstCpk, to: metrics.worstCpk };
    }
    const cpkFalling =
      cpkPair != null &&
      cpkPair.from - cpkPair.to >= FINDING_CPK_DROP &&
      cpkPair.to < policy.cpkThreshold + FINDING_CPK_DROP_HEADROOM;

    let nearLimit = false;
    if (item) {
      const margin = (item.upper - item.lower) * FINDING_NEAR_LIMIT_RATIO;
      const near = item.values
        .slice(-FINDING_NEAR_LIMIT_RECENT)
        .filter(({ value }) => value - item.lower <= margin || item.upper - value <= margin);
      nearLimit = near.length >= FINDING_NEAR_LIMIT_MIN;
    }

    const signs = [cpkFalling, metrics.drift, nearLimit, checks.gap === 'ng'].filter(Boolean).length;
    if (signs < FINDING_SUSPICIOUS_MIN_SIGNS) continue;
    const text = cpkFalling
      ? `合格だがCpk ${cpkPair!.from.toFixed(1)}→${cpkPair!.to.toFixed(1)}`
      : metrics.drift
        ? '合格だが上限・下限へ寄ってきた'
        : '合格だが公差の端に近い値が続く';
    list.push({ row, text, signs, drop: cpkFalling ? cpkPair!.from - cpkPair!.to : 0 });
  }
  return list.sort((a, b) => b.signs - a.signs || b.drop - a.drop || a.row.id.localeCompare(b.row.id, 'ja'));
}

function almostCandidates(
  rows: readonly ReductionRow[],
  policy: SelfInspectionReductionPolicy,
  periodDays: number
): Array<{ row: ReductionRow; text: string }> {
  const list: Array<{ row: ReductionRow; text: string; days: number }> = [];
  for (const row of rows) {
    const { metrics, lotsPerMonth } = row.part;
    if (row.judgement.verdict !== 'almost') continue;
    if (!lighterSelfInspectionLevel(metrics.level, metrics.lotSize)) continue;
    const blockers = blockersOf(row, policy);
    if (blockers.length !== 1) continue;
    switch (blockers[0]) {
      case 'streak': {
        const lots = policy.requiredConsecutiveLots - row.judgement.effectiveConsecutivePassLots;
        const days = lotsPerMonth > 0 ? (lots / lotsPerMonth) * 30 : Number.POSITIVE_INFINITY;
        list.push({ row, text: `あと${lots}ロットで減らせる`, days });
        break;
      }
      case 'sample': {
        const pieces = policy.minimumSampleCount - metrics.sampleCount;
        const days = metrics.sampleCount > 0 ? (pieces / metrics.sampleCount) * periodDays : Number.POSITIVE_INFINITY;
        list.push({ row, text: `あと${pieces}個で減らせる`, days });
        break;
      }
      case 'noRecheck':
        list.push({ row, text: '検査員の再測定で減らせる', days: 0 });
        break;
      case 'cpk':
        if (metrics.worstCpk != null) {
          const gap = (policy.cpkThreshold - metrics.worstCpk).toFixed(2);
          list.push({ row, text: `Cpk基準まであと${gap}`, days: Number.MAX_VALUE });
        }
        break;
      default:
        break;
    }
  }
  return list.sort((a, b) => a.days - b.days || a.row.id.localeCompare(b.row.id, 'ja'));
}

function shortageCandidates(
  rows: readonly ReductionRow[],
  policy: SelfInspectionReductionPolicy,
  periodDays: number
): Array<{ row: ReductionRow; text: string }> {
  return rows
    .filter((row) => row.part.metrics.evaluable && row.judgement.checks.sample !== 'ok')
    .map((row) => {
      const { sampleCount } = row.part.metrics;
      const pieces = policy.minimumSampleCount - sampleCount;
      const days = sampleCount > 0 ? (pieces / sampleCount) * periodDays : Number.POSITIVE_INFINITY;
      return { row, text: `あと${pieces}個${formatEta(days)}`, days };
    })
    .sort((a, b) => a.days - b.days || a.row.id.localeCompare(b.row.id, 'ja'));
}

function buildFocus(
  rows: readonly ReductionRow[],
  policy: SelfInspectionReductionPolicy,
  periodDays: number
): ReductionFinding {
  const restore = restoreCandidates(rows);
  if (restore.length > 0) {
    return focusOn(
      { kind: 'restore', tone: 'bad', icon: 'raise', lead: '戻す：', text: restore[0]!.text },
      restore.map((entry) => entry.row)
    );
  }
  const suspicious = suspiciousCandidates(rows, policy);
  if (suspicious.length > 0) {
    return focusOn(
      { kind: 'suspicious', tone: 'warn', icon: 'warn', lead: '怪しい：', text: suspicious[0]!.text },
      suspicious.map((entry) => entry.row)
    );
  }
  const almost = almostCandidates(rows, policy, periodDays);
  if (almost.length > 0) {
    return focusOn(
      { kind: 'almost', tone: 'good', icon: 'flag', lead: 'もう少し：', text: almost[0]!.text },
      almost.map((entry) => entry.row)
    );
  }
  const shortage = shortageCandidates(rows, policy, periodDays);
  if (shortage.length > 0) {
    return focusOn(
      { kind: 'shortage', tone: 'info', icon: 'wait', lead: 'いちばん近いのは ', text: `：${shortage[0]!.text}` },
      shortage.map((entry) => entry.row)
    );
  }
  return finding({ kind: 'calm', tone: 'muted', icon: 'check', text: 'いま急ぎで見る品番はありません' });
}

export function buildReductionFindings(
  rows: readonly ReductionRow[],
  policy: SelfInspectionReductionPolicy,
  options: { periodDays: number; savingsHours: number | null }
): ReductionFindings {
  return {
    overall: buildOverall(rows, policy, options),
    focus: buildFocus(rows, policy, options.periodDays)
  };
}
