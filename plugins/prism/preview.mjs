import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBackend } from './backend.mjs';
import { createMcpServer, widgetHtml } from './mcp.mjs';

// Local integration harness, NOT ChatGPT. It exercises the real MCP server
// through the official client and bridge contract, with live calls disabled.
const host = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prism plugin preview</title><style>body{margin:0;background:#e9eee4;font-family:system-ui}p{font-size:12px;text-align:center;padding:10px;color:#3d5a46}iframe{display:block;border:0;margin:auto;width:100%;max-width:1160px;min-height:100vh}</style></head><body><p>LOCAL MCP HOST PREVIEW — not connected to ChatGPT · Demo only</p><iframe title="Prism embedded interface" src="/widget" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"></iframe><script>
const token=new URLSearchParams(location.hash.slice(1)).get('key') || sessionStorage.getItem('prism-preview-key') || '';
sessionStorage.setItem('prism-preview-key',token);history.replaceState(null,'',location.pathname);
const frame=document.querySelector('iframe');
window.addEventListener('message',async event=>{
  if(event.source!==frame.contentWindow || event.origin!==location.origin || event.data?.jsonrpc!=='2.0')return;
  const msg=event.data;
  if(msg.method==='ui/notifications/size-changed'){frame.style.height=Math.max(600,Math.min(Number(msg.params.height)||600,1800))+'px';return;}
  if(msg.id===undefined)return;
  try {
    let result;
    if(msg.method==='ui/initialize')result={protocolVersion:'2026-01-26',hostInfo:{name:'Prism local test host',version:'0.3.0'},hostCapabilities:{serverTools:{listChanged:false}},hostContext:{theme:'light'}};
    else if(msg.method==='tools/call'){
      const r=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json','X-Preview-Key':token},body:JSON.stringify(msg.params)});
      if(!r.ok)throw Error('Local host rejected request.');result=await r.json();
    } else throw Error('Host method not supported.');
    frame.contentWindow.postMessage({jsonrpc:'2.0',id:msg.id,result},location.origin);
  } catch(e) {frame.contentWindow.postMessage({jsonrpc:'2.0',id:msg.id,error:{code:-32000,message:e.message}},location.origin);}
});</script></body></html>`;

export async function createPreview({directory,fetcher}={}) {
  const backend=await createBackend({directory:directory || join(homedir(),'.local','share','prism-plugin-preview'),env:{},fetcher});
  const mcp=createMcpServer(backend), client=new Client({name:'prism-local-host',version:'0.3.0'});
  const [a,b]=InMemoryTransport.createLinkedPair();
  await mcp.connect(a);await client.connect(b);
  const token=randomBytes(32).toString('hex');
  const server=createServer(async(req,res)=>{
    const hostname='127.0.0.1:'+server.address().port;
    const end=(status,body,type='text/plain')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(body);};
    if(req.headers.host!==hostname)return end(403,'Untrusted host');
    if(req.headers.origin && req.headers.origin!=='http://'+hostname)return end(403,'Origin blocked');
    if(req.method==='GET' && req.url==='/')return end(200,host,'text/html');
    if(req.method==='GET' && req.url==='/widget')return end(200,widgetHtml(),'text/html');
    if(req.method!=='POST' || req.url!=='/rpc')return end(404,'Not found');
    const supplied=Buffer.from(String(req.headers['x-preview-key'] || ''));
    const expected=Buffer.from(token);
    if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected))return end(401,'Open the launch URL');
    if(!req.headers['content-type']?.startsWith('application/json'))return end(415,'JSON required');
    try {
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>800000)return end(413,'Too large');chunks.push(chunk);}
      const input=JSON.parse(Buffer.concat(chunks).toString());
      const result=await client.callTool(input,undefined,{timeout:130000});
      end(200,JSON.stringify(result),'application/json');
    }catch{end(400,'Invalid tool request');}
  });
  return {server,token,backend,client,async close(){await new Promise(r=>server.close(r));await client.close();await mcp.close();await backend.close();}};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const preview=await createPreview();
  preview.server.listen(8796,'127.0.0.1',()=>{
    console.log('Prism local MCP host preview — demo only, not connected to ChatGPT');
    console.log('Open http://127.0.0.1:8796/#key='+preview.token);
  });
  let closing=false;
  const stop=async()=>{if(closing)return;closing=true;await preview.close();};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
