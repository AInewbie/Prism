import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createBackend } from '../plugins/prism/backend.mjs';
import { createMcpServer, URI } from '../plugins/prism/mcp.mjs';
import { createPreview } from '../plugins/prism/preview.mjs';

async function fixture(t, options={}) {
  const directory=mkdtempSync(tmpdir()+'/prism-plugin-');
  const backend=await createBackend({directory,env:{},...options});
  const server=createMcpServer(backend), client=new Client({name:'test',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair(); await server.connect(a);await client.connect(b);
  t.after(async()=>{await client.close();await server.close();await backend.close();rmSync(directory,{recursive:true,force:true});});
  const call=(name,args={})=>client.callTool({name,arguments:args});
  async function finished(id){for(let i=0;i<100;i++){const r=await call('prism_get',{run_id:id});if(!r._meta.prism.busy)return r;await new Promise(r=>setTimeout(r,25));}throw Error('Comparison did not finish');}
  return {backend,client,call,finished,directory};
}
test('MCP advertises a render resource, schemas, safe annotations and no credential tool',async t=>{
  const {client,call}=await fixture(t);
  const {tools}=await client.listTools();assert.equal(tools.length,10);
  assert.equal(tools.filter(t=>t._meta?.ui?.resourceUri).length,1);
  assert.ok(tools.find(t=>t.name==='prism_open').annotations.readOnlyHint);
  assert.ok(tools.find(t=>t.name==='prism_compare').annotations.openWorldHint);
  assert.ok(!JSON.stringify(tools.map(t=>t.inputSchema)).includes('api_key'));
  const resource=await client.readResource({uri:URI});assert.equal(resource.contents[0].mimeType,'text/html;profile=mcp-app');
  assert.ok(resource.contents[0].text.includes('ui/initialize'));assert.ok(!resource.contents[0].text.includes('/* PRISM_JS */'));
  assert.equal((await call('prism_open'))._meta.prism.liveEnabled,false);
});
test('MCP demo compare, manual score, compilation, history restore and persistence',async t=>{
  let calls=0;const {call,finished,directory}=await fixture(t,{fetcher:async()=>{calls++;throw Error('Not allowed');}});
  const created=await call('prism_compare',{prompt:'Synthetic demo',providers:['openai','gemini','grok','claude'],request_id:randomUUID()});
  const id=created.structuredContent.run_id;
  let run=(await finished(id))._meta.prism.run;assert.equal(run.responses.filter(r=>r.status==='complete').length,4);
  const a=run.responses[0];
  run=(await call('prism_review',{run_id:id,provider:a.provider,version:0,scores:{accuracy:5,usefulness:4,clarity:3},notes:'User opinion',selected:true}))._meta.prism.run;
  assert.equal(run.responses[0].notes,'User opinion');
  assert.equal((await call('prism_review',{run_id:id,provider:a.provider,version:0,notes:'stale'})).isError,true);
  run=(await call('prism_combine',{run_id:id,providers:[a.provider],method:'compile',version:0}))._meta.prism.run;
  const compiled=run.combined.text;
  run=(await call('prism_save_draft',{run_id:id,text:'Human edited final answer',version:1}))._meta.prism.run;
  const history=run.combinedHistory[0].historyId;
  run=(await call('prism_restore_draft',{run_id:id,history_id:history,version:2}))._meta.prism.run;
  assert.equal(run.combined.text,compiled);assert.equal(run.combinedHistory[1].text,'Human edited final answer');
  assert.equal(JSON.parse(readFileSync(directory+'/workspace.json')).runs[0].combined.text,compiled);
  assert.equal(calls,0);
});
test('live opt-in and per-call consent are required; keys never appear in MCP results',async t=>{
  let calls=0;const {call}=await fixture(t,{env:{OPENAI_API_KEY:'synthetic-sensitive-key',PRISM_MODEL_OPENAI:'fixture-model'},fetcher:async()=>{calls++;throw Error();}});
  const open=await call('prism_open');assert.equal(open._meta.prism.connections.openai.hasKey,true);
  assert.ok(!JSON.stringify(open).includes('synthetic-sensitive-key'));
  assert.equal((await call('prism_compare',{prompt:'Do not send',providers:['openai'],mode:'live',acknowledge_paid:true,request_id:randomUUID()})).isError,true);
  assert.equal(calls,0);
});
test('live fixture dispatch is concurrent and duplicate request IDs do not charge again',async t=>{
  let calls=0,active=0,max=0;
  const {call,finished}=await fixture(t,{env:{PRISM_PLUGIN_ALLOW_LIVE:'1',OPENAI_API_KEY:'synthetic-sensitive-key',XAI_API_KEY:'synthetic-key',PRISM_MODEL_OPENAI:'fixture',PRISM_MODEL_GROK:'fixture'},fetcher:async()=>{
    calls++;active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,30));active--;
    return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Synthetic provider answer'}]}]});
  }});
  const args={prompt:'Only a fixture',providers:['openai','grok'],mode:'live',request_id:randomUUID(),acknowledge_paid:false};
  assert.equal((await call('prism_compare',args)).isError,true);assert.equal(calls,0);
  args.acknowledge_paid=true;const first=await call('prism_compare',args);const id=first.structuredContent.run_id;
  assert.equal((await call('prism_compare',args)).structuredContent.run_id,id);
  const final=await finished(id);assert.equal(calls,2);assert.equal(max,2);
  assert.ok(!JSON.stringify(final).includes('synthetic-sensitive-key'));
  await call('prism_compare',args);assert.equal(calls,2);
  assert.equal((await call('prism_compare',{...args,prompt:'Changed'})).isError,true);
});
test('packaged stdio entry point initializes with the official MCP client',async t=>{
  const directory=mkdtempSync(tmpdir()+'/prism-stdio-');
  const transport=new StdioClientTransport({command:process.execPath,args:['plugins/prism/server.mjs'],cwd:process.cwd(),env:{PATH:process.env.PATH,PRISM_PLUGIN_DATA_DIR:directory,PRISM_PLUGIN_ALLOW_LIVE:'0'},stderr:'pipe'});
  const client=new Client({name:'stdio-test',version:'1'});await client.connect(transport);
  assert.equal((await client.listTools()).tools.length,10);
  const result=await client.callTool({name:'prism_open',arguments:{}});assert.equal(result._meta.prism.liveEnabled,false);
  await client.close();rmSync(directory,{recursive:true,force:true});
});
test('comparison request IDs survive a server restart without resending',async()=>{
  const directory=mkdtempSync(tmpdir()+'/prism-request-id-');
  let calls=0, backend;
  const options={directory,env:{},fetcher:async()=>{calls++;throw Error('No real calls');}};
  const args={prompt:'Saved synthetic request',instructions:'',providers:['openai'],mode:'demo',max_tokens:2048,request_id:randomUUID(),acknowledge_paid:false};
  try {
    backend=await createBackend(options);
    const id=await backend.compare(args);
    for(let i=0;i<100 && backend.state(id).busy;i++)await new Promise(r=>setTimeout(r,25));
    assert.equal(backend.state(id).run.responses[0].status,'complete');
    await backend.close();backend=null;
    backend=await createBackend(options);
    assert.equal(await backend.compare(args),id);
    assert.equal(backend.state(id).sessions.length,1);
    assert.equal(backend.state(id).busy,false);
    assert.equal(calls,0);
    await backend.close();backend=null;
    await assert.rejects(createBackend({...options,env:{PRISM_MODEL_OPENAI:'invalid / model'}}));
    // Bad configuration must not leave a lock or listener behind.
    backend=await createBackend(options);
    assert.equal(backend.state(id).run.responses[0].status,'complete');
  } finally {if(backend)await backend.close();rmSync(directory,{recursive:true,force:true});}
});
test('local MCP preview rejects missing credentials and cross-origin access',async()=>{
  const directory=mkdtempSync(tmpdir()+'/prism-preview-security-');
  const preview=await createPreview({directory});
  await new Promise(r=>preview.server.listen(0,'127.0.0.1',r));
  const url='http://127.0.0.1:'+preview.server.address().port;
  const body=JSON.stringify({name:'prism_open',arguments:{}});
  try {
    const request=headers=>fetch(url+'/rpc',{method:'POST',headers:{'Content-Type':'application/json',...headers},body});
    assert.equal((await request({})).status,401);
    assert.equal((await request({'X-Preview-Key':'é'.repeat(64)})).status,401);
    assert.equal((await request({'X-Preview-Key':preview.token,Origin:'https://untrusted.example'})).status,403);
    const valid=await request({'X-Preview-Key':preview.token,Origin:url});
    assert.equal(valid.status,200);
    assert.equal((await valid.json())._meta.prism.liveEnabled,false);
  } finally {await preview.close();rmSync(directory,{recursive:true,force:true});}
});
