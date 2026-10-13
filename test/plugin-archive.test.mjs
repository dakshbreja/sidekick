import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,symlink,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const run=output=>spawnSync('python3',['scripts/package-plugin.py','--output',output],{cwd:root,encoding:'utf8',timeout:20000});
async function fixture(t){const directory=await mkdtemp(join(tmpdir(),'school-bridge-archive-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));return directory;}
test('plugin archive includes only reviewed root files and is reproducible',async t=>{
 const directory=await fixture(t);const first=join(directory,'first.zip'),second=join(directory,'second.zip');
 for(const output of [first,second]){const result=run(output);assert.equal(result.status,0,result.stderr);}
 assert.deepEqual(await readFile(first),await readFile(second));
 const inspect=spawnSync('python3',['-c','import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps(z.namelist()))',first],{encoding:'utf8'});
 assert.equal(inspect.status,0);assert.deepEqual(JSON.parse(inspect.stdout),['COPYRIGHT','plugin.json','skills/save-recovery/SKILL.md','skills/workspace-onboarding/SKILL.md']);
});
test('plugin archive rejects direct and symlinked output paths into the repository',async t=>{
 const directory=await fixture(t);const link=join(directory,'repo-link');await symlink(root,link);
 const filename='synthetic-plugin-output-'+crypto.randomUUID()+'.zip';
 for(const output of [join(root,filename),join(link,filename)]){
  const result=run(output);assert.equal(result.status,1);assert.match(result.stderr,/outside the repository/);
  await assert.rejects(access(output),{code:'ENOENT'});
 }
});
