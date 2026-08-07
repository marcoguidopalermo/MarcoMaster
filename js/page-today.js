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

  ${renderCapture()}

  <button class="fsn-cta" id="fsnCta">
    <span class="fsn-cta-ic">☼</span>
    <span class="fsn-cta-txt"><b>Read your Future Self Narrative</b><span>Start the morning by remembering where you're going</span></span>
    <span class="fsn-cta-go">→</span>
  </button>

  <div class="dash-actions">
    ${renderFireCTA()}
    ${renderLeaksCta()}
  </div>

  ${renderTodayStrip()}

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
  if(it.leakId){ const t=leakTask(it.leakId,it.leakTaskId); return t?t.done:!!it.done; }
  return !!it.done;
}
/* 🔥 priority of the task behind a pipeline item (for the marker only) */
function pipelinePriority(it){
  if(it.taskId){ const t=day().tasks.find(x=>x.id===it.taskId); return !!(t&&t.priority); }
  if(it.projectId){ const p=(S.projects||[]).find(x=>x.id===it.projectId); const t=p&&p.tasks.find(x=>x.id===it.projTaskId); return !!(t&&t.priority); }
  if(it.leakId){ const t=leakTask(it.leakId,it.leakTaskId); return !!(t&&t.priority); }
  return !!it.priority;
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
        <span class="pl-txt">${pipelinePriority(it)?'<span class="prio-mark">🔥</span> ':''}${esc(it.txt)}</span>
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
  }else if(it.leakId){
    setLeakTaskDone(it.leakId, it.leakTaskId, nd);   // may auto-promote the leak to Watching
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
     • ▣ Time blocks — kind==='project' tasks (standalone time-blocks +
                       project tasks needing / having a calendar slot). The word
                       "Scheduled" only appears once a task has a real time block.
   Project tasks live in S.projects[*].tasks (labelled with the project
   dot+name); standalone tasks live in day().tasks (labelled Quick /
   Scheduled). A scheduled project task is surfaced through its project
   row — its linked day().task block (projectId set) is excluded so each
   task appears exactly once. Carry-over is untouched (reads live). */

/* Build the two flat, de-duplicated sections. Each row carries a `key`
   ("P|projId|taskId" for a project task, "S|taskId" for a standalone
   day-task) so the bind handlers can dispatch uniformly. */
let archiveOpen=false;    // Archive dropdown (default collapsed)
function buildTaskRows(){
  const tk=todayKey();
  const rows=[];
  // project tasks (active projects) — the canonical list
  (S.projects||[]).filter(p=>!p.done).forEach(p=>{
    (p.tasks||[]).forEach(t=>{
      const kind=t.kind||'project';          // legacy project tasks default to time-block
      const row={key:'P|'+p.id+'|'+t.id, source:'project', projId:p.id, id:t.id,
                 txt:t.txt, done:t.done, kind, recurringId:null, priority:!!t.priority,
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
  // leak tasks — a leak is a container like a project. Quick-only, so they never
  // enter the time-block/backlog machinery; they simply show as leak-labelled quick
  // rows. Closed leaks' tasks stay out of the active list.
  (S.leaks||[]).filter(l=>l.status!=='closed').forEach(l=>{
    (l.tasks||[]).forEach(t=>{
      rows.push({key:'L|'+l.id+'|'+t.id, source:'leak', leakId:l.id, id:t.id,
                 txt:t.txt, done:t.done, kind:'quick', recurringId:null, priority:!!t.priority,
                 leakText:l.text, projName:null, projColor:null});
    });
  });
  // standalone day-tasks — exclude project-linked blocks (surfaced via their
  // project) and meeting blocks (live on the calendar grid)
  day().tasks.filter(t=>!t.projectId && !t.meetingId).forEach(t=>{
    const row={key:'S|'+t.id, source:'standalone', id:t.id, txt:t.txt, done:t.done,
               kind:t.kind, recurringId:t.recurringId, priority:!!t.priority, projName:null, projColor:null};
    if(t.kind==='project'){
      row.scheduled=t.schedDate!=null; row.schedDate=t.schedDate; row.start=t.start;
      row.mins=t.mins; row.overdue=t.schedDate!=null && t.schedDate<tk && !t.done;
    }
    rows.push(row);
  });
  return { quick: rows.filter(r=>r.kind==='quick'), scheduled: rows.filter(r=>r.kind==='project') };
}
/* ============================================================
   TASK GROUPS — ONE builder for every full-screen surface.
   The fire picker and the "see all tasks" overlay want the same thing (everything
   open, grouped, colour-coded, deduped, 🔥 first) with two differences, so they are
   options rather than a second implementation:
     splitKinds : false → one "Tasks" group (fire picker, unchanged behaviour)
                  true  → separate ⚡ Quick and ▣ Time blocks groups
     bareLeaks  : true  → a leak with no tasks is itself selectable (fightable)
                  false → omitted; a leak is not a task
   Keys are ROW keys throughout ('S|id', 'P|proj|task', 'L|leak|task', 'L|leak'),
   so atPriority/atToggle/atKey accept them directly.
   ============================================================ */
function taskGroups(opts){
  opts=opts||{};
  const splitKinds=!!opts.splitKinds, bareLeaks=!!opts.bareLeaks;
  const groups=[], seen=new Set();
  const add=(g,key,txt,o)=>{ if(!txt||seen.has(key)) return; seen.add(key); g.items.push(Object.assign({key,txt},o||{})); };

  const pipe={title:'Pipeline', cls:'g-pipe', color:'var(--accent)', items:[]};
  (day().pipeline||[]).forEach(it=>{
    if(it.taskId){ const t=day().tasks.find(x=>x.id===it.taskId); if(t&&!t.done) add(pipe,'S|'+t.id,t.txt,{ic:'◈',priority:!!t.priority}); }
    else if(it.projectId){
      const p=(S.projects||[]).find(x=>x.id===it.projectId);
      const t=p&&(p.tasks||[]).find(x=>x.id===it.projTaskId);
      if(t&&!t.done) add(pipe,'P|'+it.projectId+'|'+it.projTaskId,t.txt,{ic:'◈',priority:!!t.priority});
    }
    else if(it.leakId){
      const t=leakTask(it.leakId,it.leakTaskId);
      if(t&&!t.done) add(pipe,'L|'+it.leakId+'|'+it.leakTaskId,t.txt,{ic:'◈',priority:!!t.priority});
    }
  });
  if(pipe.items.length) groups.push(pipe);

  // standalone day-tasks (project-linked blocks surface via their project; meeting
  // blocks live on the calendar grid) — same exclusions buildTaskRows() uses
  const quick={title:'⚡ Quick', cls:'g-task', color:'var(--txt-dim)', items:[]};
  const blocks={title:'▣ Time blocks', cls:'g-task', color:'var(--txt-dim)', items:[]};
  const one={title:'Tasks', cls:'g-task', color:'var(--txt-dim)', items:[]};
  day().tasks.filter(t=>!t.done && !t.projectId && !t.meetingId).forEach(t=>
    add(splitKinds?(t.kind==='quick'?quick:blocks):one, 'S|'+t.id, t.txt, {ic:t.kind==='quick'?'⚡':'▣', priority:!!t.priority}));
  if(splitKinds){ if(quick.items.length) groups.push(quick); if(blocks.items.length) groups.push(blocks); }
  else if(one.items.length) groups.push(one);

  (S.projects||[]).filter(p=>!p.done).forEach(p=>{
    const g={title:p.name, cls:'g-proj', color:p.color||'var(--accent)', items:[]};
    (p.tasks||[]).forEach(t=>{ if(!t.done) add(g,'P|'+p.id+'|'+t.id,t.txt,{priority:!!t.priority}); });
    if(g.items.length) groups.push(g);
  });

  // a leak with open tasks contributes its own group; a taskless leak is only
  // offered where the leak ITSELF is actionable (the fire picker)
  const bare={title:'💧 Leaks', cls:'g-leak', color:'var(--blue)', items:[]};
  (S.leaks||[]).filter(l=>l.status!=='closed').slice().sort(leakSort).forEach(l=>{
    const open=(l.tasks||[]).filter(t=>!t.done);
    if(open.length){
      const g={title:'💧 '+l.text, cls:'g-leak', color:'var(--blue)', items:[]};
      open.forEach(t=> add(g,'L|'+l.id+'|'+t.id,t.txt,{priority:!!t.priority}));
      if(g.items.length) groups.push(g);
    }else if(bareLeaks){
      add(bare,'L|'+l.id,l.text,{badge:leakCount(l)+'×',badgeCls:leakBadgeClass(l)});
    }
  });
  if(bare.items.length) groups.push(bare);

  groups.forEach(g=>g.items.sort((a,b)=>(b.priority?1:0)-(a.priority?1:0)));   // 🔥 to the top of its group
  return groups;
}

/* stable sort: priority (🔥) rows rise to the TOP of a section; everything else
   keeps its existing relative order below. */
function prioritySort(rows){ return rows.slice().sort((a,b)=>(a.priority?0:1)-(b.priority?0:1)); }
/* THE SHORTLIST — only what you flagged 🔥, across quick, time-block, project and
   leak tasks. The dashboard is what you CHOSE; "See all tasks" is where you compare
   everything and choose. The overdue count is deliberately computed across ALL open
   tasks, not just flagged ones: an unflagged overdue item still has to nudge you,
   and a count (rather than a row) keeps the shortlist from becoming a wall. */
function renderAllTasks(){
  const {quick,scheduled}=buildTaskRows();
  const openQuick=quick.filter(r=>!r.done), openSched=scheduled.filter(r=>!r.done);
  const flagged=[...openQuick.filter(r=>r.priority), ...openSched.filter(r=>r.priority)];
  const openCt=openQuick.length+openSched.length;
  const overdueCt=openSched.filter(r=>r.overdue).length;
  const archiveAll=completedRows('all');
  return `
  <div class="card all-tasks" style="border-top:3px solid var(--accent)">
    <div class="card-h">
      <h3>🔥 Priority</h3>
      <span class="ch-actions">
        <span class="sub">${flagged.length} flagged${overdueCt?` · <span class="at-overdue-ct">${overdueCt} overdue</span>`:''} · ${openCt} open</span>
        <button class="btn ghost sm" id="seeAllTasks">See all tasks</button>
      </span>
    </div>

    ${flagged.length
      ? `<div class="at-rows">${flagged.map(renderTaskRow).join('')}</div>`
      : `<div class="shortlist-empty">
          <span class="sl-line">Nothing flagged for today.</span>
          <span class="sl-sub">Open <b>See all tasks</b> to survey everything and pick what matters.</span>
          <button class="btn ghost sm" id="seeAllTasksEmpty">See all tasks</button>
        </div>`}

    ${renderArchiveSection(archiveAll)}
  </div>`;
}

/* ============================================================
   SEE ALL TASKS — the survey-and-choose overlay.
   Same .pick-screen component as the fire picker and the leaks overlay (one visual
   language for all three), same taskGroups() builder, same fitPickScreen() density
   step-down. Hosted in #taskScreen OUTSIDE .app, so the rerender() that updates the
   dashboard behind it can never disturb it.
   ============================================================ */
let taskScreenOpen=false;
function openTaskScreen(){ taskScreenOpen=true; paintTaskScreen(); }
function closeTaskScreen(){ taskScreenOpen=false; paintTaskScreen(); }

function taskScreenHTML(){
  const groups=taskGroups({splitKinds:true, bareLeaks:false});
  const total=groups.reduce((n,g)=>n+g.items.length,0);
  const flagged=groups.reduce((n,g)=>n+g.items.filter(i=>i.priority).length,0);
  /* the one markup difference from the fire picker: a triage row carries two
     independent controls, so it is a div with a ✓ and a 🔥 rather than one button.
     Base class, columns, truncation and all three density tiers are shared. */
  const row=(it)=>`<div class="pick-row has-actions ${it.priority?'is-flagged':''}">
      <span class="pick-check" data-tsdone="${esc(it.key)}" title="Mark done">✓</span>
      ${it.ic?`<span class="pick-ic">${it.ic}</span>`:''}
      <span class="pick-txt">${esc(it.txt)}</span>
      <span class="pick-flag ${it.priority?'on':''}" data-tsflag="${esc(it.key)}" title="${it.priority?'Unflag — remove from the shortlist':'Flag 🔥 — promote to the shortlist'}">🔥</span>
    </div>`;
  const group=(g)=>`<section class="pick-group ${g.cls}" style="--gc:${g.color}">
      <h3 class="pick-g-title">${esc(g.title)}<span class="pick-g-ct">${g.items.length}</span></h3>
      <div class="pick-rows">${g.items.map(row).join('')}</div>
    </section>`;
  return `<div class="pick-inner">
    <header class="pick-head">
      <div class="pick-h-txt"><h2>All tasks</h2>
        <p>Everything open, in one place. 🔥 promotes to the dashboard shortlist · ✓ clears what's already done.</p></div>
      <span class="pick-h-ct">${flagged} flagged · ${total} open</span>
      <button class="pick-close" id="taskScreenClose" title="Close">×</button>
    </header>
    ${total
      ? `<div class="pick-body">${groups.map(group).join('')}</div>`
      : `<div class="empty">Nothing open. Capture something at the top of the Dashboard.</div>`}
  </div>`;
}

function paintTaskScreen(){
  const el=q('#taskScreen'); if(!el) return;
  if(!taskScreenOpen){ el.classList.remove('show'); el.innerHTML=''; document.body.classList.remove('pick-open'); return; }
  el.innerHTML=taskScreenHTML();
  el.classList.add('show');
  document.body.classList.add('pick-open');
  bindTaskScreen();
  fitPickScreen(el);            // re-fit: rows disappear as you complete them
}

function bindTaskScreen(){
  const cl=q('#taskScreenClose'); if(cl) cl.onclick=closeTaskScreen;
  // Both handlers reuse the existing row-key actions, which already cover all four
  // key forms AND already end in rerender() — that rebuilds #main, so the dashboard
  // shortlist behind the overlay updates instantly. We then repaint the overlay.
  q('#taskScreen [data-tsflag]','all').forEach(el=>el.onclick=()=>{ atPriority(el.dataset.tsflag); paintTaskScreen(); });
  q('#taskScreen [data-tsdone]','all').forEach(el=>el.onclick=()=>{ atToggle(el.dataset.tsdone); paintTaskScreen(); });
}

/* Completed Today renders as its own block high on the Dashboard (below the
   Pipeline, above All Tasks). Same data + row behaviour; '' when empty. Its
   rows reuse the data-atcheck / data-atdel handlers bound by bindAllTasks. */
function renderCompletedToday(){
  const rows=completedRows('today');
  // ONE list of what got done. The fire stats ride in the header because they're the
  // only thing the list itself can't say (a returned-to-queue session shows up
  // nowhere else, so the card renders for stats alone too).
  const stats=(typeof fireStatsLine==='function') ? fireStatsLine() : '';
  if(!rows.length && !stats) return '';
  return `<div class="card completed-today-card">${renderCompletedSection('✓ Completed Today', rows, stats)}</div>`;
}
/* the inline label on each flat row: project dot+name, or a Quick / Time-block TYPE
   chip. It never says "Scheduled" — the real scheduled / to-schedule state is shown
   by the tag in renderTaskRow, so the word "Scheduled" only appears once a task
   actually has a time block on the calendar. */
function taskLabelChip(r){
  if(r.source==='project') return `<span class="proj-chip" style="--pc:${r.projColor}">${esc(r.projName)}</span>`;
  // leak tasks reuse the project chip in water blue — same component, leak identity
  if(r.source==='leak') return `<span class="proj-chip leak-task-chip" style="--pc:var(--blue)">💧 ${esc(r.leakText)}</span>`;
  return `<span class="type-chip ${r.kind==='quick'?'q':'s'}">${r.kind==='quick'?'⚡ Quick':'▣ Time block'}</span>`;
}
function renderTaskRow(r){
  let tag='';
  if(r.kind==='project' && !r.done){
    if(r.overdue) tag=`<span class="sched-tag overdue" title="Scheduled in the past — requires completion">⚠ Overdue · ${schedLabel({schedDate:r.schedDate,start:r.start})}</span>`;
    else if(r.scheduled) tag=`<span class="sched-tag yellow">Scheduled · ${schedLabel({schedDate:r.schedDate,start:r.start})}</span>`;
    else tag=`<span class="sched-tag toschedule" title="No time block yet — give it a time on the calendar">To schedule</span>`;
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
    <span class="at-act prio ${r.priority?'on':''}" data-atprio="${r.key}" title="${r.priority?'Priority — click to unflag':'Flag as priority'}">🔥</span>
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
  // Extinguishing a fire routes through normal task completion, so a fired task is
  // already in this list — it just needs its 🔥 marker and focus time. One map per
  // render rather than a lookup per row.
  const fm=(typeof fireMinutesByKeyToday==='function') ? fireMinutesByKeyToday() : {};
  // A) project tasks (done) — dated by their doneAt stamp
  (S.projects||[]).forEach(p=>{
    (p.tasks||[]).filter(t=>t.done).forEach(t=>{
      const when=t.doneAt||null;
      if(scope==='today' && when!==tk) return;
      out.push({source:'project', key:'P|'+p.id+'|'+t.id, txt:t.txt, kind:t.kind||'project',
                projName:p.name, projColor:p.color, when, priority:!!t.priority,
                fireMin:fm['P|'+p.id+'|'+t.id]||0});
    });
  });
  // A2) leak tasks (done) — dated by doneAt exactly like project tasks
  (S.leaks||[]).forEach(l=>{
    (l.tasks||[]).filter(t=>t.done).forEach(t=>{
      const when=t.doneAt||null;
      if(scope==='today' && when!==tk) return;
      out.push({source:'leak', key:'L|'+l.id+'|'+t.id, txt:t.txt, kind:'quick',
                leakText:l.text, when, priority:!!t.priority,
                fireMin:fm['L|'+l.id+'|'+t.id]||0});
    });
  });
  // B) standalone done day-tasks + C) swept archive entries — dated by day record
  Object.keys(S.days||{}).forEach(dk=>{
    if(scope==='today' && dk!==tk) return;
    const d=S.days[dk]||{};
    (d.tasks||[]).filter(t=>t.done && !t.projectId && !t.meetingId).forEach(t=>{
      // fire sessions key standalone tasks by the BARE id (not the 'S|' row key)
      out.push({source:'standalone', key:'S|'+t.id, txt:t.txt, kind:t.kind, when:dk, priority:!!t.priority,
                fireMin:fm['S|'+t.id]||fm[t.id]||0});
    });
    (d.archive||[]).forEach(a=>{
      // a swept task keeps its id, so a fire fought on it still resolves here
      out.push({source:'archive', dayKey:dk, id:a.id, txt:a.txt, kind:a.kind, when:dk, time:a.doneAt,
                fireMin:fm['S|'+a.id]||fm[a.id]||0});
    });
  });
  // newest first
  out.sort((x,y)=>((y.when||'')+(y.time||'')).localeCompare((x.when||'')+(x.time||'')));
  return out;
}
function renderCompletedSection(title, rows, extra){
  return `
  <div class="at-section completed">
    <div class="at-sec-h"><span class="at-sec-lab">${title}</span>${extra||''}<span class="at-sec-ct">${rows.length}</span></div>
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
    : r.source==='leak'
    ? `<span class="proj-chip leak-task-chip" style="--pc:var(--blue)">💧 ${esc(r.leakText)}</span>`
    : `<span class="type-chip ${r.kind==='quick'?'q':'s'}">${r.kind==='quick'?'⚡ Quick':'▣ Time block'}</span>`;
  const when = withDate ? (r.when?`<span class="done-when">${shortDate(r.when)}</span>`:'')
                        : (r.time?`<span class="done-when">${r.time}</span>`:'');
  const mark = r.priority?'<span class="prio-mark">🔥</span> ':'';
  // completed inside a focus session → 🔥 + the time actually spent on it
  const fire = r.fireMin ? `<span class="done-fire" title="Completed in a fire session">🔥 ${fmtFocus(r.fireMin)}</span>` : '';
  if(r.source==='archive'){
    return `<div class="at-row done">
      <div class="box done-static" title="archived">✓</div>
      <span class="at-txt">${mark}${esc(r.txt)}</span>${chip}${fire}${when}
      <span class="x" data-arcdel="${r.dayKey}|${r.id}" title="Delete from archive">×</span>
    </div>`;
  }
  return `<div class="at-row done">
    <div class="box" data-atcheck="${r.key}" title="Mark not done (reactivate)">✓</div>
    <span class="at-txt">${mark}${esc(r.txt)}</span>${chip}${fire}${when}
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
    const t={id:b(), txt, done:false, priority:false, kind};
    if(kind==='project') t.mins=mins||60;     // remembered as the scheduler's default
    p.tasks.push(t);
    save();
  }else{
    addTask(txt, kind, kind==='project'?(mins||60):2);   // standalone day-task (saves itself)
  }
}

/* ---- unified-list actions: dispatch by row key ("P|projId|id" | "S|id") ---- */
/* Row-key parser. 'P|projId|taskId' = project task, 'L|leakId|taskId' = leak task,
   'L|leakId' (two segments) = the leak ITSELF (fire-picker only), 'S|id' = standalone. */
function atKey(key){
  const a=String(key).split('|');
  if(a[0]==='P') return {src:'project', projId:a[1], id:a[2]};
  if(a[0]==='L') return a.length>2 ? {src:'leak', leakId:a[1], id:a[2]} : {src:'leakself', leakId:a[1], id:null};
  return {src:'standalone', id:a[1]};
}
function atToggle(key){
  const k=atKey(key);
  if(k.src==='leak'){
    const t=leakTask(k.leakId,k.id); if(!t) return;
    setLeakTaskDone(k.leakId, k.id, !t.done);   // may auto-promote the leak Open → Watching
    save(false); rerender(); return;
  }
  if(k.src==='project'){
    const p=(S.projects||[]).find(x=>x.id===k.projId); const t=p&&p.tasks.find(x=>x.id===k.id); if(!t) return;
    setProjTaskDone(k.projId,k.id,!t.done);    // keeps linked blocks + progress in sync
  }else{
    // usually today's record; fall back to a global lookup so a time-block task
    // living in another day record (e.g. surfaced in the TODAY strip from the
    // calendar grid) still toggles correctly
    let t=day().tasks.find(x=>x.id===k.id);
    if(!t){ const g=findTaskGlobal(k.id); t=g&&g.t; }
    if(!t) return;
    t.done=!t.done;
    if(t.done && t.recurringId) markRecurringDone(t.recurringId);
    if(t.projectId && t.projTaskId){ const p=S.projects.find(x=>x.id===t.projectId); const pt=p&&p.tasks.find(x=>x.id===t.projTaskId); if(pt) pt.done=t.done; }
  }
  save(false); rerender();
}
function atPromote(key){
  const k=atKey(key);
  if(k.src==='project') promoteProjToPipeline(k.projId,k.id);
  else if(k.src==='leak') promoteLeakToPipeline(k.leakId,k.id);
  else promoteTaskToPipeline(k.id);
}
/* a leak task in the pipeline keeps a persistent link, like a project task */
function promoteLeakToPipeline(leakId, ltId){
  const d=day(); if(!d.pipeline) d.pipeline=[];
  if(d.pipeline.length>=3){ toast('Pipeline is full (3)'); return; }
  if(d.pipeline.some(it=>it.leakId===leakId && it.leakTaskId===ltId)){ toast('Already in pipeline'); return; }
  const t=leakTask(leakId,ltId); if(!t) return;
  d.pipeline.push({id:b(), txt:t.txt, leakId, leakTaskId:ltId, done:t.done});
  save(); toast('↑ Pipeline'); rerender();
}
/* toggle the 🔥 priority flag on the underlying task (project task or day-task) */
function atPriority(key){
  const k=atKey(key);
  if(k.src==='leak'){ const t=leakTask(k.leakId,k.id); if(!t) return; t.priority=!t.priority; save(false); rerender(); return; }
  if(k.src==='project'){
    const p=(S.projects||[]).find(x=>x.id===k.projId); const t=p&&p.tasks.find(x=>x.id===k.id); if(!t) return;
    t.priority=!t.priority;
    allTimeBlockTasks().forEach(e=>{ if(e.t.projectId===k.projId && e.t.projTaskId===k.id) e.t.priority=t.priority; });  // keep linked block in sync
  }else{
    let t=day().tasks.find(x=>x.id===k.id);
    if(!t){ const g=findTaskGlobal(k.id); t=g&&g.t; }
    if(!t) return;
    t.priority=!t.priority;
  }
  save(false); rerender();
}
function atEdit(key){
  const k=atKey(key);
  if(k.src==='leak'){
    const t=leakTask(k.leakId,k.id); if(!t) return;
    const v=prompt('Edit task', t.txt); if(v==null) return; const nv=v.trim(); if(!nv) return;
    t.txt=nv; save(); rerender(); return;
  }
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
  if(k.src==='leak'){
    const l=(S.leaks||[]).find(x=>x.id===k.leakId); if(!l) return;
    l.tasks=(l.tasks||[]).filter(x=>x.id!==k.id);
    Object.keys(S.days||{}).forEach(dk=>{ const d=S.days[dk]; if(d.pipeline) d.pipeline=d.pipeline.filter(it=>!(it.leakId===k.leakId && it.leakTaskId===k.id)); });
    leakSyncWatching(k.leakId);
    save(); rerender(); return;
  }
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
  // Adding lives in unified Capture at the top of the Dashboard (capture.js) —
  // this list is a view + row actions only. addUnifiedTask() is still the writer,
  // now called from there.
  // ---- see-all overlay + archive dropdown ----
  const sa=q('#seeAllTasks'); if(sa) sa.onclick=openTaskScreen;
  const sae=q('#seeAllTasksEmpty'); if(sae) sae.onclick=openTaskScreen;
  const arch=q('[data-archtoggle]'); if(arch) arch.onclick=()=>{ archiveOpen=!archiveOpen; rerender(); };
  q('[data-arcdel]','all').forEach(el=>el.onclick=()=>{ const [dk,id]=el.dataset.arcdel.split('|'); const d=S.days[dk]; if(d&&d.archive){ d.archive=d.archive.filter(a=>a.id!==id); save(); rerender(); } });
  // ---- row actions ----
  q('[data-atcheck]','all').forEach(el=>el.onclick=()=>atToggle(el.dataset.atcheck));
  q('[data-atpipe]','all').forEach(el=>el.onclick=(e)=>{ e.stopPropagation(); atPromote(el.dataset.atpipe); });
  q('[data-atprio]','all').forEach(el=>el.onclick=(e)=>{ e.stopPropagation(); atPriority(el.dataset.atprio); });
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
   All Tasks list. Tasks added here default to time-block (▣ Time blocks). */
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
            <span class="pm-txt">${t.priority?'<span class="prio-mark">🔥</span> ':''}${esc(t.txt)}</span>
            ${tag}
            <span class="to-pipe prio ${t.priority?'on':''}" data-pmprio="${t.id}" title="${t.priority?'Priority — click to unflag':'Flag as priority'}">🔥</span>
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
  q('[data-pmprio]','all').forEach(el=>el.onclick=()=>{ const t=p.tasks.find(x=>x.id===el.dataset.pmprio); if(!t) return; t.priority=!t.priority; allTimeBlockTasks().forEach(e=>{ if(e.t.projectId===p.id && e.t.projTaskId===t.id) e.t.priority=t.priority; }); save(false); renderProjectModal(); rerender(); });
  q('[data-pmpipe]','all').forEach(el=>el.onclick=()=>{ promoteProjToPipeline(p.id, el.dataset.pmpipe); renderProjectModal(); });
  q('[data-pmedit]','all').forEach(el=>el.onclick=()=>{ const t=p.tasks.find(x=>x.id===el.dataset.pmedit); if(!t) return; const v=prompt('Edit task', t.txt); if(v==null) return; const nv=v.trim(); if(!nv) return; t.txt=nv; allTimeBlockTasks().forEach(e=>{ if(e.t.projectId===p.id && e.t.projTaskId===t.id) e.t.txt=nv; }); save(); renderProjectModal(); rerender(); });
  q('[data-pmsched]','all').forEach(el=>el.onclick=()=>{ openProjSchedule(p.id, el.dataset.pmsched); });  // replaces modal with scheduler
  const ai=q('#pmAdd'); if(ai) ai.oninput=()=>{ projModalDraft=ai.value; };
  const addT=()=>{ const v=(projModalDraft||'').trim(); if(!v) return; p.tasks.push({id:b(),txt:v,done:false,priority:false,kind:'project',mins:60}); projModalDraft=''; save(); renderProjectModal(); rerender(); };
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

function bindDashboard(){
  // Morning surfacing: jump straight into the Future Self Narrative reader
  const fc=q('#fsnCta'); if(fc) fc.onclick=()=>go('fsn');
  // Fire Station: start-a-fire CTA / return-to-fire, and evidence card
  bindFireDash();
  // Unified capture — the app's single general entry point (top of the Dashboard)
  bindCapture();
  // Leak Management: the CTA opens the full-screen leaks overlay (#leakScreen,
  // outside #main — see page-leaks.js). Capture lives in the unified line above.
  bindLeaksCta();

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
  // Cancel a scheduled meeting straight from the dashboard strip (don't open the modal)
  q('[data-mcancel]','all').forEach(el=>el.onclick=e=>{ e.stopPropagation(); if(cancelMeetingSchedule(el.dataset.mcancel)) rerender(); });

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

