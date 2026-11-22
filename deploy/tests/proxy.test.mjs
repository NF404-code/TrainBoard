import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const code = await readFile('deploy/functions/api/schedule.js', 'utf8');
const {onRequestGet} = await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const fetchOriginal = globalThis.fetch;
try {
  const expected = {status:'fresh',fromStorage:true,snapshot:{date:'2026-11-22',trains:[]}};
  globalThis.fetch = async (url,options) => {
    assert.equal(new URL(url).searchParams.get('stored'),'1');
    assert.equal(options.method,'GET');
    return Response.json(expected);
  };
  const ok=await onRequestGet();
  assert.equal(ok.status,200);
  assert.equal(ok.headers.get('Cache-Control'),'no-store');
  assert.deepEqual(await ok.json(), expected);

  globalThis.fetch=async()=>new Response('bad',{status:503});
  const bad=await onRequestGet();
  assert.equal(bad.status,502);
  assert.match((await bad.json()).error,/недоступен/);

  globalThis.fetch=async()=>new Response('<html>error</html>',{status:200});
  const malformed=await onRequestGet();
  assert.equal(malformed.status,502);

  globalThis.fetch=async()=>{throw new Error('network down')};
  const offline=await onRequestGet();
  assert.equal(offline.status,502);
  console.log('Proxy tests passed (valid, upstream 503, invalid JSON, network failure)');
} finally {
  globalThis.fetch=fetchOriginal;
}
