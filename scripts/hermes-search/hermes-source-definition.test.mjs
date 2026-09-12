import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateSourceDefinition,nonconformityDefinition} from './hermes-source-definition.mjs';
import {projectOrganized,validateOrganizedRow} from './hermes-organized-records.mjs';
import {HermesQmdLocal} from './hermes-qmd-local.mjs';

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
