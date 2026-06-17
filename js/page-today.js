/* ============================================================
   PAGE RENDERERS
   ============================================================ */
const RESET_STEPS = [
  ['schedule',"Review today's schedule"],
  ['state',"Check sleep, energy, mood, allergies / stress"],
  ['biz',"Choose today's #1 business outcome"],
  ['health',"Choose today's #1 health action"],
  ['lev',"Choose today's #1 systems / leverage action"],
  ['content',"Choose today's #1 content / personal brand action"],
  ['not',"Choose one thing I am intentionally NOT working on"],
  ['workout',"Confirm workout time"],
  ['shutdown',"Confirm shutdown time"],
];

/* draft for the throughout-day energy/mood logger */
let ciDraft={energy:'Medium',mood:''};

/* which collapsible panels are open on Today (reset each load = all closed) */
let todayOpen={reset:false,wins:false,mood:false};

/* ============================================================
   DASHBOARD — execution. Compact, card-based, fits one screen.
   Pipeline on top, then a grid of compact (scrollable) cards, a
   horizontal project strip, and a collapsible day-view Time Blocker.
   ============================================================ */
let dashPlanExpanded=false;   // Time Blocker: false = compact day view, true = full plan

function renderDashboard(){
  return `
  <div class="phead compact">
    <div class="kicker">${prettyDate()}</div>
    <h2>Dashboard</h2>
  </div>

  ${renderTodayAppointments()}

  ${renderPipeline()}

  ${renderCompletedToday()}

  ${renderAllTasks()}

  ${renderWeeklyGoals()}

  ${renderMonthlyGoals()}

  ${renderAppointments()}

  <div class="dash-grid">
    <div class="dash-col">
      ${renderFollowups()}
    </div>
    <div class="dash-col">
      ${renderThinkAbout()}
    </div>
  </div>

  ${renderActiveProjects()}

  ${renderDashMeetings()}

  <div class="card dash-plan-card">
    <div class="card-h">
      <h3>Time Blocker</h3>
      <button class="btn ghost sm" id="planExpand">${dashPlanExpanded?'▾ Collapse':'⤢ Expand'}</button>
    </div>
    <div id="dash-plan">${dashPlanExpanded?renderPlan():renderDayView()}</div>
  </div>
  `;
}

/* THINGS TO THINK ABOUT — reuses the Parking Lot data */
function renderThinkAbout(){
  const p=(S.board&&S.board.parking)||[];
  return `
  <div class="card">
    <div class="card-h"><h3>Things to think about</h3><span class="sub">${p.length}</span></div>
    <div class="think-list">
      ${p.length?p.map(it=>`<div class="think-row"><span>${esc(it.txt)}</span><span class="x" data-thinkdel="${it.id}">×</span></div>`).join(''):'<div class="empty sm">Nothing parked.</div>'}
    </div>
    <div class="mini-add"><input type="text" id="thinkInput" placeholder="Park a thought to revisit later…"><button class="btn sm" id="thinkAdd">+</button></div>
  </div>`;
}

/* ---------- THE PIPELINE — today's top 3, the dominant element ---------- */
let pipelineAdding=false;   // true while typing into an empty slot

/* live done-state of a pipeline item: follow the linked task if any, else the item flag */
function pipelineDone(it){
  if(it.taskId){ const t=day().tasks.find(x=>x.id===it.taskId); return t?t.done:!!it.done; }
  if(it.projectId){ const p=(S.projects||[]).find(x=>x.id===it.projectId); const t=p&&p.tasks.find(x=>x.id===it.projTaskId); return t?t.done:!!it.done; }
  return !!it.done;
}
function renderPipeline(){
  const d=day(); const pipe=d.pipeline||[];
  let slots='';
  for(let i=0;i<3;i++){
    const it=pipe[i];
    if(it){
      const done=pipelineDone(it);
      slots+=`
      <div class="pl-slot filled ${done?'done':''}">
        <span class="pl-num">${i+1}</span>
        <span class="pl-check" data-plcheck="${i}">✓</span>
        <span class="pl-txt">${esc(it.txt)}</span>
        <span class="pl-x" data-plremove="${i}" title="Remove">×</span>
      </div>`;
    }else if(i===pipe.length && pipelineAdding){
      slots+=`
      <div class="pl-slot add">
        <span class="pl-num">${i+1}</span>
        <input type="text" id="plInput" placeholder="Type a focus, then Enter">
      </div>`;
    }else if(i===pipe.length){
      slots+=`
      <div class="pl-slot empty add-prompt" data-pladd>
        <span class="pl-num">${i+1}</span>
        <span class="pl-add-lbl">+ pick your focus</span>
      </div>`;
    }else{
      slots+=`<div class="pl-slot empty"><span class="pl-num">${i+1}</span><span class="pl-empty-lbl">—</span></div>`;
    }
  }
  const allDone = pipe.length===3 && pipe.every(pipelineDone);
  return `
  <div class="pipeline-card">
    <div class="pipeline-head">
      <span class="pl-kick">The Pipeline</span>
      <span class="pl-sub">your 3 for today · unfinished roll over</span>
    </div>
    <div class="pipeline-slots">${slots}</div>
    ${allDone?`<button class="btn pl-refill" id="plRefill">✓ All 3 done — clear &amp; pick 3 more</button>`:''}
  </div>`;
}
/* clear the completed pipeline items so the slots reopen for the next 3 */
function clearDonePipeline(){
  const d=day(); if(!d.pipeline) return;
  d.pipeline = d.pipeline.filter(it=>!pipelineDone(it));
  save(); toast('Pipeline cleared — pick 3 more'); rerender();
}
/* promote a today task / project task into the next open pipeline slot */
function promoteTaskToPipeline(taskId){
  const d=day(); if(!d.pipeline) d.pipeline=[];
  if(d.pipeline.length>=3){ toast('Pipeline is full (3)'); return; }
  if(d.pipeline.some(it=>it.taskId===taskId)){ toast('Already in pipeline'); return; }
  const t=d.tasks.find(x=>x.id===taskId); if(!t) return;
  d.pipeline.push({id:b(), txt:t.txt, taskId:t.id, done:t.done});
  save(); toast('↑ Pipeline'); rerender();
}
function promoteProjToPipeline(pid, ptId){
  const d=day(); if(!d.pipeline) d.pipeline=[];
  if(d.pipeline.length>=3){ toast('Pipeline is full (3)'); return; }
  if(d.pipeline.some(it=>it.projectId===pid && it.projTaskId===ptId)){ toast('Already in pipeline'); return; }
  const p=(S.projects||[]).find(x=>x.id===pid); const t=p&&p.tasks.find(x=>x.id===ptId); if(!t) return;
  d.pipeline.push({id:b(), txt:t.txt, projectId:pid, projTaskId:ptId, done:t.done});
  save(); toast('↑ Pipeline'); rerender();
}
function addPipelineText(v){
  v=(v||'').trim(); pipelineAdding=false;
  const d=day(); if(!d.pipeline) d.pipeline=[];
  if(v && d.pipeline.length<3) d.pipeline.push({id:b(), txt:v, done:false});
  save(); rerender();
}
function togglePipeline(idx){
  const d=day(); const it=d.pipeline[idx]; if(!it) return;
  const nd=!pipelineDone(it);
  if(it.taskId){
    const t=d.tasks.find(x=>x.id===it.taskId);
    if(t){ t.done=nd; if(t.projectId&&t.projTaskId) setProjTaskDone(t.projectId,t.projTaskId,nd); if(nd&&t.recurringId) markRecurringDone(t.recurringId); }
  }else if(it.projectId){
    setProjTaskDone(it.projectId, it.projTaskId, nd);
  }
  it.done=nd;
  save(false); rerender();
}
function bindPipeline(){
  q('[data-plcheck]','all').forEach(el=>el.onclick=()=>togglePipeline(+el.dataset.plcheck));
  q('[data-plremove]','all').forEach(el=>el.onclick=()=>{ day().pipeline.splice(+el.dataset.plremove,1); save(); rerender(); });
  q('[data-pladd]','all').forEach(el=>el.onclick=()=>{ pipelineAdding=true; rerender(); setTimeout(()=>{ const i=q('#plInput'); if(i) i.focus(); },0); });
  const pin=q('#plInput'); if(pin){
    pin.onkeydown=e=>{
      if(e.key==='Enter'){ pin.onblur=null; addPipelineText(pin.value); }
      else if(e.key==='Escape'){ pin.onblur=null; pipelineAdding=false; rerender(); }
    };
    pin.onblur=()=>{ pin.onblur=null; if(pin.value.trim()) addPipelineText(pin.value); else { pipelineAdding=false; rerender(); } };
  }
  const rf=q('#plRefill'); if(rf) rf.onclick=clearDonePipeline;
}

/* ============================================================
   ALL TASKS — the single, flat task list on the Dashboard.
   DISPLAY-ONLY unification of every task source, plus the one add row.
   No per-project dropdowns, no second inbox: this card is the only place
   tasks are seen and added.

   Two flat sections, each row self-labelled:
     • ⚡ Quick      — kind==='quick' tasks (standalone day-tasks + project
                       tasks the user marked Quick).
     • ▣ Scheduled   — kind==='project' tasks (standalone time-blocks +
                       project tasks needing / having a calendar slot).
   Project tasks live in S.projects[*].tasks (labelled with the project
   dot+name); standalone tasks live in day().tasks (labelled Quick /
   Scheduled). A scheduled project task is surfaced through its project
   row — its linked day().task block (projectId set) is excluded so each
   task appears exactly once. Carry-over is untouched (reads live). */

/* Build the two flat, de-duplicated sections. Each row carries a `key`
   ("P|projId|taskId" for a project task, "S|taskId" for a standalone
   day-task) so the bind handlers can dispatch uniformly. */
let showAllSched=false;   // ▣ Scheduled focus: false = today + overdue only; true = full backlog. In-memory, OFF each load.
let archiveOpen=false;    // Archive dropdown (default collapsed)
function buildTaskRows(){
  const tk=todayKey();
  const rows=[];
  // project tasks (active projects) — the canonical list
  (S.projects||[]).filter(p=>!p.done).forEach(p=>{
    (p.tasks||[]).forEach(t=>{
      const kind=t.kind||'project';          // legacy project tasks default to time-block
      const row={key:'P|'+p.id+'|'+t.id, source:'project', projId:p.id, id:t.id,
                 txt:t.txt, done:t.done, kind, recurringId:null,
                 projName:p.name, projColor:p.color};
      if(kind==='project'){
        const st=projTaskState(p.id,t); const tb=st.tb||null;
        row.scheduled=st.state==='scheduled';
        row.schedDate=tb?tb.schedDate:null; row.start=tb?tb.start:null;
        row.mins=tb?tb.mins:(t.mins!=null?t.mins:null);
        row.overdue=row.schedDate!=null && row.schedDate<tk && !t.done;
      }
      rows.push(row);
    });
  });
  // standalone day-tasks — exclude project-linked blocks (surfaced via their
  // project) and meeting blocks (live on the calendar grid)
  day().tasks.filter(t=>!t.projectId && !t.meetingId).forEach(t=>{
    const row={key:'S|'+t.id, source:'standalone', id:t.id, txt:t.txt, done:t.done,
               kind:t.kind, recurringId:t.recurringId, projName:null, projColor:null};
    if(t.kind==='project'){
      row.scheduled=t.schedDate!=null; row.schedDate=t.schedDate; row.start=t.start;
      row.mins=t.mins; row.overdue=t.schedDate!=null && t.schedDate<tk && !t.done;
    }
    rows.push(row);
  });
  return { quick: rows.filter(r=>r.kind==='quick'), scheduled: rows.filter(r=>r.kind==='project') };
}
function renderAllTasks(){
  const {quick,scheduled}=buildTaskRows();
  const tk=todayKey();
  const quickActive=quick.filter(r=>!r.done);
  const schedActive=scheduled.filter(r=>!r.done);
  // DEFAULT FOCUS: hide the PROJECT backlog (unscheduled / future project tasks).
  // Keep what's relevant now — anything scheduled today or overdue, plus today's
  // standalone working set (freshly added, carried-over, recurring time-blocks).
  const isBacklog=r=>r.source==='project' && !(r.schedDate!=null && r.schedDate<=tk);
  const schedFocused=schedActive.filter(r=>!isBacklog(r));
  const hidden=schedActive.length - schedFocused.length;   // = project-backlog count
  const schedShow=showAllSched?schedActive:schedFocused;
  const openCt=quickActive.length + schedActive.length;
  const overdueCt=schedActive.filter(r=>r.overdue).length;
  const archiveAll=completedRows('all');
  const active=(S.projects||[]).filter(p=>!p.done);
  return `
  <div class="card all-tasks" style="border-top:3px solid var(--accent)">
    <div class="card-h">
      <h3>All Tasks</h3>
      <span class="sub">${openCt} open${overdueCt?` · <span class="at-overdue-ct">${overdueCt} overdue</span>`:''}</span>
    </div>

    <div class="task-add">
      <input type="text" id="taskInput" placeholder="Add a task…">
      <div class="kind-pick" id="kindPick">
        <button data-kind="quick" class="${taskDraft.kind==='quick'?'active':''}">⚡ Quick</button>
        <button data-kind="project" class="${taskDraft.kind==='project'?'active':''}">▣ Time block</button>
      </div>
      <select id="taskProjPick" class="proj-pick" title="Assign to a project (optional)">
        <option value="">— No project —</option>
        ${active.map(p=>`<option value="${p.id}" ${taskDraft.projectId===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}
      </select>
      <button class="btn" id="taskAddBtn">Add</button>
    </div>
    ${taskDraft.kind==='project'?`
    <div class="dur-pick" id="durPick">
      <span class="dur-lab">Duration:</span>
      ${DURATION_PRESETS.map(m=>`<button class="dur-btn ${taskDraft.mins===m?'sel':''}" data-dur="${m}">${fmtDuration(m)}</button>`).join('')}
      <button class="dur-btn ${!DURATION_PRESETS.includes(taskDraft.mins)&&!taskDraft.customOpen?'sel':''}" id="durCustom">${!DURATION_PRESETS.includes(taskDraft.mins)?fmtDuration(taskDraft.mins):'custom'}</button>
      ${taskDraft.customOpen?`<span class="dur-custom-wrap"><input type="number" min="1" max="600" id="durCustomInput" value="${!DURATION_PRESETS.includes(taskDraft.mins)?taskDraft.mins:''}" placeholder="min" class="num-in"><span class="dur-lab">min</span></span>`:''}
    </div>`:''}

    ${renderTaskSection('⚡ Quick', quickActive, 'Nothing quick — add one above.')}

    <div class="at-section">
      <div class="at-sec-h">
        <span class="at-sec-lab">▣ Scheduled</span>
        <span class="at-sec-actions">
          <span class="at-sec-ct">${showAllSched?schedShow.length+' shown':schedShow.length+' today/overdue'}</span>
          ${(hidden>0||showAllSched)?`<button class="btn ghost sm" id="schedToggle">${showAllSched?'▾ Focus to today':'▸ See all project tasks ('+hidden+')'}</button>`:''}
        </span>
      </div>
      ${schedShow.length?`<div class="at-rows">${schedShow.map(renderTaskRow).join('')}</div>`
        :`<div class="empty sm">${showAllSched?'No project tasks yet — add one above.':'Nothing scheduled for today.'+(hidden>0?` ${hidden} in backlog — “See all project tasks”.`:'')}</div>`}
    </div>

    ${renderArchiveSection(archiveAll)}
  </div>`;
}
/* Completed Today renders as its own block high on the Dashboard (below the
   Pipeline, above All Tasks). Same data + row behaviour; '' when empty. Its
   rows reuse the data-atcheck / data-atdel handlers bound by bindAllTasks. */
function renderCompletedToday(){
  const rows=completedRows('today');
  if(!rows.length) return '';
  return `<div class="card completed-today-card">${renderCompletedSection('✓ Completed Today', rows)}</div>`;
}
function renderTaskSection(title, rows, emptyMsg){
  const openCt=rows.filter(r=>!r.done).length;
  return `
  <div class="at-section">
    <div class="at-sec-h"><span class="at-sec-lab">${title}</span><span class="at-sec-ct">${openCt} open</span></div>
    ${rows.length?`<div class="at-rows">${rows.map(renderTaskRow).join('')}</div>`:`<div class="empty sm">${emptyMsg}</div>`}
  </div>`;
}
/* the inline label on each flat row: project dot+name, or a Quick/Scheduled chip */
function taskLabelChip(r){
  if(r.source==='project') return `<span class="proj-chip" style="--pc:${r.projColor}">${esc(r.projName)}</span>`;
  return `<span class="type-chip ${r.kind==='quick'?'q':'s'}">${r.kind==='quick'?'⚡ Quick':'▣ Scheduled'}</span>`;
}
function renderTaskRow(r){
  let tag='';
  if(r.kind==='project' && !r.done){
    if(r.overdue) tag=`<span class="sched-tag overdue" title="Scheduled in the past — requires completion">⚠ Overdue · ${schedLabel({schedDate:r.schedDate,start:r.start})}</span>`;
    else if(r.scheduled) tag=`<span class="sched-tag yellow">Scheduled · ${schedLabel({schedDate:r.schedDate,start:r.start})}</span>`;
  }
  const isProj=r.source==='project';
  const canSched   = isProj && r.kind==='project' && !r.scheduled && !r.done;
  const canUnsched = isProj && r.kind==='project' &&  r.scheduled && !r.done;
  // duration: editable for standalone scheduled day-tasks, read-only for project rows
  let mins='';
  if(r.kind==='project' && r.mins!=null && !r.done){
    mins = isProj ? `<span class="mins ro" title="duration — set when scheduling">${fmtDuration(r.mins)}</span>`
                  : `<span class="mins" data-tmins="${r.id}" title="change duration">${fmtDuration(r.mins)}</span>`;
  }
  return `
  <div class="at-row ${r.done?'done':''} ${r.overdue?'overdue':''}">
    <div class="box" data-atcheck="${r.key}">✓</div>
    <span class="at-txt">${r.recurringId?'<span class="rec-badge">↻</span> ':''}${esc(r.txt)}</span>
    ${taskLabelChip(r)}
    ${tag}
    ${mins}
    ${canSched?`<span class="at-act" data-atsched="${r.projId}|${r.id}" title="Schedule on the calendar">⏱</span>`:''}
    ${canUnsched?`<span class="at-act unsched" data-atunsched="${r.projId}|${r.id}" title="Unschedule (keeps the task in its project)">⊘</span>`:''}
    ${!r.done?`<span class="at-act" data-atpipe="${r.key}" title="Promote to pipeline">↑</span>`:''}
    ${r.recurringId?`<span class="at-act" data-atsnooze="${r.recurringId}|${r.id}" title="Snooze to tomorrow">⏰</span>`:''}
    <span class="at-act" data-atedit="${r.key}" title="Edit text">✎</span>
    <span class="x" data-atdel="${r.key}" title="Delete">×</span>
  </div>`;
}

/* ---- COMPLETED: pulled out of the active lists into two places ----
   Gather completed tasks from every source. scope 'today' → only those finished
   today (project doneAt===today, or a done task living in today's day record);
   scope 'all' → every completed task ever (the Archive). */
function completedRows(scope){
  const tk=todayKey();
  const out=[];
  // A) project tasks (done) — dated by their doneAt stamp
  (S.projects||[]).forEach(p=>{
    (p.tasks||[]).filter(t=>t.done).forEach(t=>{
      const when=t.doneAt||null;
      if(scope==='today' && when!==tk) return;
      out.push({source:'project', key:'P|'+p.id+'|'+t.id, txt:t.txt, kind:t.kind||'project',
                projName:p.name, projColor:p.color, when});
    });
  });
  // B) standalone done day-tasks + C) swept archive entries — dated by day record
  Object.keys(S.days||{}).forEach(dk=>{
    if(scope==='today' && dk!==tk) return;
    const d=S.days[dk]||{};
    (d.tasks||[]).filter(t=>t.done && !t.projectId && !t.meetingId).forEach(t=>{
      out.push({source:'standalone', key:'S|'+t.id, txt:t.txt, kind:t.kind, when:dk});
    });
    (d.archive||[]).forEach(a=>{
      out.push({source:'archive', dayKey:dk, id:a.id, txt:a.txt, kind:a.kind, when:dk, time:a.doneAt});
    });
  });
  // newest first
  out.sort((x,y)=>((y.when||'')+(y.time||'')).localeCompare((x.when||'')+(x.time||'')));
  return out;
}
function renderCompletedSection(title, rows){
  return `
  <div class="at-section completed">
    <div class="at-sec-h"><span class="at-sec-lab">${title}</span><span class="at-sec-ct">${rows.length}</span></div>
    <div class="at-rows">${rows.map(r=>renderCompletedRow(r,false)).join('')}</div>
  </div>`;
}
function renderArchiveSection(rows){
  return `
  <div class="at-section archive">
    <div class="at-sec-h arch-h" data-archtoggle>
      <span class="at-sec-lab">${archiveOpen?'▾':'▸'} Archive</span>
      <span class="at-sec-ct">${rows.length} completed</span>
    </div>
    ${archiveOpen?`<div class="at-rows">${rows.length?rows.map(r=>renderCompletedRow(r,true)).join(''):'<div class="empty sm">No completed tasks yet.</div>'}</div>`:''}
  </div>`;
}
/* a struck-through completed row. withDate=true shows the completion date (Archive);
   false shows just a time if we have one (Completed Today). */
function renderCompletedRow(r, withDate){
  const chip = r.source==='project'
    ? `<span class="proj-chip" style="--pc:${r.projColor}">${esc(r.projName)}</span>`
    : `<span class="type-chip ${r.kind==='quick'?'q':'s'}">${r.kind==='quick'?'⚡ Quick':'▣ Scheduled'}</span>`;
  const when = withDate ? (r.when?`<span class="done-when">${shortDate(r.when)}</span>`:'')
                        : (r.time?`<span class="done-when">${r.time}</span>`:'');
  if(r.source==='archive'){
    return `<div class="at-row done">
      <div class="box done-static" title="archived">✓</div>
      <span class="at-txt">${esc(r.txt)}</span>${chip}${when}
      <span class="x" data-arcdel="${r.dayKey}|${r.id}" title="Delete from archive">×</span>
    </div>`;
  }
  return `<div class="at-row done">
    <div class="box" data-atcheck="${r.key}" title="Mark not done (reactivate)">✓</div>
    <span class="at-txt">${esc(r.txt)}</span>${chip}${when}
    <span class="x" data-atdel="${r.key}" title="Delete">×</span>
  </div>`;
}

/* add a task from the unified add row, honouring kind + optional project.
   Project chosen → lives in that project's task list (kind decides section);
   none → a standalone day-task (existing addTask path). */
function addUnifiedTask(txt, kind, projectId, mins){
  txt=(txt||'').trim(); if(!txt) return;
  if(projectId){
    const p=(S.projects||[]).find(x=>x.id===projectId); if(!p){ addTask(txt, kind, kind==='project'?(mins||60):2); return; }
    if(!p.tasks) p.tasks=[];
    const t={id:b(), txt, done:false, kind};
    if(kind==='project') t.mins=mins||60;     // remembered as the scheduler's default
    p.tasks.push(t);
    save();
  }else{
    addTask(txt, kind, kind==='project'?(mins||60):2);   // standalone day-task (saves itself)
  }
}

/* ---- unified-list actions: dispatch by row key ("P|projId|id" | "S|id") ---- */
function atKey(key){ const a=key.split('|'); return a[0]==='P'?{src:'project',projId:a[1],id:a[2]}:{src:'standalone',id:a[1]}; }
function atToggle(key){
  const k=atKey(key);
  if(k.src==='project'){
    const p=(S.projects||[]).find(x=>x.id===k.projId); const t=p&&p.tasks.find(x=>x.id===k.id); if(!t) return;
    setProjTaskDone(k.projId,k.id,!t.done);    // keeps linked blocks + progress in sync
  }else{
    const t=day().tasks.find(x=>x.id===k.id); if(!t) return;
    t.done=!t.done;
    if(t.done && t.recurringId) markRecurringDone(t.recurringId);
    if(t.projectId && t.projTaskId){ const p=S.projects.find(x=>x.id===t.projectId); const pt=p&&p.tasks.find(x=>x.id===t.projTaskId); if(pt) pt.done=t.done; }
  }
  save(false); rerender();
}
function atPromote(key){
  const k=atKey(key);
  if(k.src==='project') promoteProjToPipeline(k.projId,k.id); else promoteTaskToPipeline(k.id);
}
function atEdit(key){
  const k=atKey(key);
  if(k.src==='project'){
    const p=(S.projects||[]).find(x=>x.id===k.projId); const t=p&&p.tasks.find(x=>x.id===k.id); if(!t) return;
    const v=prompt('Edit task', t.txt); if(v==null) return; const nv=v.trim(); if(!nv) return;
    t.txt=nv;
    allTimeBlockTasks().forEach(e=>{ if(e.t.projectId===k.projId && e.t.projTaskId===k.id) e.t.txt=nv; });  // keep linked block text in sync
  }else{
    const t=day().tasks.find(x=>x.id===k.id); if(!t) return;
    const v=prompt('Edit task', t.txt); if(v==null) return; const nv=v.trim(); if(!nv) return;
    t.txt=nv;
  }
  save(); rerender();
}
function atDelete(key){
  const k=atKey(key);
  if(k.src==='project'){
    const p=(S.projects||[]).find(x=>x.id===k.projId); if(!p) return;
    p.tasks=(p.tasks||[]).filter(x=>x.id!==k.id);
    // sweep any linked day-task blocks + pipeline references so nothing dangles
    const linkedIds=new Set();
    Object.keys(S.days||{}).forEach(dk=>{ (S.days[dk].tasks||[]).forEach(t=>{ if(t.projectId===k.projId && t.projTaskId===k.id) linkedIds.add(t.id); }); });
    Object.keys(S.days||{}).forEach(dk=>{
      const d=S.days[dk];
      if(d.tasks) d.tasks=d.tasks.filter(t=>!(t.projectId===k.projId && t.projTaskId===k.id));
      if(d.pipeline) d.pipeline=d.pipeline.filter(it=>!(it.projectId===k.projId && it.projTaskId===k.id) && !linkedIds.has(it.taskId));
    });
  }else{
    Object.keys(S.days||{}).forEach(dk=>{ const d=S.days[dk]; if(d.pipeline) d.pipeline=d.pipeline.filter(it=>it.taskId!==k.id); });
    day().tasks=day().tasks.filter(x=>x.id!==k.id);
  }
  save(); rerender();
}
/* Unschedule a project task: drop its non-done linked time-block(s) from the
   calendar across every day, leaving the project task itself in place. */
function unscheduleProjTask(pid, ptId){
  let removed=false;
  Object.keys(S.days||{}).forEach(dk=>{
    const d=S.days[dk]; if(!d.tasks) return;
    const before=d.tasks.length;
    d.tasks=d.tasks.filter(t=>!(t.kind==='project' && t.projectId===pid && t.projTaskId===ptId && !t.done));
    if(d.tasks.length!==before) removed=true;
  });
  if(removed) save();
  toast('Unscheduled — task kept in project'); rerender();
}
function bindAllTasks(){
  // ---- add row (kind toggle + optional project + duration) ----
  q('#kindPick [data-kind]','all').forEach(el=>el.onclick=()=>{ taskDraft.kind=el.dataset.kind; rerender(); });
  const pp=q('#taskProjPick'); if(pp) pp.onchange=()=>{ taskDraft.projectId=pp.value||null; };
  q('[data-dur]','all').forEach(el=>el.onclick=()=>{ taskDraft.mins=+el.dataset.dur; taskDraft.customOpen=false; rerender(); });
  const dc=q('#durCustom'); if(dc) dc.onclick=()=>{ taskDraft.customOpen=true; rerender(); setTimeout(()=>{ const ci=q('#durCustomInput'); if(ci) ci.focus(); },0); };
  const dci=q('#durCustomInput'); if(dci) dci.oninput=()=>{ const n=parseInt(dci.value,10); if(!isNaN(n)&&n>0) taskDraft.mins=n; };
  const doAdd=()=>{ const i=q('#taskInput'); const v=i.value.trim(); if(!v) return; addUnifiedTask(v, taskDraft.kind, taskDraft.projectId, taskDraft.kind==='project'?taskDraft.mins:2); rerender(); };
  const addBtn=q('#taskAddBtn'); if(addBtn) addBtn.onclick=doAdd;
  const ti=q('#taskInput'); if(ti) ti.onkeydown=e=>{ if(e.key==='Enter') doAdd(); };
  // ---- focus toggle + archive dropdown ----
  const st=q('#schedToggle'); if(st) st.onclick=()=>{ showAllSched=!showAllSched; rerender(); };
  const arch=q('[data-archtoggle]'); if(arch) arch.onclick=()=>{ archiveOpen=!archiveOpen; rerender(); };
  q('[data-arcdel]','all').forEach(el=>el.onclick=()=>{ const [dk,id]=el.dataset.arcdel.split('|'); const d=S.days[dk]; if(d&&d.archive){ d.archive=d.archive.filter(a=>a.id!==id); save(); rerender(); } });
  // ---- row actions ----
  q('[data-atcheck]','all').forEach(el=>el.onclick=()=>atToggle(el.dataset.atcheck));
  q('[data-atpipe]','all').forEach(el=>el.onclick=(e)=>{ e.stopPropagation(); atPromote(el.dataset.atpipe); });
  q('[data-atedit]','all').forEach(el=>el.onclick=()=>atEdit(el.dataset.atedit));
  q('[data-atdel]','all').forEach(el=>el.onclick=()=>atDelete(el.dataset.atdel));
  q('[data-atsched]','all').forEach(el=>el.onclick=()=>{ const [pid,id]=el.dataset.atsched.split('|'); openProjSchedule(pid,id); });
  q('[data-atunsched]','all').forEach(el=>el.onclick=()=>{ const [pid,id]=el.dataset.atunsched.split('|'); unscheduleProjTask(pid,id); });
  q('[data-tmins]','all').forEach(el=>el.onclick=()=>openDurationPicker(el.dataset.tmins));
  // snooze a recurring task to tomorrow (removes from today, won't re-add today)
  q('[data-atsnooze]','all').forEach(el=>el.onclick=()=>{
    const [rid,tid]=el.dataset.atsnooze.split('|');
    const r=S.recurring.find(x=>x.id===rid);
    if(r){ const t=new Date(); t.setDate(t.getDate()+1); r.snoozeUntil=t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0'); }
    day().tasks=day().tasks.filter(x=>x.id!==tid);
    if(day().recurringAdded) day().recurringAdded[rid]=true;
    save(); toast('Snoozed to tomorrow'); rerender();
  });
}

/* ---------- THIS WEEK — a simple free-text goals note ----------
   Top-level S.weeklyGoals string. No slots, no carry-over: just a compact
   textarea the user rewrites each week. Autosaves on input (no rerender, so the
   caret never jumps), mirroring the journal free-text fields. */
function renderWeeklyGoals(){
  return `
  <div class="card weekly-goals">
    <div class="card-h"><h3>This Week</h3><span class="sub">goals &amp; intentions</span></div>
    <textarea id="weeklyGoals" rows="3" placeholder="What do you want to get done this week?">${esc(S.weeklyGoals||'')}</textarea>
  </div>`;
}
function bindWeeklyGoals(){
  const ta=q('#weeklyGoals'); if(ta) ta.oninput=()=>{ S.weeklyGoals=ta.value; save(false); };
}

/* ---------- THIS MONTH — a simple free-text goals note ----------
   Top-level S.monthlyGoals string, same pattern as the weekly note above:
   compact textarea the user rewrites each month, autosaving on input (no
   rerender, so the caret never jumps). */
function renderMonthlyGoals(){
  return `
  <div class="card monthly-goals">
    <div class="card-h"><h3>This Month</h3><span class="sub">goals &amp; intentions</span></div>
    <textarea id="monthlyGoals" rows="3" placeholder="What do you want to get done this month?">${esc(S.monthlyGoals||'')}</textarea>
  </div>`;
}
function bindMonthlyGoals(){
  const ta=q('#monthlyGoals'); if(ta) ta.oninput=()=>{ S.monthlyGoals=ta.value; save(false); };
}
function winsSummary(d){
  const set=['health','lev','content','not'].filter(k=>d.focus[k]&&d.focus[k].trim()).length;
  return set?`${set}/4 set`:'tap to set';
}

function focusKey(cls){ return cls==='not'?'not':cls; }

/* ---------- ACTIVE PROJECTS (collapsed list on Today) ---------- */
let projOpen={};   // {projectId:true} = expanded; default collapsed so Today stays clean

/* visual state of a project task: done | scheduled (has a linked dated block) | unscheduled */
function projTaskState(pid, t){
  if(t.done) return {state:'done'};
  const e=linkedTimeBlock(pid, t.id);
  if(e && e.t.schedDate!=null) return {state:'scheduled', tb:e.t};
  return {state:'unscheduled'};
}
/* Active Projects — horizontal strip of cards (name + progress + count).
   Tap a card → openProjectModal to manage that project's task list. */
function renderActiveProjects(){
  const active=(S.projects||[]).filter(p=>!p.done);
  return `
  <div class="card dash-projects">
    <div class="card-h"><h3>Active Projects</h3><span class="ch-actions"><span class="sub">${active.length}</span><button class="dash-add-btn" id="dashAddProj" title="Add a project">+</button></span></div>
    ${active.length?`<div class="proj-strip">
      ${active.map(p=>{ const s=projectStats(p); return `
        <button class="proj-card-mini" data-projopen="${p.id}">
          <span class="pcm-top"><span class="proj-swatch" style="background:${p.color}"></span><span class="pcm-name">${esc(p.name)}</span><span class="pcm-del" data-pdeldash="${p.id}" title="Delete project">×</span></span>
          <div class="proj-track"><div class="proj-fill" style="width:${s.pct}%;background:${p.color}"></div></div>
          <span class="pcm-count">${s.done}/${s.total} done</span>
        </button>`; }).join('')}
    </div>`:'<div class="empty sm">No active projects — add one in Settings.</div>'}
  </div>`;
}

/* ---------- project task modal: manage + drag-reorder tasks ----------
   Opened from an Active Projects card. Add / complete / delete / schedule /
   promote a project's tasks in one place; edits flow straight into the flat
   All Tasks list. Tasks added here default to time-block (▣ Scheduled). */
let projModalId=null;
let projModalDraft='';
function openProjectModal(pid){ projModalId=pid; projModalDraft=''; renderProjectModal(); }
function renderProjectModal(){
  const p=(S.projects||[]).find(x=>x.id===projModalId); if(!p){ closeReset(); return; }
  const tasks=(p.tasks||[]).filter(t=>!t.done); const s=projectStats(p);
  const m=q('#resetModal');
  m.innerHTML=`
    <div class="modal">
      <span class="modal-close" id="pmClose">×</span>
      <h3><span class="proj-swatch" style="background:${p.color};display:inline-block;vertical-align:middle;margin-right:8px"></span>${esc(p.name)}</h3>
      <div class="proj-track" style="margin:10px 0 16px"><div class="proj-fill" style="width:${s.pct}%;background:${p.color}"></div></div>
      <div class="pm-tasks">
        ${tasks.length?tasks.map(t=>{
          const st=projTaskState(p.id,t);
          const tag = st.state==='scheduled'?`<span class="sched-tag yellow">${schedLabel(st.tb)}</span>`
                    : (st.state==='unscheduled'?`<span class="to-today" data-pmsched="${t.id}">⏱ schedule</span>`:'');
          return `<div class="pm-row" data-pmdrag="${t.id}">
            <span class="pm-grip" title="drag to reorder">⋮⋮</span>
            <span class="box" data-pmdone="${t.id}">✓</span>
            <span class="pm-txt">${esc(t.txt)}</span>
            ${tag}
            <span class="to-pipe" data-pmpipe="${t.id}" title="Promote to pipeline">↑</span>
            <span class="to-pipe" data-pmedit="${t.id}" title="Edit text">✎</span>
            <span class="x" data-pmdel="${t.id}">×</span>
          </div>`;
        }).join(''):'<div class="empty sm">No open tasks — add one below.</div>'}
      </div>
      <div class="proj-add-task" style="margin-top:12px">
        <input type="text" id="pmAdd" value="${esc(projModalDraft)}" placeholder="Add a task to ${esc(p.name)}…">
        <button class="btn sm" id="pmAddBtn">+ Add</button>
      </div>
      <p class="list-note" style="margin-top:10px">Drag ⋮⋮ to reorder · ✓ complete · ⏱ schedule · ↑ pipeline · ✎ edit. Done tasks move to “Completed Today / Archive” on the Dashboard.</p>
    </div>`;
  m.classList.add('show');
  bindProjectModal();
}
function bindProjectModal(){
  const p=(S.projects||[]).find(x=>x.id===projModalId); if(!p) return;
  const close=q('#pmClose'); if(close) close.onclick=()=>{ projModalId=null; closeReset(); };
  q('[data-pmdone]','all').forEach(el=>el.onclick=()=>{ const t=p.tasks.find(x=>x.id===el.dataset.pmdone); if(t){ setProjTaskDone(p.id,t.id,!t.done); save(false); renderProjectModal(); rerender(); } });
  q('[data-pmdel]','all').forEach(el=>el.onclick=()=>{ p.tasks=p.tasks.filter(x=>x.id!==el.dataset.pmdel); save(); renderProjectModal(); rerender(); });
  q('[data-pmpipe]','all').forEach(el=>el.onclick=()=>{ promoteProjToPipeline(p.id, el.dataset.pmpipe); renderProjectModal(); });
  q('[data-pmedit]','all').forEach(el=>el.onclick=()=>{ const t=p.tasks.find(x=>x.id===el.dataset.pmedit); if(!t) return; const v=prompt('Edit task', t.txt); if(v==null) return; const nv=v.trim(); if(!nv) return; t.txt=nv; allTimeBlockTasks().forEach(e=>{ if(e.t.projectId===p.id && e.t.projTaskId===t.id) e.t.txt=nv; }); save(); renderProjectModal(); rerender(); });
  q('[data-pmsched]','all').forEach(el=>el.onclick=()=>{ openProjSchedule(p.id, el.dataset.pmsched); });  // replaces modal with scheduler
  const ai=q('#pmAdd'); if(ai) ai.oninput=()=>{ projModalDraft=ai.value; };
  const addT=()=>{ const v=(projModalDraft||'').trim(); if(!v) return; p.tasks.push({id:b(),txt:v,done:false,kind:'project',mins:60}); projModalDraft=''; save(); renderProjectModal(); rerender(); };
  const ab=q('#pmAddBtn'); if(ab) ab.onclick=addT;
  if(ai) ai.onkeydown=e=>{ if(e.key==='Enter') addT(); };
  // drag-to-reorder p.tasks by the grip (mouse + touch), via the shared helper
  makeReorderable(q('.pm-tasks'), '[data-pmdrag]', 'pmdrag', '.pm-grip', (order)=>{
    const byId=Object.fromEntries(p.tasks.map(t=>[t.id,t]));
    p.tasks=order.map(id=>byId[id]).filter(Boolean).concat(p.tasks.filter(t=>!order.includes(t.id)));
    save(); renderProjectModal(); rerender();
  });
}

/* ---------- project-task scheduler (duration + date) ----------
   Reuses the duration presets and the same schedDate/start scheduling the time
   blocker uses, so a scheduled project task lands on the grid and stays linked. */
let projSchedDraft=null;   // {pid, ptId, mins, customOpen, date, start}
function openProjSchedule(pid, ptId){
  const p=(S.projects||[]).find(x=>x.id===pid); const t=p&&p.tasks.find(x=>x.id===ptId);
  if(!t) return;
  const linked=linkedTimeBlock(pid, ptId);   // prefill if a block already exists
  const date=(linked&&linked.t.schedDate)||todayKey();
  const mins=linked?linked.t.mins:(t.mins!=null?t.mins:60);   // else the task's remembered duration
  const ws=(S.settings&&S.settings.dayStart)||8;
  // default start = the block's existing start, else the first free slot that day
  const start=(linked&&linked.t.start!=null)?linked.t.start:firstFreeSlot(date, ws, mins, '__new__');
  projSchedDraft={ pid, ptId, mins, customOpen:false, date, start };
  renderProjSchedule();
}
function renderProjSchedule(){
  const d=projSchedDraft; if(!d) return;
  const p=(S.projects||[]).find(x=>x.id===d.pid); const t=p&&p.tasks.find(x=>x.id===d.ptId);
  if(!t){ closeReset(); return; }
  const ws=(S.settings&&S.settings.dayStart)||8;
  // conflict check on the chosen start (reuse the shared first-free-slot logic)
  const nudged=firstFreeSlot(d.date, d.start, d.mins, '__new__');
  const conflicts=(nudged!==d.start);
  // the real Time Blocker grid for this date, with a tappable slot + live preview
  const grid=planGridInner(d.date, {droppable:true, hint:'tap', selectedSlot:d.start, previewMins:d.mins, previewLabel:t.txt});
  const m=q('#resetModal');
  m.innerHTML=`
    <div class="modal">
      <span class="modal-close" id="psClose">×</span>
      <h3>Schedule task</h3>
      <p class="intro">Block time for “${esc(t.txt)}” — ${esc(p.name)}.</p>
      <div class="qf"><label>Duration</label>
        <div class="dur-pick">
          ${DURATION_PRESETS.map(mins=>`<button class="dur-btn ${d.mins===mins&&!d.customOpen?'sel':''}" data-psdur="${mins}">${fmtDuration(mins)}</button>`).join('')}
          <button class="dur-btn ${(!DURATION_PRESETS.includes(d.mins)||d.customOpen)?'sel':''}" id="psCustom">${!DURATION_PRESETS.includes(d.mins)?fmtDuration(d.mins):'custom'}</button>
          ${d.customOpen?`<span class="dur-custom-wrap"><input type="number" min="1" max="600" id="psCustomInput" value="${!DURATION_PRESETS.includes(d.mins)?d.mins:''}" placeholder="min" class="num-in"><span class="dur-lab">min</span></span>`:''}
        </div>
      </div>
      <div class="qf"><label>Date</label>
        <input type="date" id="psDate" min="${todayKey()}" value="${d.date}">
      </div>
      <div class="qf" style="margin-bottom:6px"><label>Tap a slot to set start — ${d.start!=null?'<b>'+fmtHour(d.start)+'</b>':'none'}</label></div>
      <div class="ps-grid-wrap">${grid}</div>
      ${conflicts?`<div class="ps-conflict">⚠ ${fmtHour(d.start)} overlaps another block — will schedule at <b>${fmtHour(nudged)}</b>.</div>`:''}
      <div class="btn-row" style="margin-top:18px">
        <button class="btn" id="psConfirm">Schedule</button>
        <button class="btn ghost" id="psCancel">Cancel</button>
      </div>
    </div>`;
  m.classList.add('show');
  q('#psClose').onclick=closeReset; q('#psCancel').onclick=closeReset;
  q('#resetModal [data-psdur]','all').forEach(el=>el.onclick=()=>{ d.mins=+el.dataset.psdur; d.customOpen=false; renderProjSchedule(); });
  const pc=q('#psCustom'); if(pc) pc.onclick=()=>{ d.customOpen=true; renderProjSchedule(); setTimeout(()=>{ const ci=q('#psCustomInput'); if(ci) ci.focus(); },0); };
  const pci=q('#psCustomInput'); if(pci) pci.oninput=()=>{ const n=parseInt(pci.value,10); if(!isNaN(n)&&n>0){ d.mins=n; } };
  const pd=q('#psDate'); if(pd) pd.onchange=()=>{ d.date=pd.value||todayKey(); d.start=firstFreeSlot(d.date, ws, d.mins, '__new__'); renderProjSchedule(); };
  // tap an hour slot on the grid to set the start (scoped to the modal)
  q('#resetModal [data-slot]','all').forEach(slot=>slot.onclick=()=>{ d.start=+slot.dataset.slot; renderProjSchedule(); });
  q('#psConfirm').onclick=confirmProjSchedule;
}
function confirmProjSchedule(){
  const d=projSchedDraft; if(!d) return;
  const p=(S.projects||[]).find(x=>x.id===d.pid); const t=p&&p.tasks.find(x=>x.id===d.ptId);
  if(!t){ closeReset(); return; }
  const dk=d.date||todayKey(); const mins=d.mins||60;
  const ws=(S.settings&&S.settings.dayStart)||8;
  // Reuse the send-to-today task shape. Schedule an existing linked block if there
  // is one (e.g. already sent to Today), otherwise create the linked block.
  let entry=linkedTimeBlock(d.pid, d.ptId), tb;
  if(entry){ tb=entry.t; }
  else { tb={id:b(),txt:t.txt,kind:'project',done:false,mins,start:null,schedDate:null,projectId:d.pid,projTaskId:d.ptId}; day().tasks.push(tb); }
  tb.mins=mins;
  // honour the chosen start; if it overlaps, nudge to the next free slot (never
  // silently double-book) — same first-free-slot logic placeProject uses
  tb.schedDate=dk;
  tb.start=firstFreeSlot(dk, (d.start!=null?d.start:ws), mins, tb.id);
  save(); closeReset(); toast('Scheduled'); rerender();
}

/* draft state for the unified add row (kind + optional project + duration) */
let taskDraft={kind:'quick', mins:60, customOpen:false, projectId:null};
function bindDashboard(){
  // Things to think about (Parking Lot data)
  const ta=q('#thinkAdd'); const ti=q('#thinkInput');
  const addThink=()=>{ const v=(ti&&ti.value||'').trim(); if(!v) return; if(!S.board) S.board={mustwin:[],scheduled:[],parking:[]}; if(!S.board.parking) S.board.parking=[]; S.board.parking.push({id:b(),txt:v}); save(); rerender(); };
  if(ta) ta.onclick=addThink; if(ti) ti.onkeydown=e=>{ if(e.key==='Enter') addThink(); };
  q('[data-thinkdel]','all').forEach(el=>el.onclick=()=>{ S.board.parking=(S.board.parking||[]).filter(x=>x.id!==el.dataset.thinkdel); save(); rerender(); });

  // Active Projects: tap a card → open that project's task-list modal
  q('[data-projopen]','all').forEach(el=>el.onclick=()=>openProjectModal(el.dataset.projopen));
  // Active Projects: × → delete project (confirm + clean up linked tasks/pipeline)
  q('[data-pdeldash]','all').forEach(el=>el.onclick=(e)=>{
    e.stopPropagation();   // don't also open the card's modal
    const p=(S.projects||[]).find(x=>x.id===el.dataset.pdeldash); if(!p) return;
    if(confirm(`Delete "${p.name}" and its tasks?`)){ deleteProject(p); rerender(); }
  });

  // Meetings: tap a card → open the meeting quick-view modal
  q('[data-mtgopen]','all').forEach(el=>el.onclick=()=>openMeetingModal(el.dataset.mtgopen));

  // Dashboard inline add: create a project / meeting right here (reuses the tab logic)
  const dap=q('#dashAddProj'); if(dap) dap.onclick=()=>{ const v=prompt('New project name'); if(v && createProject(v)) rerender(); };
  const dam=q('#dashAddMtg'); if(dam) dam.onclick=()=>{ const v=prompt('New meeting / person'); if(v && createMeeting(v)) rerender(); };

  // Time Blocker expand/collapse (day view ↔ full plan)
  const pe=q('#planExpand'); if(pe) pe.onclick=()=>{ dashPlanExpanded=!dashPlanExpanded; if(!dashPlanExpanded) planView='day'; rerender(); };

  bindPipeline();          // the top-3 pipeline hero
  bindAllTasks();          // the single flat "All Tasks" list — add + every source
  bindWeeklyGoals();       // the "This Week" free-text goals note
  bindMonthlyGoals();      // the "This Month" free-text goals note
  bindAppointments();      // fixed date/time commitments
  bindFollowups();         // full follow-ups list
  bindPlan();              // reused Time Blocker (day view, or full plan when expanded)
}

