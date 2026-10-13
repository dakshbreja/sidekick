import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,rm,readFile,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditPlugin} from '../scripts/plugin-audit.mjs';
const source=fileURLToPath(new URL('../plugins/school-bridge-community/',import.meta.url));
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'school-bridge-plugin-test-'));await cp(source,root,{recursive:true});t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('plugin package is instruction-only and reports host installation as unverified',async()=>{
 const result=await auditPlugin();assert.equal(result.ok,true);assert.equal(result.scope,'instruction_only');assert.equal(result.host_installation_verified,false);
});
test('adding live tools or automatic hooks fails the initial plugin scope gate',async t=>{
 const root=await fixture(t);const path=join(root,'plugin.json');const original=JSON.parse(await readFile(path,'utf8'));
 for(const addition of [{mcpServers:'./mcp.json'},{hooks:'./hooks.json'}]){
  await writeFile(path,JSON.stringify({...original,...addition}));await assert.rejects(auditPlugin(root),/scope_rejected/);
 }
});
test('plugin onboarding cannot escape the package or select an unreviewed skill',async t=>{
 const root=await fixture(t);const path=join(root,'plugin.json');const manifest=JSON.parse(await readFile(path,'utf8'));
 for(const onboardingSkill of ['../outside/SKILL.md','/outside/SKILL.md','./skills/unknown/SKILL.md']){
  manifest.extensions['com.openai'].onboardingSkill=onboardingSkill;await writeFile(path,JSON.stringify(manifest));await assert.rejects(auditPlugin(root),/scope_rejected/);
 }
});
test('plugin package rejects symlinked and unreviewed data files',async t=>{
 const root=await fixture(t);const file=join(root,'extra.txt');await writeFile(file,'Synthetic-only unreviewed content');
 await assert.rejects(auditPlugin(root),/unexpected_plugin_file/);await rm(file);
 await symlink(join(root,'COPYRIGHT'),file);await assert.rejects(auditPlugin(root),/symlink_rejected/);
});
