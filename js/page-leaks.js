/* ============================================================
   LEAK MANAGEMENT — a leak is a recurring task, decision or
   interruption that repeatedly reaches you when it shouldn't.
   Individually small; collectively they destroy focus and keep
   responsibility with you instead of the right person.

   Core principle: FIRST occurrence acts. SECOND notices. THIRD decides.
   So OCCURRENCE COUNTING is the whole point — the count is the evidence
   that justifies delegating, systemizing, automating or killing it.

   Capture is one line and nothing else — owner / resolution / due date
   are decided later, in review, never mid-interruption. A capture that
   looks like an existing leak asks one question ("same as…?") so the
   count lands on the right row instead of forking a duplicate.

   Store: S.leaks — see seedDefaults() in state.js for the shape.
   ============================================================ */

const LEAK_RES_TYPES=['Delegate','Systemize','Automate','Eliminate','Schedule'];
const LEAK_STATUSES=[['open','Open'],['progress','In progress'],['closed','Closed']];
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
    status:'open', resolutionType:null, owner:'', nextAction:'', dueDate:'',
    defOfClosed:'', followUpDate:'', closedAt:null };
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
  const reopened=(l.status==='closed');
  if(reopened){ l.status='open'; l.closedAt=null; }
  save(false);
  return {leak:l, reopened};
}

/* Entry point for every capture surface. Returns true when it captured outright,
   false when it needs the "same as…?" answer first (see leakPending). */
function leakSubmit(text, surface){
  const v=(text||'').trim(); if(!v) return false;
  const m=leakFindMatch(v);
  if(!m){ leakCreate(v); leakPending=null; toast('Captured. Back to work.'); return true; }
  leakPending={ text:v, matchId:m.id, matchText:m.text, count:(m.occurrences||[]).length,
                wasClosed:(m.status==='closed'), surface:surface };
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
      toast(r.reopened ? `It's back — ${(l.occurrences||[]).length}×. Back to work.`
                       : `Captured — ${(l.occurrences||[]).length}×. Back to work.`);
      return;
    }
  }
  leakCreate(p.text);
  toast('Captured. Back to work.');
}

/* the "same as…?" prompt — identical markup on every surface */
function leakConfirmHTML(p){
  return `<div class="leak-confirm">
    <div class="leak-confirm-q">${p.wasClosed?'You closed this one — is it back?':'Same as:'} <b>${esc(p.matchText)}</b>?</div>
    <div class="leak-confirm-meta">${p.wasClosed
      ? `Closed leak, seen ${p.count}×. Saying yes reopens it.`
      : `Seen ${p.count}× so far.`}</div>
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
function leakOpenCount(){ return (S.leaks||[]).filter(l=>l.status!=='closed').length; }

/* The two leak CTAs. Rendered beside the fire CTA so the dashboard reads as three
   parallel moves: Start a fire · Capture a leak · Fix a leak. */
function renderLeakCtas(){
  const n=leakOpenCount();
  return `
  <button class="fsn-cta leak-cta" id="leakCaptureCta">
    <span class="fsn-cta-ic">💧</span>
    <span class="fsn-cta-txt"><b>Capture a leak</b><span>One line. Decide who owns it later.</span></span>
    <span class="fsn-cta-go">→</span>
  </button>
  <button class="fsn-cta leak-cta" id="leakFixCta">
    <span class="fsn-cta-ic">💧</span>
    <span class="fsn-cta-txt"><b>Fix a leak</b><span>${n?`${n} open · close ${n===1?'it':'one'} for good`:'Nothing leaking right now'}</span></span>
    <span class="fsn-cta-go">${leakSectionOpen?'▾':'→'}</span>
  </button>`;
}

function renderLeakCapture(){
  leakAdoptStrandedPending('dash');
  const pending=(leakPending && leakPending.surface==='dash');
  return `
  <div class="card leak-cap-card" id="leakCapCard">
    <div class="card-h"><h3>💧 Capture a leak</h3><span class="sub">${leakOpenCount()} open</span></div>
    ${pending ? leakConfirmHTML(leakPending) : leakInputHTML()}
    <div class="leak-cap-foot">
      <span>First occurrence acts. Second notices. Third decides.</span>
    </div>
  </div>`;
}
function bindLeakCapture(){
  bindLeakCaptureIn(q('#leakCapCard'), 'dash', ()=>rerender());   // rerender keeps scroll position
  // "Capture a leak" jumps to the one-line input rather than hiding it behind a
  // click — capture has to stay one line and one keystroke away.
  const cc=q('#leakCaptureCta'); if(cc) cc.onclick=()=>{
    const i=q('#leakCapCard [data-leakinput]') || q('#leakCapCard [data-leakconfirm]');
    if(i){ i.scrollIntoView({behavior:'smooth',block:'center'}); if(i.matches('input')) i.focus(); }
  };
  // "Fix a leak" opens the dropdown below and scrolls it into view
  const fc=q('#leakFixCta'); if(fc) fc.onclick=()=>{
    leakSectionOpen=true; rerender();
    const el=q('#leakSection'); if(el) el.scrollIntoView({behavior:'smooth',block:'start'});
  };
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
   THE LEAKS SECTION
   ============================================================ */
let leakOpenId=null;          // which leak's detail is expanded (one at a time)
let leakClosedOpen=false;     // the collapsed "Closed" group
let leakSectionOpen=false;    // the dashboard dropdown itself — collapsed by default

function leakCount(l){ return (l.occurrences||[]).length; }
/* most draining first: occurrence count desc, then most recently seen */
function leakSort(a,b){ return (leakCount(b)-leakCount(a)) || ((b.lastSeenAt||0)-(a.lastSeenAt||0)); }

function leakDay(ts){
  if(!ts) return '—';
  const d=new Date(ts);
  const opts={month:'short',day:'numeric'};
  if(d.getFullYear()!==new Date().getFullYear()) opts.year='numeric';
  return d.toLocaleDateString('en-CA',opts);
}
/* a YYYY-MM-DD field from a date input, shown without a timezone shift */
function leakDateStr(s){
  if(!s) return '';
  const p=String(s).split('-');
  if(p.length!==3) return s;
  const d=new Date(+p[0], +p[1]-1, +p[2]);
  if(isNaN(d)) return s;
  const opts={month:'short',day:'numeric'};
  if(d.getFullYear()!==new Date().getFullYear()) opts.year='numeric';
  return d.toLocaleDateString('en-CA',opts);
}

function leakDetailHTML(l){
  const chip=(t)=>`<button class="leak-chip ${l.resolutionType===t?'on':''}" data-leakres="${l.id}|${t}">${t}</button>`;
  const stat=([k,lbl])=>`<button class="leak-stat-opt ${((l.status||'open')===k)?'on':''}" data-leakstatus="${l.id}|${k}">${lbl}</button>`;
  return `
  <div class="leak-detail">
    <div class="leak-field">
      <label>Resolution type</label>
      <div class="leak-chips">${LEAK_RES_TYPES.map(chip).join('')}</div>
    </div>
    <div class="leak-field">
      <label>Owner — who should own this</label>
      <input type="text" data-leakowner="${l.id}" value="${esc(l.owner||'')}" placeholder="Not you, ideally">
    </div>
    <div class="leak-field">
      <label>Next action</label>
      <input type="text" data-leaknext="${l.id}" value="${esc(l.nextAction||'')}" placeholder="The one move that closes the leak">
    </div>
    <div class="leak-dates">
      <div class="leak-field">
        <label>Due date</label>
        <input type="date" data-leakdue="${l.id}" value="${esc(l.dueDate||'')}">
      </div>
      <div class="leak-field">
        <label>Follow-up date</label>
        <input type="date" data-leakfollow="${l.id}" value="${esc(l.followUpDate||'')}">
      </div>
    </div>
    <div class="leak-field">
      <label>Definition of closed</label>
      <textarea data-leakdef="${l.id}" placeholder="What has to be true for this to stop reaching you?">${esc(l.defOfClosed||'')}</textarea>
    </div>
    <div class="leak-field">
      <label>Status</label>
      <div class="leak-stat-toggle">${LEAK_STATUSES.map(stat).join('')}</div>
    </div>
    <div class="leak-detail-foot">
      <span class="leak-hist">Seen ${leakCount(l)}× · first ${leakDay(l.createdAt)} · last ${leakDay(l.lastSeenAt)}${l.closedAt?` · closed ${leakDay(l.closedAt)}`:''}</span>
      <button class="btn ghost sm leak-del" data-leakdel="${l.id}">Delete</button>
    </div>
  </div>`;
}

function leakRowHTML(l){
  const open=(leakOpenId===l.id);
  const n=leakCount(l);
  const meta=[
    `first ${leakDay(l.createdAt)}`,
    `last ${leakDay(l.lastSeenAt)}`,
    leakStatusLabel(l.status||'open'),
  ];
  if(l.resolutionType) meta.push(l.resolutionType);
  if(l.dueDate) meta.push('due '+leakDateStr(l.dueDate));
  return `
  <div class="leak-row ${open?'expanded':''} ${l.status==='closed'?'is-closed':''}">
    <button class="leak-head" data-leakopen="${l.id}">
      <span class="leak-n ${n>=3?'hot':(n>=2?'warm':'')}">${n}×</span>
      <span class="leak-main">
        <span class="leak-txt">${esc(l.text)}</span>
        <span class="leak-meta">${meta.map(esc).join(' · ')}</span>
      </span>
      <span class="leak-caret">${open?'▾':'▸'}</span>
    </button>
    ${open?leakDetailHTML(l):''}
  </div>`;
}

/* The Leaks dropdown — lives on the Dashboard, collapsed by default, header
   carrying the open count. Expanded it holds everything the dedicated page did:
   the sorted list, inline detail with every resolution field, the collapsed Closed
   group, and delete. */
function renderLeakSection(){
  const all=(S.leaks||[]);
  const active=all.filter(l=>l.status!=='closed').slice().sort(leakSort);
  const closed=all.filter(l=>l.status==='closed').slice().sort((a,b)=>(b.closedAt||0)-(a.closedAt||0));
  return `
  <div class="panel leak-panel ${leakSectionOpen?'open':''}" id="leakSection">
    <button class="panel-h" id="leakSectionToggle">
      <span class="panel-caret">${leakSectionOpen?'▾':'▸'}</span>
      <span class="panel-title">💧 Leaks (${active.length})</span>
      <span class="panel-meta">close it, don't complete it</span>
    </button>
    ${leakSectionOpen?`<div class="panel-body">
      <div class="panel-note">Every one of these reached you when it shouldn't have. The goal isn't to handle the interruption — it's to permanently close the leak.</div>

      <div class="leak-list">
        ${active.length?active.map(leakRowHTML).join('')
          :'<div class="empty">No open leaks. Capture the next thing that reaches you when it shouldn\'t.</div>'}
      </div>

      ${closed.length?`
      <div class="panel ${leakClosedOpen?'open':''}" style="margin-top:14px">
        <button class="panel-h" id="leakClosedPanel">
          <span class="panel-caret">${leakClosedOpen?'▾':'▸'}</span>
          <span class="panel-title">Closed</span>
          <span class="panel-meta">${closed.length}</span>
        </button>
        ${leakClosedOpen?`<div class="panel-body"><div class="leak-list">${closed.map(leakRowHTML).join('')}</div></div>`:''}
      </div>`:''}
    </div>`:''}
  </div>`;
}

function bindLeakSection(){
  const st=q('#leakSectionToggle'); if(st) st.onclick=()=>{ leakSectionOpen=!leakSectionOpen; rerender(); };

  const byId=(id)=>(S.leaks||[]).find(x=>x.id===id);
  const pair=(v)=>{ const i=String(v).indexOf('|'); return [String(v).slice(0,i), String(v).slice(i+1)]; };

  // expand / collapse a leak's detail (one open at a time)
  q('[data-leakopen]','all').forEach(el=>el.onclick=()=>{
    leakOpenId=(leakOpenId===el.dataset.leakopen)?null:el.dataset.leakopen;
    rerender();
  });

  // resolution type — tapping the active chip clears it (all fields stay optional)
  q('[data-leakres]','all').forEach(el=>el.onclick=()=>{
    const [id,t]=pair(el.dataset.leakres); const l=byId(id); if(!l) return;
    l.resolutionType=(l.resolutionType===t)?null:t;
    save(false); rerender();
  });

  // free text — save WITHOUT re-render so the caret never jumps mid-typing
  q('[data-leakowner]','all').forEach(el=>el.oninput=()=>{ const l=byId(el.dataset.leakowner); if(l){ l.owner=el.value; save(false); } });
  q('[data-leaknext]','all').forEach(el=>el.oninput=()=>{ const l=byId(el.dataset.leaknext); if(l){ l.nextAction=el.value; save(false); } });
  q('[data-leakdef]','all').forEach(el=>el.oninput=()=>{ const l=byId(el.dataset.leakdef); if(l){ l.defOfClosed=el.value; save(false); } });

  // dates — discrete changes, so re-render to refresh the row summary
  q('[data-leakdue]','all').forEach(el=>el.onchange=()=>{ const l=byId(el.dataset.leakdue); if(l){ l.dueDate=el.value; save(false); rerender(); } });
  q('[data-leakfollow]','all').forEach(el=>el.onchange=()=>{ const l=byId(el.dataset.leakfollow); if(l){ l.followUpDate=el.value; save(false); rerender(); } });

  // status — closing stamps closedAt and moves the row into the Closed group;
  // reopening clears it. Closed leaks are never deleted by this.
  q('[data-leakstatus]','all').forEach(el=>el.onclick=()=>{
    const [id,st]=pair(el.dataset.leakstatus); const l=byId(id); if(!l) return;
    l.status=st;
    if(st==='closed'){ l.closedAt=Date.now(); leakOpenId=null; leakClosedOpen=true; }
    else l.closedAt=null;
    save(false); rerender();
    toast(st==='closed'?'Leak closed ✓':'Status updated');
  });

  // delete (confirm) — the occurrence count is the evidence, so say what's lost
  q('[data-leakdel]','all').forEach(el=>el.onclick=()=>{
    const l=byId(el.dataset.leakdel); if(!l) return;
    const n=leakCount(l);
    if(!confirm(`Delete "${l.text}"?\n\nThis erases ${n} recorded occurrence${n===1?'':'s'} — the evidence that justifies delegating it. Closing it instead keeps the history.`)) return;
    S.leaks=(S.leaks||[]).filter(x=>x.id!==l.id);
    if(leakOpenId===l.id) leakOpenId=null;
    save(); rerender();
  });

  const cp=q('#leakClosedPanel'); if(cp) cp.onclick=()=>{ leakClosedOpen=!leakClosedOpen; rerender(); };
}
