// Source-linked quantities are prepared once. A literal value is a constraint,
// never evidence that the surrounding event, time or causal relation is true.
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const escape=text=>text.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
const decimal=text=>{
  let value=text.normalize('NFKC').replace(/^\+/u,'');
  const negative=value.startsWith('-');if(negative)value=value.slice(1);
  let [whole,fraction='']=value.split('.');whole=whole.replace(/^0+(?=\d)/u,'');fraction=fraction.replace(/0+$/u,'');
  const normalized=whole+(fraction?'.'+fraction:'');return negative&&normalized!=='0'?'-'+normalized:normalized;
};
export function quantitiesInText(text,units=[]) {
  if(!units.length)return [];
  const aliases=units.flatMap(unit=>unit.aliases.map(alias=>({alias,unit:unit.unit}))).sort((a,b)=>b.alias.length-a.alias.length);
  const pattern=new RegExp('(?<![0-9０-９.．])([+＋\\-－]?[0-9０-９]+(?:[.．][0-9０-９]+)?)\\s*('+aliases.map(x=>escape(x.alias)).join('|')+')','giu');
  return [...text.matchAll(pattern)].map(match=>({start:match.index,end:match.index+match[0].length,text:match[0],
    value:decimal(match[1]),unit:aliases.find(x=>x.alias.toLowerCase()===match[2].toLowerCase()).unit}));
}
export function prepareEvidenceUnits(row,definition) {
  return row.extractions.map(span=>({unitId:hash([span.recordId,span.canonicalField,span.start,span.end].join('\0')),
    recordId:span.recordId,canonicalField:span.canonicalField,start:span.start,end:span.end,
    sourceHash:span.sourceHash,text:span.text,class:span.class,polarity:span.polarity,
    quantities:quantitiesInText(span.text,definition.quantityUnits).map(q=>({...q,start:span.start+q.start,end:span.start+q.end}))}));
}
export function quantityConstraint(question,rows,definition) {
  const quantities=quantitiesInText(question,definition.quantityUnits);
  if(!quantities.length)return null;
  // These are exact-value checks only; a range/comparison needs a typed query.
  const unsupported=quantities.some(q=>/^(?:\s*)(?:以上|以下|未満|超|より|[〜～])/u.test(question.slice(q.end)));
  const eligible=rows.filter(row=>quantities.every(q=>row.evidenceUnits.some(unit=>unit.quantities.some(actual=>actual.unit===q.unit&&actual.value===q.value))));
  return {quantities,unsupported,eligibleIds:eligible.map(row=>row.recordId),conditionIsProven:false};
}
export function fieldInputs(row,definition) {
  return Object.entries(definition.organizedLabels).flatMap(([type,label])=>{
    const texts=[...new Set(row.extractions.filter(span=>span.class===type).map(span=>span.text))];
    return texts.length?[{recordId:row.recordId+'#'+type,class:type,sourceText:label+':\n'+texts.join('\n')}]:[];
  });
}
