import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {prepareDeviceArtifact} from './hermes-device-artifact.mjs';
import {EMBED_SHA,PORTABLE_EMBED_MODEL} from './hermes-remote-inference.mjs';

test('a sealed read-only index produces a private writable SQLite copy without changing the source',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hermes-sealed-index-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const artifact=path.join(root,'artifact');
  const runtime=path.join(root,'runtime','api-container');
  await fs.mkdir(artifact,{mode:0o700});
  const source=path.join(artifact,'qmd-index.sqlite');
  const seed=new DatabaseSync(source);
  seed.exec('CREATE TABLE records (id INTEGER PRIMARY KEY); INSERT INTO records VALUES (1)');
  seed.close();
  await fs.writeFile(path.join(artifact,'snapshot.json'),'{}');
  await fs.writeFile(path.join(artifact,'reviewed.json'),'{}');
  const files={};
  for(const name of ['qmd-index.sqlite','snapshot.json','reviewed.json']) {
    files[name]=createHash('sha256').update(await fs.readFile(path.join(artifact,name))).digest('hex');
    await fs.chmod(path.join(artifact,name),0o400);
  }
  await fs.writeFile(path.join(artifact,'artifact.json'),JSON.stringify({
    schema:'hermes-device-index/v1',modelSha256:EMBED_SHA,model:PORTABLE_EMBED_MODEL,files,
  }),{mode:0o400});
  await prepareDeviceArtifact(artifact,runtime);
  const copy=path.join(runtime,'qmd-index.sqlite');
  const db=new DatabaseSync(copy);
  try {
    db.exec('PRAGMA journal_mode=WAL; INSERT INTO records VALUES (2)');
    assert.equal(db.prepare('SELECT count(*) AS n FROM records').get().n,2);
  } finally { db.close(); }
  assert.equal((await fs.stat(copy)).mode&0o777,0o600);
  assert.equal((await fs.stat(source)).mode&0o777,0o400);
  assert.equal(createHash('sha256').update(await fs.readFile(source)).digest('hex'),files['qmd-index.sqlite']);
});
