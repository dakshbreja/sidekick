// Copyright 2026 Daksh Breja. All rights reserved.
// One bounded request; status only. No provider body or token is returned/logged.
export function createRevocationClient({fetcher=fetch,timeoutMs=10000,clock=()=>Date.now()}={}){
 if(typeof fetcher!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw new Error('invalid_revocation_timeout');
 return {async revoke(token){if(typeof token!=='string'||!/^[\x21-\x7e]{1,4096}$/.test(token))return {confirmed:false,retryable:false,error:'revocation_token_invalid'};
  const controller=new AbortController();let timer,response;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('timeout'));},timeoutMs);});
  try{response=await Promise.race([fetcher('https://oauth2.googleapis.com/revoke',{method:'POST',redirect:'manual',signal:controller.signal,headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token}).toString()}),timeout]);
   if(response.status===200)return {confirmed:true,retryable:false};
   let retryAfterSeconds=0;const raw=response.headers.get('Retry-After');if(raw&&/^\d{1,10}$/.test(raw))retryAfterSeconds=Number(raw);else if(raw&&raw.length<100&&Number.isFinite(Date.parse(raw)))retryAfterSeconds=Math.max(0,Math.ceil((Date.parse(raw)-clock())/1000));
   return {confirmed:false,retryable:response.status===429||response.status>=500,error:response.status>=300&&response.status<400?'revocation_redirect_rejected':'revocation_not_confirmed',retryAfterSeconds};
  }catch{return {confirmed:false,retryable:true,error:'revocation_unavailable'};}
  finally{clearTimeout(timer);controller.abort();if(response?.body)void response.body.cancel().catch(()=>{});}
 }};
}
