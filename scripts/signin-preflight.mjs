// Check configuration format without logging credentials or making requests.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyIdentity,AuthenticationError} from '../src/auth.js';
export async function checkSigninConfiguration(env){
 const names=['ACCESS_ISSUER','ACCESS_AUDIENCE','TENANT_ID_KEY'];
 const missing=names.filter(name=>typeof env?.[name]!=='string'||!env[name]);
 const limits={identity_verified:false,access_policy_verified:false,hostname_verified:false,revocation_verified:false};
 if(missing.length)return {ok:false,configuration_format_valid:false,missing,...limits};
 try{
  // Missing assertion is deliberate: configuration validation runs first and
  // stops before public-key fetching or identity verification.
  await verifyIdentity(undefined,{issuer:env.ACCESS_ISSUER,audience:env.ACCESS_AUDIENCE,tenantIdKey:env.TENANT_ID_KEY});
 }catch(error){
  if(error instanceof AuthenticationError&&error.code==='authentication_required')return {ok:true,configuration_format_valid:true,...limits};
  return {ok:false,configuration_format_valid:false,error:'invalid_signin_configuration',...limits};
 }
 return {ok:false,configuration_format_valid:false,error:'unexpected_preflight_result',...limits};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 checkSigninConfiguration({ACCESS_ISSUER:process.env.ACCESS_ISSUER,ACCESS_AUDIENCE:process.env.ACCESS_AUDIENCE,TENANT_ID_KEY:process.env.TENANT_ID_KEY})
 .then(report=>{process.stdout.write(JSON.stringify(report,null,2)+'\n');if(!report.ok)process.exitCode=1;})
 .catch(()=>{process.stderr.write('Sign-in preflight unavailable. No configuration values are printed.\n');process.exitCode=1;});
}
