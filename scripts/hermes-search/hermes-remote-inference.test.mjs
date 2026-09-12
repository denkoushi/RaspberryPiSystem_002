import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createProxyServer} from '../../infrastructure/docker/business-hermes-egress/proxy.mjs';
import {RemoteInference,EMBED_SHA,RERANK_SHA,INFERENCE_SCHEMA} from './hermes-remote-inference.mjs';
const models={embedding:EMBED_SHA,reranker:RERANK_SHA};
const config={baseUrl:'http://127.0.0.1:1',token:'synthetic-test-token'};
const result=value=>new Response(JSON.stringify({schema:INFERENCE_SCHEMA,models,...value}));

test('the existing egress carries exact text and credentials to only the approved inference path',async t=>{
 let received;
 const upstream=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  received={url:req.url,auth:req.headers.authorization,body:JSON.parse(Buffer.concat(chunks))};
  res.setHeader('content-type','application/json');
  res.end(JSON.stringify({schema:INFERENCE_SCHEMA,models,recordIds:['0'],scores:[3]}));
 });
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const proxy=createProxyServer({provider:'dgx',allowedHttpHost:'127.0.0.1',allowedHttpPort:String(upstream.address().port)});
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 t.after(()=>{proxy.closeAllConnections();proxy.close();upstream.closeAllConnections();upstream.close();});
 const client=new RemoteInference({...config,baseUrl:`http://127.0.0.1:${upstream.address().port}`,
  proxyOrigin:`http://127.0.0.1:${proxy.address().port}`});
 await client.select('左側の処置は？',[{recordId:'private-source',sourceText:'変更しない。0.5㎜。'}]);
 assert.equal(received.url,'/v1/hermes-search/rerank');
 assert.equal(received.auth,`Bearer ${config.token}`);
 assert.equal(received.body.records[0].sourceText,'変更しない。0.5㎜。');
 await assert.rejects(client.request('unload',{}),/HTTP 403/);
});

test('remote identity is private, fixed and not redirected',async()=>{
 for(const baseUrl of ['https://example.com','http://127.0.0.1/x','http://u:p@127.0.0.1','http://100.64.0.1/?x'])
  assert.throws(()=>new RemoteInference({...config,baseUrl}));
 let sent;
 const client=new RemoteInference({...config,fetchImpl:async(url,options)=>{sent={url,options};return result({embeddings:[[1,...Array(767).fill(0)]]});}});
 assert.equal((await client.embedBatch(['already formatted query']))[0].embedding.length,768);
 assert.equal(sent.options.redirect,'error');
 assert.deepEqual(JSON.parse(sent.options.body).texts,['already formatted query']);
 assert.equal(sent.url,'http://127.0.0.1:1/v1/hermes-search/embed');
});

test('wrong models, vector counts, dimensions and non-normalized vectors fail closed',async()=>{
 for(const value of [{models:{...models,embedding:'wrong'}},{embeddings:[]},{embeddings:[[1]]},{embeddings:[Array(768).fill(0)]}]){
  const client=new RemoteInference({...config,fetchImpl:async()=>result(value)});
  await assert.rejects(client.embedBatch(['query']));
 }
 const client=new RemoteInference({...config,fetchImpl:async()=>new Response('do not expose input',{status:503})});
 await assert.rejects(client.embed('query'),error=>error.status===503&&!error.message.includes('expose'));
});

test('ranking only sends opaque ordered record identities and never changes source text',async()=>{
 let sent;
 const client=new RemoteInference({...config,fetchImpl:async(_url,options)=>{
  sent=JSON.parse(options.body);return result({recordIds:['0','1'],scores:[2,-3]});
 }});
 const records=[{recordId:'private-record-a',sourceText:'左側。変更しない。',secret:'omit'},
  {recordId:'private-record-b',sourceText:'右側 0.5 mm。'}];
 const value=await client.select('確認事項は？',records);
 assert.deepEqual(value.rerankingScore,[2,-3]);
 assert.deepEqual(sent.records,[{recordId:'0',sourceText:records[0].sourceText},{recordId:'1',sourceText:records[1].sourceText}]);
 client.fetchImpl=async()=>result({recordIds:['1','0'],scores:[2,-3]});
 await assert.rejects(client.select('確認事項は？',records),/identity/);
});

test('local readiness and number-route startup do not request Spark compute',async()=>{
 const client=new RemoteInference({...config,fetchImpl:()=>assert.fail('unexpected inference')});
 assert.equal((await client.start()).generation,false);
 await client.dispose(); client.stop();
 await assert.rejects(client.expandQuery(),/disabled/);
});
