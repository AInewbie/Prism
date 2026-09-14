(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let state = null, busy = false, ready = false, requestNumber = 0, draft = null, draftVersion = null;
  let reviews = {}, lastCompare = null;
  const pending = new Map();
  function notice(message, error = false) { $('notice').textContent = message; $('notice').className = error ? 'error' : ''; }
  function rpc(method, params) {
    return new Promise((resolve,reject) => {
      const id = ++requestNumber;
      const timer = setTimeout(() => { pending.delete(id); reject(Error('Host did not respond. Refresh the saved comparison; do not repeat a paid request automatically.')); }, 135000);
      pending.set(id,{resolve,reject,timer});
      window.parent.postMessage({jsonrpc:'2.0',id,method,params},'*');
    });
  }
  function update(result) {
    if (result.isError) throw Error(result.content?.find(c=>c.type==='text')?.text || 'Prism action failed.');
    if (!result._meta?.prism) return;
    const incoming = result._meta.prism;
    if (state?.run && incoming.run?.id === state.run.id && incoming.run.revision < state.run.revision) return;
    if (state?.run && incoming.run?.id !== state.run.id && dirty())
      return notice('Another session was opened from chat. Save your draft before opening it here.',true);
    state = incoming;
    render();
  }
  window.addEventListener('message',(event) => {
    if(event.source !== window.parent || event.data?.jsonrpc !== '2.0') return;
    const msg=event.data;
    if(pending.has(msg.id)) {
      const item=pending.get(msg.id); pending.delete(msg.id); clearTimeout(item.timer);
      msg.error ? item.reject(Error(msg.error.message || 'Host rejected the request.')) : item.resolve(msg.result);
    } else if(msg.method==='ui/notifications/tool-result') {
      try { update(msg.params); } catch(e) { notice(e.message,true); }
    }
  });
  async function tool(name,args) { const result=await rpc('tools/call',{name,arguments:args}); update(result); return result; }
  const dirty = () => draft !== null || Object.keys(reviews).length > 0;
  function controls() {
    const run=state?.run, selected=run?.responses.filter(r=>r.selected && r.status==='complete') || [];
    $('compare').disabled=!ready || busy || !!state?.busy || dirty();
    $('sessions').disabled=busy || !!state?.busy || dirty();
    $('refresh').disabled=!ready || busy;
    $('compile').disabled=busy || !!state?.busy || dirty() || !selected.length;
    $('synthesize').disabled=$('compile').disabled || (run?.mode==='live' && (!state.liveEnabled || !$('ack-synth').checked));
    $('save-draft').disabled=busy || draft===null;
    $('restore').disabled=busy || dirty() || !$('revisions').value;
    $('stop').disabled=!run || (!state?.busy && !busy);
    $('export').disabled=busy || dirty() || !run;
    $('draft-status').textContent=draft!==null?'Unsaved changes':run?.combined.text?'Saved on Prism server':'No saved draft';
    document.querySelectorAll('[data-review-save]').forEach(b => b.disabled=busy || !reviews[b.dataset.reviewSave]);
  }
  function render() {
    if(!state) return;
    const focused=document.activeElement, focusId=focused?.id, position=focused?.selectionStart;
    const positions=[...document.querySelectorAll('.answer-text')].map(n=>[n.id,n.scrollTop]);
    const run=state.run;
    $('connection-status').textContent='Connected · '+Object.values(state.connections).filter(c=>c.hasKey).length+'/4 providers';
    if(!$('providers').children.length) $('providers').innerHTML=state.providers.map(p=>'<label class="check"><input type="checkbox" data-provider="'+p.id+'" checked>'+esc(p.name)+'</label>').join('');
    $('sessions').innerHTML='<option value="">New comparison</option>'+state.sessions.map(s=>'<option value="'+s.id+'">'+esc(s.title)+' · '+s.completed+'/'+s.total+'</option>').join('');
    $('sessions').value=run?.id || '';
    if(!$('model-settings').children.length || !focused?.closest('#models'))
      $('model-settings').innerHTML=state.providers.map(p=>'<div class="model-row"><label>'+esc(p.name)+' · '+(state.connections[p.id].hasKey?'key configured':'no key')+'<input id="model-'+p.id+'" maxlength="120" value="'+esc(state.connections[p.id].model)+'" placeholder="Your available model ID"></label><button data-model="'+p.id+'">Save model</button></div>').join('');
    if(!$('synth-provider').children.length) $('synth-provider').innerHTML=state.providers.map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join('');
    $('mode').querySelector('[value=live]').disabled=!state.liveEnabled;
    modeNote();
    $('comparison').hidden=!run;
    if(run) {
      $('run-title').textContent='Your comparison'; $('run-prompt').textContent=run.prompt;
      $('run-mode').textContent=run.mode==='demo'?'DEMO · Fixed illustrative samples, not real model answers.':'LIVE · Generated using your provider API accounts.';
      $('progress').textContent=run.responses.filter(r=>r.status==='complete').length+'/'+run.responses.length+' answers'+(state.busy?' · running':'');
      $('answers').innerHTML=run.responses.map(r=>{
        const edit=reviews[r.provider], shown=edit || r;
        const overall=['accuracy','usefulness','clarity'].every(k=>Number.isInteger(r.scores[k]))?(Object.values(r.scores).reduce((a,b)=>a+b,0)/3).toFixed(1)+'/5':'Unscored';
        return '<article class="answer" data-answer="'+r.provider+'"><div class="answer-head"><div><h3>Answer '+r.label+'</h3><span class="quiet">'+($('blind').checked?'Identity hidden':esc(state.providers.find(p=>p.id===r.provider).name)+' · '+esc(r.model))+'</span></div><span class="badge">'+overall+'</span></div>'+
          '<pre class="answer-text" id="text-'+r.provider+'">'+esc(r.text || r.error || (r.status==='complete'?'Files received (no text)':r.status==='pending'?'Waiting…':'Generating…'))+'</pre>'+((r.artifactIds||[]).length?'<p class="quiet">'+r.artifactIds.length+' output file(s) preserved. Open the Prism browser app to inspect or download files.</p>':'')+
          (r.warning?'<p class="quiet">'+esc(r.warning)+'</p>':'')+
          (r.status!=='complete'?'':'<div class="scores">'+['accuracy','usefulness','clarity'].map(k=>'<label>'+k[0].toUpperCase()+k.slice(1)+'<select id="score-'+r.provider+'-'+k+'" data-score="'+k+'"><option value="">—</option>'+[1,2,3,4,5].map(n=>'<option '+(shown.scores[k]===n?'selected':'')+'>'+n+'</option>').join('')+'</select></label>').join('')+'</div><label>Review notes<textarea id="notes-'+r.provider+'" data-notes rows="2" maxlength="8000">'+esc(shown.notes)+'</textarea></label><label class="check"><input type="checkbox" data-selected '+(shown.selected?'checked':'')+'>Use in combined answer</label><div class="row"><span class="review-status">'+(edit?'Unsaved review':'Saved review')+'</span><button data-review-save="'+r.provider+'">Save review</button></div>')+'</article>';
      }).join('');
      if(draft===null) $('draft').value=run.combined.text;
      const revisions=[...(run.combinedHistory || [])].reverse(), prior=$('revisions').value;
      $('history-count').textContent='('+revisions.length+')';
      $('revisions').innerHTML=revisions.map(r=>'<option value="'+r.historyId+'">Revision '+r.version+' · '+esc(r.method)+'</option>').join('');
      if(revisions.some(r=>r.historyId===prior)) $('revisions').value=prior;
      previewRevision(); payload();
    }
    controls();
    if(focusId && $(focusId) && focused!==$(focusId)) { $(focusId).focus({preventScroll:true}); if(typeof position==='number') $(focusId).setSelectionRange?.(position,position); }
    for(const [id,top] of positions) if($(id)) $(id).scrollTop=top;
    window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height:Math.min(document.documentElement.scrollHeight,1800)}},'*');
  }
  function modeNote() {
    $('live-approval').hidden=$('mode').value!=='live';
    $('mode-note').textContent=$('mode').value==='demo'?'Demo uses fixed illustrative samples—not actual answers from these models.':state?.liveEnabled?'Each selected provider receives your prompt and shared instructions. API charges apply.':'Live calls are disabled on this server.';
  }
  function payload() {
    if(!state?.run) return;
    const run=state.run, selected=run.responses.filter(r=>r.selected && r.status==='complete');
    $('selection').textContent=selected.length+' sources selected';
    $('payload').textContent=JSON.stringify({originalPrompt:run.prompt,sharedInstructions:run.instructions,direction:$('direction').value,
      selectedAnswers:selected.map(r=>({label:r.label,answer:r.text,files:(state.run.artifacts||[]).filter(f=>(r.artifactIds||[]).includes(f.id)).map(f=>({name:f.name,mimeType:f.mimeType,size:f.size,contentsIncluded:false})),scores:r.scores,notes:r.notes}))},null,2);
  }
  function previewRevision(){ $('revision-preview').value=state?.run?.combinedHistory?.find(r=>r.historyId===$('revisions').value)?.text || ''; }
  async function action(fn) {
    if(busy) return; busy=true; controls();
    try { await fn(); } catch(e) { notice(e.message,true); }
    finally { busy=false; controls(); }
  }
  $('composer').onsubmit=(event)=>{event.preventDefault(); if(dirty()) return notice('Save your draft and reviews first.',true); action(async()=>{
    const args={prompt:$('prompt').value,instructions:$('instructions').value,providers:[...document.querySelectorAll('[data-provider]:checked')].map(n=>n.dataset.provider),mode:$('mode').value,max_tokens:Number($('max-tokens').value),acknowledge_paid:$('ack-paid').checked};
    if(args.mode==='live' && !args.acknowledge_paid) throw Error('Confirm the provider-data and API-credit notice first.');
    const signature=JSON.stringify(args);
    if(lastCompare?.signature!==signature) lastCompare={signature,id:crypto.randomUUID()};
    await tool('prism_compare',{...args,request_id:lastCompare.id}); lastCompare=null;
    notice('Comparison started. Answers arrive independently.');
  });};
  $('answers').oninput=(event)=>{
    const card=event.target.closest('[data-answer]'); if(!card) return;
    const provider=card.dataset.answer, source=state.run.responses.find(r=>r.provider===provider);
    reviews[provider] ||= {scores:{...source.scores},notes:source.notes,selected:source.selected,version:source.reviewVersion};
    const edit=reviews[provider];
    if(event.target.dataset.score) edit.scores[event.target.dataset.score]=event.target.value?Number(event.target.value):null;
    if(event.target.hasAttribute('data-notes')) edit.notes=event.target.value;
    if(event.target.hasAttribute('data-selected')) edit.selected=event.target.checked;
    card.querySelector('.review-status').textContent='Unsaved review'; controls();
  };
  $('answers').onclick=(event)=>{const id=event.target.closest('[data-review-save]')?.dataset.reviewSave;if(!id || !reviews[id]) return;action(async()=>{
    const sent=JSON.stringify(reviews[id]); await tool('prism_review',{run_id:state.run.id,provider:id,...reviews[id]});
    if(JSON.stringify(reviews[id])===sent) delete reviews[id]; render(); notice('Review saved.');
  });};
  $('draft').oninput=()=>{if(draft===null) draftVersion=state.run.combined.version;draft=$('draft').value===state.run.combined.text?null:$('draft').value;controls();};
  $('save-draft').onclick=()=>action(async()=>{const sent=draft; await tool('prism_save_draft',{run_id:state.run.id,text:sent,version:draftVersion}); if(draft===sent) draft=null;render();notice('Draft saved; earlier version kept.');});
  async function combine(method) { if(dirty()) throw Error('Save reviews and draft before combining.'); await tool('prism_combine',{
    run_id:state.run.id,providers:state.run.responses.filter(r=>r.selected && r.status==='complete').map(r=>r.provider),method,version:state.run.combined.version,
    provider:$('synth-provider').value,direction:$('direction').value,acknowledge_paid:$('ack-synth').checked}); notice('Combined draft ready. Review it before use.'); }
  $('compile').onclick=()=>action(()=>combine('compile')); $('synthesize').onclick=()=>action(()=>combine('synthesize'));
  $('restore').onclick=()=>action(async()=>{await tool('prism_restore_draft',{run_id:state.run.id,history_id:$('revisions').value,version:state.run.combined.version});notice('Revision restored. Previous draft retained.');});
  $('revisions').onchange=()=>{previewRevision();controls();};$('blind').onchange=render;
  $('direction').oninput=payload; $('ack-synth').onchange=controls; $('mode').onchange=modeNote;
  $('sessions').onchange=()=>action(async()=>{if(dirty()) throw Error('Save edits before switching.');const id=$('sessions').value;await tool('prism_open',id?{run_id:id}:{});});
  $('refresh').onclick=()=>action(async()=>{await tool(state?.run?'prism_get':'prism_open',state?.run?{run_id:state.run.id}:{});notice(dirty()?'Latest saved state loaded; your unsaved edits remain.':'Refreshed.');});
  $('stop').onclick=async()=>{try{await tool('prism_stop',{run_id:state.run.id});notice('Stop requested. Paid requests may already have used credits.');}catch(e){notice(e.message,true);}};
  $('model-settings').onclick=(e)=>{const id=e.target.dataset.model;if(id) action(async()=>{if(dirty())throw Error('Save edits before changing models.');const runId=state?.run?.id;await tool('prism_set_model',{provider:id,model:$('model-'+id).value});if(runId)await tool('prism_get',{run_id:runId});notice('Model ID saved.');});};
  $('export').onclick=()=>{if(dirty())return notice('Save edits before export.',true);const blob=new Blob([JSON.stringify({application:'Prism',version:'0.10.0',fileBytesIncluded:false,run:state.run},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='prism-'+state.run.id.slice(0,8)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);notice((state.run.artifacts||[]).length?'Export includes text and file metadata only. Export actual file bytes from the browser app.':'Export requested. If your host blocks downloads, use the standalone app to export.');};
  window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue='';}});
  setInterval(async()=>{if(!ready || busy || !state?.busy || !state.run)return;try{await tool('prism_get',{run_id:state.run.id});}catch(e){notice(e.message,true);}},1200);
  (async()=>{try{await rpc('ui/initialize',{appInfo:{name:'Prism',version:'0.3.0'},appCapabilities:{},protocolVersion:'2026-01-26'});
    window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}},'*');ready=true;
    if(!state)await tool('prism_open',{});notice('Prism is ready. Start with a demo or choose an approved live comparison.');controls();
  }catch(e){notice(e.message,true);}})();
})();
