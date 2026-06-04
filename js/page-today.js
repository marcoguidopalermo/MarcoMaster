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

  ${renderPipeline()}

  ${renderAppointments()}

  <div class="dash-grid">
    <div class="dash-col">
      ${renderTaskInbox()}
    </div>
    <div class="dash-col">
      ${renderFollowups()}
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
function winsSummary(d){
  const set=['health','lev','content','not'].filter(k=>d.focus[k]&&d.focus[k].trim()).length;
  return set?`${set}/4 set`:'tap to set';
}

/* ---------- TASK INBOX (lives on Today) ---------- */
function renderTaskInbox(){
  const quick=quickTasks();
  const projects=projectTasks().filter(t=>!t.meetingId);      // meeting blocks live on the calendar grid, not the task inbox
  const unsched=unscheduledProjects().filter(t=>!t.meetingId);
  const quickDone=quick.filter(t=>t.done).length;
  const liveDone=day().tasks.filter(t=>t.done).length;
  const archived=day().archive.length;
  const projChip=(t)=>{
    if(!t.projectId) return '';
    const p=(S.projects||[]).find(x=>x.id===t.projectId); if(!p) return '';
    return `<span class="proj-chip" style="--pc:${p.color}">${esc(p.name)}</span>`;
  };
  return `
  <div class="card big-card" style="border-top:3px solid var(--accent)">
    <div class="card-h">
      <h3>Today's Tasks</h3>
      <span class="sub">${quick.length} quick · ${projects.length} blocked${archived?` · ${archived} done`:''}</span>
    </div>
    ${liveDone?`<div class="clear-bar">
      <span>${liveDone} done</span>
      <button class="btn sm" id="clearCompleted">Clear ✓</button>
    </div>`:''}

    <div class="task-add">
      <input type="text" id="taskInput" placeholder="Add a task...">
      <div class="kind-pick" id="kindPick">
        <button data-kind="quick" class="${taskDraft.kind==='quick'?'active':''}">⚡ Quick</button>
        <button data-kind="project" class="${taskDraft.kind==='project'?'active':''}">▣ Time block</button>
      </div>
      <button class="btn" id="taskAddBtn">Add</button>
    </div>
    ${taskDraft.kind==='project'?`
    <div class="dur-pick" id="durPick">
      <span class="dur-lab">Duration:</span>
      ${DURATION_PRESETS.map(m=>`<button class="dur-btn ${taskDraft.mins===m?'sel':''}" data-dur="${m}">${fmtDuration(m)}</button>`).join('')}
      <button class="dur-btn ${!DURATION_PRESETS.includes(taskDraft.mins)&&!taskDraft.customOpen?'sel':''}" id="durCustom">${!DURATION_PRESETS.includes(taskDraft.mins)?fmtDuration(taskDraft.mins):'custom'}</button>
      ${taskDraft.customOpen?`<span class="dur-custom-wrap"><input type="number" min="1" max="600" id="durCustomInput" value="${!DURATION_PRESETS.includes(taskDraft.mins)?taskDraft.mins:''}" placeholder="min" class="num-in"><span class="dur-lab">min</span></span>`:''}
    </div>`:''}

    <div class="inbox-cols">
      <div class="inbox-col">
        <div class="inbox-col-h"><span class="lab quick">⚡ Quick Tasks</span><span class="ct">${quickDone}/${quick.length}</span></div>
        ${quick.length?quick.map(t=>`
          <div class="qtask big-task ${t.done?'done':''}">
            <div class="box" data-tdone="${t.id}">✓</div>
            <span class="qtxt">${t.recurringId?'<span class="rec-badge">↻</span> ':''}${esc(t.txt)}</span>
            ${!t.done?`<span class="to-pipe" data-plpromote-task="${t.id}" title="Promote to pipeline">↑</span>`:''}
            ${t.recurringId?`<span class="snz" data-snooze="${t.recurringId}|${t.id}" title="snooze">⏰</span>`:''}
            <span class="x" data-tdel="${t.id}">×</span>
          </div>`).join(''):'<div class="empty">Nothing quick.</div>'}
      </div>

      <div class="inbox-col">
        <div class="inbox-col-h"><span class="lab proj">▣ Tasks — requires time block</span><span class="ct">${unsched.length?unsched.length+' to block':'all set ✓'}</span></div>
        ${projects.length?projects.map(t=>`
          <div class="ptask big-task ${t.done?'done':''} ${t.schedDate!=null?'scheduled':'limbo'}">
            <div class="box" data-tdone="${t.id}">✓</div>
            <span class="ptxt">${t.recurringId?'<span class="rec-badge">↻</span> ':''}${t.fromYesterday?'<span class="rec-badge yd">↳</span> ':''}${esc(t.txt)}${projChip(t)}</span>
            ${t.schedDate!=null?`<span class="sched-tag yellow">${schedLabel(t)}</span>`:''}
            <span class="mins" data-tmins="${t.id}">${fmtDuration(t.mins)}</span>
            ${!t.done?`<span class="to-pipe" data-plpromote-task="${t.id}" title="Promote to pipeline">↑</span>`:''}
            ${t.recurringId?`<span class="snz" data-snooze="${t.recurringId}|${t.id}" title="snooze">⏰</span>`:''}
            <span class="x" data-tdel="${t.id}">×</span>
          </div>`).join(''):'<div class="empty">Nothing to block.</div>'}
        ${unsched.length?`<button class="btn ghost sm" id="goPlan" style="margin-top:10px;width:100%">→ Time block these</button>`:''}
      </div>
    </div>
  </div>`;
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
   Tap a card → openProjectModal for full task management + drag-reorder. */
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

/* ---------- project task modal: manage + drag-reorder tasks ---------- */
let projModalId=null;
let projModalDraft='';
function openProjectModal(pid){ projModalId=pid; projModalDraft=''; renderProjectModal(); }
function renderProjectModal(){
  const p=(S.projects||[]).find(x=>x.id===projModalId); if(!p){ closeReset(); return; }
  const tasks=p.tasks||[]; const s=projectStats(p);
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
          return `<div class="pm-row ${t.done?'done':''}" draggable="true" data-pmdrag="${t.id}">
            <span class="pm-grip" title="drag to reorder">⋮⋮</span>
            <span class="box" data-pmdone="${t.id}">✓</span>
            <span class="pm-txt">${esc(t.txt)}</span>
            ${tag}
            ${!t.done?`<span class="to-pipe" data-pmpipe="${t.id}" title="Promote to pipeline">↑</span>`:''}
            <span class="x" data-pmdel="${t.id}">×</span>
          </div>`;
        }).join(''):'<div class="empty sm">No tasks yet — add one below.</div>'}
      </div>
      <div class="proj-add-task" style="margin-top:12px">
        <input type="text" id="pmAdd" value="${esc(projModalDraft)}" placeholder="Add a task to ${esc(p.name)}…">
        <button class="btn sm" id="pmAddBtn">+ Add</button>
      </div>
      <p class="list-note" style="margin-top:10px">Drag ⋮⋮ to reorder · ✓ complete · ⏱ schedule · ↑ pipeline</p>
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
  q('[data-pmsched]','all').forEach(el=>el.onclick=()=>{ openProjSchedule(p.id, el.dataset.pmsched); });  // replaces modal with scheduler
  const ai=q('#pmAdd'); if(ai) ai.oninput=()=>{ projModalDraft=ai.value; };
  const addT=()=>{ const v=(projModalDraft||'').trim(); if(!v) return; p.tasks.push({id:b(),txt:v,done:false}); projModalDraft=''; save(); renderProjectModal(); rerender(); };
  const ab=q('#pmAddBtn'); if(ab) ab.onclick=addT;
  if(ai) ai.onkeydown=e=>{ if(e.key==='Enter') addT(); };
  // drag-to-reorder within p.tasks
  let dragId=null;
  q('[data-pmdrag]','all').forEach(row=>{
    row.ondragstart=e=>{ dragId=row.dataset.pmdrag; row.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; try{e.dataTransfer.setData('text/plain',dragId);}catch(_){} };
    row.ondragend=()=>{ dragId=null; row.classList.remove('dragging'); };
    row.ondragover=e=>{ e.preventDefault(); };
    row.ondrop=e=>{ e.preventDefault();
      const overId=row.dataset.pmdrag; const dg=dragId||(e.dataTransfer&&e.dataTransfer.getData('text/plain'));
      if(!dg||dg===overId) return;
      const arr=p.tasks; const from=arr.findIndex(x=>x.id===dg); const to=arr.findIndex(x=>x.id===overId);
      if(from<0||to<0) return; const [moved]=arr.splice(from,1); arr.splice(to,0,moved); save(); renderProjectModal(); rerender();
    };
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
  const mins=linked?linked.t.mins:60;
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

/* draft state for the Today task add row */
let taskDraft={kind:'quick', mins:60, customOpen:false};
function bindTaskInbox(){
  q('#kindPick [data-kind]','all').forEach(el=>el.onclick=()=>{
    taskDraft.kind=el.dataset.kind; rerender();
  });
  // duration presets
  q('[data-dur]','all').forEach(el=>el.onclick=()=>{ taskDraft.mins=+el.dataset.dur; taskDraft.customOpen=false; rerender(); });
  const dc=q('#durCustom'); if(dc) dc.onclick=()=>{ taskDraft.customOpen=true; rerender(); setTimeout(()=>{ const ci=q('#durCustomInput'); if(ci) ci.focus(); },0); };
  const dci=q('#durCustomInput'); if(dci) dci.oninput=()=>{ const n=parseInt(dci.value,10); if(!isNaN(n)&&n>0) taskDraft.mins=n; };
  const addBtn=q('#taskAddBtn');
  const doAdd=()=>{
    const i=q('#taskInput'); const v=i.value.trim(); if(!v)return;
    addTask(v, taskDraft.kind, taskDraft.kind==='project'?taskDraft.mins:2);
    rerender();
  };
  if(addBtn) addBtn.onclick=doAdd;
  const ti=q('#taskInput'); if(ti) ti.onkeydown=e=>{ if(e.key==='Enter') doAdd(); };
  q('[data-tdone]','all').forEach(el=>el.onclick=()=>{
    const t=day().tasks.find(x=>x.id===el.dataset.tdone);
    if(t){
      t.done=!t.done;
      if(t.done && t.recurringId) markRecurringDone(t.recurringId);
      if(t.projectId && t.projTaskId){
        const p=S.projects.find(x=>x.id===t.projectId);
        const pt=p&&p.tasks.find(x=>x.id===t.projTaskId);
        if(pt) pt.done=t.done;   // keep project progress in sync
      }
      save(false); rerender();
    }
  });
  q('[data-tdel]','all').forEach(el=>el.onclick=()=>{
    day().tasks=day().tasks.filter(x=>x.id!==el.dataset.tdel); save(); rerender();
  });
  q('[data-tmins]','all').forEach(el=>el.onclick=()=>{
    openDurationPicker(el.dataset.tmins);
  });
  const gp=q('#goPlan'); if(gp) gp.onclick=()=>{ const el=q('#dash-plan'); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); };
  const cc=q('#clearCompleted'); if(cc) cc.onclick=()=>{
    archiveCompleted(); toast('Cleared & archived'); rerender();
  };
  // snooze a recurring task to tomorrow (removes from today, won't re-add today)
  q('[data-snooze]','all').forEach(el=>el.onclick=()=>{
    const [rid,tid]=el.dataset.snooze.split('|');
    const r=S.recurring.find(x=>x.id===rid);
    if(r){ const t=new Date(); t.setDate(t.getDate()+1); r.snoozeUntil=t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0'); }
    day().tasks=day().tasks.filter(x=>x.id!==tid);
    if(day().recurringAdded) day().recurringAdded[rid]=true; // don't re-add today
    save(); toast('Snoozed to tomorrow'); rerender();
  });
  // skip this cycle (mark last=today so next due is a full interval out)
  q('[data-skip]','all').forEach(el=>el.onclick=()=>{
    const [rid,tid]=el.dataset.skip.split('|');
    const r=S.recurring.find(x=>x.id===rid);
    if(r){ r.last=todayKey(); }
    day().tasks=day().tasks.filter(x=>x.id!==tid);
    if(day().skipped) day().skipped[rid]=true;
    save(); toast('Skipped this cycle'); rerender();
  });
}
function bindDashboard(){
  // Things to think about (Parking Lot data)
  const ta=q('#thinkAdd'); const ti=q('#thinkInput');
  const addThink=()=>{ const v=(ti&&ti.value||'').trim(); if(!v) return; if(!S.board) S.board={mustwin:[],scheduled:[],parking:[]}; if(!S.board.parking) S.board.parking=[]; S.board.parking.push({id:b(),txt:v}); save(); rerender(); };
  if(ta) ta.onclick=addThink; if(ti) ti.onkeydown=e=>{ if(e.key==='Enter') addThink(); };
  q('[data-thinkdel]','all').forEach(el=>el.onclick=()=>{ S.board.parking=(S.board.parking||[]).filter(x=>x.id!==el.dataset.thinkdel); save(); rerender(); });

  // Active Projects: tap a card → open the project task modal
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

  // promote a quick/inbox task → pipeline
  q('[data-plpromote-task]','all').forEach(el=>el.onclick=(e)=>{ e.stopPropagation(); promoteTaskToPipeline(el.dataset.plpromoteTask); });

  // Time Blocker expand/collapse (day view ↔ full plan)
  const pe=q('#planExpand'); if(pe) pe.onclick=()=>{ dashPlanExpanded=!dashPlanExpanded; if(!dashPlanExpanded) planView='day'; rerender(); };

  bindPipeline();          // the top-3 pipeline hero
  bindAppointments();      // fixed date/time commitments
  bindTaskInbox();         // Quick + Scheduled lists (recurring auto-injected here)
  bindFollowups();         // full follow-ups list
  bindPlan();              // reused Time Blocker (day view, or full plan when expanded)
}

