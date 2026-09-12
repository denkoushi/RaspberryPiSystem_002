// Reviewed offline extraction sidecar. Derived descriptions aid retrieval;
// every displayed character is materialized from the current original record.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareEvidenceUnits} from './hermes-evidence-units.mjs';
import {buildLexicalQuery} from './hermes-qmd-local.mjs';
import {nonconformityDefinition} from './hermes-source-definition.mjs';
import * as nonconformityAnswer from './hermes-sources/nonconformity-answer.mjs';

const nonconformitySource={definition:nonconformityDefinition,...nonconformityAnswer};

const hash = text => createHash('sha256').update(text).digest('hex');

export function validateOrganizedRow(row,record,definition=nonconformityDefinition) {
  if (!record || row.recordId!==record.evidenceKey || row.review?.decision!=='approved') throw new Error('unreviewed or absent source record');
  if (!Array.isArray(row.extractions) || !row.extractions.length) throw new Error('empty organized record');
  for(const span of row.extractions) {
    const source=record[span.canonicalField];
    if(span.recordId!==row.recordId || typeof source!=='string' || span.sourceHash!==hash(source)
      || span.offsetUnit!=='javascript_utf16_code_units' || !Number.isInteger(span.start) || !Number.isInteger(span.end)
      || span.start<0 || span.end<=span.start || span.end>source.length || source.slice(span.start,span.end)!==span.text
      || !Object.hasOwn(definition.bodyFields,span.canonicalField)
      || !definition.organizedLabels[span.class] || !['affirmed','negated','unknown'].includes(span.polarity)) throw new Error('organized source span validation failed');
  }
  return row;
}

export function projectOrganized(question, rows, recordsById, source=nonconformitySource) {
  for(const row of rows)validateOrganizedRow(row,recordsById.get(row.recordId),source.definition);
  return source.projectAnswer(question,rows,recordsById,(row,record)=>validateOrganizedRow(row,record,source.definition));
}

// Build once during ingestion/index preparation. Rank all reviewed original categories;
// reviewed descriptions aid retrieval only and never replace source evidence.
export function organizedContext(row,record,definition=nonconformityDefinition) {
  validateOrganizedRow(row,record,definition);
  const metadata=definition.searchMetadataFields.map(field=>record[field]?`${field}: ${record[field]}`:'').filter(Boolean);
  const original=Object.entries(definition.bodyFields).filter(([field])=>typeof record[field]==='string'&&record[field].trim())
    .map(([field,label])=>`${label}:\n${record[field]}`);
  const sections=Object.entries(definition.organizedLabels).map(([type,label])=>{
    const texts=[...new Set(row.extractions.filter(span=>span.class===type).map(span=>span.text))];
    return texts.length?`${label}:\n${texts.join('\n')}`:'';
  }).filter(Boolean);
  const rankingText=[...metadata,...sections].join('\n');
  const descriptions=row.extractions.map(span=>`${definition.organizedLabels[span.class]}: ${definition.originalOnlyContextClasses?.includes(span.class)?'':span.searchText+'\n'}${span.text}`);
  return {rankingText,searchText:[...metadata,...original,...descriptions].join('\n')};
}

export class OrganizedRecords {
  constructor(qmd,manifestPath,source=nonconformitySource) {this.source=source;this.qmd=qmd;this.manifestPath=manifestPath;this.rows=new Map();this.byFile=new Map();}
  async prepare() {
    if(this.qmd.sourceAdapter && this.qmd.sourceAdapter.definition.id!==this.source.definition.id) throw new Error('search and answer source mismatch');
    const raw=await fs.readFile(this.manifestPath,'utf8');const manifest=JSON.parse(raw);
    if(manifest.schema!=='hermes-reviewed-extraction/v1' || manifest.snapshotDigest!==this.qmd.snapshot.digest) throw new Error('organized snapshot mismatch');
    this.manifestDigest=hash(raw);
    const directory=path.join(this.qmd.dataDirectory,'organized');await fs.mkdir(directory,{recursive:true});
    const expected=new Set();
    for(const row of manifest.records) {
      validateOrganizedRow(row,this.qmd.recordsById.get(row.recordId),this.source.definition);this.rows.set(row.recordId,row);
      const filename=hash(row.recordId)+'.md';expected.add(filename);this.byFile.set(filename,row);
      const record=this.qmd.recordsById.get(row.recordId);
      const context=organizedContext(row,record,this.source.definition);
      row.context=context.searchText;row.rankingText=context.rankingText;
      row.evidenceUnits=prepareEvidenceUnits(row,this.source.definition);
      await fs.writeFile(path.join(directory,filename),row.context,'utf8');
    }
    await fs.writeFile(path.join(this.qmd.dataDirectory,'evidence-units.json'),JSON.stringify({
      schema:'hermes-source-evidence-units/v1',source:this.source.definition.id,snapshotDigest:this.qmd.snapshot.digest,
      manifestDigest:this.manifestDigest,records:[...this.rows.values()].map(row=>({recordId:row.recordId,units:row.evidenceUnits}))},null,2),'utf8');
    for(const filename of await fs.readdir(directory)) if(filename.endsWith('.md')&&!expected.has(filename))await fs.unlink(path.join(directory,filename));
    await this.qmd.store.addCollection('organized',{path:directory,pattern:'*.md'});
    await this.qmd.store.update({collections:['organized']});
    const status=await this.qmd.store.getStatus();
    if(status.needsEmbedding>0) {
      if(this.qmd.allowIndexUpdate===false) throw new Error('organized index needs offline preparation');
      await this.qmd.store.embed({collection:'organized',model:this.qmd.embedModelPath,maxDocsPerBatch:8});
    }
    return {count:this.rows.size,manifestDigest:this.manifestDigest,extractorVersion:manifest.extractorVersion,
      inferenceAtQuestionTime:false,scope:'manually reviewed small ingestion trial; not all snapshot records'};
  }
  async retrieve(question, originalResults) {
    const subject=question;const lexical=buildLexicalQuery(question);
    const queries=[{type:'vec',query:subject}];if(lexical)queries.unshift({type:'lex',query:lexical});
    // Both lanes search the complete reviewed collection, independently of
    // original-text candidates. Fuse with candidates from the full 8209 rows.
    const hits=await this.qmd.store.search({queries,collections:['organized'],limit:20,candidateLimit:20,rerank:false});
    const found=new Map();
    for(const hit of hits) {
      const row=this.byFile.get(path.basename(hit.file));
      if(!row)throw new Error('organized index/source identity mismatch');
      found.set(row.recordId,row);
    }
    for(const result of originalResults)if(this.rows.has(result.recordId))found.set(result.recordId,this.rows.get(result.recordId));
    return [...found.values()];
  }
  select(question,candidates,scores,options={}) {
    return this.source.selectRecords(question,candidates,scores,options,this.rows);
  }
}
