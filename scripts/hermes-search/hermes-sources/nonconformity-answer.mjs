// Nonconformity answer semantics belong here; other sources supply their own policy.
import fs from 'node:fs';
import {buildLexicalQuery} from '../hermes-qmd-local.mjs';
import {quantitiesInText} from '../hermes-evidence-units.mjs';
import {nonconformityDefinition} from '../hermes-source-definition.mjs';
const LABELS=nonconformityDefinition.organizedLabels;
export const relevancePolicy=Object.freeze(JSON.parse(fs.readFileSync(new URL('./nonconformity-relevance.json',import.meta.url),'utf8')));
if(relevancePolicy.schema!=='hermes-trial-relevance/v1'||!Number.isFinite(relevancePolicy.minBestAnswerScore)||relevancePolicy.maxAnswers!==1)throw new Error('invalid relevance calibration');

function wantsActionFields(question) {
  return /対策|再発防止|是正|対応|対処|確認|指示|教育|どう|教える|教えた|教わ|見直/u.test(question);
}

// Use the request clause for field retrieval only. Whole-question record
// retrieval is unchanged. No event synonym or record-number dictionary.
export function semanticFieldQuery(question) {
  if(wantsActionFields(question)||/原因|なぜ|何故|理由|処置|処理|手直し/u.test(question))return null;
  const clauses=question.split(/[、，。!?？！\n]+/u).map(x=>x.trim()).filter(clause=>clause&&buildLexicalQuery(clause));
  return clauses.at(-1)??question;
}
export function nonNumericConditionQueries(question) {
  return question.split(/[、，。!?？！\n]+/u).map(x=>x.trim()).filter(clause=>clause
    &&!quantitiesInText(clause,nonconformityDefinition.quantityUnits).length&&buildLexicalQuery(clause));
}

// Source headings define the scope of following action sentences. Preserve
// continuations under that heading; never derive ownership from origin dept.
function requestedActionSpans(question,spans,record) {
  const scoped=spans.map(span=>{
    const prefix=record[span.canonicalField].slice(0,span.start+span.text.length);
    const headings=[...prefix.matchAll(/(?:^|\n)([^\n:：]{1,20})[：:]/gu)];
    return {span,heading:headings.at(-1)?.[1].trim()};
  });
  const named=new Set(scoped.map(s=>s.heading).filter(label=>label&&question.includes(label)));
  return named.size?scoped.filter(s=>s.heading&&named.has(s.heading)).map(s=>s.span):spans;
}

export function projectAnswer(question, rows, recordsById, validateOrganizedRow) {
  const wantsActions=wantsActionFields(question);
  const wantsCauses=/原因|なぜ|何故|理由|工程|特定|どこ|事例/u.test(question);
  const wantsDisposition=/処置|処理|手直し/u.test(question);
  const selectedSourceSpans=[];const sections=[];
  for(const row of rows) {
    const record=recordsById.get(row.recordId);validateOrganizedRow(row,record);
    const wanted=new Set(['event','uncertainty',...(row.requestedClasses??[])]);
    if([...wanted].some(type=>!Object.hasOwn(LABELS,type)))throw new Error('unknown requested original category');
    if(wantsActions)wanted.add('action');if(wantsCauses)wanted.add('cause');if(wantsDisposition)wanted.add('disposition');
    const missingActions=(wantsActions||wanted.has('action'))&&!row.extractions.some(s=>s.class==='action');
    if(missingActions)wanted.add('disposition');
    const lines=[`【不適合番号 ${Number(record.nonconformityNo)}】`];
    if(missingActions)lines.push('対策に該当する記載をこの記録から抽出できていません（未実施という意味ではありません）。');
    if(wantsDisposition&&!row.extractions.some(s=>s.class==='disposition')) {
      // A missing reviewed category is not proof that the original field is
      // empty. Prefer the complete original disposition, otherwise label the
      // alternative action category explicitly rather than returning only an event.
      if(typeof record.disposition==='string'&&record.disposition.trim()) {
        lines.push(`${LABELS.disposition}:\n${record.disposition}`);
        selectedSourceSpans.push({recordId:row.recordId,canonicalField:'disposition',start:0,end:record.disposition.length,
          text:record.disposition,offsetUnit:'javascript_utf16_code_units',sourceFields:['disposition']});
      } else {
        const hasActions=row.extractions.some(s=>s.class==='action');
        lines.push(hasActions?'処置欄に記載はありません。以下に、同じ記録の対策を表示します。':'処置欄に記載はなく、対策に該当する原文も整理済みの範囲から確認できません。');
        if(hasActions)wanted.add('action');
      }
    }
    const seen=new Set();
    for(const type of Object.keys(LABELS)) {
      if(!wanted.has(type))continue;
      let spans=row.extractions.filter(s=>s.class===type && !(type==='action'&&row.extractions.some(other=>other.class==='cause'&&other.text===s.text)))
        .sort((a,b)=>a.canonicalField.localeCompare(b.canonicalField)||a.start-b.start);
      if(type==='action')spans=requestedActionSpans(question,spans,record);
      const text=[];
      for(const span of spans) {
        const key=`${span.canonicalField}:${span.start}:${span.end}`;
        if(seen.has(key))continue;seen.add(key);
        text.push(record[span.canonicalField].slice(span.start,span.end));
        selectedSourceSpans.push({...span,sourceFields:[span.canonicalField]});
      }
      if(text.length)lines.push(`${LABELS[type]}:\n${text.join('\n')}`);
    }
    sections.push(lines.join('\n'));
  }
  return {answer:sections.join('\n\n'),recordIds:rows.map(r=>r.recordId),selectedSourceSpans};
}

export function selectRecords(question, candidates, scores, {scoreKind}={}) {
  // Similarity cannot establish negation or exhaustive coverage.
  if(/すべて|全て|全件|存在しない|一度も|以外|ではない|していない|しなかった|なかった事例/u.test(question)) {
    return {rows:[],reason:'この試用では、否定条件や全件にわたる条件を確実に判定できません。対象の記録や現象を指定してください。'};
  }
  const count=question.normalize('NFKC').match(/([1-3])件/u);
  const limit=count?Number(count[1]):/複数|いくつか/u.test(question)?3:1;
  const ranked=candidates.map((row,i)=>({row,score:scores[i]}))
    .filter(({score})=>typeof score==='number'&&Number.isFinite(score)).sort((a,b)=>b.score-a.score);
  const wantsActions=wantsActionFields(question);
  // Field availability is established from reviewed original spans. It does
  // not establish relevance: all records were scored against the whole query.
  const complete=wantsActions?ranked.filter(({row})=>row.extractions.some(s=>s.class==='action')):ranked;
  const best=(complete.length?complete:ranked)[0];
  const floor=scoreKind==='raw_relevance_logit'?relevancePolicy.minBestAnswerScore:0;
  const selected=best&&best.score>floor?[best.row]:[];
  return {rows:selected,scoreKind,requestedCount:limit,insufficientCount:selected.length>0&&selected.length<limit,
    reason:selected.length?undefined:'整理済みの記録から質問に対応する答えを選べませんでした。対象工程や現象をもう少し具体的に指定してください。未整理の記録を含めて存在しないという意味ではありません。',
    ranking:ranked.map(x=>({recordId:x.row.recordId,score:x.score})),
    rejectionFloor:floor,selectionIsEntailmentProof:false,
    additionalAnswers:'not accepted from secondary ranks without separately validated relevance'};
}
