import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {EMBED_SHA,PORTABLE_EMBED_MODEL} from './hermes-remote-inference.mjs';

export async function prepareDeviceArtifact(artifactRoot, dataDirectory) {
  const root=path.resolve(artifactRoot);
  const data=path.resolve(dataDirectory);
  if(!data.startsWith(path.join(path.dirname(root),'runtime')+path.sep)) throw new Error('dedicated runtime directory required');
  const proof=JSON.parse(await fs.readFile(path.join(root,'artifact.json'),'utf8'));
  if(proof.schema!=='hermes-device-index/v1' || proof.modelSha256!==EMBED_SHA || proof.model!==PORTABLE_EMBED_MODEL) throw new Error('unsupported index artifact');
  for(const name of ['qmd-index.sqlite','snapshot.json','reviewed.json']) {
    const hash=createHash('sha256');
    for await(const chunk of createReadStream(path.join(root,name)))hash.update(chunk);
    if(hash.digest('hex')!==proof.files?.[name])throw new Error('device artifact checksum mismatch');
  }
  await fs.mkdir(data,{recursive:true,mode:0o700});
  // This directory belongs only to this API container's single worker. The
  // sealed source index is never opened for writing or shared between slots.
  for(const suffix of ['','-wal','-shm'])await fs.rm(path.join(data,'qmd-index.sqlite'+suffix),{force:true});
  await fs.copyFile(path.join(root,'qmd-index.sqlite'),path.join(data,'qmd-index.sqlite'));
}
