// Synthetic local workerd/SQLite harness. Never configure real account secrets.
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createAuthFixture } from './auth-fixtures.mjs';

export async function createRuntime({ authFixture, persistPath, workerName = 'community-test', inspectStorage = false, deploymentBundle, bindings = {}, providerFetch, aiFetch, connector = false } = {}) {
  const auth = authFixture ?? await createAuthFixture();
  const root = fileURLToPath(new URL('../', import.meta.url));
  const script = deploymentBundle ? await readFile(deploymentBundle, 'utf8') : (await build({ absWorkingDir: root, entryPoints: ['src/index.js'], bundle: true,
    write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:*', 'node:*'], logLevel: 'silent' })).outputFiles[0].text;
  const outboundRequests = [];
  // v5 explicitly exports this converter for the documented Worker option API.
  const workerOptions = { name: workerName, modules: true, script,
    scriptPath: `${root}test/runtime-worker.mjs`, compatibilityDate: '2026-10-12',
    compatibilityFlags: ['nodejs_compat'], host: '127.0.0.1', port: 0, cf: false,
    unsafeDevRegistryPath: undefined, unsafeRegisterWorker: false,
    unsafeInspectDurableObjects: inspectStorage,
    log: new Log(LogLevel.ERROR), bindings: { ...auth.env, ...bindings },
    ...(aiFetch?{serviceBindings:{AI:'synthetic-tutor-ai'}}:{}),
    durableObjects: { STUDENTS: { className: 'StudentState', useSQLite: true }, COLLECTION_BUDGETS: {className:'CollectionBudget',useSQLite:true} },
    ...(persistPath ? { resourcePersistencePath: persistPath } : {}),
    outboundService: async (request) => {
      outboundRequests.push({ method: request.method, url: request.url });
      if (request.method !== 'GET' || request.url !== `${auth.config.issuer}/cdn-cgi/access/certs`) {
        if (providerFetch) return providerFetch(request);
        throw new Error('Synthetic runtime blocks all non-JWKS outbound requests');
      }
      return new Response(JSON.stringify(auth.jwks), { headers: { 'content-type': 'application/json' } });
    },
  };
  const aiWorker={name:'synthetic-tutor-ai',modules:true,compatibilityDate:'2026-10-12',script:`import {WorkerEntrypoint} from 'cloudflare:workers'; export default class extends WorkerEntrypoint {async run(model,input){const response=await this.env.RESPONSE.fetch(new Request('https://ai-fixture.example.invalid/',{method:'POST',body:JSON.stringify({model,input})}));return response.json();}}`,serviceBindings:{RESPONSE:aiFetch}};
  let connectorWorker;
  if(connector){
    const connectorScript=(await build({absWorkingDir:root,entryPoints:['src/connector-worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:*','node:*'],logLevel:'silent'})).outputFiles[0].text;
    workerOptions.bindings.CONNECTOR_ENABLED='true';
    workerOptions.serviceBindings={...workerOptions.serviceBindings,CONNECTOR_AUTH:'study-connector-test'};
    connectorWorker={name:'study-connector-test',modules:true,script:connectorScript,compatibilityDate:'2026-10-12',compatibilityFlags:['nodejs_compat'],bindings:{CONNECTOR_ORIGIN:'https://connector.example.invalid',BRIDGE_ORIGIN:'https://community.example.invalid'},kvNamespaces:['OAUTH_KV'],durableObjects:{CONNECTOR_REQUESTS:{className:'ConnectorRequests',useSQLite:true}},serviceBindings:{BRIDGE:{name:workerName,entrypoint:'ConnectorBackend'}}};
  }
  const mf=new Miniflare(convertV4MiniflareOptions(aiFetch||connector?{workers:[workerOptions,...(aiFetch?[aiWorker]:[]),...(connector?[connectorWorker]:[])],...(persistPath?{resourcePersistencePath:persistPath}:{})}:workerOptions));
  try { await mf.ready; } catch (error) { await mf.dispose(); throw error; }
  const origin = 'https://community.example.invalid';
  const request = (path, { student = 'a', method = 'GET', body, headers = {} } = {}) => {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Only fixture-local paths are allowed');
    if (student !== null && !Object.hasOwn(auth.tokens, student)) throw new Error('Unknown synthetic student');
    return mf.dispatchFetch(`${origin}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        ...(student === null ? {} : { 'Cf-Access-Jwt-Assertion': auth.tokens[student] }),
        ...(body === undefined ? {} : { 'content-type': 'application/json', origin }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };
  return { mf, tokens: auth.tokens, env: auth.env, authFixture: auth, origin, request,
    outboundRequests, workerName, close: () => mf.dispose() };
}
