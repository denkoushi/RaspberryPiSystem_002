import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateSourceDefinition,nonconformityDefinition,knowledgeProcedureDefinition,sourceDefinitions,sourceIdsFromEnv} from './hermes-source-definition.mjs';
import {projectOrganized,validateOrganizedRow} from './hermes-organized-records.mjs';
import {HermesQmdLocal} from './hermes-qmd-local.mjs';

test('registered procedure definition is validated, structured and frozen',()=>{
  assert.equal(sourceDefinitions.knowledge_procedure,knowledgeProcedureDefinition);
  assert.equal(sourceDefinitions.nonconformity,nonconformityDefinition);
  assert.ok(Object.isFrozen(sourceDefinitions));
  assert.ok(Object.isFrozen(knowledgeProcedureDefinition.metadataFields));
  assert.equal(knowledgeProcedureDefinition.offlineExtraction,undefined);
  assert.equal(knowledgeProcedureDefinition.recordNumberField,'title');
  assert.deepEqual(knowledgeProcedureDefinition.contextAttributes,Object.keys(knowledgeProcedureDefinition.metadataFields));
  assert.deepEqual(knowledgeProcedureDefinition.lexicalFields,[...Object.keys(knowledgeProcedureDefinition.metadataFields),...Object.keys(knowledgeProcedureDefinition.bodyFields)]);
});

test('retrieval source selection defaults, trims, deduplicates and rejects unknown ids',()=>{
  for(const value of [undefined,'',' , '])assert.deepEqual(sourceIdsFromEnv({HERMES_RETRIEVAL_SOURCES:value}),['nonconformity']);
  assert.deepEqual(sourceIdsFromEnv({HERMES_RETRIEVAL_SOURCES:' knowledge_procedure,nonconformity,knowledge_procedure '}),['knowledge_procedure','nonconformity']);
  for(const id of ['missing','constructor'])assert.throws(()=>sourceIdsFromEnv({HERMES_RETRIEVAL_SOURCES:`nonconformity,${id}`}),{message:`unknown retrieval source: ${id}`});
});

test('disposition requests preserve the original field or explicitly show same-record actions when it is empty',()=>{
 const record={evidenceKey:'nonconformity:synthetic',nonconformityNo:'123',remarks:'左側でずれた。',correctiveContent:'クランプを追加した。',disposition:null};
 const make=(type,field)=>({recordId:record.evidenceKey,class:type,canonicalField:field,start:0,end:record[field].length,
  text:record[field],sourceHash:createHash('sha256').update(record[field]).digest('hex'),offsetUnit:'javascript_utf16_code_units',polarity:'affirmed'});
 const row={recordId:record.evidenceKey,review:{decision:'approved'},extractions:[make('event','remarks'),make('action','correctiveContent')]};
 const records=new Map([[row.recordId,record]]);
 const empty=projectOrganized('加工物がずれたときの処置は？',[row],records);
 assert.match(empty.answer,/処置欄に記載はありません/);
 assert.match(empty.answer,/対策・確認事項:\nクランプを追加した。/);
 record.disposition='左側のみ再製作。';
 const original=projectOrganized('処置を教えて',[row],records);
 assert.match(original.answer,/処置:\n左側のみ再製作。/);
 assert.doesNotMatch(original.answer,/記載はありません/);
 const span=original.selectedSourceSpans.find(s=>s.canonicalField==='disposition');
 assert.equal(record.disposition.slice(span.start,span.end),span.text);
});

test('a definition cannot change an adapter identity or introduce unmapped fields',()=>{
  assert.throws(()=>validateSourceDefinition(structuredClone(nonconformityDefinition),'inventory'),/match/);
  const wrong=structuredClone(nonconformityDefinition);
  wrong.offlineExtraction.fields.push('guessedColumn');
  assert.throws(()=>validateSourceDefinition(wrong,'nonconformity'),/extraction/);
  assert.throws(()=>new HermesQmdLocal({sourceAdapter:{definition:{id:'inventory'}}}),/complete authorized/);
});

test('another source can use its own labels and projection with the same original-span guard',()=>{
  const definition=validateSourceDefinition({schema:'hermes-source-definition/v1',id:'inventory',
    visibility:['admin'],
    bodyFields:{location:'保管場所'},contextAttributes:[],searchMetadataFields:[],lexicalFields:['location'],
    organizedLabels:{location:'保管場所'},organizedContextClasses:['location']},'inventory');
  const record={evidenceKey:'inventory:1',location:'棚B-4'};
  const span={recordId:record.evidenceKey,class:'location',canonicalField:'location',start:0,end:record.location.length,
    offsetUnit:'javascript_utf16_code_units',sourceHash:createHash('sha256').update(record.location).digest('hex'),
    text:record.location,polarity:'affirmed'};
  const row={recordId:record.evidenceKey,review:{decision:'approved'},extractions:[span]};
  const source={definition,projectAnswer(_question,rows,recordsById,validate){
    const original=recordsById.get(rows[0].recordId);validate(rows[0],original);
    return {answer:`${definition.organizedLabels.location}: ${original.location}`};
  }};
  assert.equal(projectOrganized('保管場所は？',[row],new Map([[row.recordId,record]]),source).answer,'保管場所: 棚B-4');
  assert.throws(()=>projectOrganized('保管場所は？',[row],new Map([[row.recordId,{...record,location:'棚A-4'}]]),source),/span/);
  assert.throws(()=>validateOrganizedRow(row,{...record,evidenceKey:'nonconformity:1'},definition),/source record/);
});

test('visibility is required, non-empty and limited to known unique principal kinds',()=>{
  for(const visibility of [undefined,null,'admin',[],['unknown'],['ADMIN'],['viewer',1],['admin','admin']]) {
    assert.throws(()=>validateSourceDefinition({...structuredClone(nonconformityDefinition),visibility},'nonconformity'),/visibility/);
  }
  for(const definition of [nonconformityDefinition,knowledgeProcedureDefinition]) {
    assert.deepEqual(definition.visibility,['kiosk','viewer','manager','admin']);
    assert.ok(Object.isFrozen(definition.visibility));
  }
  assert.deepEqual(validateSourceDefinition({...structuredClone(nonconformityDefinition),visibility:['admin']},'nonconformity').visibility,['admin']);
});


test('training sources are opt-in validated structured definitions with public visibility',()=>{
  const ids=['torque_training_session','torque_training_operator','torque_training_team'];
  assert.deepEqual(sourceIdsFromEnv({HERMES_RETRIEVAL_SOURCES:ids.join(',')}),ids);
  for(const id of ids) {
    const definition=sourceDefinitions[id];
    assert.equal(validateSourceDefinition(structuredClone(definition),id).id,id);
    assert.equal(definition.offlineExtraction,undefined);
    assert.deepEqual(definition.visibility,['kiosk','viewer','manager','admin']);
    assert.ok(Object.isFrozen(definition.metadataFields));
    assert.deepEqual(definition.contextAttributes,Object.keys(definition.metadataFields));
    assert.deepEqual(definition.lexicalFields,[...Object.keys(definition.metadataFields),...Object.keys(definition.bodyFields)]);
  }
});

test('directory registration discovers definitions and rejects inconsistent or invalid files', async (t)=>{
  const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {loadSourceDefinitions}=await import('./hermes-source-definition.mjs');
  const dir=mkdtempSync(join(tmpdir(),'hermes-source-definitions-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const value={...structuredClone(knowledgeProcedureDefinition),id:'synthetic_source',label:'合成ソース'};
  const write=(name,data)=>writeFileSync(join(dir,name),JSON.stringify(data));
  write('nonconformity-relevance.json',{schema:'hermes-relevance/v1',id:'not_a_source'});
  write('other.json',{schema:'other-contract/v1',bodyFields:{text:'別契約の本文'}});
  write('synthetic-source.json',value);
  const registered=loadSourceDefinitions(dir);
  assert.deepEqual(Object.keys(registered),['synthetic_source']);
  assert.equal(registered.synthetic_source.label,'合成ソース');
  assert.ok(Object.isFrozen(registered.synthetic_source));
  write('synthetic_source.json',value);
  assert.throws(()=>loadSourceDefinitions(dir),/duplicate source definition/);
  rmSync(join(dir,'synthetic_source.json'));
  write('synthetic-source.json',{...value,id:'wrong'});
  assert.throws(()=>loadSourceDefinitions(dir),/match/);
  write('synthetic-source.json',{...value,visibility:[]});
  assert.throws(()=>loadSourceDefinitions(dir),/visibility/);
  write('synthetic-source.json',{...value,schema:'hermes-source-definition/v2'});
  assert.throws(()=>loadSourceDefinitions(dir),/match/);
  write('synthetic-source.json',{...value,schema:undefined});
  assert.throws(()=>loadSourceDefinitions(dir),/match/);
});

test('optional numeric and retrieval policy declarations are validated without requiring them',()=>{
  const base=structuredClone(knowledgeProcedureDefinition);
  for(const numericFields of [['unknown'],['title','title'],'title',[null]]) {
    assert.throws(()=>validateSourceDefinition({...base,numericFields},base.id),/numeric fields/);
  }
  for(const retrieval of [null,[],{semanticSearch:'true'},{unknown:true},{denseStoreSuffix:'../bad'}]) {
    assert.throws(()=>validateSourceDefinition({...base,retrieval},base.id),/retrieval capabilities/);
  }
  for(const pageContextAttributes of [[],null,{entity:'unknown'}]) {
    assert.throws(()=>validateSourceDefinition({...base,pageContextAttributes},base.id),/page context attributes/);
  }
  assert.throws(()=>validateSourceDefinition({...base,outOfScopeAnswer:''},base.id),/out of scope answer/);
  assert.equal(validateSourceDefinition({...base,numericFields:['title'],retrieval:{semanticSearch:true},pageContextAttributes:{entity:null}},base.id).numericFields[0],'title');
});
