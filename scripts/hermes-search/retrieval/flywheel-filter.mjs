// Graders and the keep rule for synthetic questions. Each generated question is graded against
// its anchor record A and its near miss B by two independent graders: JEV (gradeBatch in
// graded-labels.mjs) and the DGX business LLM. A question is kept when both give A grade 3.
// B's grades are stored, not required to be low: similar nonconformities are often relevant to the
// same question, and the trial of 2026-10-03 kept only 5 of 37 questions under "B must be 1 or
// lower" while both graders confirmed A for 36 of them.
import { GRADE_CRITERIA, gradeBatch, recordText } from './graded-labels.mjs';

export const RELEVANT = 3;

const GRADE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['grade'],
  properties: { grade: { type: 'integer', minimum: 0, maximum: 3 } },
};

export function gradeSystemPrompt() {
  return [
    'あなたは製造業の不適合記録の検索結果を採点する。',
    '質問が探している出来事に、記録がどれだけ当てはまるかを 0 から 3 の整数で答える。',
    '組織名・日付・件数の指定は判断に使わない。',
    ...Object.entries(GRADE_CRITERIA).map(([id, text]) => `${id.slice(1)}: ${text}`),
    'JSON で {"grade": 数値} だけを返す。',
  ].join('\n');
}

/** Grader on the DGX business LLM; `chat` is createDgxChat from flywheel-generate.mjs. */
export function createDgxGrader(chat) {
  const system = gradeSystemPrompt();
  return async function grade(question, text) {
    const reply = await chat({
      messages: [{ role: 'system', content: system }, { role: 'user', content: `質問:\n${question}\n\n記録:\n${text}` }],
      schema: GRADE_SCHEMA,
      temperature: 0,
    });
    if (!reply?.ok) return null;
    try {
      const value = JSON.parse(reply.content)?.grade;
      return Number.isInteger(value) && value >= 0 && value <= 3 ? value : null;
    } catch {
      return null;
    }
  };
}

/** Grader on JEV for the two records of one question, in one call. */
export function createJevPairGrader(evaluate) {
  return async function grade(question, textA, textB) {
    try {
      const graded = await gradeBatch({ evaluate, question, items: [{ id: 'a', text: textA }, { id: 'b', text: textB }] });
      return [graded.a?.g ?? null, graded.b?.g ?? null];
    } catch {
      return [null, null];
    }
  };
}

export function keepDecision({ dgx, jev }) {
  if (dgx.a == null || jev.a == null) return { kept: false, reason: 'ungraded' };
  if (dgx.a === RELEVANT && jev.a === RELEVANT) return { kept: true, reason: null };
  return { kept: false, reason: 'anchor_not_confirmed' };
}

/**
 * Grades generated rows ({ a, b, question, ok }) and returns them with grades and the decision.
 * Rows that failed generation pass through unchanged. Rows hold ids and grades, no record text.
 */
export async function filterAndLabel({ rows, recordsById, bodyFields, fieldLabels = {}, gradeDgx, gradeJevPair }) {
  const out = [];
  for (const row of rows) {
    if (!row.ok) {
      out.push(row);
      continue;
    }
    const textA = recordText(recordsById.get(row.a), bodyFields, fieldLabels);
    const textB = recordText(recordsById.get(row.b), bodyFields, fieldLabels);
    const dgx = { a: await gradeDgx(row.question, textA), b: await gradeDgx(row.question, textB) };
    const [jevA, jevB] = await gradeJevPair(row.question, textA, textB);
    const jev = { a: jevA, b: jevB };
    out.push({ ...row, grades: { dgx, jev }, ...keepDecision({ dgx, jev }) });
  }
  return out;
}
