/* ============================================================
   THE FIRE STATION — a focus-session mode.
   Core principle: notice every fire, fight one at a time.

   Reuses existing stores — fires are normal TASKS, captures are normal
   quick-tasks, the check-in is a normal SPOTLOG (tagged fireId). The only new
   store is S.fireSessions (focus-session metadata) + S.activeFireId (the one
   burning fire). Clocks are computed from startedAt, never a live counter, so
   they survive navigation, reload, and backgrounding. The bar (#fireBar) and
   takeover (#fireScreen) live OUTSIDE #main, so no page render disturbs them.
   ============================================================ */

/* ---------- session accessors ---------- */
function activeFire(){ return S.activeFireId ? (S.fireSessions||[]).find(s=>s.id===S.activeFireId) : null; }
function fireIsActive(){ const s=activeFire(); return !!(s && !s.endedAt); }

/* ---------- clock math (source of truth = startedAt) ---------- */
function fireTargetMs(s){ return s.startedAt + (s.durationMin + (s.extendMin||0))*60000; }
function fireRemainingMs(s){ return fireTargetMs(s) - Date.now(); }
function fireElapsedMs(s){ return Date.now() - s.startedAt; }
function fireClockText(s){
  return s.mode==='timer' ? fmtMSS(Math.max(0, fireRemainingMs(s))) : fmtMSS(fireElapsedMs(s));
}
function fmtMSS(ms){
  const neg = ms<0; ms=Math.abs(ms);
  const t=Math.floor(ms/1000), m=Math.floor(t/60), s=t%60;
  return (neg?'-':'')+m+':'+String(s).padStart(2,'0');
}
/* local YYYY-MM-DD for a timestamp (matches todayKey()) */
function fireDayKey(ms){ const d=new Date(ms); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

/* ---------- task resolution (keys are atToggle-format) ---------- */
function fireTaskByKey(key){
  const k=atKey(key);
  if(k.src==='project'){ const p=(S.projects||[]).find(x=>x.id===k.projId); return p&&(p.tasks||[]).find(x=>x.id===k.id); }
  let t=day().tasks.find(x=>x.id===k.id); if(!t){ const g=findTaskGlobal(k.id); t=g&&g.t; } return t;
}
/* the ordered picker list — Pipeline FIRST, then all other open tasks. */
function firePickList(){
  const out=[], seen=new Set();
  const push=(key,txt,sub)=>{ if(seen.has(key)||!txt) return; seen.add(key); out.push({key,txt,sub}); };
  (day().pipeline||[]).forEach(it=>{
    if(it.taskId){ const t=day().tasks.find(x=>x.id===it.taskId); if(t&&!t.done) push(t.id, t.txt, 'Pipeline'); }
    else if(it.projectId){ const p=(S.projects||[]).find(x=>x.id===it.projectId); const t=p&&(p.tasks||[]).find(x=>x.id===it.projTaskId); if(t&&!t.done) push('P|'+it.projectId+'|'+it.projTaskId, t.txt, 'Pipeline · '+(p?p.name:'')); }
  });
  day().tasks.filter(t=>!t.done && !t.projectId).forEach(t=> push(t.id, t.txt, t.kind==='quick'?'Quick':'Time block'));
  (S.projects||[]).forEach(p=> (p.tasks||[]).forEach(t=>{ if(!t.done) push('P|'+p.id+'|'+t.id, t.txt, p.name); }));
  return out;
}
/* complete the task through the NORMAL completion path, forced done=true. */
function fireCompleteTask(key){
  const k=atKey(key);
  if(k.src==='project'){ setProjTaskDone(k.projId, k.id, true); return; }
  let t=day().tasks.find(x=>x.id===k.id); if(!t){ const g=findTaskGlobal(k.id); t=g&&g.t; }
  if(!t) return;
  t.done=true;
  if(t.recurringId) markRecurringDone(t.recurringId);
  if(t.projectId && t.projTaskId){ const p=S.projects.find(x=>x.id===t.projectId); const pt=p&&p.tasks.find(x=>x.id===t.projTaskId); if(pt) pt.done=true; }
}

/* ============================================================
   RENDER — bar + takeover (both outside #main)
   ============================================================ */
let fireScreenOpen=false;   // is the takeover visible
let fireTimer=null;         // 1s repaint interval (repaint only; never source of truth)
let fireEndPrompted=false;  // guard: end-of-block prompt shown once per expiry

function startFireTimer(){ if(!fireTimer) fireTimer=setInterval(paintFireClocks, 1000); }
function stopFireTimer(){ if(fireTimer){ clearInterval(fireTimer); fireTimer=null; } }

/* Full (re)build of bar + screen structure. Call on state changes. */
function paintFire(){
  const s=activeFire(); const on=!!(s && !s.endedAt);
  document.body.classList.toggle('fire-active', on && !fireScreenOpen);
  const bar=q('#fireBar'), scr=q('#fireScreen');
  if(bar){
    if(on && !fireScreenOpen){ bar.innerHTML=fireBarHTML(s); bar.classList.add('show'); bindFireBar(); }
    else { bar.classList.remove('show'); bar.innerHTML=''; }
  }
  if(scr){
    if(on && fireScreenOpen){ scr.innerHTML=fireScreenHTML(s); scr.classList.add('show'); bindFireScreen(); }
    else { scr.classList.remove('show'); scr.innerHTML=''; }
  }
  if(on) startFireTimer(); else stopFireTimer();
}
/* Lightweight per-second update — recompute the clock text from startedAt only.
   Never rebuilds innerHTML (keeps the queue input focused) and never saves. */
function paintFireClocks(){
  const s=activeFire();
  if(!s || s.endedAt){ stopFireTimer(); return; }
  const txt=fireClockText(s);
  q('#fireBar .fire-clock','all').forEach(el=>el.textContent=txt);
  q('#fireScreen .fire-clock','all').forEach(el=>el.textContent=txt);
  if(s.mode==='timer' && fireRemainingMs(s)<=0 && !fireEndPrompted){ fireEndPrompted=true; openFireEndOfBlock(); }
}

function fireBarHTML(s){
  return `<button class="fire-bar-btn" id="fireBarOpen">
    <span class="fire-bar-ic">🔥</span>
    <span class="fire-bar-title">${esc(s.taskTxt)}</span>
    <span class="fire-bar-clock"><span class="fire-clock">${fireClockText(s)}</span> ${s.mode==='timer'?'left':'elapsed'}</span>
    <span class="fire-bar-return">tap to return ›</span>
  </button>`;
}
function bindFireBar(){ const el=q('#fireBarOpen'); if(el) el.onclick=openFireScreen; }

function fireScreenHTML(s){
  const q1=(s.queuedTaskIds||[]).length;
  return `
  <div class="fire-screen-inner">
    <button class="fire-min" id="fireMinimize" title="Minimize — the fire keeps burning">▾ Minimize</button>
    <div class="fire-focus">
      <div class="fire-kicker">🔥 Fighting one fire</div>
      <h1 class="fire-title">${esc(s.taskTxt)}</h1>
      <div class="fire-def"><span class="fire-def-lbl">Extinguished when</span> ${esc(s.defOfDone)}</div>
      <div class="fire-clock-big ${s.mode}"><span class="fire-clock">${fireClockText(s)}</span></div>
      <div class="fire-clock-mode">${s.mode==='timer'?'remaining':'elapsed'}${s.mode==='stopwatch'&&s.estimateMin?` · est ${s.estimateMin} min`:''}</div>
    </div>
    <div class="fire-actions">
      <button class="btn fire-extinguish" id="fireExtinguish">✓ Extinguished</button>
      <button class="btn ghost" id="fireQueueBtn">+ Queue a fire</button>
      ${s.mode==='timer'?`<button class="btn ghost" id="fireExtend">Extend</button>`:''}
      <button class="btn ghost fire-override-btn" id="fireOverride">Emergency override</button>
    </div>
    <div class="fire-queue-inline" id="fireQueueWrap" hidden>
      <input type="text" id="fireQueueInput" placeholder="Capture it — you'll fight it later">
      <button class="btn sm" id="fireQueueSave">Capture</button>
    </div>
    ${q1?`<div class="fire-queue-count">${q1} captured for later</div>`:''}
  </div>`;
}
function bindFireScreen(){
  const mn=q('#fireMinimize'); if(mn) mn.onclick=closeFireScreen;
  const ex=q('#fireExtinguish'); if(ex) ex.onclick=extinguishFire;
  const qb=q('#fireQueueBtn'); if(qb) qb.onclick=()=>{ const w=q('#fireQueueWrap'); if(w){ w.hidden=false; const i=q('#fireQueueInput'); if(i) i.focus(); } };
  const qs=q('#fireQueueSave'); if(qs) qs.onclick=fireQueueSave;
  const qi=q('#fireQueueInput'); if(qi) qi.onkeydown=e=>{ if(e.key==='Enter') fireQueueSave(); };
  const en=q('#fireExtend'); if(en) en.onclick=()=>fireExtend();
  const ov=q('#fireOverride'); if(ov) ov.onclick=openFireOverride;
}

function openFireScreen(){ fireScreenOpen=true; paintFire(); window.scrollTo(0,0); }
function closeFireScreen(){ fireScreenOpen=false; paintFire(); }

/* ---------- fast capture during a session ---------- */
function fireQueueSave(){
  const i=q('#fireQueueInput'); const v=(i&&i.value||'').trim(); if(!v) return;
  const id=addTask(v,'quick');           // normal quick-task path (returns new id)
  const s=activeFire(); if(s && id){ if(!s.queuedTaskIds) s.queuedTaskIds=[]; s.queuedTaskIds.push(id); save(false); }
  const w=q('#fireQueueWrap'); if(w) w.hidden=true;
  toast('Captured. Back to the fire.');
  paintFire();
}

/* ============================================================
   SESSION LIFECYCLE
   ============================================================ */
/* start-flow modal state */
let fireStep='pick';        // 'pick' | 'def' | 'mode'
let firePick=null;          // {key, txt}
let fireDefText='';
let fireModeSel='timer';
let fireDurSel=25;
let fireEstText='';

function openFirePicker(){
  if(fireIsActive()){ openFireScreen(); return; }   // one fire at a time
  fireStep='pick'; firePick=null; fireDefText=''; fireModeSel='timer'; fireDurSel=25; fireEstText='';
  renderFireModal();
}
function renderFireModal(){
  const m=q('#resetModal'); let inner;
  if(fireStep==='pick'){
    const list=firePickList();
    inner=`<h3>🔥 Start a fire</h3>
      <p class="intro">You notice every fire. You fight one at a time. Pick the one to fight now.</p>
      ${list.length
        ? `<div class="fire-pick-list">${list.map(c=>`<button class="fire-pick" data-firepick="${esc(c.key)}"><span class="fire-pick-txt">${esc(c.txt)}</span><span class="fire-pick-sub">${esc(c.sub)}</span></button>`).join('')}</div>`
        : `<div class="empty">No open tasks to fight yet — add one first.</div>`}
      <div class="btn-row" style="margin-top:14px"><button class="btn ghost" id="fireCancel">Cancel</button></div>`;
  } else if(fireStep==='def'){
    inner=`<h3>Definition of extinguished</h3>
      <p class="intro">For "<b>${esc(firePick.txt)}</b>" — what has to be true for this fire to be out?</p>
      <div class="qf"><input type="text" id="fireDefInput" value="${esc(fireDefText)}" placeholder="Extinguished when…"></div>
      <div class="btn-row" style="margin-top:14px"><button class="btn" id="fireDefNext">Next</button><button class="btn ghost" id="fireBack">Back</button></div>`;
  } else {
    inner=`<h3>Choose your mode</h3>
      <div class="fire-mode-toggle">
        <button class="fire-mode ${fireModeSel==='timer'?'on':''}" data-firemode="timer"><b>Timer</b><small>Countdown — contain open-ended work</small></button>
        <button class="fire-mode ${fireModeSel==='stopwatch'?'on':''}" data-firemode="stopwatch"><b>Stopwatch</b><small>Count up — bounded work, unknown length</small></button>
      </div>
      ${fireModeSel==='timer'
        ? `<div class="fire-dur">${[10,25,45,60,90].map(d=>`<button class="fire-dur-opt ${fireDurSel===d?'on':''}" data-firedur="${d}">${d} min</button>`).join('')}</div>`
        : `<div class="qf"><label>Estimate (optional, minutes)</label><input type="number" id="fireEstInput" min="1" value="${esc(fireEstText)}" placeholder="e.g. 15"></div>`}
      <div class="btn-row" style="margin-top:14px"><button class="btn fire-light" id="fireLight">🔥 Light it</button><button class="btn ghost" id="fireBack">Back</button></div>`;
  }
  m.innerHTML=`<div class="modal">${inner}</div>`;
  m.classList.add('show');
  bindFireModal();
}
function bindFireModal(){
  const cc=q('#fireCancel'); if(cc) cc.onclick=closeReset;
  q('[data-firepick]','all').forEach(el=>el.onclick=()=>{ const key=el.dataset.firepick; const c=firePickList().find(x=>x.key===key); firePick={key, txt:c?c.txt:''}; fireStep='def'; renderFireModal(); });
  const bk=q('#fireBack'); if(bk) bk.onclick=()=>{ fireStep = (fireStep==='mode'?'def':'pick'); renderFireModal(); };
  const di=q('#fireDefInput'); if(di){ di.oninput=()=>{ fireDefText=di.value; }; di.focus(); }
  const dn=q('#fireDefNext'); if(dn) dn.onclick=()=>{ if(!(fireDefText||'').trim()){ toast('Say what "out" looks like'); return; } fireStep='mode'; renderFireModal(); };
  q('[data-firemode]','all').forEach(el=>el.onclick=()=>{ fireModeSel=el.dataset.firemode; renderFireModal(); });
  q('[data-firedur]','all').forEach(el=>el.onclick=()=>{ fireDurSel=+el.dataset.firedur; renderFireModal(); });
  const ei=q('#fireEstInput'); if(ei) ei.oninput=()=>{ fireEstText=ei.value; };
  const lt=q('#fireLight'); if(lt) lt.onclick=startFire;
}
function startFire(){
  const key=firePick&&firePick.key, def=(fireDefText||'').trim();
  if(!key || !def) return;
  const t=fireTaskByKey(key);
  if(t) t.defOfDone=def;   // persists on the task after the session
  const s={
    id:b(), taskId:key, taskTxt:(t?t.txt:firePick.txt)||'Fire', defOfDone:def,
    mode:fireModeSel,
    durationMin: fireModeSel==='timer' ? fireDurSel : null,
    estimateMin: fireModeSel==='stopwatch' ? (parseInt(fireEstText,10)||null) : null,
    actualMin:null, startedAt:Date.now(), endedAt:null, outcome:null,
    queuedTaskIds:[], overrides:[], extendMin:0
  };
  if(!S.fireSessions) S.fireSessions=[];
  S.fireSessions.push(s); S.activeFireId=s.id;
  fireEndPrompted=false;
  save(false); closeReset();
  openFireScreen(); startFireTimer();
  if(current==='dashboard') rerender();
}

/* End a session with an outcome (task completion handled by caller for extinguish). */
function fireEndSession(outcome){
  const s=activeFire(); if(!s) return null;
  s.endedAt=Date.now();
  s.actualMin=Math.max(0, Math.round(fireElapsedMs(s)/60000));
  s.outcome=outcome;
  S.activeFireId=null; fireScreenOpen=false; stopFireTimer();
  return s;
}
function extinguishFire(){
  const s=activeFire(); if(!s) return;
  const key=s.taskId;
  const ended=fireEndSession('extinguished');
  fireCompleteTask(key);            // NORMAL completion path
  save(false); closeReset(); paintFire();
  if(ended.mode==='stopwatch' && ended.estimateMin!=null) toast(`Extinguished. Estimated ${ended.estimateMin} min, actual ${ended.actualMin} min.`);
  else toast('Fire extinguished ✓');
  if(current==='dashboard') rerender();
}
function fireReturnToQueue(){
  if(!activeFire()) return;
  fireEndSession('returned');       // task left open, on purpose
  save(false); closeReset(); paintFire();
  toast('Back in the queue — fight it when you choose.');
  if(current==='dashboard') rerender();
}
function fireExtend(){
  const s=activeFire(); if(!s || s.mode!=='timer') return;
  s.extendMin=(s.extendMin||0)+s.durationMin;   // one more block
  fireEndPrompted=false;                          // re-arm for the new block's end
  save(false); closeReset(); paintFire();
}

/* ---------- emergency override (never shaming) ---------- */
function openFireOverride(){
  const m=q('#resetModal');
  m.innerHTML=`<div class="modal">
    <span class="modal-close" id="fireOvClose">×</span>
    <h3>Emergency override</h3>
    <p class="intro">Would delaying this until the block ends cause immediate, real harm?</p>
    <div class="qf"><label>If yes, what's happening? (logged, no judgment)</label>
      <input type="text" id="fireOvReason" placeholder="What makes this a true emergency?"></div>
    <div class="btn-col" style="margin-top:16px">
      <button class="btn" id="fireOvYes">Yes — end the block now</button>
      <button class="btn ghost" id="fireOvQueue">No — queue it instead</button>
      <button class="btn ghost" id="fireOvBack">No — back to the fire</button>
    </div>
  </div>`;
  m.classList.add('show');
  const close=q('#fireOvClose'); if(close) close.onclick=closeReset;
  const back=q('#fireOvBack'); if(back) back.onclick=closeReset;
  const yes=q('#fireOvYes'); if(yes) yes.onclick=()=>{
    const s=activeFire(); if(!s){ closeReset(); return; }
    const reason=(q('#fireOvReason').value||'').trim();
    s.overrides.push({ ts:Date.now(), reason, harm:true });
    fireEndSession('override');
    save(false); closeReset(); paintFire();
    toast('Handled. Come back when you can.');
    if(current==='dashboard') rerender();
  };
  const queue=q('#fireOvQueue'); if(queue) queue.onclick=()=>{
    const reason=(q('#fireOvReason').value||'').trim();
    const s=activeFire();
    if(reason && s){ const id=addTask(reason,'quick'); if(id){ if(!s.queuedTaskIds) s.queuedTaskIds=[]; s.queuedTaskIds.push(id); save(false); } }
    closeReset(); toast('Captured. Back to the fire.'); paintFire();
  };
}

/* ---------- end of block (timer expiry) ---------- */
let fireEobSpot={mood:null,energy:null,calm:null,focus:null};
function fireSpotRow(key,label){
  let cells='';
  for(let n=1;n<=5;n++) cells+=`<span class="fire-star ${fireEobSpot[key]>=n?'on':''}" data-fspot="${key}|${n}">★</span>`;
  return `<div class="fire-spot-row"><span class="fire-spot-lbl">${label}</span><span class="fire-stars">${cells}</span></div>`;
}
function fireSpotHTML(){
  return `<div class="fire-spot"><div class="fire-spot-h">Optional — how was the block?</div>
    ${fireSpotRow('mood','Mood')}${fireSpotRow('energy','Energy')}${fireSpotRow('calm','Calm')}${fireSpotRow('focus','Focus')}</div>`;
}
function bindFireSpot(){
  q('[data-fspot]','all').forEach(el=>el.onclick=()=>{
    const p=el.dataset.fspot.split('|'); const k=p[0], n=+p[1];
    fireEobSpot[k]=n;
    q(`[data-fspot^="${k}|"]`,'all').forEach(c=>{ const cn=+c.dataset.fspot.split('|')[1]; c.classList.toggle('on', cn<=n); });
  });
}
function saveFireSpot(fireId){
  const dr=fireEobSpot;
  if(dr.mood==null && dr.energy==null && dr.calm==null && dr.focus==null) return;
  const d=day(); if(!d.spotlogs) d.spotlogs=[];
  d.spotlogs.push({ id:b(), time:nowHM(), ts:Date.now(), mood:dr.mood, energy:dr.energy, calm:dr.calm, focus:dr.focus, note:'', fireId });
  save(false);
}
function openFireEndOfBlock(){
  const s=activeFire(); if(!s) return;
  fireEobSpot={mood:null,energy:null,calm:null,focus:null};
  const m=q('#resetModal');
  m.innerHTML=`<div class="modal">
    <h3>Block complete</h3>
    <p class="intro">Time's up on this block. No rush — you decide what's next.</p>
    <div class="fire-eob-def"><span class="fire-def-lbl">Extinguished when</span> ${esc(s.defOfDone)}</div>
    ${fireSpotHTML()}
    <div class="btn-col" style="margin-top:16px">
      <button class="btn" id="fireEobExting">✓ Extinguished</button>
      <button class="btn ghost" id="fireEobExtend">Extend another block</button>
      <button class="btn ghost" id="fireEobQueue">Return to queue</button>
      <button class="btn ghost" id="fireEobNext">Next action</button>
    </div>
  </div>`;
  m.classList.add('show');
  bindFireSpot();
  const sid=s.id;
  const ex=q('#fireEobExting'); if(ex) ex.onclick=()=>{ saveFireSpot(sid); extinguishFire(); };
  const en=q('#fireEobExtend'); if(en) en.onclick=()=>{ saveFireSpot(sid); fireExtend(); };
  const rq=q('#fireEobQueue'); if(rq) rq.onclick=()=>{ saveFireSpot(sid); fireReturnToQueue(); };
  const nx=q('#fireEobNext'); if(nx) nx.onclick=()=>{ saveFireSpot(sid); extinguishFire(); openFirePicker(); };
}

/* ============================================================
   DASHBOARD SURFACES (called from renderDashboard / bindDashboard)
   ============================================================ */
function renderFireCTA(){
  if(fireIsActive()){
    return `<button class="fsn-cta fire-cta" id="fireReturnCta">
      <span class="fsn-cta-ic">🔥</span>
      <span class="fsn-cta-txt"><b>A fire is burning</b><span>Tap to return to the fire screen</span></span>
      <span class="fsn-cta-go">›</span></button>`;
  }
  return `<button class="fsn-cta fire-cta" id="fireStartCta">
    <span class="fsn-cta-ic">🔥</span>
    <span class="fsn-cta-txt"><b>Start a fire</b><span>Notice every fire. Fight one at a time.</span></span>
    <span class="fsn-cta-go">→</span></button>`;
}
function renderFireEvidence(){
  const tk=todayKey();
  const sess=(S.fireSessions||[]).filter(s=>s.endedAt && fireDayKey(s.endedAt)===tk);
  if(!sess.length) return '';
  const exting=sess.filter(s=>s.outcome==='extinguished');
  const totalMin=sess.reduce((a,s)=>a+(s.actualMin||0),0);
  return `<div class="card fire-evidence">
    <div class="card-h"><h3>🔥 Fires extinguished today</h3><span class="sub">${exting.length}</span></div>
    ${exting.length
      ? `<div class="fire-eb-list">${exting.map(s=>`<div class="fire-eb-row"><span class="fire-eb-txt">${esc(s.taskTxt)}</span><span class="fire-eb-min">${fmtDuration(s.actualMin||0)}</span></div>`).join('')}</div>`
      : `<div class="empty sm">No fires out yet today — that's fine. Start one when you're ready.</div>`}
    <div class="fire-ev-foot"><span>${fmtDuration(totalMin)} focused</span><span>${sess.length} session${sess.length>1?'s':''}</span></div>
  </div>`;
}
function bindFireDash(){
  const sc=q('#fireStartCta'); if(sc) sc.onclick=openFirePicker;
  const rc=q('#fireReturnCta'); if(rc) rc.onclick=openFireScreen;
}

/* ============================================================
   INIT / RESUME (called from startApp)
   ============================================================ */
function initFire(){
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') paintFireClocks(); });
  resumeFireIfActive();
}
function resumeFireIfActive(){
  const s=activeFire();
  if(s && !s.endedAt){
    fireScreenOpen=false;   // bar only on reload; tap in to open the takeover
    fireEndPrompted=false;
    paintFire(); startFireTimer();
    if(s.mode==='timer' && fireRemainingMs(s)<=0){ fireEndPrompted=true; openFireEndOfBlock(); }
  } else {
    document.body.classList.remove('fire-active');
  }
}
