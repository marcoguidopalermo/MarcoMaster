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

function renderToday(){
  const d=day();
  const steps=(S.settings&&S.settings.resetSteps)||DEFAULT_RESET_STEPS.map(s=>({id:s[0],label:s[1]}));
  const total=steps.length;
  const done=steps.filter(s=>d.reset[s.id]).length;
  const pct=total?Math.round(done/total*100):0;
  const focusRow=(tag,cls,label,ph)=>`
    <div class="focusrow">
      <span class="tag ${cls}">${tag}</span>
      <input type="text" data-focus="${cls==='not'?'not':cls}" value="${esc(d.focus[focusKey(cls)]||'')}" placeholder="${ph}">
    </div>`;
  const bizFocus=d.focus.biz||'';
  const dueCount=dueRecurring().filter(r=>!d.skipped[r.id]).length;

  // collapsible panel helper
  const panel=(key,title,meta,body)=>`
    <div class="panel ${todayOpen[key]?'open':''}">
      <button class="panel-h" data-panel="${key}">
        <span class="panel-caret">${todayOpen[key]?'▾':'▸'}</span>
        <span class="panel-title">${title}</span>
        <span class="panel-meta">${meta}</span>
      </button>
      ${todayOpen[key]?`<div class="panel-body">${body}</div>`:''}
    </div>`;

  return `
  <div class="phead compact">
    <div class="kicker">${prettyDate()}</div>
    <h2>Today</h2>
  </div>

  <div class="today-layout">
    <div class="ga-pipe">${renderPipeline()}</div>

    <div class="ga-proj">${renderActiveProjects()}</div>

    <div class="ga-side">${renderFollowups()}</div>

    <div class="ga-quiet">
      <div class="quiet-divider"><span>everything else</span></div>

      <div class="focus-hero focus-hero-sm">
        <span class="fh-lab">Today's #1</span>
        <input type="text" data-focus="biz" value="${esc(bizFocus)}" placeholder="The one thing that matters most today">
      </div>

      ${renderTaskInbox()}

      ${panel('reset','Morning Routine', `${done}/${total} ${pct===100?'✓':''}`, `
        ${steps.map(s=>`
          <div class="check ${d.reset[s.id]?'done':''}" data-reset="${s.id}">
            <div class="box">✓</div><div class="lbl">${esc(s.label)}</div>
          </div>`).join('')}
      `)}

      ${panel('wins','Four Wins + One No', winsSummary(d), `
        ${focusRow('Health','health','#1 HEALTH','Health win')}
        ${focusRow('Leverage','lev','#1 SYSTEMS','Systems / leverage win')}
        ${focusRow('Content','content','#1 CONTENT','Content / brand win')}
        ${focusRow('NOT today','not','NOT DOING','What you are NOT doing today')}
        <div class="grid2" style="margin-top:14px">
          <div class="field" style="margin-bottom:0"><label>Workout</label>
            <input type="text" data-state="workout" value="${esc(d.workout||'')}" placeholder="e.g. 5:30pm"></div>
          <div class="field" style="margin-bottom:0"><label>Shutdown</label>
            <input type="text" data-state="shutdownTime" value="${esc(d.shutdownTime||'')}" placeholder="e.g. 9:30pm"></div>
        </div>
      `)}

      ${panel('mood','Energy & Mood', `${d.checkins.length} logged${d.sleep?' · slept '+esc(d.sleep):''}`, `
        <div class="checkin-add">
          <div class="energy-pills" data-checkinenergy>
            ${['Low','Medium','High'].map(v=>`<button data-cke="${v}" class="${ciDraft.energy===v?'sel':''}">${v}</button>`).join('')}
          </div>
          <input type="text" id="ckMood" value="${esc(ciDraft.mood)}" placeholder="mood word">
          <button class="btn sm" id="ckLog">+ Log</button>
        </div>
        <div class="field" style="margin:12px 0 0"><label>Sleep last night</label>
          <input type="text" data-state="sleep" value="${esc(d.sleep||'')}" placeholder="e.g. 7h, solid"></div>
        ${d.checkins.length?`<div class="checkin-list" style="margin-top:12px">
          ${[...d.checkins].reverse().map(c=>`
            <div class="checkin-row">
              <span class="ck-time">${c.t}</span>
              <span class="ck-energy e${energyToNum(c.energy)}">${['','Low','Med','High'][energyToNum(c.energy)]||c.energy}</span>
              <span class="ck-mood">${esc(c.mood||'—')}</span>
              <span class="x" data-ckdel="${c.ts}">×</span>
            </div>`).join('')}
        </div>`:''}
      `)}

      <p class="list-note"><span class="serif">"Don't react until you run MarcoMaster."</span></p>
    </div>
  </div>
  `;
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
  return `
  <div class="pipeline-card">
    <div class="pipeline-head">
      <span class="pl-kick">The Pipeline</span>
      <span class="pl-sub">your 3 for today · resets each morning</span>
    </div>
    <div class="pipeline-slots">${slots}</div>
  </div>`;
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
}
function winsSummary(d){
  const set=['health','lev','content','not'].filter(k=>d.focus[k]&&d.focus[k].trim()).length;
  return set?`${set}/4 set`:'tap to set';
}

/* ---------- TASK INBOX (lives on Today) ---------- */
function renderTaskInbox(){
  const quick=quickTasks();
  const projects=projectTasks();
  const unsched=unscheduledProjects();
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
function renderActiveProjects(){
  const active=(S.projects||[]).filter(p=>!p.done);
  if(!active.length){
    return `
    <div class="card">
      <div class="card-h"><h3>Active Projects</h3><span class="sub">0</span></div>
      <div class="empty">No active projects yet — add one on the Projects page.</div>
    </div>`;
  }
  const taskRow=(p,t)=>{
    const st=projTaskState(p.id,t);
    if(st.state==='done'){              // complete → crossed out (reuses .ptask-row.done)
      return `<div class="ptask-row done">
        <span class="box" data-aptdone="${p.id}|${t.id}">✓</span>
        <span class="ptxt">${esc(t.txt)}</span></div>`;
    }
    if(st.state==='scheduled'){         // scheduled → yellow tag with date + time
      return `<div class="ptask-row scheduled">
        <span class="box" data-aptdone="${p.id}|${t.id}">✓</span>
        <span class="ptxt">${esc(t.txt)}</span>
        <span class="sched-tag yellow">${schedLabel(st.tb)}</span>
        <span class="to-pipe" data-plpromote-proj="${p.id}|${t.id}" title="Promote to pipeline">↑</span></div>`;
    }
    return `<div class="ptask-row">     <!-- unscheduled → tap to schedule -->
      <span class="box" data-aptdone="${p.id}|${t.id}">✓</span>
      <span class="ptxt" data-aptsched="${p.id}|${t.id}" style="cursor:pointer">${esc(t.txt)}</span>
      <span class="to-pipe" data-plpromote-proj="${p.id}|${t.id}" title="Promote to pipeline">↑</span>
      <span class="to-today" data-aptsched="${p.id}|${t.id}">⏱ schedule</span></div>`;
  };
  const projRow=(p)=>{
    const s=projectStats(p); const open=!!projOpen[p.id]; const tasks=p.tasks||[];
    return `
    <div class="panel ${open?'open':''}">
      <button class="panel-h" data-projpanel="${p.id}">
        <span class="panel-caret">${open?'▾':'▸'}</span>
        <span class="proj-swatch" style="background:${p.color}"></span>
        <span class="panel-title">${esc(p.name)}</span>
        <span class="panel-meta">${s.done}/${s.total}</span>
      </button>
      <div class="proj-track" style="margin:0 16px 12px"><div class="proj-fill" style="width:${s.pct}%;background:${p.color}"></div></div>
      ${open?`<div class="panel-body" style="padding-top:0">
        <div class="proj-tasks">
          ${tasks.length?tasks.map(t=>taskRow(p,t)).join(''):'<div class="empty sm">No tasks yet.</div>'}
        </div>
      </div>`:''}
    </div>`;
  };
  return `
  <div class="card">
    <div class="card-h"><h3>Active Projects</h3><span class="sub">${active.length}</span></div>
    ${active.map(projRow).join('')}
  </div>`;
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
  const gp=q('#goPlan'); if(gp) gp.onclick=()=>go('plan');
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
function bindToday(){
  // collapsible panel toggles
  q('[data-panel]','all').forEach(el=>el.onclick=()=>{
    const k=el.dataset.panel; todayOpen[k]=!todayOpen[k]; rerender();
  });
  q('[data-reset]','all').forEach(el=>el.onclick=()=>{
    const id=el.dataset.reset; const d=day(); d.reset[id]=!d.reset[id];
    save(false); rerender();
  });
  q('[data-focus]','all').forEach(el=>el.oninput=()=>{ day().focus[el.dataset.focus]=el.value; save(); });
  q('[data-state]','all').forEach(el=>el.oninput=()=>{ day()[el.dataset.state]=el.value; save(); });
  // throughout-day energy/mood logger
  q('[data-checkinenergy] [data-cke]','all').forEach(el=>el.onclick=()=>{
    ciDraft.energy=el.dataset.cke;
    q('[data-checkinenergy] [data-cke]','all').forEach(b=>b.classList.toggle('sel',b===el));
  });
  const ckMood=q('#ckMood'); if(ckMood) ckMood.oninput=()=>{ ciDraft.mood=ckMood.value; };
  const ckLog=q('#ckLog'); if(ckLog) ckLog.onclick=()=>{
    day().checkins.push({t:nowHM(),ts:Date.now(),energy:ciDraft.energy,mood:ciDraft.mood.trim()});
    ciDraft={energy:'Medium',mood:''}; save(); rerender();
  };
  q('[data-ckdel]','all').forEach(el=>el.onclick=()=>{
    day().checkins=day().checkins.filter(c=>String(c.ts)!==el.dataset.ckdel); save(); rerender();
  });
  // Active Projects: expand/collapse, schedule an unscheduled task, toggle done
  q('[data-projpanel]','all').forEach(el=>el.onclick=()=>{ const id=el.dataset.projpanel; projOpen[id]=!projOpen[id]; rerender(); });
  q('[data-aptsched]','all').forEach(el=>el.onclick=(e)=>{
    e.stopPropagation(); const [pid,tid]=el.dataset.aptsched.split('|'); openProjSchedule(pid,tid);
  });
  q('[data-aptdone]','all').forEach(el=>el.onclick=(e)=>{
    e.stopPropagation(); const [pid,tid]=el.dataset.aptdone.split('|');
    const p=(S.projects||[]).find(x=>x.id===pid); const t=p&&p.tasks.find(x=>x.id===tid);
    if(t){ setProjTaskDone(pid,tid,!t.done); save(false); rerender(); }
  });
  // promote actions (from inbox tasks and project tasks) → pipeline
  q('[data-plpromote-task]','all').forEach(el=>el.onclick=(e)=>{ e.stopPropagation(); promoteTaskToPipeline(el.dataset.plpromoteTask); });
  q('[data-plpromote-proj]','all').forEach(el=>el.onclick=(e)=>{ e.stopPropagation(); const [pid,tid]=el.dataset.plpromoteProj.split('|'); promoteProjToPipeline(pid,tid); });
  bindPipeline();          // the top-3 pipeline hero
  bindTaskInbox();
  bindFollowups();         // full follow-ups list in the sidebar
}

