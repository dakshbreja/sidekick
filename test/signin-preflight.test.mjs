import test from 'node:test';
import assert from 'node:assert/strict';
import {base64url} from 'jose';
import {checkSigninConfiguration} from '../scripts/signin-preflight.mjs';
test('sign-in preflight reports only missing names without inventing identity success',async()=>{
 const result=await checkSigninConfiguration({});assert.equal(result.ok,false);
 assert.deepEqual(result.missing,['ACCESS_ISSUER','ACCESS_AUDIENCE','TENANT_ID_KEY']);
 assert.equal(result.identity_verified,false);assert.equal(result.access_policy_verified,false);
});
test('sign-in preflight validates format without network access or returning configuration values',async()=>{
 const key=base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
 const env={ACCESS_ISSUER:'https://preflight-synthetic.cloudflareaccess.com',ACCESS_AUDIENCE:'synthetic-application-audience',TENANT_ID_KEY:key};
 const fetchOriginal=globalThis.fetch;globalThis.fetch=()=>assert.fail('No network work in configuration preflight');
 try{const result=await checkSigninConfiguration(env);assert.equal(result.ok,true);assert.equal(result.identity_verified,false);assert.equal(result.hostname_verified,false);assert.equal(result.revocation_verified,false);
 for(const value of Object.values(env))assert.equal(JSON.stringify(result).includes(value),false);
 }finally{globalThis.fetch=fetchOriginal;}
});
test('malformed sign-in configuration fails safely without exposing invalid values',async()=>{
 const result=await checkSigninConfiguration({ACCESS_ISSUER:'https://attacker.invalid',ACCESS_AUDIENCE:'invalid',TENANT_ID_KEY:'synthetic-invalid-value'});
 assert.equal(result.ok,false);assert.equal(result.error,'invalid_signin_configuration');assert.equal(JSON.stringify(result).includes('synthetic-invalid-value'),false);
});
