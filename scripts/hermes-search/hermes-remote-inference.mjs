// Optional inference boundary. Search/index/source projection stay in this process.
import {isIP} from 'node:net';
import http from 'node:http';

export function throughEgress(proxyOrigin) {
  const proxy = new URL(proxyOrigin);
  if (proxy.protocol !== 'http:' || proxy.username || proxy.password || proxy.pathname !== '/' || proxy.search || proxy.hash
    || !['business-hermes-chat-egress','localhost','127.0.0.1'].includes(proxy.hostname)) throw new Error('invalid existing egress origin');
  return (target, options) => new Promise((resolve,reject) => {
    const url = new URL(target);
    if(url.protocol !== 'http:') return reject(new Error('egress requires private HTTP gateway'));
    const request = http.request({hostname:proxy.hostname,port:proxy.port || 80,path:url.href,
      method:'POST',signal:options.signal,headers:{...options.headers,host:url.host,
        'content-length':Buffer.byteLength(options.body)}}, response => {
      const chunks=[];let size=0;
      response.on('data',chunk=>{
        size+=chunk.length;
        if(size>8*1024*1024){response.destroy(new Error('oversized inference response'));return;}
        chunks.push(chunk);
      });
      response.on('error',reject);
      response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode})));
    });
    request.on('error',reject);
    request.end(options.body);
  });
}

export const INFERENCE_SCHEMA = 'hermes-search-inference/v1';
export const EMBED_SHA = 'b5ce9d77a3fc4b3b39ccb5643c36777911cc4eb46a66962eadfa3f5f60490d63';
export const RERANK_SHA = 'd9e3e081faff1eefb84019509b2f5558fd74c1a05a2c7db22f74174fcedb5286';
export const EMBED_DIMENSIONS = 768;
export const PORTABLE_EMBED_MODEL = 'hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf';

function privateHost(host) {
  if (host === 'localhost' || host === '[::1]') return true;
  if (isIP(host) !== 4) return false;
  const [a,b] = host.split('.').map(Number);
  return a === 127 || a === 10 || (a === 192 && b === 168)
    || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
}

export class RemoteInference {
  constructor({baseUrl, token, timeoutMs = 30000, fetchImpl, proxyOrigin = process.env.HERMES_INFERENCE_EGRESS, embedModel = PORTABLE_EMBED_MODEL}) {
    const url = new URL(baseUrl);
    if (!['http:','https:'].includes(url.protocol) || !privateHost(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('inference origin must be a private-network HTTP origin');
    }
    if (typeof token !== 'string' || token.length < 16 || /[\r\n]/u.test(token)) throw new Error('inference credential is missing or invalid');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) throw new Error('invalid inference timeout');
    this.baseUrl = url.origin;
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl ?? (proxyOrigin ? throughEgress(proxyOrigin) : fetch);
    this.embedModelName = embedModel;
  }

  async request(operation, input) {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/hermes-search/${operation}`, {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(this.timeoutMs),
      headers:{'content-type':'application/json',authorization:`Bearer ${this.token}`},
      body:JSON.stringify({schema:INFERENCE_SCHEMA,...input}),
    });
    // Do not log upstream response bodies: they can contain business inputs.
    if (!response.ok) throw Object.assign(new Error(`inference unavailable (HTTP ${response.status})`), {status:response.status});
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 8 * 1024 * 1024) throw new Error('oversized inference response');
    const value = JSON.parse(raw);
    if (value.schema !== INFERENCE_SCHEMA || value.models?.embedding !== EMBED_SHA
      || value.models?.reranker !== RERANK_SHA) throw new Error('inference model identity mismatch');
    return value;
  }

  async embedBatch(texts) {
    if (!Array.isArray(texts) || !texts.length || texts.length > 32
      || texts.some(text => typeof text !== 'string' || !text || text.length > 16000)) throw new Error('invalid embedding inputs');
    const value = await this.request('embed', {texts});
    if (!Array.isArray(value.embeddings) || value.embeddings.length !== texts.length) throw new Error('embedding count mismatch');
    return value.embeddings.map(embedding => {
      if (!Array.isArray(embedding) || embedding.length !== EMBED_DIMENSIONS
        || embedding.some(v => typeof v !== 'number' || !Number.isFinite(v))) throw new Error('invalid embedding vector');
      const norm = Math.sqrt(embedding.reduce((sum,v) => sum + v*v,0));
      if (Math.abs(norm - 1) > 0.01) throw new Error('embedding is not normalized');
      return {embedding,model:this.embedModelName};
    });
  }

  async embed(text) { return (await this.embedBatch([text]))[0]; }

  async tokenize(text) {
    if (typeof text !== 'string' || text.length > 200000) throw new Error('invalid tokenize input');
    const value = await this.request('tokenize', {text});
    if (!Array.isArray(value.tokens) || value.tokens.some(v => !Number.isSafeInteger(v) || v < 0)) throw new Error('invalid token response');
    return value.tokens;
  }

  async detokenize(tokens) {
    if (!Array.isArray(tokens) || tokens.length > 8192 || tokens.some(v => !Number.isSafeInteger(v) || v < 0)) throw new Error('invalid detokenize input');
    const value = await this.request('detokenize', {tokens});
    if (typeof value.text !== 'string') throw new Error('invalid detokenize response');
    return value.text;
  }

  async start() {
    // Number lookup and local readiness must work without starting Spark compute.
    // Identity is verified on every actual inference response.
    return {family:'bge-reranker-v2-m3',modelSha256:RERANK_SHA,device:'remote',generation:false};
  }

  async select(question, sourceRecords) {
    if (typeof question !== 'string' || !question.trim() || question.length > 4000
      || !Array.isArray(sourceRecords) || !sourceRecords.length || sourceRecords.length > 64
      || sourceRecords.some(r => typeof r.recordId !== 'string' || typeof r.sourceText !== 'string' || !r.sourceText)) throw new Error('invalid ranking inputs');
    const started = performance.now();
    // Send opaque ordered IDs and only the required text, not source metadata.
    const records = sourceRecords.map((record,index) => ({recordId:String(index),sourceText:record.sourceText}));
    const value = await this.request('rerank', {question,records});
    if (!Array.isArray(value.recordIds) || value.recordIds.length !== records.length
      || value.recordIds.some((id,index) => id !== records[index].recordId)
      || !Array.isArray(value.scores) || value.scores.length !== records.length
      || value.scores.some(v => typeof v !== 'number' || !Number.isFinite(v))) throw new Error('ranking identity/order mismatch');
    return {rerankingScore:value.scores,scoreKind:'raw_relevance_logit',selectionIsEntailmentProof:false,
      elapsedMs:Math.round((performance.now()-started)*10)/10,spans:[]};
  }

  // No generation fallback and no client-owned remote process lifecycle.
  async expandQuery() { throw new Error('query generation is disabled'); }
  async rerank() { throw new Error('use explicit record ranking'); }
  async dispose() {}
  stop() {}
}
