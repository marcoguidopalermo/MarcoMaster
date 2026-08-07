/* ============================================================
   LEAK MANAGEMENT — a leak is a recurring task, decision or
   interruption that repeatedly reaches you when it shouldn't.
   Individually small; collectively they destroy focus and keep
   responsibility with you instead of the right person.

   Core principle: FIRST occurrence acts. SECOND notices. THIRD decides.
   So OCCURRENCE COUNTING is the whole point — the count is the evidence
   that justifies delegating, systemizing, automating or killing it.

   Capture is one line and nothing else — what to do about it is decided
   later, in review, never mid-interruption. A capture that looks like an
   existing leak asks one question ("same as…?") so the count lands on the
   right row instead of forking a duplicate.

   The detail is deliberately thin: the text, the count, ONE free-text notes
   field, status, delete. Structured resolution fields were tried and folded
   back into notes (see the _leakV2 migration in state.js) — the count is the
   thing that drives action, not a form.

   Store: S.leaks — see seedDefaults() in state.js for the shape.
   ============================================================ */

const LEAK_STATUSES=[['open','Open'],['watching','Watching'],['closed','Closed']];
function leakStatusLabel(s){ const f=LEAK_STATUSES.find(x=>x[0]===s); return f?f[1]:'Open'; }

/* ============================================================
   SIMILARITY — increment an existing leak vs create a new one.
   Deliberately simple and explainable: normalize, drop noise words,
   then a token-set Dice coefficient with a containment override
   (so "invoice question from James" matches "James invoice question
   again"). Best single candidate only; below threshold we create
   silently. That errs toward NOT interrupting: a missed match costs
   one duplicate row, a false prompt costs a decision mid-work — which
   is the exact tax this feature exists to remove.
   ============================================================ */
const LEAK_STOPWORDS=new Set(['the','a','an','to','for','of','my','again','about','is','it','and','on','in','with','me','that','this','from','at','be','was']);
const LEAK_MATCH_MIN=0.6;

function leakNorm(s){ return String(s??'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim(); }
function leakTokens(s){
  const raw=leakNorm(s).split(' ').filter(Boolean);
  const t=raw.filter(w=>!LEAK_STOPWORDS.has(w));
  return t.length?t:raw;          // an all-stopword capture still gets compared
}
function leakSimilarity(a,b){
  const na=leakNorm(a), nb=leakNorm(b);
  if(!na||!nb) return 0;
  if(na===nb) return 1;
  if(na.includes(nb)||nb.includes(na)) return 1;   // containment → same leak, said longer
  const A=new Set(leakTokens(a)), B=new Set(leakTokens(b));
  if(!A.size||!B.size) return 0;
  let inter=0; A.forEach(w=>{ if(B.has(w)) inter++; });
  return (2*inter)/(A.size+B.size);
}
/* Best match across ALL leaks — CLOSED ONES INCLUDED. A closed leak reaching you
   again is the single most important signal in the model (the fix didn't hold), so
   it must never silently fork into a fresh row with a count of 1. */
function leakFindMatch(text){
  let best=null, bestScore=0;
  (S.leaks||[]).forEach(l=>{
    if(!l||!l.text) return;
    const sc=leakSimilarity(text,l.text);
    if(sc>bestScore){ bestScore=sc; best=l; }
  });
  return (best && bestScore>=LEAK_MATCH_MIN) ? best : null;
}

/* ============================================================
   CAPTURE — one line, nothing else.
   ============================================================ */
/* the one in-flight "same as…?" question, if any. surface = which screen asked,
   so only that screen renders the prompt. The text is held here, so neither answer
   can lose it. */
let leakPending=null;      // {text, matchId, matchText, count, wasClosed, surface}

function leakCreate(text){
  const now=Date.now();
  const l={ id:b(), text:text, occurrences:[now], createdAt:now, lastSeenAt:now,
    status:'open', notes:'', tasks:[], regressions:0, regressionsFromClosed:0,
    closedAt:null, _leakV2:true };
  if(!Array.isArray(S.leaks)) S.leaks=[];
  S.leaks.push(l);
  save(false);
  return l;
}
/* Record another occurrence. A CLOSED leak reopens — it's back, and the row has to
   say so; its closed-then-recurred history stays intact in occurrences. */
function leakIncrement(l){
  if(!l) return null;
  const now=Date.now();
  if(!Array.isArray(l.occurrences)) l.occurrences=[];
  l.occurrences.push(now);
  l.lastSeenAt=now;
  // THE key signal: it came back after you thought it was handled. Both directions
  // count as a regression, and Closed→Open is the STRONGER one — Watching only ever
  // meant "unproven", Closed meant "I declared this solved".
  const from = l.status;
  const regressed = (from==='watching' || from==='closed');
  if(regressed){
    l.status='open';
    l.closedAt=null;
    l.regressions=(l.regressions||0)+1;
    if(from==='closed') l.regressionsFromClosed=(l.regressionsFromClosed||0)+1;
  }
  save(false);
  return {leak:l, regressed, from};
}

/* Entry point for every capture surface. Returns true when it captured outright,
   false when it needs the "same as…?" answer first (see leakPending). */
function leakSubmit(text, surface){
  const v=(text||'').trim(); if(!v) return false;
  const m=leakFindMatch(v);
  if(!m){ leakCreate(v); leakPending=null; toast('Captured. Back to work.'); return true; }
  leakPending={ text:v, matchId:m.id, matchText:m.text, count:(m.occurrences||[]).length,
                wasClosed:(m.status==='closed'), wasWatching:(m.status==='watching'), surface:surface };
  return false;
}
/* Answer the question: 'same' → increment that leak, 'new' → create a separate one. */
function leakResolvePending(choice){
  const p=leakPending; if(!p) return;
  leakPending=null;
  if(choice==='same'){
    const l=(S.leaks||[]).find(x=>x.id===p.matchId);
    if(l){
      const r=leakIncrement(l);
      if(r.regressed){
        const n=l.regressions||1;
        toast(`The fix didn't hold — back to Open (${n}${n===1?'st':(n===2?'nd':(n===3?'rd':'th'))} regression).`);
      }else{
        toast(`Captured — ${(l.occurrences||[]).length}×. Back to work.`);
      }
      return;
    }
  }
  leakCreate(p.text);
  toast('Captured. Back to work.');
}

/* the "same as…?" prompt — identical markup on every surface */
function leakConfirmHTML(p){
  const q = p.wasClosed  ? 'You closed this one — is it back?'
          : p.wasWatching ? 'This one was on watch. Did it come back?'
          : 'Same as:';
  const meta = p.wasClosed  ? `You declared this solved after ${p.count}×. Saying yes reopens it and records a regression.`
             : p.wasWatching ? `Watching after ${p.count}×. Saying yes means the fix didn't hold.`
             : `Seen ${p.count}× so far.`;
  return `<div class="leak-confirm ${(p.wasClosed||p.wasWatching)?'is-regression':''}">
    <div class="leak-confirm-q">${q} <b>${esc(p.matchText)}</b>?</div>
    <div class="leak-confirm-meta">${meta}</div>
    <div class="leak-confirm-btns">
      <button class="btn sm" data-leakconfirm="same">Yes — same leak (→ ${p.count+1}×)</button>
      <button class="btn ghost sm" data-leakconfirm="new">No — new leak</button>
    </div>
  </div>`;
}
/* one-line capture row, shared by every surface */
function leakInputHTML(placeholder){
  return `<div class="leak-cap-row">
    <input type="text" data-leakinput placeholder="${esc(placeholder||"What reached you that shouldn't have?")}">
    <button class="btn sm" data-leakadd>Capture</button>
  </div>`;
}
/* Bind a capture surface. root is the container element (scoped so the dashboard
   card and the fire screen never bind each other's controls); after() runs once the
   capture settles and is what repaints that particular surface. */
function bindLeakCaptureIn(root, surface, after){
  if(!root) return;
  const input=root.querySelector('[data-leakinput]');
  const btn=root.querySelector('[data-leakadd]');
  const submit=()=>{
    const v=(input&&input.value||'').trim(); if(!v) return;
    leakSubmit(v, surface);      // toasts on outright capture; otherwise sets the prompt
    after();
  };
  if(btn) btn.onclick=submit;
  if(input) input.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); submit(); } };
  root.querySelectorAll('[data-leakconfirm]').forEach(el=>el.onclick=()=>{
    leakResolvePending(el.dataset.leakconfirm);
    after();
  });
}

/* An unanswered prompt belongs to the screen that asked it — but if that screen is
   gone (the fire ended while the question was still open) the captured text would be
   stranded with nowhere to render. Hand it to whichever surface is now on screen, so
   a capture is never silently lost. */
function leakAdoptStrandedPending(surface){
  if(!leakPending || leakPending.surface===surface) return;
  if(leakPending.surface==='fire'){
    const live = (typeof fireScreenOpen!=='undefined' && fireScreenOpen && typeof fireIsActive==='function' && fireIsActive());
    if(!live) leakPending.surface=surface;
  }
}

/* ---------- DASHBOARD surface ----------
   Water to the Fire Station's fire: leaks carry 💧 and the app's blue, fires carry
   🔥 and red, so the two read as opposites at a glance. */
/* The Leaks CTA. Sits beside the fire CTA as the dashboard's second move.
   Capture is NOT here — it's a destination in the unified capture line at the top
   of the Dashboard. This opens the full-screen leaks overlay. */
function renderLeaksCta(){
  const n=(S.leaks||[]).filter(l=>l.status!=='closed').length;
  return `
  <button class="fsn-cta leak-cta" id="leaksCta">
    <span class="fsn-cta-ic">💧</span>
    <span class="fsn-cta-txt"><b>Leaks</b><span>${n?`${n} open · close ${n===1?'it':'one'} for good`:'Nothing leaking right now'}</span></span>
    <span class="fsn-cta-go">→</span>
  </button>`;
}
function bindLeaksCta(){
  const c=q('#leaksCta'); if(c) c.onclick=openLeakScreen;
}

/* ---------- FIRE STATION surface ----------
   Leaks announce themselves mid-work, so capture has to be reachable from the
   active-fire screen. Everything here stays INSIDE #fireScreen (which lives outside
   #main): no go(), no rerender(), and nothing touching S.activeFireId /
   fireScreenOpen / the timer. paintFire() rebuilds the screen, and the clock is
   recomputed from startedAt — so the session and its elapsed time are untouched. */
function renderFireLeakCapture(){
  const pending=(leakPending && leakPending.surface==='fire');
  return `<div class="fire-leak-inline" id="fireLeakWrap" ${pending?'':'hidden'}>
    ${pending ? leakConfirmHTML(leakPending) : leakInputHTML('Capture it — close the leak later')}
  </div>`;
}
function bindFireLeakCapture(){
  const wrap=q('#fireLeakWrap');
  const btn=q('#fireLeakBtn');
  if(btn) btn.onclick=()=>{ if(wrap){ wrap.hidden=false; const i=wrap.querySelector('[data-leakinput]'); if(i) i.focus(); } };
  bindLeakCaptureIn(wrap, 'fire', ()=>paintFire());   // repaint the takeover only — back at the fire
}

/* ============================================================
   THE LEAKS OVERLAY — full-screen, every leak visible at once.
   Rendered into #leakScreen, which lives OUTSIDE .app exactly like the Fire
   Station's #fireScreen: rerender() only ever replaces #main, so a page render
   can never collapse this overlay, lose its scroll, or drop a focused field.
   ============================================================ */
let leakScreenOpen=false;
let leakOpenId=null;          // which leak's detail is showing (null = the grid)

function leakCount(l){ return (l.occurrences||[]).length; }
/* most draining first: occurrence count desc, then most recently seen */
function leakSort(a,b){ return (leakCount(b)-leakCount(a)) || ((b.lastSeenAt||0)-(a.lastSeenAt||0)); }
/* the count IS the evidence, so it escalates: blue at 1×, amber at 2×, red at 3×+
   (first occurrence acts, second notices, third decides) */
function leakBadgeClass(l){ const n=leakCount(l); return n>=3?'hot':(n>=2?'warm':''); }

function leakDay(ts){
  if(!ts) return '—';
  const d=new Date(ts);
  const opts={month:'short',day:'numeric'};
  if(d.getFullYear()!==new Date().getFullYear()) opts.year='numeric';
  return d.toLocaleDateString('en-CA',opts);
}

/* ============================================================
   LEAK TASKS — a leak is a CONTAINER, like a project.
   Tasks live on the leak in the SAME shape as project tasks, and every existing
   task path (All Tasks, the fire picker, Completed Today, the pipeline) gains a
   leak branch beside its project branch rather than a parallel implementation.
   Row key: 'L|<leakId>|<taskId>'  (vs 'L|<leakId>' = the leak itself).
   Leak tasks are QUICK-only: the time-block machinery is keyed on
   projectId/projTaskId throughout, and a leak fix is a small concrete action.
   ============================================================ */
function leakById(id){ return (S.leaks||[]).find(l=>l.id===id) || null; }
function leakTask(leakId, taskId){ const l=leakById(leakId); return l && (l.tasks||[]).find(t=>t.id===taskId) || null; }
function leakOpenTasks(l){ return (l&&l.tasks||[]).filter(t=>!t.done); }

function addLeakTask(leakId, txt){
  const l=leakById(leakId); const v=(txt||'').trim();
  if(!l || !v) return false;
  if(!Array.isArray(l.tasks)) l.tasks=[];
  l.tasks.push({id:b(), txt:v, done:false, doneAt:null, priority:false, kind:'quick'});
  // work is outstanding again → a watching leak goes back to Open (no regression:
  // only a real recurrence counts as the fix failing)
  if(l.status==='watching') l.status='open';
  save();
  return true;
}
/* Mirrors setProjTaskDone: stamps the completion DAY so the task shows in
   Completed Today, then re-evaluates the leak's status. */
function setLeakTaskDone(leakId, taskId, done){
  const t=leakTask(leakId, taskId); if(!t) return;
  t.done=!!done;
  t.doneAt = done ? todayKey() : null;
  leakSyncWatching(leakId);
}
/* THE single choke point for Open→Watching, so the rule is identical whether the
   task was completed in the leak detail, in All Tasks, or by extinguishing a fire.
   Promotes ONLY when there is real work that is now all done. Never closes: Closed
   is a deliberate act and nothing here will ever set it. */
function leakSyncWatching(leakId){
  const l=leakById(leakId); if(!l) return;
  const tasks=l.tasks||[];
  if(l.status==='open' && tasks.length && tasks.every(t=>t.done)){
    l.status='watching';
  }else if(l.status==='watching' && tasks.length && tasks.some(t=>!t.done)){
    l.status='open';          // work outstanding again — not a regression
  }
  save(false);
}

/* whole days since the last occurrence — the evidence for closing a watching leak */
function leakDaysSince(l){
  const ms=Date.now()-(l.lastSeenAt||l.createdAt||Date.now());
  return Math.max(0, Math.floor(ms/86400000));
}
function leakQuietLabel(l){
  const d=leakDaysSince(l);
  return d===0 ? 'since today' : (d===1 ? '1 day since last occurrence' : `${d} days since last occurrence`);
}
/* every fire fought on this leak — the leak itself AND any of its tasks, all-time */
function leakFireStats(leakId){
  const pre='L|'+leakId;
  let count=0, mins=0;
  (S.fireSessions||[]).forEach(s=>{
    if(!s || !s.endedAt || typeof s.taskId!=='string') return;
    if(s.taskId===pre || s.taskId.indexOf(pre+'|')===0){ count++; mins+=(s.actualMin||0); }
  });
  return {count, mins};
}
function leakRegressionLabel(l){
  const n=l.regressions||0; if(!n) return '';
  const c=l.regressionsFromClosed||0;
  return `⚠ ${n} regression${n===1?'':'s'}${c?` · ${c} from closed`:''}`;
}

function openLeakScreen(){ leakScreenOpen=true; leakOpenId=null; paintLeakScreen(); }
function closeLeakScreen(){ leakScreenOpen=false; paintLeakScreen(); rerender(); }

/* one compact, single-line row. Task progress rides along like a project's, and a
   leak that has regressed carries the warning treatment wherever it appears. */
function leakRowHTML(l){
  const t=(l.tasks||[]), doneCt=t.filter(x=>x.done).length;
  return `<button class="pick-row ${l.regressions?'is-regressed':''}" data-leakrow="${l.id}">
    <span class="pick-badge ${leakBadgeClass(l)}">${leakCount(l)}×</span>
    <span class="pick-txt">${esc(l.text)}</span>
    ${l.regressions?`<span class="leak-regress-mark" title="${esc(leakRegressionLabel(l))}">⚠${l.regressions>1?l.regressions:''}</span>`:''}
    ${t.length?`<span class="leak-task-ct">${doneCt}/${t.length}</span>`:''}
    ${l.status==='watching'?`<span class="leak-watch-mark" title="${esc(leakQuietLabel(l))}">👁 ${leakDaysSince(l)}d</span>`:''}
  </button>`;
}

/* DETAIL — text + count, notes, its TASK LIST, status, the quiet counter while
   watching, regressions if any, this leak's fire time, delete. It REPLACES the grid
   rather than expanding inline, because expanding a row inside a multi-column
   layout reflows every other column under the cursor. */
function leakDetailHTML(l){
  const stat=([k,lbl])=>`<button class="leak-stat-opt ${((l.status||'open')===k)?'on':''}" data-leakstatus="${l.id}|${k}">${lbl}</button>`;
  const tasks=(l.tasks||[]);
  const fs=leakFireStats(l.id);
  const taskRow=(t)=>`<div class="leak-t-row ${t.done?'done':''}">
      <span class="box" data-leaktdone="${l.id}|${t.id}" title="${t.done?'Mark not done':'Mark done'}">✓</span>
      <span class="leak-t-txt">${t.priority?'<span class="prio-mark">🔥</span> ':''}${esc(t.txt)}</span>
      <span class="x" data-leaktdel="${l.id}|${t.id}" title="Delete task">×</span>
    </div>`;
  return `<div class="leak-detail-full">
    <button class="pick-back" id="leakBack">← All leaks</button>
    <div class="leak-d-head">
      <span class="pick-badge ${leakBadgeClass(l)}">${leakCount(l)}×</span>
      <h2>${esc(l.text)}</h2>
    </div>
    <div class="leak-d-sub">first seen ${leakDay(l.createdAt)} · last seen ${leakDay(l.lastSeenAt)}${l.closedAt?` · closed ${leakDay(l.closedAt)}`:''}${fs.count?` · ${fs.count} fire${fs.count===1?'':'s'} · ${fmtFocus(fs.mins)} focused`:''}</div>

    ${l.status==='watching'?`<div class="leak-watching">
      <span class="leak-watch-big">👁 ${esc(leakQuietLabel(l))}</span>
      <span class="leak-watch-note">The fix is in. Close it when you're satisfied it stopped reaching you.</span>
    </div>`:''}
    ${l.regressions?`<div class="leak-regressed">${esc(leakRegressionLabel(l))} — it came back after you thought it was handled.</div>`:''}

    <div class="leak-d-lbl">Tasks<span class="leak-d-ct">${tasks.filter(t=>t.done).length}/${tasks.length}</span></div>
    <div class="leak-t-list">
      ${tasks.length?tasks.map(taskRow).join(''):'<div class="empty sm">No tasks yet — what would actually close this leak?</div>'}
    </div>
    <div class="leak-t-add">
      <input type="text" data-leaktadd="${l.id}" placeholder="Add a task that closes this leak…">
      <button class="btn sm" data-leaktaddbtn="${l.id}">+</button>
    </div>

    <div class="leak-d-lbl">Notes</div>
    <textarea class="leak-notes" data-leaknotes="${l.id}" placeholder="Notes — whatever you want to remember about this leak: who should own it, what would kill it, what you already tried.">${esc(l.notes||'')}</textarea>

    <div class="leak-d-actions">
      <div class="leak-stat-toggle">${LEAK_STATUSES.map(stat).join('')}</div>
      <button class="btn ghost sm leak-del" data-leakdel="${l.id}">Delete</button>
    </div>
  </div>`;
}

function leakScreenHTML(){
  const open=(S.leaks||[]).filter(l=>l.status!=='closed').slice().sort(leakSort);
  const closed=(S.leaks||[]).filter(l=>l.status==='closed').slice().sort((a,b)=>(b.closedAt||0)-(a.closedAt||0));
  const cur=leakOpenId ? (S.leaks||[]).find(l=>l.id===leakOpenId) : null;
  const body = cur ? leakDetailHTML(cur) : `
    <div class="pick-body">
      <section class="pick-group g-leak" style="--gc:var(--blue)">
        <h3 class="pick-g-title">Open<span class="pick-g-ct">${open.length}</span></h3>
        <div class="pick-rows">${open.length?open.map(leakRowHTML).join('')
          :'<div class="empty sm">No open leaks. Capture the next thing that reaches you when it shouldn\'t.</div>'}</div>
      </section>
      ${closed.length?`
      <section class="pick-group g-leak is-closed" style="--gc:var(--line)">
        <h3 class="pick-g-title">Closed<span class="pick-g-ct">${closed.length}</span></h3>
        <div class="pick-rows">${closed.map(leakRowHTML).join('')}</div>
      </section>`:''}
    </div>`;
  return `<div class="pick-inner">
    <header class="pick-head">
      <div class="pick-h-txt"><h2>💧 Leaks</h2>
        <p>Close it, don't complete it. First occurrence acts, second notices, third decides.</p></div>
      <button class="pick-close" id="leakScreenClose" title="Close">×</button>
    </header>
    ${body}
  </div>`;
}

function paintLeakScreen(){
  const el=q('#leakScreen'); if(!el) return;
  if(!leakScreenOpen){ el.classList.remove('show'); el.innerHTML=''; document.body.classList.remove('pick-open'); return; }
  el.innerHTML=leakScreenHTML();
  el.classList.add('show');
  document.body.classList.add('pick-open');
  bindLeakScreen();
  if(!leakOpenId) fitPickScreen(el);   // density step-down applies to the grid, not the detail
}

function bindLeakScreen(){
  const byId=(id)=>(S.leaks||[]).find(x=>x.id===id);
  const cl=q('#leakScreenClose'); if(cl) cl.onclick=closeLeakScreen;
  const bk=q('#leakBack'); if(bk) bk.onclick=()=>{ leakOpenId=null; paintLeakScreen(); };

  q('#leakScreen [data-leakrow]','all').forEach(el=>el.onclick=()=>{ leakOpenId=el.dataset.leakrow; paintLeakScreen(); });

  // notes — save WITHOUT repainting so the caret never jumps mid-sentence
  const nt=q('#leakScreen [data-leaknotes]');
  if(nt) nt.oninput=()=>{ const l=byId(nt.dataset.leaknotes); if(l){ l.notes=nt.value; save(false); } };

  // ---- tasks (the same machinery as project tasks, reached by leak id) ----
  const pair=(v)=>{ const i=String(v).indexOf('|'); return [String(v).slice(0,i), String(v).slice(i+1)]; };
  q('#leakScreen [data-leaktdone]','all').forEach(el=>el.onclick=()=>{
    const [lid,tid]=pair(el.dataset.leaktdone);
    const t=leakTask(lid,tid); if(!t) return;
    setLeakTaskDone(lid, tid, !t.done);     // may auto-promote Open → Watching
    paintLeakScreen(); rerender();
  });
  q('#leakScreen [data-leaktdel]','all').forEach(el=>el.onclick=()=>{
    const [lid,tid]=pair(el.dataset.leaktdel);
    const l=byId(lid); if(!l) return;
    l.tasks=(l.tasks||[]).filter(x=>x.id!==tid);
    // dropping the last outstanding task can complete the set — re-evaluate
    leakSyncWatching(lid);
    // sweep any pipeline references so nothing dangles
    Object.keys(S.days||{}).forEach(dk=>{ const d=S.days[dk]; if(d.pipeline) d.pipeline=d.pipeline.filter(it=>!(it.leakId===lid && it.leakTaskId===tid)); });
    save(); paintLeakScreen(); rerender();
  });
  const ti=q('#leakScreen [data-leaktadd]'), tb=q('#leakScreen [data-leaktaddbtn]');
  const addT=()=>{ if(!ti) return; if(!addLeakTask(ti.dataset.leaktadd, ti.value)) return; paintLeakScreen(); rerender(); };
  if(tb) tb.onclick=addT;
  if(ti) ti.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); addT(); } };

  // status — closing stamps closedAt, reopening clears it. Never deletes.
  q('#leakScreen [data-leakstatus]','all').forEach(el=>el.onclick=()=>{
    const v=el.dataset.leakstatus, i=v.indexOf('|');
    const l=byId(v.slice(0,i)); const st=v.slice(i+1); if(!l) return;
    l.status=st;
    l.closedAt = (st==='closed') ? Date.now() : null;
    save(false); paintLeakScreen(); rerender();
    toast(st==='closed' ? 'Leak closed ✓' : (st==='watching' ? 'Watching — waiting to see if it stops' : 'Reopened'));
  });

  // delete (confirm) — the occurrence count is the evidence, so say what's lost
  q('#leakScreen [data-leakdel]','all').forEach(el=>el.onclick=()=>{
    const l=byId(el.dataset.leakdel); if(!l) return;
    const n=leakCount(l);
    if(!confirm(`Delete "${l.text}"?\n\nThis erases ${n} recorded occurrence${n===1?'':'s'} — the evidence that justifies delegating it. Closing it instead keeps the history.`)) return;
    S.leaks=(S.leaks||[]).filter(x=>x.id!==l.id);
    leakOpenId=null;
    save(); paintLeakScreen(); rerender();
  });
}
