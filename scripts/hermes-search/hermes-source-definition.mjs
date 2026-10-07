// Source definitions describe columns and extraction semantics. They never
// grant database access or select a connection supplied by model output.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

function freeze(value) {
  if(value && typeof value==='object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function validateSourceDefinition(value,expectedId) {
  if(!expectedId || value?.schema!=='hermes-source-definition/v1' || value.id!==expectedId) {
    throw new Error('source definition does not match its ingestion adapter');
  }
  if(!Array.isArray(value.visibility) || !value.visibility.length
    || value.visibility.some(kind=>!['kiosk','viewer','manager','admin'].includes(kind))
    || new Set(value.visibility).size!==value.visibility.length) {
    throw new Error('invalid visibility');
  }
  for(const name of ['bodyFields','organizedLabels',...(value.metadataFields===undefined?[]:['metadataFields'])]) {
    const entries=Object.entries(value[name]??{});
    if(!entries.length || entries.some(([key,label])=>!key || typeof label!=='string' || !label)) {
      throw new Error(`invalid ${name}`);
    }
  }
  for(const name of ['contextAttributes','searchMetadataFields','lexicalFields','organizedContextClasses']) {
    if(!Array.isArray(value[name]) || value[name].some(x=>typeof x!=='string' || !x) || new Set(value[name]).size!==value[name].length) {
      throw new Error(`invalid ${name}`);
    }
  }
  if(value.organizedContextClasses.some(name=>!Object.hasOwn(value.organizedLabels,name))) {
    throw new Error('unknown organized context class');
  }
  if(value.quantityUnits!==undefined) {
    if(!Array.isArray(value.quantityUnits)||value.quantityUnits.some(unit=>typeof unit.unit!=='string'||!unit.unit
      ||!Array.isArray(unit.aliases)||!unit.aliases.length||unit.aliases.some(alias=>typeof alias!=='string'||!alias)))throw new Error('invalid quantity units');
    const aliases=value.quantityUnits.flatMap(unit=>unit.aliases.map(alias=>alias.toLowerCase()));
    if(new Set(aliases).size!==aliases.length)throw new Error('ambiguous quantity unit alias');
  }
  if(value.label!==undefined && (typeof value.label!=='string'||!value.label.trim()))throw new Error('invalid label');
  if(value.numericFields!==undefined && (!Array.isArray(value.numericFields)
    ||new Set(value.numericFields).size!==value.numericFields.length
    ||value.numericFields.some(key=>typeof key!=='string'||!Object.hasOwn(value.metadataFields??{},key)))) {
    throw new Error('invalid numeric fields');
  }
  if(value.retrieval!==undefined) {
    if(!value.retrieval||typeof value.retrieval!=='object'||Array.isArray(value.retrieval)
      ||Object.entries(value.retrieval).some(([key,enabled])=>key==='denseStoreSuffix'
        ? typeof enabled!=='string'||!/^[a-z0-9_-]*$/u.test(enabled)
        : !['semanticSearch','enrichment','learnedQueries'].includes(key)||typeof enabled!=='boolean')) {
      throw new Error('invalid retrieval capabilities');
    }
  }
  if(value.pageContextAttributes!==undefined && (!value.pageContextAttributes
    ||typeof value.pageContextAttributes!=='object'||Array.isArray(value.pageContextAttributes)
    ||Object.entries(value.pageContextAttributes).some(([kind,field])=>!kind
      ||field!==null && (typeof field!=='string'||!Object.hasOwn(value.metadataFields??{},field))))) {
    throw new Error('invalid page context attributes');
  }
  if(value.outOfScopeAnswer!==undefined && (typeof value.outOfScopeAnswer!=='string'||!value.outOfScopeAnswer.trim())) {
    throw new Error('invalid out of scope answer');
  }
  const extraction=value.offlineExtraction;
  // A structured source may supply typed values directly, without extraction.
  if(extraction && (typeof extraction.prompt!=='string' || !extraction.prompt.trim()
    || !Array.isArray(extraction.fields) || !extraction.fields.length
    || extraction.fields.some(field=>!Object.hasOwn(value.bodyFields,field)))) {
    throw new Error('invalid offline extraction definition');
  }
  return freeze(value);
}

export function loadSourceDefinitions(directory=new URL('./hermes-sources/',import.meta.url)) {
  const root=directory instanceof URL?fileURLToPath(directory):directory;
  const definitions=Object.create(null);
  for(const file of fs.readdirSync(root).sort()) {
    if(!file.endsWith('.json')||!fs.statSync(path.join(root,file)).isFile())continue;
    const value=JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
    // Other JSON contracts (e.g. relevance rules) share this directory.
    if(!String(value?.schema??'').startsWith('hermes-source-definition/')
      && (value?.schema!==undefined||!Object.hasOwn(value??{},'bodyFields')))continue;
    if(Object.hasOwn(definitions,value.id))throw new Error(`duplicate source definition: ${value.id}`);
    const expectedId=file.slice(0,-5).replaceAll('-','_');
    definitions[expectedId]=validateSourceDefinition(value,expectedId);
  }
  return Object.freeze(definitions);
}

export const sourceDefinitions=loadSourceDefinitions();
// Compatibility exports for the existing ingestion and legacy consumers.
export const nonconformityDefinitionPath=new URL('./hermes-sources/nonconformity.json',import.meta.url);
export const nonconformityDefinition=sourceDefinitions.nonconformity;
export const nonconformityDefinitionDigest=createHash('sha256').update(fs.readFileSync(nonconformityDefinitionPath,'utf8')).digest('hex');
export const knowledgeProcedureDefinition=sourceDefinitions.knowledge_procedure;
export const torqueTrainingSessionDefinition=sourceDefinitions.torque_training_session;
export const torqueTrainingOperatorDefinition=sourceDefinitions.torque_training_operator;
export const torqueTrainingTeamDefinition=sourceDefinitions.torque_training_team;

// Only this boundary supplies the source identity of legacy untagged records.
export function recordSourceId(record) {
  return record?.sourceId ?? 'nonconformity';
}

export function sourceIdsFromEnv(env=process.env) {
  const ids=[...new Set((env.HERMES_RETRIEVAL_SOURCES??'').split(',').map(id=>id.trim()).filter(Boolean))];
  if(!ids.length)return ['nonconformity'];
  for(const id of ids) {
    if(!Object.hasOwn(sourceDefinitions,id))throw new Error(`unknown retrieval source: ${id}`);
  }
  return ids;
}
