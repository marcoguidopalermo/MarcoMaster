/* ============================================================
   PROJECTS — management only (create / rename / colour / notes /
   finish / delete / reorder). Tasks are added and worked from the
   Dashboard's flat All Tasks list, not here; this view still shows
   each project's progress (done / total) which rolls up from its
   task list in S.projects[*].tasks.
   ============================================================ */
const PROJ_COLORS=['#58a6ff','#3fb950','#e3b341','#14b8a6','#bc8cff','#f778ba','#56d4dd'];
let newProjName='';

function projectStats(p){
  const tasks=p.tasks||[];
  const total=tasks.length;
  const done=tasks.filter(t=>t.done).length;
  return {total,done,pct: total?Math.round(done/total*100):0};
}
function renderProjects(){
  const active=(S.projects||[]).filter(p=>!p.done);
  const finished=(S.projects||[]).filter(p=>p.done);
  const card=(p)=>{
    const s=projectStats(p);
    return `
    <div class="proj-card ${p.done?'fin':''}" data-pdrag="${p.id}">
      <div class="proj-bar-top">
        ${!p.done?`<span class="proj-grip" title="drag to reorder">⋮⋮</span>`:''}
        <input type="color" class="proj-color" data-pcolor="${p.id}" value="${p.color}" title="project colour">
        <input type="text" class="proj-name-in" data-pname="${p.id}" value="${esc(p.name)}">
        <span class="proj-stat" title="done / total tasks (from the Dashboard list)">${s.done}/${s.total}</span>
        <span class="proj-act" data-pdone="${p.id}" title="${p.done?'reopen':'mark finished'}">${p.done?'↩':'✓'}</span>
        <span class="x" data-pdel="${p.id}">×</span>
      </div>
      <div class="proj-track"><div class="proj-fill" style="width:${s.pct}%;background:${p.color}"></div></div>
      <textarea class="proj-note" data-pnote="${p.id}" rows="2" placeholder="Notes about ${esc(p.name)}… goals, links, context">${esc(p.note||'')}</textarea>
    </div>`;
  };
  return `
  <div class="phead">
    <div class="kicker">Things on the go</div>
    <h2>Projects</h2>
    <p>Create, rename, colour and annotate projects here. Add and work their tasks from the Dashboard's <b>All Tasks</b> list.</p>
  </div>

  <div class="proj-stack">
    ${active.length?active.map(card).join(''):'<div class="empty">No active projects. Add one below.</div>'}
  </div>

  <div class="card" style="margin-top:16px">
    <div class="proj-add">
      <input type="text" id="newProj" value="${esc(newProjName)}" placeholder="New project (e.g. CrewMaster)...">
      <button class="btn" id="addProj">Add</button>
    </div>
  </div>

  ${finished.length?`
    <div class="phead compact" style="margin-top:24px"><h2 style="font-size:18px">Finished</h2></div>
    <div class="proj-stack">${finished.map(card).join('')}</div>
  `:''}
  `;
}

function bindProjects(){
  q('[data-pname]','all').forEach(el=>el.oninput=()=>{ const p=S.projects.find(x=>x.id===el.dataset.pname); if(p){ p.name=el.value; save(); } });
  q('[data-pcolor]','all').forEach(el=>el.onchange=()=>{ const p=S.projects.find(x=>x.id===el.dataset.pcolor); if(p){ p.color=el.value; save(); rerender(); } });
  q('[data-pdone]','all').forEach(el=>el.onclick=()=>{ const p=S.projects.find(x=>x.id===el.dataset.pdone); if(p){ p.done=!p.done; save(); rerender(); } });
  q('[data-pdel]','all').forEach(el=>el.onclick=()=>{
    const p=S.projects.find(x=>x.id===el.dataset.pdel); if(!p) return;
    if(confirm(`Delete "${p.name}" and its tasks?`)){ deleteProject(p); rerender(); }
  });
  // drag-to-reorder project cards (mouse + touch) — order = priority, mirrored on
  // the dashboard (both render from S.projects). First .proj-stack = active cards.
  makeReorderable(q('.proj-stack'), '[data-pdrag]', 'pdrag', '.proj-grip', (order)=>{
    const byId=Object.fromEntries((S.projects||[]).map(p=>[p.id,p]));
    const reordered=order.map(id=>byId[id]).filter(Boolean);
    const rest=(S.projects||[]).filter(p=>!order.includes(p.id));   // finished + any others stay after
    S.projects=[...reordered,...rest];
    save(); rerender();
  });

  // per-project notes (free text) — autosave on input, no rerender so the caret stays put
  q('[data-pnote]','all').forEach(el=>el.oninput=()=>{ const p=S.projects.find(x=>x.id===el.dataset.pnote); if(p){ p.note=el.value; save(false); } });

  const np=q('#newProj'); if(np) np.oninput=()=>{ newProjName=np.value; };
  const add=q('#addProj'); if(add) add.onclick=()=>{ if(createProject(newProjName)){ newProjName=''; rerender(); } };
  const ni=q('#newProj'); if(ni) ni.onkeydown=e=>{ if(e.key==='Enter') q('#addProj').click(); };
}
/* create a project from a name; returns the new project (falsy if not created).
   Shared by the Settings tab add-input, the Dashboard inline "+" and the overlay,
   so the logic lives in one place. Callers that only need "did it work?" still
   read it as a boolean; the ones that want to open the new project's detail
   straight away use the returned object. */
function createProject(name){
  const v=(name||'').trim(); if(!v) return null;
  if(!S.projects) S.projects=[];
  const color=PROJ_COLORS[(S.projects||[]).length % PROJ_COLORS.length];
  const p={id:b(),name:v,color,done:false,tasks:[]};
  S.projects.push(p);
  save(); return p;
}
/* remove everything linked to a project across all days, so deleting it leaves
   no orphans (mirrors removeMeetingLinks for meetings):
   - time-block/calendar day-tasks created from its tasks (projectId === p.id)
   - pipeline items promoted from it, whether linked by projectId OR by taskId
     (a project task sent to Today then promoted references the day-task's id). */
function removeProjectLinks(p){
  if(!p) return;
  // ids of this project's day-tasks first, so pipeline items that reference them
  // by taskId can be cleaned even after the tasks themselves are removed
  const linkedTaskIds=new Set();
  Object.keys(S.days||{}).forEach(dk=>{
    (S.days[dk].tasks||[]).forEach(t=>{ if(t.projectId===p.id) linkedTaskIds.add(t.id); });
  });
  Object.keys(S.days||{}).forEach(dk=>{
    const d=S.days[dk];
    if(d.tasks) d.tasks=d.tasks.filter(t=>t.projectId!==p.id);
    if(d.pipeline) d.pipeline=d.pipeline.filter(it=>it.projectId!==p.id && !linkedTaskIds.has(it.taskId));
  });
}
/* delete a project: clean up its links, drop it (and its task list) from
   S.projects, and persist through the version-stamped save layer. */
function deleteProject(p){
  if(!p) return;
  removeProjectLinks(p);
  S.projects=(S.projects||[]).filter(x=>x.id!==p.id);
  save();
}

/* ============================================================
   THE PROJECTS OVERLAY — every project visible at once.
   The same .pick-screen component the fire picker, leaks, all-tasks and
   appointments already use: one host OUTSIDE .app (#projScreen), the shared
   header / group / row markup, and fitPickScreen()'s density step-down instead
   of a scrollbar. It replaces the dashboard's horizontally-scrolling strip as
   the way in — it does NOT reimplement the detail: a row opens the EXISTING
   project modal, so the detail, its handlers and its data path are unchanged.
   ============================================================ */
let projScreenOpen=false;
function openProjScreen(){ projScreenOpen=true; paintProjScreen(); }
function closeProjScreen(){ projScreenOpen=false; paintProjScreen(); rerender(); }

function projOpenCount(p){ return (p.tasks||[]).filter(t=>!t.done).length; }

/* Active / Finished is the grouping the Projects tab has always used; the overlay
   just splits Active by whether anything is actually open, which is the one
   distinction a survey surface needs to be worth opening. */
function projGroups(){
  const all=S.projects||[];
  const active=all.filter(p=>!p.done);
  return [
    {title:'In progress', color:'var(--accent)',  cls:'', items:active.filter(p=>projOpenCount(p)>0)},
    {title:'Nothing open',color:'var(--txt-dim)', cls:'', items:active.filter(p=>projOpenCount(p)===0)},
    {title:'Finished',    color:'var(--line)',    cls:'is-closed', items:all.filter(p=>p.done)},
  ].filter(g=>g.items.length);
}
/* one compact single-line row — the shared .pick-row base, plus the project's own
   swatch and progress track so it still reads as a project at a glance */
function projRowHTML(p){
  const s=projectStats(p), open=projOpenCount(p);
  return `<button class="pick-row" data-projrow="${p.id}" title="Open ${esc(p.name)}">
    <span class="proj-swatch" style="background:${p.color}"></span>
    <span class="pick-txt">${esc(p.name)}</span>
    ${open?`<span class="pick-badge">${open}</span>`:''}
    <span class="proj-track pick-track"><span class="proj-fill" style="width:${s.pct}%;background:${p.color}"></span></span>
    <span class="pick-meta">${s.done}/${s.total}</span>
  </button>`;
}
function projScreenHTML(){
  const groups=projGroups();
  const total=groups.reduce((n,g)=>n+g.items.length,0);
  const openCt=(S.projects||[]).filter(p=>!p.done).reduce((n,p)=>n+projOpenCount(p),0);
  const group=(g)=>`<section class="pick-group ${g.cls}" style="--gc:${g.color}">
      <h3 class="pick-g-title">${esc(g.title)}<span class="pick-g-ct">${g.items.length}</span></h3>
      <div class="pick-rows">${g.items.map(projRowHTML).join('')}</div>
    </section>`;
  return `<div class="pick-inner">
    <header class="pick-head">
      <div class="pick-h-txt"><h2>◈ Projects</h2>
        <p>Everything on the go, in one place. Open one to work its task list — the dashboard keeps only what's live.</p></div>
      <span class="pick-h-ct">${openCt} open task${openCt===1?'':'s'}</span>
      <button class="btn ghost sm" id="projScreenAdd">+ New project</button>
      <button class="pick-close" id="projScreenClose" title="Close">×</button>
    </header>
    ${total
      ? `<div class="pick-body">${groups.map(group).join('')}</div>`
      : `<div class="empty">No projects yet. Add one to start tracking something on the go.</div>`}
  </div>`;
}
function paintProjScreen(){
  const el=q('#projScreen'); if(!el) return;
  if(!projScreenOpen){ el.classList.remove('show'); el.innerHTML=''; document.body.classList.remove('pick-open'); return; }
  el.innerHTML=projScreenHTML();
  el.classList.add('show');
  document.body.classList.add('pick-open');
  bindProjScreen();
  fitPickScreen(el);     // re-fit: rows move between groups as tasks get ticked
}
function bindProjScreen(){
  const cl=q('#projScreenClose'); if(cl) cl.onclick=closeProjScreen;
  // A row opens the existing project modal. That modal paints ABOVE the overlay
  // (see .modal-bg's z-index) and already ends every mutation in rerender(), so
  // the dashboard behind both is current; closeReset() repaints this overlay.
  q('#projScreen [data-projrow]','all').forEach(el=>el.onclick=()=>openProjectModal(el.dataset.projrow));
  const ad=q('#projScreenAdd'); if(ad) ad.onclick=()=>{
    const v=prompt('New project name'); const p=v&&createProject(v);
    if(p){ paintProjScreen(); rerender(); openProjectModal(p.id); }   // straight into its task list
  };
}
