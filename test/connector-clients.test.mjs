import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorProvider} from '../src/connector-clients.js';
import {CONNECTOR_SCRIPT} from '../src/connector-ui.js';

test('provider callbacks use exact trusted origins and known paths',()=>{
 for(const callback of ['https://chatgpt.com/connector_platform_oauth_redirect','https://chatgpt.com/connector/oauth/synthetic_callback_1234','https://claude.ai/api/mcp/auth_callback']){
  const expected=callback.includes('chatgpt.com')?'ChatGPT':'Claude';
  assert.equal(connectorProvider(callback),expected);
  assert.equal(connectorProvider(callback+'?code=synthetic&state=test',true),expected);
  assert.equal(connectorProvider(callback+'?code=synthetic'),null);
 }
 for(const callback of ['https://chatgpt.com.attacker.invalid/connector_platform_oauth_redirect','https://attacker.invalid/connector/oauth/synthetic_callback_1234','http://chatgpt.com/connector_platform_oauth_redirect','https://chatgpt.com:8443/connector_platform_oauth_redirect','https://user:pass@chatgpt.com/connector_platform_oauth_redirect','https://chatgpt.com/connector_platform_oauth_redirect#fragment','https://chatgpt.com/connector/oauth/short','https://chatgpt.com/connector/oauth/synthetic_callback_1234/extra','https://chatgpt.com/connector/oauth/%2Fsynthetic_callback_1234','https://claude.ai/other','not a URL'])assert.equal(connectorProvider(callback,true),null,callback);
});
test('consent browser script embeds the same callback validator and parses',()=>{
 assert.ok(CONNECTOR_SCRIPT.includes(connectorProvider.toString()));
 assert.doesNotThrow(()=>new Function(CONNECTOR_SCRIPT));
});
