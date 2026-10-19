import test from 'node:test';
import assert from 'node:assert/strict';
import {projectRequestedFields} from './hermes-qmd-prefetch-worker.mjs';
import {HermesQmdLocal} from './hermes-qmd-local.mjs';

test('answer intent selects original fields, preserving uncertainty and departments', () => {
 const record={nonconformityNo:'123',condition:'どこで破損したか不明。',remarks:'左側面に破損。',correctiveContent:'資材：出荷時に確認。\n製造：開梱時に撮影。',disposition:'交換'};
 const result=projectRequestedFields('破損の事例と対策', [{recordId:'a',record}]);
 assert.match(result.answer,/どこで破損したか不明。/);
 assert.match(result.answer,/資材：出荷時に確認。\n製造：開梱時に撮影。/);
 assert.doesNotMatch(result.answer,/交換/);
 for(const s of result.selectedSourceSpans) assert.equal(record[s.canonicalField].slice(s.start,s.end),s.text);
 const measures=projectRequestedFields('対策を教えて', [{recordId:'a',record}]);
 assert.deepEqual(measures.selectedSourceSpans.map(s=>s.canonicalField),['correctiveContent']);
});
test('missing corrective action is explicit and records stay separate', () => {
 const r=projectRequestedFields('事例と対策を2件',[
  {recordId:'a',record:{nonconformityNo:'123',condition:'A',correctiveContent:null,disposition:'再製作'}},
  {recordId:'b',record:{nonconformityNo:'456',condition:'B',correctiveContent:'再点検'}},
 ]);
 assert.match(r.answer,/123】\n個別是正内容は未記録/);
 assert.match(r.answer,/456】\n不適合内容: B\n個別是正内容: 再点検/);
 assert.equal(r.selectedSourceSpans.find(s=>s.text==='再製作').recordId,'a');
});
test('lexical and full semantic queries reach one standard QMD fusion call', async () => {
 const qmd=new HermesQmdLocal({rootDirectory:'.',dataDirectory:'.',dbPath:'unused',embedModelPath:'unused',qmdRoot:'.'});
 qmd.snapshot={scope:'authorized',snapshotId:'s',digest:'d'};
 qmd.lexicalBodies=['板が曲がった','部品の検査'];
 const calls=[];
 qmd.store={search:async(options)=>{calls.push(options);return [];}};
 await qmd.search('板が曲がった事例と対策');
 assert.equal(calls.length,1);
 assert(calls[0].queries.some(q=>q.type==='lex'));
 assert(calls[0].queries.some(q=>q.type==='vec'&&q.query==='板が曲がった事例と対策'));
 assert.equal(calls[0].rerank,false);
});
