// Initial release scope: instruction files only, with no live tools or hooks.
import {lstat,readdir,readFile} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const packageRoot=fileURLToPath(new URL('../plugins/school-bridge-community/',import.meta.url));
const expected=new Set(['plugin.json','COPYRIGHT','skills/workspace-onboarding/SKILL.md','skills/save-recovery/SKILL.md']);
const directories=new Set(['skills','skills/workspace-onboarding','skills/save-recovery']);
const fail=code=>{throw new Error(code);};
export async function auditPlugin(root=packageRoot){
 root=resolve(root);
 if(!(await lstat(root)).isDirectory())fail('plugin_root_must_be_directory');
 const found=new Set();
 async function walk(path){
  for(const name of await readdir(path)){
   const candidate=resolve(path,name);const entry=relative(root,candidate).split(sep).join('/');const info=await lstat(candidate);
   if(info.isSymbolicLink())fail('plugin_symlink_rejected');
   if(info.isDirectory()){if(!directories.has(entry))fail('unexpected_plugin_directory');await walk(candidate);}
   else if(info.isFile()){if(!expected.has(entry))fail('unexpected_plugin_file');found.add(entry);}
   else fail('plugin_nonregular_entry');
  }
 }
 await walk(root);
 if(found.size!==expected.size)fail('plugin_file_missing');
 const manifest=JSON.parse(await readFile(resolve(root,'plugin.json'),'utf8'));
 const allowed=new Set(['$schema','name','version','description','author','repository','license','extensions']);
 if(!manifest||Object.keys(manifest).some(k=>!allowed.has(k)))fail('plugin_manifest_scope_rejected');
 if(manifest.$schema!=='https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'||manifest.name!=='school-bridge-community'||!/^\d+\.\d+\.\d+$/.test(manifest.version)||!manifest.description||manifest.license!=='UNLICENSED')fail('plugin_identity_invalid');
 if(manifest.author?.name!=='Daksh Breja'||manifest.repository!=='https://github.com/dakshbreja/school-bridge-community')fail('plugin_ownership_invalid');
 const extension=manifest.extensions?.['com.openai'];
 if(Object.keys(manifest.extensions||{}).length!==1||!extension||Object.keys(extension).length!==1||extension.onboardingSkill!=='./skills/workspace-onboarding/SKILL.md')fail('plugin_extension_scope_rejected');
 for(const name of ['workspace-onboarding','save-recovery']){
  const skill=await readFile(resolve(root,`skills/${name}/SKILL.md`),'utf8');
  if(!skill.startsWith(`---\nname: ${name}\ndescription: `)||!/^---\nname: [a-z-]+\ndescription: [^\n]+\n---\n/.test(skill))fail('plugin_skill_metadata_invalid');
 }
 const copyright=await readFile(resolve(root,'COPYRIGHT'),'utf8');
 if(!copyright.includes('Copyright 2026 Daksh Breja. All rights reserved.'))fail('plugin_copyright_missing');
 return {ok:true,files:found.size,skills:2,scope:'instruction_only',host_installation_verified:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 auditPlugin().then(report=>process.stdout.write(JSON.stringify(report,null,2)+'\n')).catch(()=>{process.stderr.write('Plugin audit failed; inspect the reviewed package locally. No file contents are printed.\n');process.exitCode=1;});
}
