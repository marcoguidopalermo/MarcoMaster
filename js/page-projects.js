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
/* create a project from a name; returns true if created. Shared by the Settings
   tab add-input and the Dashboard inline "+" so the logic lives in one place. */
function createProject(name){
  const v=(name||'').trim(); if(!v) return false;
  if(!S.projects) S.projects=[];
  const color=PROJ_COLORS[(S.projects||[]).length % PROJ_COLORS.length];
  S.projects.push({id:b(),name:v,color,done:false,tasks:[]});
  save(); return true;
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
