// Source definitions describe columns and extraction semantics. They never
// grant database access or select a connection supplied by model output.
import fs from 'node:fs';
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
  const extraction=value.offlineExtraction;
  // A structured source may supply typed values directly, without extraction.
  if(extraction && (typeof extraction.prompt!=='string' || !extraction.prompt.trim()
    || !Array.isArray(extraction.fields) || !extraction.fields.length
    || extraction.fields.some(field=>!Object.hasOwn(value.bodyFields,field)))) {
    throw new Error('invalid offline extraction definition');
  }
  return freeze(value);
}

export const nonconformityDefinitionPath=new URL('./hermes-sources/nonconformity.json',import.meta.url);
const raw=fs.readFileSync(nonconformityDefinitionPath,'utf8');
export const nonconformityDefinition=validateSourceDefinition(JSON.parse(raw),'nonconformity');
export const nonconformityDefinitionDigest=createHash('sha256').update(raw).digest('hex');

export const knowledgeProcedureDefinition=validateSourceDefinition(
  JSON.parse(fs.readFileSync(new URL('./hermes-sources/knowledge-procedure.json',import.meta.url),'utf8')),
  'knowledge_procedure',
);
export const sourceDefinitions=Object.freeze({
  nonconformity:nonconformityDefinition,
  knowledge_procedure:knowledgeProcedureDefinition,
});

export function sourceIdsFromEnv(env=process.env) {
  const ids=[...new Set((env.HERMES_RETRIEVAL_SOURCES??'').split(',').map(id=>id.trim()).filter(Boolean))];
  if(!ids.length)return ['nonconformity'];
  for(const id of ids) {
    if(!Object.hasOwn(sourceDefinitions,id))throw new Error(`unknown retrieval source: ${id}`);
  }
  return ids;
}
