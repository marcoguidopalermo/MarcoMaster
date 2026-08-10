/* ============================================================
   CONTENT — deliberately minimal. Only two things here are genuinely new:
   PILLARS (the themes you work from) and FOOTAGE LISTS (what you have to
   film). Everything else reuses what the app already has.

   No multi-stage pipeline, no scripting or outline editor, no hook database,
   no analytics, no hashtags, no scheduling, no AI. An idea has three stages
   and that is the whole model:

       Idea  →  This week  →  Posted

   Store: S.content — see seedDefaults() in state.js for the shape.
     pillars : [{id,name}]                     — names only, seeded once
     ideas   : [{id, txt, pillarId, stage, clips:[{id,txt,done}], postedAt}]
     floor   : the weekly posting FLOOR (set in Settings → Weekly floors)

   THE MASTER FOOTAGE LIST IS DERIVED, NEVER STORED (see masterFootage). It is
   recomputed from the "This week" ideas on every render, so there is no second
   copy to drift, no sync step, and nothing extra to migrate.

   Working on content is an ordinary task: an idea's "＋ Task" action calls the
   normal addTask(), so it lands in All Tasks, the fire picker, the pipeline and
   Completed Today like anything else. There is no content-work surface here.
   ============================================================ */

const CONTENT_STAGES=[['idea','Ideas'],['week','This week'],['posted','Posted']];

/* ---------- accessors ---------- */
function contentPillars(){ return (S.content&&S.content.pillars)||[]; }
function contentIdeas(){ return (S.content&&S.content.ideas)||[]; }
function contentFloor(){ const f=+((S.content||{}).floor); return f>=1?f:3; }
function pillarById(id){ return contentPillars().find(p=>p.id===id)||null; }
function ideaById(id){ return contentIdeas().find(i=>i.id===id)||null; }
function ideasInStage(st){ return contentIdeas().filter(i=>i.stage===st); }

/* ---------- ideas ----------
   createContentIdea is the SINGLE writer, shared by the Content tab's add row and
   by unified capture (capture.js), so an idea has exactly one shape and one path
   into the store no matter where it was typed. */
function createContentIdea(txt){
  const v=(txt||'').trim(); if(!v) return null;
  if(!S.content.ideas) S.content.ideas=[];
  const it={ id:b(), txt:v, pillarId:null, stage:'idea', clips:[], createdAt:Date.now(), postedAt:null };
  S.content.ideas.push(it);
  save();
  return it;
}
/* One tap between stages. Posting stamps the DAY (like doneAt everywhere else), so
   weekly evidence can count it; moving back out clears the stamp. */
function setIdeaStage(id, stage){
  const it=ideaById(id); if(!it) return;
  it.stage=stage;
  it.postedAt = (stage==='posted') ? todayKey() : null;
  save();
}
function deleteIdea(id){
  S.content.ideas=contentIdeas().filter(i=>i.id!==id);
  save();
}

/* ============================================================
   FOOTAGE — the per-idea checklist, and the derived MASTER list.

   Dedupe is exact-match on a normalised key, deliberately NOT fuzzy. The leaks
   module can afford fuzzy matching because it ASKS before merging two things; a
   footage list that silently merged "gym" with "gym mirror shot" would send you
   out of the house having filmed the wrong thing. Predictable beats clever here.
   ============================================================ */
function clipKey(txt){
  return String(txt??'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
}
function addIdeaClip(ideaId, txt){
  const it=ideaById(ideaId); const v=(txt||'').trim();
  if(!it || !v) return false;
  if(!Array.isArray(it.clips)) it.clips=[];
  it.clips.push({id:b(), txt:v, done:false});
  save();
  return true;
}
function deleteIdeaClip(ideaId, clipId){
  const it=ideaById(ideaId); if(!it) return;
  it.clips=(it.clips||[]).filter(c=>c.id!==clipId);
  save();
}
/* THE single writer for a clip's ticked state, whether one clip inside an idea or
   every clip behind a master row. That's what makes ticking two-way: the idea's
   checklist, the master list and the dashboard card all read the same clips. */
function setClipDone(refs, done){
  (refs||[]).forEach(r=>{
    const it=ideaById(r.ideaId); if(!it) return;
    const c=(it.clips||[]).find(x=>x.id===r.clipId); if(!c) return;
    c.done=!!done;
  });
  save(false);
}
/* The combined, deduplicated set of clips needed across every "This week" idea.
   Each row carries the refs behind it, so ticking the row ticks the clip wherever
   it appears. A row is done only when EVERY ref is done — one physical clip
   satisfies every idea that needed it — and rows with refs that disagree show a
   quiet count rather than silently rounding either way. */
function masterFootage(){
  const rows=[], byKey={};
  ideasInStage('week').forEach(it=>{
    (it.clips||[]).forEach(c=>{
      const k=clipKey(c.txt); if(!k) return;
      let r=byKey[k];
      if(!r){ r=byKey[k]={ key:k, txt:c.txt, refs:[], doneCt:0, total:0, ideas:[] }; rows.push(r); }
      r.refs.push({ideaId:it.id, clipId:c.id});
      r.total++; if(c.done) r.doneCt++;
      if(r.ideas.indexOf(it.txt)<0) r.ideas.push(it.txt);
    });
  });
  rows.forEach(r=>{ r.done = r.total>0 && r.doneCt===r.total; });
  // outstanding first, then alphabetical — a stable order you can glance down
  rows.sort((a,b)=>((a.done?1:0)-(b.done?1:0)) || a.key.localeCompare(b.key));
  return rows;
}
function masterOutstanding(){ return masterFootage().filter(r=>!r.done); }
/* Re-derive the row at click time rather than trusting refs baked into the DOM —
   the underlying ideas may have changed since the surface was painted. */
function toggleMasterClip(key){
  const r=masterFootage().find(x=>x.key===key); if(!r) return;
  setClipDone(r.refs, !r.done);
}

/* ============================================================
   WEEKLY EVIDENCE — posted this week against the floor. Same shared phrasing as
   training (floorEvidenceLine in ui-core.js): a floor met, never a target missed.
   ============================================================ */
function contentWeekStats(){
  const wk=weekStartKey(todayKey());
  const posted=contentIdeas().filter(i=>i.stage==='posted' && i.postedAt && weekStartKey(i.postedAt)===wk);
  return { floor:contentFloor(), done:posted.length, posted };
}
function contentEvidenceLine(){ const st=contentWeekStats(); return floorEvidenceLine(st.done, st.floor); }
function contentEvidenceClass(){ const st=contentWeekStats(); return floorEvidenceClass(st.done, st.floor); }

/* ============================================================
   THE CONTENT TAB
   ============================================================ */
let contentOpen={};            // {ideaId:true} = its footage checklist is expanded
let contentPostedOpen=false;   // the Posted history (collapsed by default)
let newIdeaText='';
let newPillarName='';
let clipDraft={};              // {ideaId: in-progress new clip text}

function renderContent(){
  return `
  <div class="phead compact">
    <div class="kicker">Themes · ideas · what to film</div>
    <h2>Content</h2>
  </div>

  ${renderContentEvidence()}
  ${renderPillars()}
  ${renderMasterFootage()}
  ${renderIdeaStages()}
  `;
}

function renderContentEvidence(){
  const st=contentWeekStats();
  return `
  <div class="card">
    <div class="card-h"><h3>This week</h3><span class="sub">posted</span></div>
    <div class="train-ev ${contentEvidenceClass()}">${esc(contentEvidenceLine())}</div>
    <p class="list-note" style="margin-top:8px">Your floor is ${st.floor} post${st.floor===1?'':'s'} a week — set it in Settings → Weekly floors. Anything past it is a bonus.</p>
  </div>`;
}

/* ---------- PILLARS — the themes, kept visible so you never start from nothing ---------- */
function renderPillars(){
  const ps=contentPillars();
  return `
  <div class="card">
    <div class="card-h"><h3>Pillars</h3><span class="sub">${ps.length}</span></div>
    <div class="cp-list">
      ${ps.length?ps.map(p=>`
        <div class="cp-row">
          <input type="text" class="cp-name" data-cpname="${p.id}" value="${esc(p.name)}">
          <span class="x" data-cpdel="${p.id}" title="Delete pillar">×</span>
        </div>`).join(''):'<div class="empty sm">No pillars yet — add the themes you work from.</div>'}
    </div>
    <div class="mini-add">
      <input type="text" id="newPillar" value="${esc(newPillarName)}" placeholder="Add a pillar…">
      <button class="btn sm" id="addPillar">+</button>
    </div>
  </div>`;
}

/* ---------- MASTER FOOTAGE — one glance before you leave the house ---------- */
function renderMasterFootage(){
  const rows=masterFootage();
  const out=rows.filter(r=>!r.done).length;
  return `
  <div class="card cf-card">
    <div class="card-h"><h3>🎬 Master footage list</h3>
      <span class="sub">${rows.length?`${out} outstanding · ${rows.length} total`:'nothing needed'}</span></div>
    ${rows.length
      ? `<div class="cf-list">${rows.map(masterRowHTML).join('')}</div>
         <p class="list-note" style="margin-top:10px">Everything the <b>This week</b> ideas need, combined and deduplicated. Ticking one here ticks it on every idea that needed it.</p>`
      : `<div class="empty sm">Nothing to film. Add clips to a “This week” idea and they gather here.</div>`}
  </div>`;
}
function masterRowHTML(r){
  const partial = !r.done && r.doneCt>0;
  return `
  <div class="cf-row ${r.done?'done':''}">
    <span class="box" data-cfmaster="${esc(r.key)}" title="${r.done?'Mark not captured':'Mark captured'}">✓</span>
    <span class="cf-txt">${esc(r.txt)}</span>
    ${r.total>1?`<span class="cf-ct ${partial?'partial':''}" title="${esc(r.ideas.join(' · '))}">${partial?`${r.doneCt}/${r.total}`:`${r.total} ideas`}</span>`:''}
  </div>`;
}

/* ---------- THE THREE STAGES ---------- */
function renderIdeaStages(){
  const idea=ideasInStage('idea'), week=ideasInStage('week'), posted=ideasInStage('posted');
  // newest posted first; the rest keep the order you put them in
  const postedSorted=posted.slice().sort((a,b)=>String(b.postedAt||'').localeCompare(String(a.postedAt||'')));
  return `
  <div class="card">
    <div class="card-h"><h3>Ideas</h3><span class="sub">${idea.length} idea${idea.length===1?'':'s'} · ${week.length} this week</span></div>

    <div class="ci-add">
      <input type="text" id="newIdea" value="${esc(newIdeaText)}" placeholder="Capture a content idea…">
      <button class="btn sm" id="addIdea">+</button>
    </div>

    <div class="ci-section">
      <div class="ci-sec-h"><span class="ci-sec-lab">This week</span><span class="ci-sec-ct">${week.length}</span></div>
      ${week.length?`<div class="ci-rows">${week.map(ideaRowHTML).join('')}</div>`
        :`<div class="empty sm">Nothing active. Move 3–5 ideas here — those are the ones whose footage gathers into the master list.</div>`}
    </div>

    <div class="ci-section">
      <div class="ci-sec-h"><span class="ci-sec-lab">Ideas</span><span class="ci-sec-ct">${idea.length}</span></div>
      ${idea.length?`<div class="ci-rows">${idea.map(ideaRowHTML).join('')}</div>`
        :`<div class="empty sm">No loose ideas. Capture one above, or from the Dashboard capture line.</div>`}
    </div>

    <div class="ci-section">
      <div class="ci-sec-h arch-h" data-cipostedtoggle>
        <span class="ci-sec-lab">${contentPostedOpen?'▾':'▸'} Posted</span>
        <span class="ci-sec-ct">${posted.length}</span>
      </div>
      ${contentPostedOpen?`<div class="ci-rows">${postedSorted.length?postedSorted.map(ideaRowHTML).join(''):'<div class="empty sm">Nothing posted yet.</div>'}</div>`:''}
    </div>
  </div>`;
}

function ideaRowHTML(it){
  const p=it.pillarId?pillarById(it.pillarId):null;
  const clips=it.clips||[];
  const doneCt=clips.filter(c=>c.done).length;
  const open=!!contentOpen[it.id];
  // one tap per move, in the direction that matters for this stage
  let moves='';
  if(it.stage==='idea')   moves=`<button class="ci-move" data-cistage="${it.id}|week" title="Move to This week">→ This week</button>`;
  if(it.stage==='week')   moves=`<button class="ci-move" data-cistage="${it.id}|posted" title="Mark posted">→ Posted</button>
                                 <button class="ci-move ghost" data-cistage="${it.id}|idea" title="Back to Ideas">↩</button>`;
  if(it.stage==='posted') moves=`<button class="ci-move ghost" data-cistage="${it.id}|week" title="Back to This week">↩</button>`;
  return `
  <div class="ci-row-wrap">
    <div class="ci-row ${it.stage==='posted'?'posted':''}">
      <span class="ci-exp" data-ciexp="${it.id}" title="${open?'Collapse':'Footage + pillar'}">${open?'▾':'▸'}</span>
      <span class="ci-txt">${esc(it.txt)}</span>
      ${p?`<span class="cp-chip">${esc(p.name)}</span>`:''}
      ${clips.length?`<span class="ci-clipct ${doneCt===clips.length?'all':''}">🎬 ${doneCt}/${clips.length}</span>`:''}
      ${it.stage==='posted'&&it.postedAt?`<span class="ci-when">${shortDate(it.postedAt)}</span>`:''}
      <span class="ci-acts">${moves}</span>
      <span class="ci-act" data-citask="${it.id}" title="Add it to your tasks — then fire on it like anything else">＋ Task</span>
      <span class="ci-act" data-ciedit="${it.id}" title="Edit text">✎</span>
      <span class="x" data-cidel="${it.id}" title="Delete idea">×</span>
    </div>
    ${open?ideaPanelHTML(it):''}
  </div>`;
}
/* the expanded panel: pillar picker + this idea's footage checklist */
function ideaPanelHTML(it){
  const clips=it.clips||[];
  return `
  <div class="ci-panel">
    <div class="ci-panel-lbl">Pillar</div>
    <div class="cp-chips">
      ${contentPillars().map(p=>`<button class="train-chip ${it.pillarId===p.id?'on':''}" data-cipillar="${it.id}|${p.id}">${esc(p.name)}</button>`).join('')}
      ${contentPillars().length?'':'<span class="empty sm">No pillars yet — add one above.</span>'}
    </div>

    <div class="ci-panel-lbl">Footage this idea needs<span class="ci-panel-ct">${clips.filter(c=>c.done).length}/${clips.length}</span></div>
    <div class="cf-list">
      ${clips.length?clips.map(c=>`
        <div class="cf-row ${c.done?'done':''}">
          <span class="box" data-ciclip="${it.id}|${c.id}" title="${c.done?'Mark not captured':'Mark captured'}">✓</span>
          <span class="cf-txt">${esc(c.txt)}</span>
          <span class="x" data-ciclipdel="${it.id}|${c.id}" title="Remove clip">×</span>
        </div>`).join(''):'<div class="empty sm">No clips listed. What do you need to film for this?</div>'}
    </div>
    <div class="mini-add">
      <input type="text" data-ciclipadd="${it.id}" value="${esc(clipDraft[it.id]||'')}" placeholder="Add a clip — laptop work, gym, job site…">
      <button class="btn sm" data-ciclipaddbtn="${it.id}">+</button>
    </div>
  </div>`;
}

function bindContent(){
  const pair=(v)=>{ const i=String(v).indexOf('|'); return [String(v).slice(0,i), String(v).slice(i+1)]; };

  // ---- pillars: rename saves without a re-render so the caret never jumps ----
  q('[data-cpname]','all').forEach(el=>el.oninput=()=>{ const p=pillarById(el.dataset.cpname); if(p){ p.name=el.value; save(); } });
  q('[data-cpdel]','all').forEach(el=>el.onclick=()=>{
    const p=pillarById(el.dataset.cpdel); if(!p) return;
    const used=contentIdeas().filter(i=>i.pillarId===p.id).length;
    if(!confirm(`Delete the pillar "${p.name}"?${used?`\n\n${used} idea${used===1?'':'s'} will simply lose the label — nothing else changes.`:''}`)) return;
    // clear the reference rather than leaving a dangling id behind
    contentIdeas().forEach(i=>{ if(i.pillarId===p.id) i.pillarId=null; });
    S.content.pillars=contentPillars().filter(x=>x.id!==p.id);
    save(); rerender();
  });
  const np=q('#newPillar'); if(np) np.oninput=()=>{ newPillarName=np.value; };
  const addP=()=>{
    const v=(newPillarName||'').trim(); if(!v) return;
    if(!S.content.pillars) S.content.pillars=[];
    S.content.pillars.push({id:b(), name:v});
    newPillarName=''; save(); rerender();
  };
  const ap=q('#addPillar'); if(ap) ap.onclick=addP;
  if(np) np.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); addP(); } };

  // ---- ideas ----
  const ni=q('#newIdea'); if(ni) ni.oninput=()=>{ newIdeaText=ni.value; };
  const addI=()=>{ if(!createContentIdea(newIdeaText)) return; newIdeaText=''; rerender(); };
  const ai=q('#addIdea'); if(ai) ai.onclick=addI;
  if(ni) ni.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); addI(); } };

  q('[data-ciexp]','all').forEach(el=>el.onclick=()=>{ const id=el.dataset.ciexp; contentOpen[id]=!contentOpen[id]; rerender(); });
  q('[data-cistage]','all').forEach(el=>el.onclick=()=>{
    const [id,st]=pair(el.dataset.cistage);
    setIdeaStage(id, st); rerender();
    toast(st==='posted'?'Posted ✓':(st==='week'?'Moved to This week':'Back to Ideas'));
  });
  q('[data-ciedit]','all').forEach(el=>el.onclick=()=>{
    const it=ideaById(el.dataset.ciedit); if(!it) return;
    const v=prompt('Edit idea', it.txt); if(v==null) return;
    const nv=v.trim(); if(!nv) return;
    it.txt=nv; save(); rerender();
  });
  q('[data-cidel]','all').forEach(el=>el.onclick=()=>{
    const it=ideaById(el.dataset.cidel); if(!it) return;
    const n=(it.clips||[]).length;
    if(!confirm(`Delete "${it.txt}"?${n?`\n\nIts ${n} clip${n===1?'':'s'} go with it.`:''}`)) return;
    deleteIdea(it.id); rerender();
  });
  // "＋ Task" — the ordinary task path, nothing content-specific. It then shows up
  // in All Tasks, the fire picker, the pipeline and Completed Today like anything else.
  q('[data-citask]','all').forEach(el=>el.onclick=()=>{
    const it=ideaById(el.dataset.citask); if(!it) return;
    addTask(it.txt,'quick',2);
    toast('Added to your tasks'); rerender();
  });
  // assign / clear a pillar (tapping the one already set clears it)
  q('[data-cipillar]','all').forEach(el=>el.onclick=()=>{
    const [iid,pid]=pair(el.dataset.cipillar);
    const it=ideaById(iid); if(!it) return;
    it.pillarId = (it.pillarId===pid) ? null : pid;
    save(); rerender();
  });

  // ---- per-idea clips ----
  q('[data-ciclip]','all').forEach(el=>el.onclick=()=>{
    const [iid,cid]=pair(el.dataset.ciclip);
    const it=ideaById(iid); const c=it&&(it.clips||[]).find(x=>x.id===cid); if(!c) return;
    setClipDone([{ideaId:iid, clipId:cid}], !c.done);
    rerender();
  });
  q('[data-ciclipdel]','all').forEach(el=>el.onclick=()=>{
    const [iid,cid]=pair(el.dataset.ciclipdel);
    deleteIdeaClip(iid,cid); rerender();
  });
  q('[data-ciclipadd]','all').forEach(el=>el.oninput=()=>{ clipDraft[el.dataset.ciclipadd]=el.value; });
  q('[data-ciclipadd]','all').forEach(el=>el.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); addClipFrom(el.dataset.ciclipadd); } });
  q('[data-ciclipaddbtn]','all').forEach(el=>el.onclick=()=>addClipFrom(el.dataset.ciclipaddbtn));

  const pt=q('[data-cipostedtoggle]'); if(pt) pt.onclick=()=>{ contentPostedOpen=!contentPostedOpen; rerender(); };

  bindMasterFootage();
}
function addClipFrom(ideaId){
  if(!addIdeaClip(ideaId, clipDraft[ideaId])) return;
  clipDraft[ideaId]=''; rerender();
}
/* shared by the Content tab and the dashboard card — one handler, one behaviour */
function bindMasterFootage(){
  q('[data-cfmaster]','all').forEach(el=>el.onclick=()=>{ toggleMasterClip(el.dataset.cfmaster); rerender(); });
}

/* ============================================================
   DASHBOARD — the master footage list, and only when something is outstanding.
   This is the one part of the module worth seeing during the day: what to film
   before you're back home. Renders '' otherwise, like the Today strip does.
   ============================================================ */
function renderContentFootage(){
  const out=masterOutstanding();
  if(!out.length) return '';
  return `
  <div class="card cf-card dash-footage">
    <div class="card-h"><h3>🎬 Footage to get</h3><span class="ch-actions"><span class="sub">${out.length} outstanding</span></span></div>
    <div class="cf-list">${out.map(masterRowHTML).join('')}</div>
  </div>`;
}
function bindContentFootage(){ bindMasterFootage(); }
