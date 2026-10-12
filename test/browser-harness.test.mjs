import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
test('browser evidence rejects repository directories including names beginning with two dots',async()=>{
 for(const prefix of ['.synthetic-evidence-','..synthetic-evidence-']){
  const directory=await mkdtemp(join(root,prefix));
  try{
   const result=spawnSync(process.execPath,['scripts/browser-check.mjs'],{cwd:root,encoding:'utf8',timeout:20000,
    env:{...process.env,BROWSER_EVIDENCE_DIR:directory,DEMO_PORT:'not-a-port'}});
   assert.equal(result.status,1);assert.match(result.stderr,/Browser evidence must be outside the repository/);
  }finally{await rm(directory,{recursive:true,force:true});}
 }
});
