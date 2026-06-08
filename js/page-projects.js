/* ============================================================
   PROJECTS — ongoing efforts with their own task lists.
   Add tasks inside a project; send them into Today's time-block
   bucket when you want to work them. Progress rolls up from the
   project's own task list (done / total).
   ============================================================ */
const PROJ_COLORS=['#58a6ff','#3fb950','#e3b341','#14b8a6','#bc8cff','#f778ba','#56d4dd'];
let newProjName='';
let projDraftText={};   // {projectId: in-progress new-task text}

function projectStats(p){
  const tasks=p.tasks||[];
  const total=tasks.length;
  const done=tasks.filter(t=>t.done).length;
  return {total,done,pct: total?Math.round(done/total*100):0};
}
/* is this project task already sitting in today's list? */
function projTaskInToday(projId, ptId){
  return day().tasks.some(t=>t.projectId===projId && t.projTaskId===ptId && !t.done);
}

function renderProjects(){
  const active=(S.projects||[]).filter(p=>!p.done);
  const finished=(S.projects||[]).filter(p=>p.done);
  const card=(p)=>{
    const s=projectStats(p);
    const tasks=p.tasks||[];
    return `
    <div class="proj-card ${p.done?'fin':''}" data-pdrag="${p.id}">
      <div class="proj-bar-top">
        ${!p.done?`<span class="proj-grip" title="drag to reorder">⋮⋮</span>`:''}
        <input type="color" class="proj-color" data-pcolor="${p.id}" value="${p.color}" title="project colour">
        <input type="text" class="proj-name-in" data-pname="${p.id}" value="${esc(p.name)}">
        <span class="proj-stat">${s.done}/${s.total}</span>
        <span class="proj-act" data-pdone="${p.id}" title="${p.done?'reopen':'mark finished'}">${p.done?'↩':'✓'}</span>
        <span class="x" data-pdel="${p.id}">×</span>
      </div>
      <div class="proj-track"><div class="proj-fill" style="width:${s.pct}%;background:${p.color}"></div></div>

      <div class="proj-tasks">
        ${tasks.length?tasks.map(t=>`
          <div class="ptask-row ${t.done?'done':''}">
            <span class="box" data-ptdone="${p.id}|${t.id}">✓</span>
            <span class="ptxt">${esc(t.txt)}</span>
            ${!t.done?(projTaskInToday(p.id,t.id)
              ? `<span class="in-today">in today ✓</span>`
              : `<span class="to-today" data-pttoday="${p.id}|${t.id}">→ today</span>`):''}
            <span class="x" data-ptdel="${p.id}|${t.id}">×</span>
          </div>`).join(''):'<div class="empty sm">No tasks yet.</div>'}
      </div>

      <div class="proj-add-task">
        <input type="text" data-ptadd="${p.id}" value="${esc(projDraftText[p.id]||'')}" placeholder="Add a task to ${esc(p.name)}...">
        <button class="btn sm" data-ptaddbtn="${p.id}">+</button>
      </div>
    </div>`;
  };
  return `
  <div class="phead">
    <div class="kicker">Things on the go</div>
    <h2>Projects</h2>
    <p>Add tasks to a project, then send them to Today when you're ready to work them.</p>
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

  q('[data-ptdone]','all').forEach(el=>el.onclick=()=>{
    const [pid,tid]=el.dataset.ptdone.split('|');
    const p=S.projects.find(x=>x.id===pid); const t=p&&p.tasks.find(x=>x.id===tid);
    if(t){ setProjTaskDone(pid,tid,!t.done); save(false); rerender(); }
  });
  q('[data-ptdel]','all').forEach(el=>el.onclick=()=>{
    const [pid,tid]=el.dataset.ptdel.split('|');
    const p=S.projects.find(x=>x.id===pid); if(p){ p.tasks=p.tasks.filter(x=>x.id!==tid); save(); rerender(); }
  });

  q('[data-pttoday]','all').forEach(el=>el.onclick=()=>{
    const [pid,tid]=el.dataset.pttoday.split('|');
    const p=S.projects.find(x=>x.id===pid); const t=p&&p.tasks.find(x=>x.id===tid);
    if(!t) return;
    day().tasks.push({id:b(),txt:t.txt,kind:'project',done:false,mins:60,start:null,projectId:pid,projTaskId:tid});
    save(); toast('Sent to Today'); rerender();
  });

  q('[data-ptadd]','all').forEach(el=>el.oninput=()=>{ projDraftText[el.dataset.ptadd]=el.value; });
  q('[data-ptadd]','all').forEach(el=>el.onkeydown=e=>{ if(e.key==='Enter'){ addProjTask(el.dataset.ptadd); } });
  q('[data-ptaddbtn]','all').forEach(el=>el.onclick=()=>addProjTask(el.dataset.ptaddbtn));

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
  // top-level "This Week" pipeline: strip items linked to this project too
  if(S.weeklyPipeline) S.weeklyPipeline=S.weeklyPipeline.filter(it=>it.projectId!==p.id && !linkedTaskIds.has(it.taskId));
}
/* delete a project: clean up its links, drop it (and its task list) from
   S.projects, and persist through the version-stamped save layer. */
function deleteProject(p){
  if(!p) return;
  removeProjectLinks(p);
  S.projects=(S.projects||[]).filter(x=>x.id!==p.id);
  save();
}
function addProjTask(pid){
  const p=S.projects.find(x=>x.id===pid); if(!p) return;
  const v=(projDraftText[pid]||'').trim(); if(!v) return;
  p.tasks.push({id:b(),txt:v,done:false});
  projDraftText[pid]=''; save(); rerender();
}
